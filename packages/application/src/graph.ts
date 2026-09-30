/** Production contained-graph driver. Every graph node runs through an existing
 * contained service: a loop is an ordinary contained controller journey, a check
 * is a fresh contained verifier over the owner's exact candidate, and a delivery
 * is the existing portable preparation and separate Send. The graph adds order,
 * aggregate allowance and typed handoff; it never adds a host execution path.
 *
 * Child state lives at `<graph>/children/<node>/`. A child controller is a normal
 * contained state directory, so its own status, loop, review and resume commands
 * keep working; the graph reconciles by reading it and never re-dispatches. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { copyFile, lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { compileDeclaration, createExecutionAuthority, hashValue, planVersion, type ContainedGraphNode, type ContainedGraphPlan, type ExecutionAuthority, type ExecutionPlan } from "@wringer/plan";
import type { GraphCandidate, GraphDriver, GraphEffectRequest, GraphObservation } from "@wringer/scheduler";
import { deliverContained, exportEvidenceBundle, type ContainedDeliveryResult } from "@wringer/delivery";
import { readContainedGraph } from "@wringer/scheduler";
import { inspectGraph } from "../../../examples/evidence/read-bundle.mjs";
import readerSource from "../../../integrations/bundle-reader.txt" with { type: "text" };
import exportSchema from "../../../schema/contained-graph-export-v1.schema.json";
import { safePath } from "@wringer/workflow";
import { processDriver, type PreparedRepositorySource } from "@wringer/runtime";
import { controllerStatus, immutableControllerFile, privateControllerDirectory, readController, readControllerFile, startController, type ApplicationOptions } from "./controller";
import { containedServices } from "./services";

const ROOT_SOURCE = "root-source/source.bundle";
const RECOVERY_ACTIONS = ["resume", "retry-verification", "retry-judge", "retry-stopped", "retry-uncertain", "request-revision"];
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
function fail(message: string): never { throw new Error(message); }
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
type Loop = Extract<ContainedGraphNode, { kind: "loop" }>;
type Delivery = Extract<ContainedGraphNode, { kind: "delivery" }>;

async function present(path: string) {
    try { const info = await lstat(path); if (info.isSymbolicLink()) fail("Graph child records cannot be symlinks"); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function child(directory: string, node: string, create = false) {
    if (!/^[a-z][a-z0-9-]*$/.test(node)) fail("Unsafe graph node identity");
    const path = await safePath(directory, `children/${node}`);
    if (create) { await privateControllerDirectory(await safePath(directory, "children")); await privateControllerDirectory(path); }
    return path;
}
async function git(args: string[], label: string) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { env: GIT_ENV, timeoutMs: 60000 });
    if (result.code !== 0) fail(`${label} failed; nothing was changed`);
    return result.stdout;
}
/** Paths every leaf's acceptance depends on. A candidate may not change them. */
export function graphAcceptanceInputs(plan: ContainedGraphPlan): string[] {
    const leaves = Object.values(plan.nodes).filter((node): node is Loop => node.kind === "loop");
    return [...new Set(leaves.flatMap(node => [...node.plan.acceptance.protected_paths, ...node.plan.acceptance.checks.flatMap(check => check.files)]))].sort();
}
/** Compare the exact Git entries of every acceptance input with the graph root. */
export async function assertAcceptanceInputsUnchanged(objectStore: string, plan: ContainedGraphPlan, candidateCommit: string) {
    const paths = graphAcceptanceInputs(plan);
    if (!paths.length) return;
    const read = (commit: string) => git(["--git-dir", objectStore, "--literal-pathspecs", "ls-tree", "-r", "-z", commit, "--", ...paths], "Reading acceptance inputs");
    if (await read(plan.repository.commit) !== await read(candidateCommit)) fail("The candidate changed a graph acceptance input; no child was derived from it");
}
/** The owner loop's validated journal must hold exactly this candidate. */
async function owner(directory: string, candidate: GraphCandidate) {
    const state = join(await child(directory, candidate.owner), "state");
    const history = await readController(state), recorded = history.state.candidate;
    if (!recorded || recorded.tree !== candidate.tree || recorded.source.commit !== candidate.source.commit || recorded.source.url !== candidate.source.url)
        fail(`The ${candidate.owner} journal does not hold the exact candidate this node received`);
    const source = recorded.source as PreparedRepositorySource;
    if (typeof source.bundlePath !== "string" || typeof source.objectStore !== "string" || !source.bundlePath.startsWith(state + "/") || !source.objectStore.startsWith(state + "/"))
        fail(`The ${candidate.owner} candidate has no captured source transport inside its own journal`);
    return { state, history, source };
}
/** Only the source commit and time clipped to the remaining root allowance may differ. */
function comparable(plan: ExecutionPlan) {
    const { plan_sha256, repository, budget, ...rest } = plan, { wall_clock_seconds, session_timeout_seconds, ...limits } = budget;
    return { ...rest, repository: { url: repository.url }, budget: limits };
}
export interface GraphChildDerivation {
    schema_version: "wringer.contained-graph-derivation.v1"; graphSha256: string; node: string; templatePlanSha256: string;
    inputSha256: string; sourceCommit: string; wallClockSeconds: number; sessionTimeoutSeconds: number; expiresAt: string;
    planSha256: string; authoritySha256: string; rootBundle: boolean;
}
export async function deriveGraphChild(request: GraphEffectRequest, at = new Date()) {
    const node = request.plan.nodes[request.node] as Loop, template = node.plan, input = request.reservation.input;
    if (node?.kind !== "loop") fail("Only a loop node derives a child journey");
    const remaining = Math.floor((Date.parse(request.reservation.deadline) - at.getTime()) / 1000);
    if (remaining < 1) fail(`The root wall clock has no time left for ${request.node}; no child was started`);
    let commit = template.repository.commit, sourceBundle: string | undefined;
    if (input.candidate) {
        const from = await owner(request.directory, input.candidate);
        await assertAcceptanceInputsUnchanged(from.source.objectStore, request.plan, input.candidate.source.commit);
        commit = input.candidate.source.commit; sourceBundle = from.source.bundlePath;
    } else if (await present(await safePath(request.directory, ROOT_SOURCE))) sourceBundle = await safePath(request.directory, ROOT_SOURCE);
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = template as ExecutionPlan & Record<string, unknown>;
    const wall = Math.min(template.budget.wall_clock_seconds, remaining), session = Math.min(template.budget.session_timeout_seconds, wall);
    const plan = compileDeclaration({ ...raw, version: planVersion(template), repository: { url: template.repository.url, commit }, budget: { ...template.budget, wall_clock_seconds: wall, session_timeout_seconds: session } });
    if (hashValue(comparable(plan)) !== hashValue(comparable(template))) fail(`The derived ${request.node} plan differs from its approved template beyond source and clipped time`);
    const expiresAt = new Date(Math.min(Date.parse(request.authority.expiresAt), Date.parse(request.reservation.deadline))).toISOString();
    const authority: ExecutionAuthority = createExecutionAuthority(plan, { actor: request.authority.actor, actions: ["plan", "build", "verify", "judge"], expiresAt, at });
    const derivation: GraphChildDerivation = { schema_version: "wringer.contained-graph-derivation.v1", graphSha256: request.plan.sha256, node: request.node, templatePlanSha256: template.plan_sha256, inputSha256: hashValue(input), sourceCommit: commit, wallClockSeconds: wall, sessionTimeoutSeconds: session, expiresAt, planSha256: plan.plan_sha256, authoritySha256: hashValue(authority), rootBundle: !input.candidate && !!sourceBundle };
    return { plan, authority, sourceBundle, derivation };
}
function runtimeBinary(plan: ExecutionPlan) { return plan.runtime.binary ?? (plan.runtime.kind === "apple-container" ? "container" : "kubectl"); }
function requireRuntime(plan: ExecutionPlan, node: string, directory: string) {
    const binary = runtimeBinary(plan);
    // Read PATH as it is now; the process-start PATH is not the operator's current environment.
    if (!Bun.which(binary, { PATH: process.env.PATH ?? "" })) fail(`Containment unavailable for ${node}: ${binary} is not on PATH. No host fallback exists; nothing was dispatched and ${node} stays reserved.\nNext: install and start the declared runtime, check it with wringer-drive doctor, then wringer-drive graph resume --state ${quote(directory)}`);
}
/** The verifier's outcome without its private evidence directory; what an export carries. */
export function portableVerification(value: { schema_version: string; status: string; candidateCommit: string; candidateTree: string; acceptanceSha256: string; runtimeId: string; image: string; checks: unknown[]; regressions?: unknown[] }) {
    return { schema_version: value.schema_version, status: value.status, candidateCommit: value.candidateCommit, candidateTree: value.candidateTree, acceptanceSha256: value.acceptanceSha256, runtimeId: value.runtimeId, image: value.image, checks: value.checks, regressions: value.regressions ?? [] };
}
function portable(result: ContainedDeliveryResult) {
    return { deliveryId: result.deliveryId, status: result.status, pushed: result.pushed, codeCommit: result.codeCommit, evidenceCommit: result.evidenceCommit, sourceBranch: result.sourceBranch, targetBranch: result.targetBranch, auditCommand: result.auditCommand };
}
async function remoteBranch(remote: string, branch: string) {
    const output = await git(["ls-remote", "--", remote, `refs/heads/${branch}`], "Reading the publication remote");
    return output.split("\n").map(line => line.split("\t")).find(([, ref]) => ref === `refs/heads/${branch}`)?.[0] ?? null;
}
async function assertOrigin(publication: Delivery["publication"]) {
    if (publication.remote.startsWith("/")) {
        const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", publication.remote, "rev-parse", "--is-bare-repository"], { env: GIT_ENV, timeoutMs: 20000 });
        if (result.code !== 0 || result.stdout.trim() !== "true") fail("A local publication origin must be a bare repository; nothing was prepared or sent");
    }
}

export function containedGraphDriver(options: ApplicationOptions = {}): GraphDriver {
    const injectedRoles = !!options.executeRole && !!options.runCommands, injectedCommands = !!options.runCommands;
    async function checkRequest(request: GraphEffectRequest, create: boolean) {
        const candidate = request.reservation.input.candidate ?? fail(`${request.node} has no candidate to check`);
        const from = await owner(request.directory, candidate), original: PreparedRepositorySource = await readControllerFile(join(from.state, "prepared-source.json"));
        const directory = await child(request.directory, request.node, create);
        const verification = { plan: from.history.plan, source: from.source, phase: "candidate" as const, effectId: `graph-check-${request.node}`, signal: request.signal };
        return { candidate, from, directory, verification, services: () => containedServices(directory, original, options) };
    }
    async function deliveryRequest(request: GraphEffectRequest) {
        const node = request.plan.nodes[request.node] as Delivery, candidate = request.reservation.input.candidate ?? fail(`${request.node} has no candidate to deliver`);
        return { node, candidate, from: await owner(request.directory, candidate), directory: await child(request.directory, request.node, true) };
    }
    return {
        async preflight(request, operation) {
            const node = request.plan.nodes[request.node]!;
            if (operation === "send") {
                const { node: delivery, directory } = await deliveryRequest(request);
                await assertOrigin(delivery.publication);
                const prepared = await readControllerFile(join(directory, "prepared.json"));
                if (!await remoteBranch(delivery.publication.remote, delivery.publication.targetBranch)) fail(`Publication target branch ${delivery.publication.targetBranch} does not exist on the remote; nothing was sent`);
                const existing = await remoteBranch(delivery.publication.remote, delivery.publication.sourceBranch);
                if (existing && existing !== prepared.evidenceCommit) fail(`Review branch ${delivery.publication.sourceBranch} already exists with different content; nothing was sent`);
                return;
            }
            if (node.kind === "loop") { if (!injectedRoles) requireRuntime(node.plan, request.node, request.directory); await deriveGraphChild(request); }
            else if (node.kind === "check") { const { from } = await checkRequest(request, false); if (!injectedCommands) requireRuntime(from.history.plan, request.node, request.directory); }
            else if (node.kind === "delivery") {
                const { node: delivery, from } = await deliveryRequest(request);
                await assertOrigin(delivery.publication);
                if (from.history.result.status !== "review-ready") fail(`Delivery needs the ${from.history.state.id} journey to be review-ready; it is ${from.history.result.status}`);
            }
        },
        async dispatch(request) {
            const node = request.plan.nodes[request.node]!;
            if (node.kind === "loop") {
                const derived = await deriveGraphChild(request), directory = await child(request.directory, request.node, true);
                await immutableControllerFile(join(directory, "derivation.json"), derived.derivation);
                await startController(join(directory, "state"), derived.plan, derived.authority, { ...options, ...(derived.sourceBundle ? { sourceBundle: derived.sourceBundle } : {}), signal: request.signal });
            } else if (node.kind === "check") {
                const check = await checkRequest(request, true);
                await check.services().verifyCandidate(check.verification);
            } else if (node.kind === "delivery") {
                const { node: delivery, candidate, from, directory } = await deliveryRequest(request);
                const result = await deliverContained({ stateDir: from.state, publication: delivery.publication, send: false, expectedCandidateTree: candidate.tree, signal: request.signal });
                if (result.codeCommit !== candidate.source.commit || result.pushed) fail("Delivery preparation does not carry the exact candidate commit");
                await immutableControllerFile(join(directory, "prepared.json"), portable(result));
            } else fail(`${node.kind} nodes have no effect to dispatch`);
        },
        async observe(request): Promise<GraphObservation | null> {
            const node = request.plan.nodes[request.node]!, directory = await child(request.directory, request.node);
            if (node.kind === "loop") {
                const state = join(directory, "state");
                if (!await present(join(state, "plan.json"))) return null;
                if (!await present(join(state, ".wringer/contained/events"))) return { kind: "held", reason: `The ${request.node} child started but recorded no journey yet. Inspect it with wringer-drive status --state ${quote(state)} and continue it with wringer-drive resume --state ${quote(state)}; the graph never starts it again.` };
                const projection = await controllerStatus(state), result = projection.result;
                if (projection.status === "running") return null;
                const candidate: GraphCandidate | null = result.candidate ? { source: { url: result.candidate.source.url, commit: result.candidate.source.commit }, tree: result.candidate.tree, owner: request.node } : null;
                if (projection.status === "review-ready") return { kind: "complete", outcome: "ready", candidate, evidenceSha256: projection.revision };
                const next = result.stop?.next_move ? ` Next: ${result.stop.next_move}` : "";
                if (projection.status === "human-hold") return { kind: "held", reason: `The ${request.node} child journey waits for its own human review. ${result.stop?.message ?? ""}${next}`.trim() };
                if (projection.actions.some(action => action.enabled && RECOVERY_ACTIONS.includes(action.id))) return { kind: "held", reason: `The ${request.node} child journey stopped with a recovery available under its own authority. ${result.stop?.message ?? ""}${next}`.trim() };
                return { kind: "complete", outcome: "stopped", candidate, evidenceSha256: projection.revision };
            }
            if (!await present(directory)) return null;
            if (node.kind === "check") {
                const check = await checkRequest(request, false);
                if (!await present(join(check.directory, "verification", check.verification.effectId, "observation-record.json"))) return null;
                const verification = await check.services().reconcileVerification!(check.verification);
                if (!verification) return null;
                if (verification.candidateTree !== check.candidate.tree || verification.candidateCommit !== check.candidate.source.commit) fail(`The ${request.node} verification observed a different candidate`);
                return { kind: "complete", outcome: verification.status, candidate: check.candidate, evidenceSha256: hashValue(portableVerification(verification)) };
            }
            if (node.kind === "delivery") {
                const candidate = request.reservation.input.candidate!, delivery = node as Delivery;
                if (await present(join(directory, "sent.json"))) return { kind: "complete", outcome: "delivered", candidate, evidenceSha256: hashValue(await readControllerFile(join(directory, "sent.json"))) };
                if (!await present(join(directory, "prepared.json"))) return null;
                const prepared = await readControllerFile(join(directory, "prepared.json"));
                if (await present(join(directory, "send-intent.json"))) {
                    // A Send was attempted without a retained confirmation: read the remote only.
                    const head = await remoteBranch(delivery.publication.remote, delivery.publication.sourceBranch);
                    return head === prepared.evidenceCommit ? { kind: "complete", outcome: "delivered", candidate, evidenceSha256: hashValue({ reconciled: "remote-branch", evidenceCommit: head, sourceBranch: delivery.publication.sourceBranch }) } : null;
                }
                return { kind: "prepared", candidate, evidenceSha256: hashValue(prepared) };
            }
            return null;
        },
        async send(request) {
            const { node: delivery, candidate, from, directory } = await deliveryRequest(request), prepared = await readControllerFile(join(directory, "prepared.json"));
            await immutableControllerFile(join(directory, "send-intent.json"), { schema_version: "wringer.contained-graph-send-intent.v1", deliveryId: prepared.deliveryId, evidenceCommit: prepared.evidenceCommit, sourceBranch: delivery.publication.sourceBranch, targetBranch: delivery.publication.targetBranch });
            const result = await deliverContained({ stateDir: from.state, publication: delivery.publication, send: true, expectedCandidateTree: candidate.tree, signal: request.signal });
            if (!result.pushed || result.evidenceCommit !== prepared.evidenceCommit || result.deliveryId !== prepared.deliveryId) fail("Send did not confirm the exact prepared evidence commit");
            await immutableControllerFile(join(directory, "sent.json"), portable(result));
        },
    };
}
/** Retain the operator's root source bundle beside the graph for root-input loops.
 * The bundle is transport only: each child still verifies the pinned commit. */
export async function attachGraphRootSource(directory: string, bundlePath: string) {
    const info = await lstat(bundlePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) fail("Root source bundle must be a regular, non-symlink file of at most 64 MiB");
    const target = await safePath(directory, ROOT_SOURCE);
    await privateControllerDirectory(await safePath(directory, "root-source"));
    if (await present(target)) {
        const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
        if (digest(await readFile(target)) !== digest(await readFile(bundlePath))) fail("A different root source bundle is already attached to this graph");
        return target;
    }
    await copyFile(bundlePath, target, 1 /* COPYFILE_EXCL */);
    return target;
}

const LEGACY_KINDS = ["intent", "human", "deliver"];
const GRAPH_OMISSIONS = [
    { what: "Child controller journals (children/NODE/state)", reason: "They record private controller paths, provider sessions and raw runtime output. A loop is linked to its delivery through the delivery manifest's journal head; the delivery envelope carries the portable evidence." },
    { what: "Raw verifier output for check nodes", reason: "Command stdout/stderr may carry private paths or secrets. The exported verification summary carries each check's status, exit code and output digest." },
    { what: "Root source bundle, candidate object stores, locks and staging", reason: "Transport and coordination state, not evidence; the candidate commit travels in the delivery envelope." },
];
/** Portable export: exact graph records, per-node evidence bound to recorded
 * results, nested delivery envelopes, the independent reader and a summary.
 * The destination is allocated exclusively and never overwritten. */
export async function exportContainedGraph(directory: string, destination: string) {
    const state = await readContainedGraph(directory), source = await fs.realpath(directory);
    const output = path.join(await fs.realpath(path.dirname(path.resolve(destination))), path.basename(path.resolve(destination)));
    if (output === source || output.startsWith(source + path.sep)) fail("Export outside the graph state directory");
    await fs.mkdir(output, { mode: 0o700 });
    const files: Record<string, string> = {}, digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const write = async (name: string, bytes: string | Uint8Array) => { const target = path.join(output, name); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 }); files[name] = digest(bytes); return name; };
    const copy = async (from: string, name: string) => write(name, await fs.readFile(await safePath(directory, from)));
    await copy("plan.json", "graph/plan.json"); await copy("authority.json", "graph/authority.json");
    for (const event of state.events) await copy(`events/${String(event.sequence).padStart(4, "0")}.json`, `graph/events/${String(event.sequence).padStart(4, "0")}.json`);
    const nodes: { id: string; kind: string; evidence: string | null; prepared: string | null; delivery: string | null }[] = [];
    for (const [id, row] of Object.entries(state.nodes)) {
        const node = state.plan.nodes[id]!, entry = { id, kind: node.kind, evidence: null as string | null, prepared: null as string | null, delivery: null as string | null };
        if (node.kind === "loop" && await present(await safePath(directory, `children/${id}/derivation.json`))) entry.evidence = await copy(`children/${id}/derivation.json`, `nodes/${id}/derivation.json`);
        if (node.kind === "check" && row.result) {
            const record = await readControllerFile(await safePath(directory, `children/${id}/verification/graph-check-${id}/result.json`));
            entry.evidence = await write(`nodes/${id}/verification.json`, JSON.stringify(portableVerification(record.value), null, 2) + "\n");
        }
        if (node.kind === "delivery" && row.prepared) {
            const prepared = await readControllerFile(await safePath(directory, `children/${id}/prepared.json`));
            entry.prepared = await write(`nodes/${id}/prepared.json`, JSON.stringify(prepared, null, 2) + "\n");
            if (row.result) {
                const sent = await present(await safePath(directory, `children/${id}/sent.json`)) ? await readControllerFile(await safePath(directory, `children/${id}/sent.json`)) : { reconciled: "remote-branch", evidenceCommit: prepared.evidenceCommit, sourceBranch: (node as Delivery).publication.sourceBranch };
                entry.evidence = await write(`nodes/${id}/delivered.json`, JSON.stringify(sent, null, 2) + "\n");
            }
            const bundle = await safePath(directory, `children/${row.prepared.candidate.owner}/state/deliveries/${prepared.deliveryId}/bundle`);
            await fs.mkdir(path.join(output, "deliveries"), { recursive: true, mode: 0o700 });
            await exportEvidenceBundle(bundle, path.join(output, "deliveries", id));
            entry.delivery = `deliveries/${id}`;
        }
        if (node.kind !== "router") nodes.push(entry);
    }
    const lines = nodes.map(row => { const recorded = state.nodes[row.id]!; return `- **${row.id}** (${row.kind}): ${recorded.result ? `${recorded.result.outcome}` : recorded.prepared ? "prepared" : "reserved"}${recorded.result?.candidate ? `, candidate \`${recorded.result.candidate.source.commit}\` from ${recorded.result.candidate.owner}` : ""}`; });
    const summary = `# Contained graph ${state.plan.id}\n\nPhase: ${state.phase}. Revision \`${state.revision}\`; ${state.events.length} events.\nSource ${state.plan.repository.url} @ \`${state.plan.repository.commit}\`.\n\n${lines.join("\n")}\n\nVerify with \`node read-bundle.mjs .\` (Node built-ins only). Integrity and lineage are not a rerun of behaviour, containment or human acceptance.\n`;
    await write("read-bundle.mjs", readerSource); await write("schema.json", JSON.stringify(exportSchema, null, 2) + "\n"); await write("summary.md", summary);
    const index = { schema_version: "wringer.contained-graph-export.v1" as const, graph: { id: state.plan.id, sha256: state.plan.sha256, repository: state.plan.repository }, revision: state.revision, eventCount: state.events.length, files, nodes, omissions: GRAPH_OMISSIONS, limits: ["Engineering evidence of recorded decisions; not a live model, containment or independent human acceptance measurement.", "The graph actor is recorded, not authenticated.", ...(Object.values(state.plan.nodes).some(node => node.kind === "delivery" && path.isAbsolute(node.publication.remote)) ? ["graph/plan.json is carried verbatim because its digest binds the grant and every event. It names each delivery's declared publication remote; here that includes a local bare origin, a path on the exporting machine that is not resolvable elsewhere. Use an HTTPS or SSH remote for graphs whose evidence you share."] : [])] };
    await fs.writeFile(path.join(output, "graph.json"), JSON.stringify(index, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await inspectGraph(output);
    return index;
}
/** Load a contained graph declaration (YAML or JSON). A loop's `plan` may name
 * an execution-plan file beside the graph; it is compiled and pinned here. */
export async function loadContainedGraphFile(path: string): Promise<ContainedGraphPlan> {
    const { lstat: stat, readFile: read } = await import("node:fs/promises"), { dirname, resolve } = await import("node:path");
    const { parseYaml, EngineError } = await import("@wringer/engine"), { compileContainedGraph, loadExecutionPlan } = await import("@wringer/plan");
    const info = await stat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new EngineError("A graph declaration must be a regular file of at most 2 MiB, not a symlink", 2);
    const raw = parseYaml(await read(path, "utf8"), "graph");
    const nodes = raw && typeof raw === "object" && raw.nodes && typeof raw.nodes === "object" ? Object.values(raw.nodes as Record<string, any>) : [];
    if (raw && typeof raw === "object" && (["budgets", "state", "inputs"].some(key => Object.hasOwn(raw, key)) || nodes.some(node => LEGACY_KINDS.includes(node?.kind))))
        throw new EngineError(`${path} is a retired host-execution graph. It remains readable with wring graph show ${quote(path)}; it cannot run. A contained graph declares loop, check, router, human-hold and delivery nodes.`, 2, "wringer-drive graph --help");
    const declaration = structuredClone(raw);
    for (const node of Object.values((declaration?.nodes ?? {}) as Record<string, any>))
        if (node?.kind === "loop" && typeof node.plan === "string") node.plan = await loadExecutionPlan(resolve(dirname(path), node.plan));
    try { return compileContainedGraph(declaration); }
    catch (error) { throw new EngineError(`Contained graph refused before any effect: ${(error as Error).message}`, 2, "wringer-drive graph --help"); }
}
export interface GraphStatusView {
    schema_version: "wringer.contained-graph-status.v1";
    graph: { id: string; sha256: string; repository: { url: string; commit: string } };
    revision: string; phase: string; reason: string | null; cursor: string; startedAt: string; deadline: string;
    allowance: { roleSessions: { reserved: number; ceiling: number }; verificationAttempts: { reserved: number; ceiling: number }; wallClockSeconds: number };
    nodes: { id: string; kind: string; required: boolean; input: string; state: string; outcome: string | null; route: { to: string; via: string[] } | null; candidate: { commit: string; tree: string; owner: string } | null; evidenceSha256: string | null; child: string | null }[];
    next: { action: "resume" | "decide" | "send" | "inspect-child" | "none"; node: string | null; prompt: string | null; inputSha256: string | null; preparedSha256: string | null; command: string | null };
}
/** One derived view for CLI and later MCP inspection. It grants nothing. */
export function graphStatusView(directory: string, state: import("@wringer/scheduler").GraphState): GraphStatusView {
    const { plan } = state, order: string[] = [];
    const visit = (id: string) => { if (id === "done" || id === "fail" || order.includes(id)) return; order.push(id); const node = plan.nodes[id]!; for (const next of node.kind === "router" ? [...node.routes.map(route => route.to), node.otherwise] : [node.then]) visit(next); };
    visit(plan.entry);
    const nodes = order.map(id => {
        const node = plan.nodes[id]!, row = state.nodes[id];
        const phase = !row ? (node.kind === "router" ? "evaluated-inline" : "not-reached") : row.route ? "complete" : row.result ? "resulted" : row.sent ? "sent" : row.prepared ? "prepared" : row.decision ? "decided" : row.dispatched ? "dispatched" : "reserved";
        const candidate = row?.result?.candidate ?? row?.prepared?.candidate ?? null;
        return { id, kind: node.kind, required: plan.required.includes(id), input: node.input, state: phase, outcome: row?.result?.outcome ?? null, route: row?.route ? { to: row.route.to, via: row.route.via } : null, candidate: candidate ? { commit: candidate.source.commit, tree: candidate.tree, owner: candidate.owner } : null, evidenceSha256: row?.result?.evidenceSha256 ?? row?.prepared?.evidenceSha256 ?? null, child: node.kind === "loop" && row?.dispatched ? `children/${id}/state` : null };
    });
    const cursor = state.nodes[state.cursor], graph = quote(directory);
    let next: GraphStatusView["next"] = { action: "none", node: null, prompt: null, inputSha256: null, preparedSha256: null, command: null };
    if (state.phase === "human-hold" && plan.nodes[state.cursor]?.kind === "human-hold" && cursor) {
        const input = hashValue(cursor.reservation.input), prompt = (plan.nodes[state.cursor] as Extract<ContainedGraphNode, { kind: "human-hold" }>).prompt;
        next = { action: "decide", node: state.cursor, prompt, inputSha256: input, preparedSha256: null, command: `wringer-drive graph decide --state ${graph} --node ${state.cursor} --revision ${state.revision} --input ${input} --continue --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'` };
    } else if (state.phase === "human-hold") next = { action: "inspect-child", node: state.cursor, prompt: state.reason, inputSha256: null, preparedSha256: null, command: `wringer-drive status --state ${quote(join(directory, "children", state.cursor, "state"))}` };
    else if (state.phase === "send-hold" && cursor?.prepared) {
        const prepared = hashValue(cursor.prepared);
        next = { action: "send", node: state.cursor, prompt: null, inputSha256: null, preparedSha256: prepared, command: `wringer-drive graph send --state ${graph} --node ${state.cursor} --revision ${state.revision} --prepared ${prepared} --by 'YOUR NAME' --note 'WHY THIS EXACT DELIVERY MAY BE PUBLISHED'` };
    } else if (["pending", "uncertain"].includes(state.phase)) next = { action: "resume", node: state.cursor, prompt: null, inputSha256: null, preparedSha256: null, command: `wringer-drive graph resume --state ${graph}` };
    return { schema_version: "wringer.contained-graph-status.v1", graph: { id: plan.id, sha256: plan.sha256, repository: { url: plan.repository.url, commit: plan.repository.commit } }, revision: state.revision, phase: state.phase, reason: state.reason, cursor: state.cursor, startedAt: state.startedAt, deadline: state.deadline,
        allowance: { roleSessions: { reserved: state.reserved.roleSessions, ceiling: plan.budget.maxRoleSessions }, verificationAttempts: { reserved: state.reserved.verificationAttempts, ceiling: plan.budget.maxVerificationAttempts }, wallClockSeconds: plan.budget.wallClockSeconds }, nodes, next };
}
export function renderGraphStatus(view: GraphStatusView): string {
    const width = Math.max(...view.nodes.map(node => node.id.length));
    const rows = view.nodes.map(node => `  ${node.id.padEnd(width)}  ${node.kind.padEnd(10)}  ${node.state}${node.outcome ? ` · ${node.outcome}` : ""}${node.route ? ` → ${node.route.via.length ? `${node.route.via.join(" → ")} → ` : ""}${node.route.to}` : ""}${node.candidate ? ` · candidate ${node.candidate.commit.slice(0, 12)} from ${node.candidate.owner}` : ""}${node.required ? "" : " · optional"}`);
    return [`Graph ${view.graph.id} · ${view.phase}${view.reason ? `: ${view.reason}` : ""}`, `Revision ${view.revision}`, ...rows,
        `Allowance reserved: ${view.allowance.roleSessions.reserved}/${view.allowance.roleSessions.ceiling} role sessions, ${view.allowance.verificationAttempts.reserved}/${view.allowance.verificationAttempts.ceiling} verifier attempts; root deadline ${view.deadline}.`,
        ...(view.next.prompt && view.next.action === "decide" ? [`Hold: ${view.next.prompt}`] : []),
        view.next.command ? `Next: ${view.next.command}` : "No further graph action is available."].join("\n");
}
