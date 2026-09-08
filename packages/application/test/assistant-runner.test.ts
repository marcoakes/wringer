import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, readFile, writeFile, readdir, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashValue } from "@wringer/plan";
import { createAssistantRunner, recoverAssistantRunner, parseAssistantRunnerRequest, AssistantDispatchRefused, type AssistantRunnerRequest } from "../src/assistant-runner";

type Runner = Awaited<ReturnType<typeof createAssistantRunner>>;
const directories: string[] = [], runners: Runner[] = [], children: ReturnType<typeof Bun.spawn>[] = [];
afterEach(async () => {
    for (const child of children.splice(0)) { try { child.kill("SIGKILL"); } catch {} await child.exited; }
    for (const runner of runners.splice(0)) { try { await runner.stop(20); } catch {} }
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
async function scratch() { const directory = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-runner-"))); directories.push(directory); return directory; }
function request(overrides: Partial<AssistantRunnerRequest> = {}): AssistantRunnerRequest { return { id: crypto.randomUUID(), jobId: crypto.randomUUID(), kind: "start", body: { expectedRevision: "a".repeat(64) }, ...overrides }; }
async function runner(directory: string, execute: (r: AssistantRunnerRequest, signal: AbortSignal) => Promise<unknown> = async () => ({ fixture: true })) {
    const value = await createAssistantRunner(directory, { execute, pollIntervalMs: 10 }); runners.push(value); return value;
}
async function until<T>(read: () => Promise<T>, predicate: (v: T) => boolean): Promise<T> {
    for (let n = 0; n < 600; n++) { const result = await read(); if (predicate(result)) return result; await Bun.sleep(5); }
    throw new Error("Fixture did not reach the expected durable state");
}
const terminal = (r: Runner, operationId: string) => until(() => r.read(operationId), value => ["completed", "failed", "cancelled", "uncertain"].includes(value.status));
async function spawn(directory: string, mode: string) {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/assistant-runner-child.ts"), directory, mode], { stdout: "pipe", stderr: "pipe" }); children.push(child);
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read(); reader.releaseLock();
    if (!new TextDecoder().decode(first.value).includes("fixture-ready")) throw new Error(`Fixture child failed: ${await new Response(child.stderr).text()}`);
    return child;
}
async function dispatches(directory: string): Promise<AssistantRunnerRequest[]> {
    try { return (await readFile(join(directory, "fixture-dispatches.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }
    catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
}

describe("assistant daemon durable queue", () => {
    test("acceptance survives a lost response and twenty duplicate clients execute once", async () => {
        const directory = await scratch(), input = request(); let calls = 0;
        const first = await runner(directory, async r => { calls++; return { seen: r.id }; }), second = await runner(directory);
        await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? first : second).enqueue(input)));
        expect((await second.read(input.id)).status).toBe("accepted");
        const saved = JSON.parse(await readFile(join(directory, "requests", input.id, "request.json"), "utf8"));
        expect(saved.requestSha256).toBe(hashValue(input));
        await expect(second.enqueue({ ...input, body: { different: true } })).rejects.toThrow("different request");
        await expect(second.enqueue({ ...input, jobId: crypto.randomUUID() })).rejects.toThrow("different request");
        await first.start();
        expect((await terminal(second, input.id)).result).toEqual({ seen: input.id });
        await first.stop();
        await second.start();
        expect((await second.enqueue(input)).status).toBe("completed");
        expect(calls).toBe(1);
        expect((await second.list(input.jobId)).map(x => x.id)).toEqual([input.id]);
    });
    test("an independent process completes work after its original client disappears", async () => {
        const directory = await scratch(), input = request(), client = await runner(directory);
        await client.enqueue(input);
        const child = await spawn(directory, "finish");
        // The enqueuing client object does not own or await execution. A newly
        // constructed client reconnects to records while the daemon owns work.
        const reconnected = await runner(directory);
        expect((await terminal(reconnected, input.id)).status).toBe("completed");
        expect((await reconnected.enqueue(input)).status).toBe("completed");
        expect(await dispatches(directory)).toHaveLength(1);
        child.kill("SIGTERM"); await child.exited;
        expect((await reconnected.status()).ownerState).toBe("absent");
    });
    test("real kill after claim retains uncertainty; explicit recovery dispatches only never-claimed work", async () => {
        const directory = await scratch(), active = request(), pending = request(), client = await runner(directory);
        await client.enqueue(active);
        const child = await spawn(directory, "block");
        await until(() => dispatches(directory), records => records.length === 1);
        await client.enqueue(pending);
        child.kill("SIGKILL"); await child.exited;
        expect((await client.read(active.id)).status).toBe("uncertain");
        expect((await client.read(pending.id)).status).toBe("accepted");
        const old = (await client.status()).owner!;
        expect((await client.status()).recoveryRequired).toBe(true);
        await expect(client.start()).rejects.toThrow("orphan runner");
        await expect(recoverAssistantRunner(directory, { ownerToken: crypto.randomUUID(), acknowledgeUncertain: true })).rejects.toThrow("ownership changed");
        const recovery = await recoverAssistantRunner(directory, { ownerToken: old.token, acknowledgeUncertain: true });
        expect(recovery.previousOwner.pid).toBe(child.pid);
        let calls = 0;
        const restarted = await runner(directory, async r => { calls++; expect(r.id).toBe(pending.id); return { revalidated: true }; });
        await restarted.start();
        expect((await terminal(restarted, pending.id)).status).toBe("completed");
        expect((await restarted.read(active.id)).status).toBe("uncertain");
        expect((await restarted.enqueue(active)).status).toBe("uncertain");
        expect(calls).toBe(1);
        expect(await readdir(join(directory, "recoveries"))).toHaveLength(1);
    });
    test("real kill before claim leaves accepted work available for an authority-rechecking owner", async () => {
        const directory = await scratch(), input = request(), client = await runner(directory);
        await client.enqueue(input);
        const child = await spawn(directory, "before-start"); child.kill("SIGKILL"); await child.exited;
        expect((await client.read(input.id)).status).toBe("accepted");
        let effects = 0;
        const restarted = await runner(directory, async () => { throw new AssistantDispatchRefused("Approval is out of date; zero domain effects were invoked"); effects++; });
        await restarted.start();
        expect((await terminal(restarted, input.id)).status).toBe("failed");
        expect(effects).toBe(0);
    });
    test("a live owner, including a possibly reused PID, cannot be displaced", async () => {
        const directory = await scratch(), first = await runner(directory), second = await runner(directory);
        await first.start(); const owner = (await first.status()).owner!;
        await expect(second.start()).rejects.toThrow("owns this queue");
        await expect(recoverAssistantRunner(directory, { ownerToken: owner.token, acknowledgeUncertain: true })).rejects.toThrow("live or its liveness is unknown");
        expect((await first.status()).owner).toEqual(owner);
    });
    test("cancellation before claim is durable and blocks current and future dispatch", async () => {
        const directory = await scratch(), input = request(); let calls = 0;
        const value = await runner(directory, async () => { calls++; return {}; });
        await value.enqueue(input); await value.cancel(input.jobId); await value.cancel(input.jobId);
        expect((await value.read(input.id)).status).toBe("cancelled");
        await expect(value.enqueue(request({ jobId: input.jobId }))).rejects.toThrow("was cancelled");
        await value.start(); await Bun.sleep(30);
        expect((await value.enqueue(input)).status).toBe("cancelled"); expect(calls).toBe(0);
    });
    test("active cancellation aborts but remains unresolved until the executor's outcome is durable", async () => {
        const directory = await scratch(), input = request(); let finish!: () => void, observedSignal: AbortSignal | undefined;
        const held = new Promise<void>(resolve => finish = resolve);
        const value = await runner(directory, async (_r, signal) => { observedSignal = signal; await held; return { remoteMayHaveRun: true }; });
        await value.enqueue(input); await value.start();
        await until(async () => observedSignal, Boolean);
        await value.cancel(input.jobId);
        expect(observedSignal!.aborted).toBe(true);
        expect((await value.read(input.id)).status).toBe("cancel-requested");
        finish(); const result = await terminal(value, input.id);
        expect(result.status).toBe("completed"); expect(result.cancellationRequested).toBe(true); expect(result.result).toEqual({ remoteMayHaveRun: true });
    });
    test("shutdown waits are bounded and cannot release ownership while an effect ignores cancellation", async () => {
        const directory = await scratch(), input = request(); let finish!: () => void, began = false;
        const value = await runner(directory, async () => { began = true; await new Promise<void>(r => finish = r); return {}; });
        await value.enqueue(input); await value.start(); await until(async () => began, Boolean);
        const stopped = await value.stop(5);
        expect(stopped.acceptingDispatch).toBe(false); expect(stopped.ownerState).toBe("live"); expect(stopped.activeOperationId).toBe(input.id);
        const other = await runner(directory); await expect(other.start()).rejects.toThrow("owns this queue");
        finish(); await terminal(value, input.id);
        await until(() => value.status(), state => state.ownerState === "absent");
    });
    test("cancellation from a reconnected client reaches the independently owned active process", async () => {
        const directory = await scratch(), input = request(), client = await runner(directory);
        await client.enqueue(input);
        await spawn(directory, "abort");
        await until(() => dispatches(directory), records => records.length === 1);
        await client.cancel(input.jobId);
        const result = await terminal(client, input.id);
        expect(result.status).toBe("uncertain"); expect(result.cancellationRequested).toBe(true);
        expect(result.error).toBe("Fixture observed cancellation after dispatch");
        expect(await dispatches(directory)).toHaveLength(1);
    });
    test("post-dispatch errors remain uncertain across reconnect; known pre-effect refusals are distinct", async () => {
        const directory = await scratch(), a = request(), b = request(); let calls = 0;
        const value = await runner(directory, async r => { calls++; if (r.id === a.id) throw new Error("Connection lost after remote acceptance"); throw new AssistantDispatchRefused("No authority remains"); });
        await value.enqueue(a); await value.enqueue(b); await value.start();
        expect((await terminal(value, a.id)).status).toBe("uncertain"); expect((await terminal(value, b.id)).status).toBe("failed");
        await value.stop(); const next = await runner(directory); await next.start();
        expect((await next.enqueue(a)).status).toBe("uncertain"); expect(calls).toBe(2);
    });
    test("request, claim, result and cancellation corruption fail closed", async () => {
        for (const file of ["request.json", "claim.json", "outcome.json"]) {
            const directory = await scratch(), input = request(), value = await runner(directory);
            await value.enqueue(input); await value.start(); await terminal(value, input.id); await value.stop();
            const path = join(directory, "requests", input.id, file), stored = JSON.parse(await readFile(path, "utf8"));
            stored.at = "2000-01-01T00:00:00Z"; await writeFile(path, JSON.stringify(stored));
            await expect(value.read(input.id)).rejects.toThrow("digest or identity changed");
        }
        const directory = await scratch(), input = request(), value = await runner(directory);
        await value.enqueue(input); await value.cancel(input.jobId);
        const path = join(directory, "jobs", input.jobId, "cancel.json"), stored = JSON.parse(await readFile(path, "utf8"));
        stored.jobId = crypto.randomUUID(); const { sha256: _, ...body } = stored; stored.sha256 = hashValue(body); await writeFile(path, JSON.stringify(stored));
        await expect(value.read(input.id)).rejects.toThrow("another job");
    });
    test("symlink paths, oversized files, non-JSON objects and arbitrary handles are rejected", async () => {
        const directory = await scratch(), outside = await scratch(), value = await runner(directory), input = request();
        await symlink(outside, join(directory, "requests"));
        await expect(value.enqueue(input)).rejects.toThrow("symlinks"); expect(await readdir(outside)).toEqual([]);
        for (const input of [request({ id: "../escape" }), request({ body: { text: "x".repeat(200000) } }), { ...request(), execute: "touch injected" }, request({ body: { value: Number.NaN } }), request({ body: { date: new Date() } })]) expect(() => parseAssistantRunnerRequest(input)).toThrow();
        const hiddenAccessor = Object.defineProperty({}, "secret", { get() { throw new Error("Accessor must not be invoked"); } });
        expect(() => parseAssistantRunnerRequest(request({ body: hiddenAccessor }))).toThrow("accessors");
        const safe = await scratch(), safeRunner = await runner(safe), large = request(); await safeRunner.enqueue(large);
        await writeFile(join(safe, "requests", large.id, "request.json"), "x".repeat(600000));
        await expect(safeRunner.read(large.id)).rejects.toThrow("bounded regular file");
    });
    test("credentials are rejected before persistence and scrubbed before retaining an outcome", async () => {
        const previous = process.env.WRINGER_RUNNER_TEST_SECRET; process.env.WRINGER_RUNNER_TEST_SECRET = "fixture-runner-private-value-827182718";
        try {
            const directory = await scratch(), value = await runner(directory, async () => ({ text: process.env.WRINGER_RUNNER_TEST_SECRET, optional: undefined }));
            await expect(value.enqueue(request({ body: { note: process.env.WRINGER_RUNNER_TEST_SECRET } }))).rejects.toThrow("Detected credential");
            const input = request(); await value.enqueue(input); await value.start();
            const result = await terminal(value, input.id); expect(result.result).toEqual({ text: "[REDACTED]" });
            expect(await readFile(join(directory, "requests", input.id, "outcome.json"), "utf8")).not.toContain(process.env.WRINGER_RUNNER_TEST_SECRET!);
        } finally { if (previous === undefined) delete process.env.WRINGER_RUNNER_TEST_SECRET; else process.env.WRINGER_RUNNER_TEST_SECRET = previous; }
    });
    test("an existing unknown recovery guard is never automatically removed", async () => {
        const directory = await scratch(), value = await runner(directory);
        await writeFile(join(directory, "recovery.json"), "{}", { mode: 0o600 });
        await expect(value.start()).rejects.toThrow("recovery guard exists");
        expect(await readFile(join(directory, "recovery.json"), "utf8")).toBe("{}");
        expect((await value.status()).recoveryRequired).toBe(true);
    });
    test("operator reconciliation preserves uncertainty and attaches domain evidence without replay", async () => {
        const directory = await scratch(), input = request(); let calls = 0;
        const value = await runner(directory, async () => { calls++; throw new Error("Fixture lost response after retained domain outcome"); });
        await value.enqueue(input); await value.start(); await terminal(value, input.id);
        const path = join(directory, "requests", input.id, "outcome.json"), before = await readFile(path, "utf8");
        const proof = { acknowledgeUncertain: true as const, disposition: "completed" as const, evidenceSha256: "a".repeat(64) };
        const reconciled = await value.reconcile(input.id, proof);
        expect(reconciled.status).toBe("completed"); expect(reconciled.reconciliation).toEqual({ evidenceSha256: proof.evidenceSha256, priorStatus: "uncertain", priorError: "Fixture lost response after retained domain outcome" });
        expect(await readFile(path, "utf8")).toBe(before);
        expect(await value.reconcile(input.id, proof)).toEqual(reconciled);
        await expect(value.reconcile(input.id, { ...proof, evidenceSha256: "b".repeat(64) })).rejects.toThrow("different domain evidence");
        expect((await value.enqueue(input)).status).toBe("completed"); expect(calls).toBe(1);
    });
    test("reconciliation refuses accepted and actively running operations and validates its sibling", async () => {
        const directory = await scratch(), input = request(); let finish!: () => void, began = false;
        const value = await runner(directory, async () => { began = true; await new Promise<void>(r => finish = r); throw new Error("Fixture uncertain"); });
        const proof = { acknowledgeUncertain: true as const, disposition: "failed" as const, evidenceSha256: "a".repeat(64) };
        await value.enqueue(input); await expect(value.reconcile(input.id, proof)).rejects.toThrow("inactive uncertain");
        await value.start(); await until(async () => began, Boolean);
        await expect(value.reconcile(input.id, proof)).rejects.toThrow("inactive uncertain");
        finish(); await terminal(value, input.id); await value.reconcile(input.id, proof);
        const path = join(directory, "requests", input.id, "reconciliation.json"), saved = JSON.parse(await readFile(path, "utf8"));
        saved.evidenceSha256 = "b".repeat(64); await writeFile(path, JSON.stringify(saved));
        await expect(value.read(input.id)).rejects.toThrow("digest or identity changed");
    });
    test("a killed claimed request can be reconciled against domain evidence without removing its claim", async () => {
        const directory = await scratch(), input = request(), value = await runner(directory);
        await value.enqueue(input); const child = await spawn(directory, "block");
        await until(() => dispatches(directory), records => records.length === 1);
        child.kill("SIGKILL"); await child.exited;
        const path = join(directory, "requests", input.id, "claim.json"), before = await readFile(path, "utf8");
        const result = await value.reconcile(input.id, { acknowledgeUncertain: true, disposition: "completed", evidenceSha256: "c".repeat(64) });
        expect(result.status).toBe("completed"); expect(result.reconciliation?.priorStatus).toBe("uncertain");
        expect(await readFile(path, "utf8")).toBe(before);
        expect((await value.status()).recoveryRequired).toBe(true);
    });
    test("an incomplete unacknowledged request directory does not poison other accepted work", async () => {
        const directory = await scratch(), value = await runner(directory), input = request();
        await mkdir(join(directory, "requests", crypto.randomUUID()), { recursive: true });
        await value.enqueue(input); await value.start(); expect((await terminal(value, input.id)).status).toBe("completed");
        expect(await value.list()).toHaveLength(1);
    });
});
