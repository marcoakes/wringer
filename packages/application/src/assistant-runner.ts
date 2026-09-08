import { constants } from "node:fs";
import { lstat, mkdir, realpath, open, link, unlink, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";

/** The daemon owns this queue. Transport lifetime is deliberately not an input.
 * These records detect corruption, not tampering by the OS owner. execute is a
 * construction-only application dependency and must recheck domain authority. */
export interface AssistantRunnerRequest { id: string; jobId: string; kind: string; body: Record<string, unknown>; }
export type AssistantOperationStatus = "accepted" | "running" | "cancel-requested" | "completed" | "failed" | "cancelled" | "uncertain";
export interface AssistantRunnerOperation {
    id: string; jobId: string; kind: string; requestSha256: string; status: AssistantOperationStatus;
    acceptedAt: string; cancellationRequested: boolean; result?: unknown; error?: string;
    reconciliation?: { evidenceSha256: string; priorStatus: "uncertain"; priorError?: string };
}
export interface AssistantRunnerOwner { token: string; pid: number; at: string; }
export interface AssistantRunnerStatus {
    owner: AssistantRunnerOwner | null; ownerState: "absent" | "live" | "dead" | "unknown";
    recoveryRequired: boolean; acceptingDispatch: boolean; activeOperationId: string | null; error: string | null;
}
export interface AssistantRunnerOptions {
    execute: (request: AssistantRunnerRequest, signal: AbortSignal) => Promise<unknown>;
    pollIntervalMs?: number;
}
/** Only the application may use this when it proves no effect was dispatched. */
export class AssistantDispatchRefused extends Error { override name = "AssistantDispatchRefused"; }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_REQUEST = 128 * 1024, MAX_RECORD = 512 * 1024, MAX_ENTRIES = 10000;
const now = () => new Date().toISOString();
const isObject = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const id = (x: unknown): string => { if (typeof x !== "string" || !UUID.test(x)) throw new Error("A UUID handle is required"); return x; };
const keys = (value: object, names: string[]) => Object.keys(value).every(k => names.includes(k));
function jsonCopy(value: unknown, bound: number): any {
    let count = 0;
    const inspect = (x: unknown, depth: number): void => {
        if (++count > 20000 || depth > 32) throw new Error("Queue data exceeds its structural bound");
        if (x === null || typeof x === "boolean" || typeof x === "string" || typeof x === "number" && Number.isFinite(x)) return;
        if (!x || typeof x !== "object" || (!Array.isArray(x) && ![Object.prototype, null].includes(Object.getPrototypeOf(x)))) throw new Error("Queue data must be inert JSON");
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(x))) {
            if (descriptor.get || descriptor.set) throw new Error("Queue data must not contain accessors");
            inspect(descriptor.value, depth + 1);
        }
    };
    inspect(value, 0);
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > bound) throw new Error("Queue data exceeds its byte bound");
    return JSON.parse(text);
}
export function parseAssistantRunnerRequest(value: unknown): AssistantRunnerRequest {
    const v = jsonCopy(value, MAX_REQUEST);
    if (!isObject(v) || !keys(v, ["id", "jobId", "kind", "body"]) || typeof v.kind !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(v.kind) || !isObject(v.body)) throw new Error("Expected a bounded queue request, not an executable command");
    id(v.id); id(v.jobId);
    const freeze = (x: any): void => { if (x && typeof x === "object") { for (const item of Object.values(x)) freeze(item); Object.freeze(x); } };
    freeze(v);
    return v as AssistantRunnerRequest;
}
type RecordValue = Record<string, any>;
const signed = (body: RecordValue) => ({ ...body, sha256: hashValue(body) });
function checked(value: unknown, schema: string, fields: string[]): RecordValue {
    if (!isObject(value)) throw new Error("Queue record is unreadable");
    const { sha256, ...body } = value;
    if (!keys(body, ["schema_version", "at", ...fields]) || body.schema_version !== schema || typeof body.at !== "string" || !Number.isFinite(Date.parse(body.at)) || typeof sha256 !== "string" || !SHA.test(sha256) || sha256 !== hashValue(body)) throw new Error("Queue record digest or identity changed");
    return value;
}
function alive(pid: number): "live" | "dead" | "unknown" {
    try { process.kill(pid, 0); return "live"; } catch (e: any) { return e.code === "ESRCH" ? "dead" : "unknown"; }
}

async function storeAt(directory: string) {
    const absolute = resolve(directory);
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    if ((await lstat(absolute)).isSymbolicLink()) throw new Error("Queue root must not be a symlink");
    const root = await realpath(absolute);
    async function path(name: string) {
        const target = resolve(root, name), rel = relative(root, target);
        if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("Queue path escapes its root");
        let cursor = root;
        for (const part of rel.split(sep)) {
            cursor = join(cursor, part);
            try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Queue records must not traverse symlinks"); }
            catch (e: any) { if (e.code !== "ENOENT") throw e; }
        }
        return target;
    }
    async function syncDirectory(directory: string) { const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); } }
    async function read(name: string): Promise<RecordValue | null> {
        const target = await path(name);
        let handle;
        try { handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
        catch (e: any) { if (e.code === "ENOENT") return null; throw e; }
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > MAX_RECORD) throw new Error("Queue record is not a bounded regular file");
            const text = await handle.readFile("utf8");
            if (Buffer.byteLength(text) > MAX_RECORD) throw new Error("Queue record exceeds its byte bound");
            return JSON.parse(text);
        } finally { await handle.close(); }
    }
    async function install(name: string, value: RecordValue) {
        const text = JSON.stringify(jsonCopy(value, MAX_RECORD)) + "\n", target = await path(name);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await path(name);
        const temporary = `${target}.${crypto.randomUUID()}.tmp`, handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
        try { await link(temporary, target); await syncDirectory(dirname(target)); }
        finally { await unlink(temporary); }
        // Persist newly-created request/job directories as well as the file.
        let parent = dirname(target);
        while (parent !== root) { parent = dirname(parent); await syncDirectory(parent); }
    }
    async function remove(name: string) { const target = await path(name); await unlink(target); await syncDirectory(dirname(target)); }
    async function inventory(name: string): Promise<string[]> {
        let names: string[];
        try { names = await readdir(await path(name)); }
        catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
        if (names.length > MAX_ENTRIES || names.some(n => !UUID.test(n))) throw new Error("Queue inventory is invalid or exceeds its bound");
        return names.sort();
    }
    return { read, install, remove, inventory };
}
type Store = Awaited<ReturnType<typeof storeAt>>;
async function readOwner(store: Store): Promise<AssistantRunnerOwner | null> {
    const value = await store.read("owner.json"); if (!value) return null;
    const v = checked(value, "wringer.assistant-runner-owner.v1", ["token", "pid"]);
    id(v.token);
    if (!Number.isSafeInteger(v.pid) || v.pid < 1) throw new Error("Queue owner PID is invalid");
    return { token: v.token, pid: v.pid, at: v.at };
}
async function requestRecord(store: Store, operationId: string) {
    const value = await store.read(`requests/${id(operationId)}/request.json`);
    if (!value) throw new Error("Queue operation was not found");
    const v = checked(value, "wringer.assistant-runner-request.v1", ["request", "requestSha256"]), request = parseAssistantRunnerRequest(v.request);
    if (request.id !== operationId || v.requestSha256 !== hashValue(request)) throw new Error("Queue operation is bound to a different request");
    return { request, sha256: v.requestSha256 as string, at: v.at as string };
}
async function cancellation(store: Store, jobId: string): Promise<boolean> {
    const value = await store.read(`jobs/${id(jobId)}/cancel.json`); if (!value) return false;
    const v = checked(value, "wringer.assistant-runner-cancellation.v1", ["jobId"]);
    if (v.jobId !== jobId) throw new Error("Queue cancellation belongs to another job");
    return true;
}
async function readOperation(store: Store, operationId: string): Promise<AssistantRunnerOperation> {
    const saved = await requestRecord(store, operationId), r = saved.request;
    const cancellationRequested = await cancellation(store, r.jobId);
    const base = { id: r.id, jobId: r.jobId, kind: r.kind, requestSha256: saved.sha256, acceptedAt: saved.at, cancellationRequested };
    const claimValue = await store.read(`requests/${r.id}/claim.json`);
    let claim: RecordValue | null = null;
    if (claimValue) {
        claim = checked(claimValue, "wringer.assistant-runner-claim.v1", ["id", "jobId", "requestSha256", "ownerToken"]);
        id(claim.ownerToken);
        if (claim.id !== r.id || claim.jobId !== r.jobId || claim.requestSha256 !== saved.sha256) throw new Error("Queue claim differs from its request");
    }
    const outcome = await store.read(`requests/${r.id}/outcome.json`);
    async function reconciled(operation: AssistantRunnerOperation): Promise<AssistantRunnerOperation> {
        const saved = await store.read(`requests/${r.id}/reconciliation.json`);
        if (!saved) return operation;
        const v = checked(saved, "wringer.assistant-runner-reconciliation.v1", ["id", "jobId", "requestSha256", "claimSha256", "originalOutcomeSha256", "disposition", "evidenceSha256", "ownerObservation"]);
        if (!claim || v.id !== r.id || v.jobId !== r.jobId || v.requestSha256 !== base.requestSha256 || v.claimSha256 !== claim.sha256 || v.originalOutcomeSha256 !== (outcome?.sha256 ?? null) || outcome && outcome.status !== "uncertain" || !["completed", "failed"].includes(v.disposition) || typeof v.evidenceSha256 !== "string" || !SHA.test(v.evidenceSha256) || !["absent", "dead", "settled"].includes(v.ownerObservation)) throw new Error("Queue reconciliation does not bind the original uncertain operation");
        const { error, ...rest } = operation;
        return { ...rest, status: v.disposition, reconciliation: { evidenceSha256: v.evidenceSha256, priorStatus: "uncertain", ...(error ? { priorError: error } : {}) } };
    }
    if (outcome) {
        const v = checked(outcome, "wringer.assistant-runner-outcome.v1", ["id", "jobId", "requestSha256", "status", "result", "error"]);
        if (v.id !== r.id || v.jobId !== r.jobId || v.requestSha256 !== saved.sha256 || !["completed", "failed", "cancelled", "uncertain"].includes(v.status) || v.status === "completed" && !claim || v.error !== undefined && (typeof v.error !== "string" || v.error.length > 2048) || v.status === "cancelled" && !cancellationRequested) throw new Error("Queue outcome is not bound to its request and disposition");
        return reconciled({ ...base, status: v.status, ...(Object.hasOwn(v, "result") ? { result: v.result } : {}), ...(v.error ? { error: v.error } : {}) });
    }
    if (!claim) return reconciled({ ...base, status: cancellationRequested ? "cancelled" : "accepted" });
    const owner = await readOwner(store), live = !!owner && owner.token === claim.ownerToken && alive(owner.pid) === "live";
    return reconciled({ ...base, status: !live ? "uncertain" : cancellationRequested ? "cancel-requested" : "running", ...(!live ? { error: "No durable outcome exists. This claimed request will not be replayed; inspect domain evidence before explicit recovery." } : {}) });
}

/** Recovery is an operator action, not an assistant tool. A live PID (including
 * PID reuse) or unknown liveness always refuses; no orphan lock is auto-removed. */
export async function recoverAssistantRunner(directory: string, input: { ownerToken: string; acknowledgeUncertain: true }) {
    id(input.ownerToken);
    if (input.acknowledgeUncertain !== true) throw new Error("Acknowledge that orphan effects and charges may remain");
    const store = await storeAt(directory), token = crypto.randomUUID();
    await store.install("recovery.json", signed({ schema_version: "wringer.assistant-runner-recovery-guard.v1", at: now(), token, pid: process.pid }));
    try {
        const owner = await readOwner(store);
        if (!owner || owner.token !== input.ownerToken) throw new Error("Queue ownership changed; no lock was removed");
        if (alive(owner.pid) !== "dead") throw new Error("Queue owner is live or its liveness is unknown; no lock was removed");
        await store.install(`recoveries/${token}.json`, signed({ schema_version: "wringer.assistant-runner-recovery.v1", at: now(), owner, evidence: "process-no-longer-exists", acknowledgement: "orphan-effects-remain-uncertain" }));
        const current = await readOwner(store);
        if (!current || hashValue(current) !== hashValue(owner) || alive(current.pid) !== "dead") throw new Error("Queue ownership changed during recovery; no lock was removed");
        await store.remove("owner.json");
        return { recovered: true as const, previousOwner: owner, message: "Only dead runner ownership was released. Claimed operations and domain reservations were not replayed or removed." };
    } finally {
        const guard = checked(await store.read("recovery.json"), "wringer.assistant-runner-recovery-guard.v1", ["token", "pid"]);
        if (guard.token !== token || guard.pid !== process.pid) throw new Error("Recovery guard changed; no foreign lock was removed");
        await store.remove("recovery.json");
    }
}

export async function createAssistantRunner(directory: string, options: AssistantRunnerOptions) {
    if (typeof options.execute !== "function") throw new Error("An application executor is required");
    const interval = options.pollIntervalMs ?? 250;
    if (!Number.isInteger(interval) || interval < 10 || interval > 5000) throw new Error("Queue poll interval must be between 10 and 5000 ms");
    const store = await storeAt(directory);
    let owner: AssistantRunnerOwner | null = null, timer: ReturnType<typeof setTimeout> | null = null;
    let stopping = true, pump: Promise<void> | null = null, fault: string | null = null, releasing: Promise<void> | null = null;
    let active: { id: string; jobId: string; controller: AbortController } | null = null;
    const scrub = (message: string) => new Redactor().scrub(message).slice(0, 2048);
    async function status(): Promise<AssistantRunnerStatus> {
        const current = await readOwner(store), ownerState = current ? alive(current.pid) : "absent";
        const guard = await store.read("recovery.json");
        return { owner: current, ownerState, recoveryRequired: !!guard || !!current && ownerState !== "live", acceptingDispatch: !!owner && !stopping && !fault && !guard, activeOperationId: active?.id ?? null, error: fault ?? (guard ? "A recovery guard exists; its owner must be investigated before dispatch." : null) };
    }
    async function assertOwner() {
        const current = await readOwner(store);
        if (!owner || !current || current.token !== owner.token || current.pid !== process.pid) throw new Error("Runner ownership changed; no dispatch was attempted");
    }
    async function release() {
        if (releasing) return releasing;
        if (!owner || active || pump) return;
        releasing = (async () => { await assertOwner(); await store.remove("owner.json"); owner = null; })();
        try { await releasing; } finally { releasing = null; }
    }
    async function outcome(request: AssistantRunnerRequest, status: "completed" | "failed" | "cancelled" | "uncertain", extra: RecordValue = {}) {
        await store.install(`requests/${request.id}/outcome.json`, signed({ schema_version: "wringer.assistant-runner-outcome.v1", at: now(), id: request.id, jobId: request.jobId, requestSha256: hashValue(request), status, ...extra }));
    }
    async function dispatch() {
        await assertOwner();
        for (const record of await list()) {
            if (stopping || fault) return;
            if (record.status !== "accepted") continue;
            const { request } = await requestRecord(store, record.id);
            await assertOwner();
            if (await cancellation(store, request.jobId)) continue;
            await store.install(`requests/${request.id}/claim.json`, signed({ schema_version: "wringer.assistant-runner-claim.v1", at: now(), id: request.id, jobId: request.jobId, requestSha256: hashValue(request), ownerToken: owner!.token }));
            // A cancellation racing the claim is observed before entering the
            // effectful dependency. Claimed requests never become pending again.
            if (await cancellation(store, request.jobId)) { await outcome(request, "cancelled"); continue; }
            if (stopping) { await outcome(request, "failed", { error: "Runner stopped before application dispatch; no effect was invoked." }); return; }
            const controller = new AbortController(); active = { id: request.id, jobId: request.jobId, controller };
            const checkCancellation = setInterval(() => { void cancellation(store, request.jobId).then(cancelled => { if (cancelled) controller.abort(new Error("Cancellation requested")); }).catch(() => controller.abort(new Error("Cancellation record could not be validated"))); }, interval);
            try {
                let value = await options.execute(request, controller.signal);
                // Normal JSON results may contain optional undefined properties;
                // hash the actual retained JSON, never its pre-serialization shape.
                value = value === undefined ? null : JSON.parse(new Redactor().scrub(JSON.stringify(value)));
                await outcome(request, "completed", { result: jsonCopy(value, MAX_RECORD - MAX_REQUEST) });
            } catch (e) {
                await outcome(request, e instanceof AssistantDispatchRefused ? "failed" : "uncertain", { error: scrub(e instanceof Error ? e.message : "Application dispatch ended without a durable outcome") });
            } finally { clearInterval(checkCancellation); active = null; }
        }
    }
    function wake() {
        if (stopping || pump || fault) return;
        if (timer) { clearTimeout(timer); timer = null; }
        pump = dispatch().catch(e => { fault = scrub(e instanceof Error ? e.message : "Queue dispatch failed"); stopping = true; }).finally(async () => {
            pump = null;
            // Keep an owner after storage/ownership failure: an operator must
            // investigate, not have a new daemon reinterpret it as safe to run.
            if (stopping && !fault) { try { await release(); } catch (e) { fault = scrub(e instanceof Error ? e.message : "Queue ownership could not be released"); } }
            else if (!stopping) { timer = setTimeout(wake, interval); timer.unref(); }
        });
    }
    async function list(jobId?: string) {
        if (jobId !== undefined) id(jobId);
        const records: AssistantRunnerOperation[] = [];
        for (const operationId of await store.inventory("requests")) {
            // An enqueuer may have created its directory but not yet installed
            // the immutable request. It has not received an acceptance yet.
            if (!await store.read(`requests/${operationId}/request.json`)) continue;
            records.push(await readOperation(store, operationId));
        }
        return records.filter(record => jobId === undefined || record.jobId === jobId).sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.id.localeCompare(b.id));
    }
    return {
        async enqueue(input: AssistantRunnerRequest): Promise<AssistantRunnerOperation> {
            const request = parseAssistantRunnerRequest(input), text = JSON.stringify(request);
            if (new Redactor().scrub(text) !== text) throw new Error("Detected credential in queue request; it was not retained");
            const prior = await store.read(`requests/${request.id}/request.json`);
            if (!prior) {
                if (await cancellation(store, request.jobId)) throw new Error("This job was cancelled; no new operation was accepted");
                try { await store.install(`requests/${request.id}/request.json`, signed({ schema_version: "wringer.assistant-runner-request.v1", at: now(), request, requestSha256: hashValue(request) })); }
                catch (e: any) { if (e.code !== "EEXIST") throw e; }
            }
            const saved = await requestRecord(store, request.id);
            if (saved.sha256 !== hashValue(request)) throw new Error("This operation ID already names a different request");
            // ACK cannot precede the durable request, even if its caller loses
            // this response. A later duplicate observes the same operation.
            const accepted = await readOperation(store, request.id); wake(); return accepted;
        },
        read: (operationId: string) => readOperation(store, id(operationId)),
        list,
        status,
        /** Operator-only: evidence must be derived from validated domain records
         * by the application, never a caller's assertion that work succeeded. */
        async reconcile(operationId: string, input: { acknowledgeUncertain: true; disposition: "completed" | "failed"; evidenceSha256: string }) {
            id(operationId);
            if (input.acknowledgeUncertain !== true || !["completed", "failed"].includes(input.disposition) || typeof input.evidenceSha256 !== "string" || !SHA.test(input.evidenceSha256)) throw new Error("Reconciliation requires explicit acknowledgement and validated domain evidence");
            const saved = await store.read(`requests/${operationId}/reconciliation.json`);
            if (saved) {
                const value = await readOperation(store, operationId);
                if (value.status !== input.disposition || value.reconciliation?.evidenceSha256 !== input.evidenceSha256) throw new Error("This reconciliation already names different domain evidence");
                return value;
            }
            const value = await readOperation(store, operationId), current = await readOwner(store);
            const original = await store.read(`requests/${operationId}/outcome.json`);
            if (value.status !== "uncertain" || active?.id === operationId || current && alive(current.pid) === "unknown") throw new Error("Only an inactive uncertain operation may be reconciled; live or unknown work was not guessed");
            const claim = await store.read(`requests/${operationId}/claim.json`);
            if (!claim) throw new Error("An unclaimed operation cannot be reconciled as dispatched work");
            const ownerObservation = original?.status === "uncertain" ? "settled" : !current || current.token !== claim.ownerToken ? "absent" : alive(current.pid);
            if (!["settled", "absent", "dead"].includes(ownerObservation)) throw new Error("The operation's owner is live or unknown; no outcome was inferred");
            await store.install(`requests/${operationId}/reconciliation.json`, signed({ schema_version: "wringer.assistant-runner-reconciliation.v1", at: now(), id: operationId, jobId: value.jobId, requestSha256: value.requestSha256, claimSha256: claim.sha256, originalOutcomeSha256: original?.sha256 ?? null, disposition: input.disposition, evidenceSha256: input.evidenceSha256, ownerObservation }));
            return readOperation(store, operationId);
        },
        async start() {
            if (owner) { if (stopping || fault) throw new Error("Runner is stopping or requires investigation"); return status(); }
            if (await store.read("recovery.json")) throw new Error("Runner recovery guard exists; no owner was guessed or removed");
            const next = { token: crypto.randomUUID(), pid: process.pid, at: now() };
            try { await store.install("owner.json", signed({ schema_version: "wringer.assistant-runner-owner.v1", ...next })); }
            catch (e: any) { if (e.code === "EEXIST") throw new Error("Another or orphan runner owns this queue. Inspect owner status; explicit dead-owner recovery is required."); throw e; }
            owner = next;
            if (await store.read("recovery.json")) { await release(); throw new Error("Runner recovery is in progress; no dispatch was attempted"); }
            stopping = false; fault = null; wake(); return status();
        },
        async stop(timeoutMs = 5000) {
            if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) throw new Error("Stop wait must be bounded to 30 seconds");
            stopping = true;
            if (timer) { clearTimeout(timer); timer = null; }
            active?.controller.abort(new Error("Runner shutdown requested; effects may remain uncertain"));
            if (pump) {
                let timeout: ReturnType<typeof setTimeout> | undefined;
                await Promise.race([pump, new Promise<void>(resolve => { timeout = setTimeout(resolve, timeoutMs); })]);
                if (timeout) clearTimeout(timeout);
            }
            if (!fault) await release();
            return status();
        },
        async cancel(jobId: string) {
            id(jobId);
            try { await store.install(`jobs/${jobId}/cancel.json`, signed({ schema_version: "wringer.assistant-runner-cancellation.v1", at: now(), jobId })); }
            catch (e: any) { if (e.code !== "EEXIST") throw e; await cancellation(store, jobId); }
            if (active?.jobId === jobId) active.controller.abort(new Error("Cancellation requested; already dispatched effects may still have run"));
            return { jobId, cancellationRequested: true as const, message: "Future dispatch is stopped. Cancellation does not refund charges or prove an active remote request never ran." };
        },
    };
}
