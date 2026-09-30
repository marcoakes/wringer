/** One bounded task delegated to an external A2A 1.0 agent over JSON-RPC.
 *
 * The approved graph pins the endpoint and the digest of the agent's card; both are
 * checked before sending and again at completion. The request is recorded before it
 * is sent, and the task id as soon as it is known. A returned patch becomes a
 * candidate only inside controller storage, only within the delegate's
 * verification scope, and only a following check can verify it. An Agent Card, a
 * completion state or an artifact grants nothing and never counts as acceptance. */
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashValue, type ContainedGraphNode } from "@wringer/plan";
import type { GraphEffectRequest } from "@wringer/scheduler";
import { Redactor } from "@wringer/engine";
import { processDriver, type PreparedRepositorySource } from "@wringer/runtime";
import { immutableControllerFile, readControllerFile } from "./controller";

type Delegate = Extract<ContainedGraphNode, { kind: "delegate" }>;
export const A2A_VERSION = "1.0";
export const PATCH_MEDIA_TYPE = "text/x-diff";
const TERMINAL: Record<string, "returned" | "failed" | "canceled"> = { TASK_STATE_COMPLETED: "returned", TASK_STATE_FAILED: "failed", TASK_STATE_REJECTED: "failed", TASK_STATE_INPUT_REQUIRED: "failed", TASK_STATE_AUTH_REQUIRED: "failed", TASK_STATE_CANCELED: "canceled" };
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const FIXED_ENV = { ...GIT_ENV, GIT_AUTHOR_NAME: "Wringer delegation", GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: "Wringer delegation", GIT_COMMITTER_EMAIL: "wringer@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
function fail(message: string): never { throw new Error(message); }
const stamp = <T extends object>(body: T) => ({ ...body, sha256: hashValue(body) });
async function present(path: string) { try { const info = await lstat(path); if (info.isSymbolicLink()) fail("Delegation records cannot be symlinks"); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function git(args: string[], label: string, options: { env?: Record<string, string>; allowed?: number[] } = {}) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { env: options.env ?? GIT_ENV, timeoutMs: 60000 });
    if (!(options.allowed ?? [0]).includes(result.code)) fail(`${label} failed; nothing was accepted`);
    return { code: result.code, out: result.stdout.trim() };
}

/** Bounded HTTP: JSON only, at most 1 MiB, no redirects, a deadline on every call. */
async function http(url: string, init: { method: string; body?: unknown }, timeoutMs: number) {
    const response = await fetch(url, { method: init.method, redirect: "manual", signal: AbortSignal.timeout(Math.max(1, timeoutMs)), headers: { "content-type": "application/json", accept: "application/json", "A2A-Version": A2A_VERSION }, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    if (response.status >= 300 && response.status < 400) fail(`The peer redirected ${init.method} ${new URL(url).pathname}; redirects are not followed`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 1024 * 1024) fail("The peer's response exceeds 1 MiB");
    if (!response.ok) fail(`The peer answered HTTP ${response.status}`);
    try { return JSON.parse(text); } catch { fail("The peer's response is not JSON"); }
}
/** The Agent Card at the endpoint's origin, and the canonical digest the graph pins. */
export async function readAgentCard(endpoint: string, timeoutMs = 10000) {
    const card = await http(new URL("/.well-known/agent-card.json", endpoint).toString(), { method: "GET" }, timeoutMs);
    if (!card || typeof card !== "object" || Array.isArray(card) || typeof card.name !== "string") fail("The peer's Agent Card is not an object with a name");
    return { card, sha256: hashValue(card) };
}
let serial = 0;
export async function a2aCall(endpoint: string, method: "SendMessage" | "GetTask" | "CancelTask", params: unknown, timeoutMs: number) {
    const id = `wringer-${++serial}`, reply = await http(endpoint, { method: "POST", body: { jsonrpc: "2.0", id, method, params } }, timeoutMs);
    if (!reply || reply.jsonrpc !== "2.0" || reply.id !== id) fail(`The peer's ${method} reply is not a JSON-RPC 2.0 response to this request`);
    if (reply.error) { const error = new Error(`The peer refused ${method}: ${String(reply.error.message ?? "error").slice(0, 300)} (${reply.error.code})`) as Error & { code?: number }; error.code = reply.error.code; throw error; }
    return reply.result;
}
function task(value: unknown) {
    const row = value as Record<string, any>;
    if (!row || typeof row.id !== "string" || !row.id || typeof row.status?.state !== "string") fail("The peer's answer is not an A2A task");
    return row as { id: string; contextId?: string; status: { state: string }; artifacts?: any[] };
}

export interface GraphDelegation {
    schema_version: "wringer.contained-graph-delegation.v1"; graphSha256: string; node: string; inputSha256: string;
    peer: { url: string; cardSha256: string; skill: string }; messageId: string; taskId: string | null; states: string[]; cancelRequested: boolean;
    outcome: "returned" | "failed" | "canceled" | "unavailable"; reason: string | null;
    artifact: { sha256: string; mediaType: string; changedPaths: string[] } | null; candidate: { commit: string; tree: string } | null;
    evidenceKind: "live-peer" | "local-peer"; sha256: string;
}
export interface ExternalTaskServices {
    /** The exact source the task starts from: the root bundle or the input candidate's owner. */
    base: PreparedRepositorySource;
    /** The graph's pinned root source, whose files the following check restores. */
    rootBundle: string | null;
    pollMs?: number;
}
const within = (path: string, prefix: string) => prefix === "." || path === prefix || path.startsWith(prefix + "/");
export function delegationMessageId(request: GraphEffectRequest) { return hashValue({ graph: request.plan.sha256, node: request.node, input: request.reservation.input }).slice(0, 32); }

/** Check the pinned card before anything is sent. Effect-free. */
export async function preflightExternalTask(node: Delegate) {
    let sha256: string;
    try { sha256 = (await readAgentCard(node.peer.url)).sha256; } catch (error) { fail(`The peer at ${node.peer.url} is unavailable: ${(error as Error).message}. Nothing was sent.`); }
    if (sha256 !== node.peer.cardSha256) fail(`The peer's Agent Card changed: pinned ${node.peer.cardSha256.slice(0, 12)}, served ${sha256.slice(0, 12)}. Nothing was sent; a changed identity needs a new approved graph.`);
}
/** Apply the one returned patch to the exact base in controller storage, within the verification scope. */
async function applyArtifact(node: Delegate, directory: string, base: string, artifacts: any[] | undefined) {
    if (!Array.isArray(artifacts) || artifacts.length !== 1) fail(`The peer returned ${Array.isArray(artifacts) ? artifacts.length : "no"} artifacts; exactly one patch is required`);
    const parts = artifacts[0]?.parts;
    if (!Array.isArray(parts) || parts.length !== 1) fail("The artifact must carry exactly one part");
    const part = parts[0], mediaType = part?.mediaType;
    if (mediaType !== PATCH_MEDIA_TYPE || typeof part.text !== "string") fail(`The artifact part must be ${PATCH_MEDIA_TYPE} text`);
    const patch: string = part.text;
    if (!patch.trim() || Buffer.byteLength(patch) > 1024 * 1024 || !/^diff --git /m.test(patch)) fail("The artifact is not a bounded Git patch");
    if (new Redactor().scrub(patch) !== patch) fail("The artifact contains a detected credential");
    const store = join(directory, "delegate.git"), scratch = await mkdtemp(join(tmpdir(), "wringer-delegation-"));
    try {
        const env = { ...FIXED_ENV, GIT_INDEX_FILE: join(scratch, "index") }, file = join(scratch, "artifact.patch");
        await writeFile(file, patch, { mode: 0o600 });
        await git(["--git-dir", store, "read-tree", base], "Reading the task's base", { env });
        if ((await git(["--git-dir", store, "apply", "--cached", "--binary", "--", file], "Applying the returned patch", { env, allowed: [0, 1, 128] })).code !== 0) fail("The returned patch does not apply to the task's exact base");
        const changed = (await git(["--git-dir", store, "diff-index", "--cached", "--name-only", base], "Listing changed paths", { env })).out.split("\n").filter(Boolean).sort();
        if (!changed.length) fail("The returned patch changes nothing");
        const guarded = [...node.verify.acceptance.protected_paths, ...node.verify.acceptance.checks.flatMap(check => check.files)];
        const outside = changed.filter(path => !node.verify.scope.writable.some(prefix => within(path, prefix)) || guarded.some(prefix => within(path, prefix)));
        if (outside.length) fail(`The returned patch touches paths outside the delegate's writable scope or its protected checks: ${outside.slice(0, 5).join(", ")}`);
        const tree = (await git(["--git-dir", store, "write-tree"], "Writing the returned tree", { env })).out;
        const commit = (await git(["--git-dir", store, "commit-tree", tree, "-p", base, "-m", `Returned by an external A2A task for ${node.peer.skill}`], "Recording the returned candidate", { env })).out;
        await git(["--git-dir", store, "update-ref", "refs/heads/delegated", commit], "Recording the returned reference");
        await git(["--git-dir", store, "bundle", "create", join(directory, "source.bundle"), "refs/heads/delegated"], "Bundling the returned candidate");
        return { artifact: { sha256: hashValue(patch), mediaType, changedPaths: changed }, candidate: { commit, tree } };
    } finally { await rm(scratch, { recursive: true, force: true }); }
}
async function finish(request: GraphEffectRequest, directory: string, body: Omit<GraphDelegation, "schema_version" | "graphSha256" | "node" | "inputSha256" | "sha256">) {
    const record = stamp({ schema_version: "wringer.contained-graph-delegation.v1" as const, graphSha256: request.plan.sha256, node: request.node, inputSha256: hashValue(request.reservation.input), ...body }) as GraphDelegation;
    await immutableControllerFile(join(directory, "delegation.json"), record);
    return record;
}
/** Poll until a terminal state, cancel once at the deadline, then settle the outcome. */
async function settle(request: GraphEffectRequest, directory: string, services: ExternalTaskServices, taskId: string, first: { id: string; status: { state: string }; artifacts?: any[] }, sent: { messageId: string; states: string[]; sentAt: string }) {
    const node = request.plan.nodes[request.node] as Delegate, deadline = Math.min(Date.parse(request.reservation.deadline), Date.parse(sent.sentAt) + node.timeoutSeconds * 1000);
    const states = [...sent.states]; let current = first, cancelRequested = false;
    const seen = (state: string) => { if (states.at(-1) !== state) states.push(state); };
    seen(current.status.state);
    while (!TERMINAL[current.status.state]) {
        request.signal?.throwIfAborted();
        if (Date.now() >= deadline && !cancelRequested) {
            cancelRequested = true;
            try { current = task(await a2aCall(node.peer.url, "CancelTask", { id: taskId }, 10000)); } catch { /* A task that cannot be cancelled is read again below. */ }
            seen(current.status.state);
            if (TERMINAL[current.status.state]) break;
        }
        if (cancelRequested && Date.now() >= deadline + 30000) return finish(request, directory, { peer: node.peer, messageId: sent.messageId, taskId, states, cancelRequested, outcome: "unavailable", reason: "The task did not end after its deadline and one cancellation", artifact: null, candidate: null, evidenceKind: evidence(node) });
        await Bun.sleep(services.pollMs ?? 500);
        current = task(await a2aCall(node.peer.url, "GetTask", { id: taskId }, 10000));
        if (current.id !== taskId) fail("The peer answered for another task");
        seen(current.status.state);
    }
    const outcome = TERMINAL[current.status.state]!;
    if (outcome !== "returned") return finish(request, directory, { peer: node.peer, messageId: sent.messageId, taskId, states, cancelRequested, outcome, reason: `The peer ended the task ${current.status.state}`, artifact: null, candidate: null, evidenceKind: evidence(node) });
    try {
        const applied = await applyArtifact(node, directory, services.base.commit, current.artifacts);
        // Identity at completion: the same card that was pinned and checked before sending.
        const { sha256 } = await readAgentCard(node.peer.url);
        if (sha256 !== node.peer.cardSha256) fail("The peer's Agent Card changed during the task");
        return finish(request, directory, { peer: node.peer, messageId: sent.messageId, taskId, states, cancelRequested, outcome: "returned", reason: null, ...applied, evidenceKind: evidence(node) });
    } catch (error) {
        return finish(request, directory, { peer: node.peer, messageId: sent.messageId, taskId, states, cancelRequested, outcome: "unavailable", reason: new Redactor().scrub((error as Error).message).slice(0, 2000), artifact: null, candidate: null, evidenceKind: evidence(node) });
    }
}
const evidence = (node: Delegate) => new URL(node.peer.url).protocol === "https:" ? "live-peer" as const : "local-peer" as const;

/** Send once. The request is durable before sending; the task id as soon as it is known. */
export async function runExternalTask(request: GraphEffectRequest, directory: string, services: ExternalTaskServices) {
    const node = request.plan.nodes[request.node] as Delegate, store = join(directory, "delegate.git");
    await git(["init", "--bare", "--initial-branch=delegation", store], "Creating the delegation store");
    await git(["--git-dir", store, "fetch", "--no-tags", "--", services.base.bundlePath!, `${services.base.commit}:refs/heads/base`], "Fetching the task's base");
    if (services.rootBundle && services.base.commit !== request.plan.repository.commit) await git(["--git-dir", store, "fetch", "--no-tags", "--", services.rootBundle, "+refs/*:refs/root/*"], "Fetching the pinned root source");
    if ((await git(["--git-dir", store, "cat-file", "-e", `${request.plan.repository.commit}^{commit}`], "Checking the pinned root", { allowed: [0, 1, 128] })).code !== 0) fail("The pinned root commit is not available to verify the returned candidate");
    await immutableControllerFile(join(directory, "acceptance-source.json"), { url: request.plan.repository.url, commit: request.plan.repository.commit, bundlePath: join(directory, "acceptance.bundle"), objectStore: store });
    await git(["--git-dir", store, "update-ref", "refs/heads/root", request.plan.repository.commit], "Recording the pinned root");
    await git(["--git-dir", store, "bundle", "create", join(directory, "acceptance.bundle"), "refs/heads/root"], "Bundling the pinned root");
    const messageId = delegationMessageId(request), contextId = hashValue({ graph: request.plan.sha256, node: request.node }).slice(0, 32);
    const text = `${node.instruction}\n\nRepository: ${request.plan.repository.url} at commit ${services.base.commit}.\nYou may change only: ${node.verify.scope.writable.join(", ")}. Do not change: ${[...node.verify.acceptance.protected_paths, ...node.verify.acceptance.checks.flatMap(check => check.files)].join(", ") || "nothing else is protected"}.\nReturn exactly one artifact with one ${PATCH_MEDIA_TYPE} text part: a Git patch against that commit. Your result will be verified independently; it is not accepted because you report completion.`;
    const params = { message: { messageId, contextId, role: "ROLE_USER", parts: [{ text }], metadata: { skill: node.peer.skill } }, configuration: { acceptedOutputModes: [PATCH_MEDIA_TYPE], returnImmediately: true } };
    const sentAt = new Date().toISOString();
    await immutableControllerFile(join(directory, "request.json"), { schema_version: "wringer.contained-graph-delegation-request.v1", endpoint: node.peer.url, cardSha256: node.peer.cardSha256, method: "SendMessage", params, sentAt });
    let reply: any;
    try { reply = await a2aCall(node.peer.url, "SendMessage", params, 30000); }
    catch (error) { return finish(request, directory, { peer: node.peer, messageId, taskId: null, states: [], cancelRequested: false, outcome: "unavailable", reason: new Redactor().scrub((error as Error).message).slice(0, 2000), artifact: null, candidate: null, evidenceKind: evidence(node) }); }
    if (!reply?.task) return finish(request, directory, { peer: node.peer, messageId, taskId: null, states: [], cancelRequested: false, outcome: "failed", reason: "The peer answered with a message, not a task", artifact: null, candidate: null, evidenceKind: evidence(node) });
    const first = task(reply.task);
    await immutableControllerFile(join(directory, "sent.json"), { taskId: first.id, contextId: first.contextId ?? null, messageId, sentAt });
    return settle(request, directory, services, first.id, first, { messageId, states: [], sentAt });
}
/** Read-only reconciliation: a retained record, or the peer's state for a retained task id. */
export async function observeExternalTask(request: GraphEffectRequest, directory: string, services: ExternalTaskServices) {
    if (await present(join(directory, "delegation.json"))) return readControllerFile(join(directory, "delegation.json")) as Promise<GraphDelegation>;
    if (!await present(join(directory, "sent.json"))) return null;
    const sent = await readControllerFile(join(directory, "sent.json")), node = request.plan.nodes[request.node] as Delegate;
    let current;
    try { current = task(await a2aCall(node.peer.url, "GetTask", { id: sent.taskId }, 10000)); } catch { return null; }
    if (!TERMINAL[current.status.state]) return null;
    return settle(request, directory, services, sent.taskId, current, { messageId: sent.messageId, states: [], sentAt: sent.sentAt });
}
