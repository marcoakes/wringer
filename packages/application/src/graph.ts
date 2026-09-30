/** Production contained-graph driver. Every graph node runs through an existing
 * contained service: a loop is an ordinary contained controller journey, a check
 * is a fresh contained verifier over the owner's exact candidate, a join merges
 * branch candidates deterministically and verifies the result afresh against every
 * branch plan, and a delivery is a portable preparation plus a separate Send. The
 * graph adds order, aggregate allowance and typed handoff; it never adds a host
 * execution path.
 *
 * Child state lives at `<graph>/children/<node>/`. A child controller is a normal
 * contained state directory, so its own status, loop, review and resume commands
 * keep working; the graph reconciles by reading it and never re-dispatches. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { copyFile, lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { compileDeclaration, createExecutionAuthority, graphEdges, graphInput, graphRegions, hashValue, planVersion, type ContainedGraphNode, type ContainedGraphPlan, type ExecutionAuthority, type ExecutionPlan } from "@wringer/plan";
import type { GraphCandidate, GraphDriver, GraphEffectRequest, GraphObservation } from "@wringer/scheduler";
import { deliverContained, exportEvidenceBundle, type ContainedDeliveryResult } from "@wringer/delivery";
import { readContainedGraph } from "@wringer/scheduler";
import { inspectGraph } from "../../../examples/evidence/read-bundle.mjs";
import readerSource from "../../../integrations/bundle-reader.txt" with { type: "text" };
import exportSchema from "../../../schema/contained-graph-export-v1.schema.json";
import exportSchemaV2 from "../../../schema/contained-graph-export-v2.schema.json";
import { safePath } from "@wringer/workflow";
import { processDriver, type PreparedRepositorySource } from "@wringer/runtime";
import { controllerStatus, immutableControllerFile, privateControllerDirectory, readController, readControllerFile, startController, type ApplicationOptions } from "./controller";
import { containedServices } from "./services";

const ROOT_SOURCE = "root-source/source.bundle";
const RECOVERY_ACTIONS = ["resume", "retry-verification", "retry-judge", "retry-stopped", "retry-uncertain", "request-revision"];
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
/** Fixed identity and time: the same branches always integrate to the same commit. */
const INTEGRATION_ENV = { ...GIT_ENV, GIT_AUTHOR_NAME: "Wringer integration", GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: "Wringer integration", GIT_COMMITTER_EMAIL: "wringer@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
function fail(message: string): never { throw new Error(message); }
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
type Loop = Extract<ContainedGraphNode, { kind: "loop" }>;
type Delivery = Extract<ContainedGraphNode, { kind: "delivery" }>;
type Join = Extract<ContainedGraphNode, { kind: "join" }>;

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
async function git(args: string[], label: string, options: { env?: Record<string, string>; input?: string; allowed?: number[] } = {}) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { env: options.env ?? GIT_ENV, timeoutMs: 60000, input: options.input });
    if (!(options.allowed ?? [0]).includes(result.code)) fail(`${label} failed; nothing was changed`);
    return options.allowed ? `${result.code}\n${result.stdout}` : result.stdout;
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
export interface GraphIntegration {
    schema_version: "wringer.contained-graph-integration.v1"; graphSha256: string; join: string; base: string;
    branches: { branch: string; node: string; commit: string; tree: string }[];
    status: "merged" | "conflict"; commit?: string; tree?: string; conflicts?: string[];
}
/** A join's integrated candidate lives in its own controller-owned store. */
async function integrationOwner(directory: string, candidate: GraphCandidate) {
    const state = await child(directory, candidate.owner), record: GraphIntegration = await readControllerFile(join(state, "integration.json"));
    if (record.status !== "merged" || record.commit !== candidate.source.commit || record.tree !== candidate.tree) fail(`The ${candidate.owner} integration does not hold the exact candidate this node received`);
    return { kind: "join" as const, state, record, history: null, source: { url: candidate.source.url, commit: record.commit, bundlePath: join(state, "source.bundle"), objectStore: join(state, "integration.git") } as PreparedRepositorySource };
}
/** The owner loop's validated journal must hold exactly this candidate. */
async function owner(directory: string, candidate: GraphCandidate, plan?: ContainedGraphPlan) {
    if (plan?.nodes[candidate.owner]?.kind === "join") return integrationOwner(directory, candidate);
    return loopOwner(directory, candidate);
}
async function loopOwner(directory: string, candidate: GraphCandidate) {
    const state = join(await child(directory, candidate.owner), "state");
    const history = await readController(state), recorded = history.state.candidate;
    if (!recorded || recorded.tree !== candidate.tree || recorded.source.commit !== candidate.source.commit || recorded.source.url !== candidate.source.url)
        fail(`The ${candidate.owner} journal does not hold the exact candidate this node received`);
    const source = recorded.source as PreparedRepositorySource;
    if (typeof source.bundlePath !== "string" || typeof source.objectStore !== "string" || !source.bundlePath.startsWith(state + "/") || !source.objectStore.startsWith(state + "/"))
        fail(`The ${candidate.owner} candidate has no captured source transport inside its own journal`);
    return { kind: "loop" as const, state, history, record: null, source };
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
        const from = await owner(request.directory, input.candidate, request.plan);
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
/** Git 2.40 added `merge-tree --merge-base`; 2.38 added `merge-tree --write-tree`.
 * Older Git cannot merge without a working tree, so a join refuses it before dispatch. */
export type GitMergeMode = "explicit-base" | "computed-base";
export function gitMergeMode(version: string): GitMergeMode | null {
    const match = /^git version (\d+)\.(\d+)/.exec(version.trim());
    if (!match) return null;
    const major = Number(match[1]), minor = Number(match[2]);
    if (major > 2 || major === 2 && minor >= 40) return "explicit-base";
    if (major === 2 && minor >= 38) return "computed-base";
    return null;
}
async function installedMergeMode() { return gitMergeMode(await git(["--version"], "Reading the Git version")); }
/** Three-way merge of `current` and `next` against the fork's source, writing objects only.
 * With Git 2.38–2.39 Git computes the merge base itself; that is accepted only when it is
 * exactly the fork's source, so both modes produce the same tree. */
export async function mergeBranchCandidates(store: string, base: string, current: string, next: string, mode: GitMergeMode) {
    if (mode === "computed-base") {
        const bases = (await git(["--git-dir", store, "merge-base", "--all", current, next], "Reading the merge base")).split("\n").filter(Boolean);
        if (bases.length !== 1 || bases[0] !== base) fail("This Git (2.38 or 2.39) computes the merge base itself, and these candidates do not meet exactly at the fork's source. Integrating them needs Git 2.40 or later; nothing was integrated");
    }
    const args = mode === "explicit-base" ? ["--merge-base", base, current, next] : [current, next];
    const [code, tree, ...paths] = (await git(["--git-dir", store, "merge-tree", "--write-tree", "--name-only", "--no-messages", ...args], "Merging branch candidates", { allowed: [0, 1] })).split("\n").filter(Boolean);
    return code === "0" ? { tree: tree!, conflicts: [] as string[] } : { tree: null, conflicts: [...new Set(paths)].sort() };
}
/** Integrate branch candidates in declared order against the fork's source.
 * Git writes objects only; no working tree is touched. */
async function integrate(request: GraphEffectRequest, directory: string): Promise<GraphIntegration> {
    const recordPath = join(directory, "integration.json");
    if (await present(recordPath)) return readControllerFile(recordPath);
    const branches = request.reservation.input.branches ?? fail(`${request.node} has no branch candidates`), base = request.reservation.input.source.commit, store = join(directory, "integration.git");
    await git(["init", "--bare", "--initial-branch=integration", store], "Creating the integration store");
    for (const [index, branch] of branches.entries()) {
        const from = await loopOwner(request.directory, branch.candidate);
        await git(["--git-dir", store, "fetch", "--no-tags", "--", from.source.bundlePath!, `${branch.candidate.source.commit}:refs/heads/branch-${index}`], `Fetching branch ${branch.branch}`);
        const [code] = (await git(["--git-dir", store, "merge-base", "--is-ancestor", base, branch.candidate.source.commit], "Checking branch ancestry", { allowed: [0, 1] })).split("\n");
        if (code !== "0") fail(`Branch ${branch.branch} does not descend from the fork's source; nothing was integrated`);
    }
    const mode = await installedMergeMode() ?? fail("Joins need Git 2.38 or later to integrate without a working tree; nothing was integrated");
    let current = branches[0]!.candidate.source.commit, conflicts: string[] = [];
    for (const branch of branches.slice(1)) {
        const merged = await mergeBranchCandidates(store, base, current, branch.candidate.source.commit, mode);
        if (!merged.tree) { conflicts = merged.conflicts; break; }
        current = (await git(["--git-dir", store, "commit-tree", merged.tree, "-p", current, "-p", branch.candidate.source.commit, "-m", `Integrate ${branches.map(row => row.branch).join(", ")} for graph ${request.plan.id}`], "Recording the integration", { env: INTEGRATION_ENV })).trim();
    }
    const record: GraphIntegration = { schema_version: "wringer.contained-graph-integration.v1", graphSha256: request.plan.sha256, join: request.node, base, branches: branches.map(row => ({ branch: row.branch, node: row.node, commit: row.candidate.source.commit, tree: row.candidate.tree })), status: conflicts.length ? "conflict" : "merged", ...(conflicts.length ? { conflicts } : {}) };
    if (!conflicts.length) {
        record.commit = current; record.tree = (await git(["--git-dir", store, "rev-parse", `${current}^{tree}`], "Reading the integrated tree")).trim();
        await assertAcceptanceInputsUnchanged(store, request.plan, current);
        await git(["--git-dir", store, "update-ref", "refs/heads/integrated", current], "Recording the integrated candidate");
        await git(["--git-dir", store, "bundle", "create", join(directory, "source.bundle"), "refs/heads/integrated"], "Bundling the integrated candidate");
    }
    await immutableControllerFile(recordPath, record);
    return record;
}
async function remoteDefaultBranch(remote: string) {
    const output = await git(["ls-remote", "--symref", "--", remote, "HEAD"], "Reading the remote default branch");
    return /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(output)?.[1] ?? null;
}
async function assertOrigin(publication: Delivery["publication"]) {
    if (publication.remote.startsWith("/")) {
        const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", publication.remote, "rev-parse", "--is-bare-repository"], { env: GIT_ENV, timeoutMs: 20000 });
        if (result.code !== 0 || result.stdout.trim() !== "true") fail("A local publication origin must be a bare repository; nothing was prepared or sent");
    }
}

/** A delivery whose candidate a join integrated: the evidence commit carries the
 * graph's own portable export on top of the exact merged code. */
async function prepareGraphDelivery(request: GraphEffectRequest, delivery: Delivery, candidate: GraphCandidate, from: Awaited<ReturnType<typeof integrationOwner>>, directory: string) {
    const preparedPath = join(directory, "prepared.json");
    if (await present(preparedPath)) return readControllerFile(preparedPath);
    const deliveryId = `graph-${hashValue({ graph: request.plan.sha256, node: request.node, commit: candidate.source.commit, tree: candidate.tree }).slice(0, 24)}`, prefix = `.wringer/graph-deliveries/${deliveryId}`;
    const scratch = await mkdtemp(join(tmpdir(), "wringer-graph-delivery-")), exported = join(scratch, "export"), index = join(scratch, "index");
    try {
        await exportContainedGraph(request.directory, exported);
        const env = { ...INTEGRATION_ENV, GIT_INDEX_FILE: index }, store = from.source.objectStore;
        await git(["--git-dir", store, "read-tree", candidate.source.commit], "Reading the integrated tree", { env });
        const walk = async (base: string, prefixPath = ""): Promise<string[]> => (await Promise.all((await readdir(join(base, prefixPath), { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(base, join(prefixPath, entry.name)) : Promise.resolve([join(prefixPath, entry.name)])))).flat();
        for (const name of (await walk(exported)).sort()) {
            const blob = (await git(["--git-dir", store, "hash-object", "-w", "--stdin"], "Storing graph evidence", { env, input: await readFile(join(exported, name), "utf8") })).trim();
            await git(["--git-dir", store, "update-index", "--add", "--cacheinfo", `100644,${blob},${prefix}/${name.split(path.sep).join("/")}`], "Staging graph evidence", { env });
        }
        const tree = (await git(["--git-dir", store, "write-tree"], "Writing the evidence tree", { env })).trim();
        const evidenceCommit = (await git(["--git-dir", store, "commit-tree", tree, "-p", candidate.source.commit, "-m", `Wringer graph evidence ${deliveryId}`], "Recording the evidence commit", { env })).trim();
        await git(["--git-dir", store, "update-ref", `refs/heads/delivery-${deliveryId}`, evidenceCommit], "Recording the delivery reference");
        const prepared = { deliveryId, status: "prepared", pushed: false, codeCommit: candidate.source.commit, evidenceCommit, sourceBranch: delivery.publication.sourceBranch, targetBranch: delivery.publication.targetBranch, auditCommand: `node ${prefix}/read-bundle.mjs ${prefix}` };
        await immutableControllerFile(preparedPath, prepared);
        return prepared;
    } finally { await rm(scratch, { recursive: true, force: true }); }
}
export function containedGraphDriver(options: ApplicationOptions = {}): GraphDriver {
    const injectedRoles = !!options.executeRole && !!options.runCommands, injectedCommands = !!options.runCommands;
    async function checkRequest(request: GraphEffectRequest, create: boolean) {
        const candidate = request.reservation.input.candidate ?? fail(`${request.node} has no candidate to check`);
        const from = await loopOwner(request.directory, candidate), original: PreparedRepositorySource = await readControllerFile(join(from.state, "prepared-source.json"));
        const directory = await child(request.directory, request.node, create);
        const verification = { plan: from.history.plan, source: from.source, phase: "candidate" as const, effectId: `graph-check-${request.node}`, signal: request.signal };
        return { candidate, from, directory, verification, services: () => containedServices(directory, original, options) };
    }
    async function deliveryRequest(request: GraphEffectRequest) {
        const node = request.plan.nodes[request.node] as Delivery, candidate = request.reservation.input.candidate ?? fail(`${request.node} has no candidate to deliver`);
        return { node, candidate, from: await owner(request.directory, candidate, request.plan), directory: await child(request.directory, request.node, true) };
    }
    /** One fresh contained verification of the integrated candidate per branch plan. */
    async function joinVerifications(request: GraphEffectRequest, directory: string, record: GraphIntegration) {
        const inputs = request.reservation.input.branches ?? fail(`${request.node} has no branch candidates`);
        return Promise.all(record.branches.map(async (row, index) => {
            const branch = inputs[index];
            if (!branch || branch.branch !== row.branch || branch.candidate.source.commit !== row.commit) fail(`The ${request.node} integration record differs from its reserved branch inputs`);
            const from = await loopOwner(request.directory, branch.candidate);
            const original: PreparedRepositorySource = await readControllerFile(join(from.state, "prepared-source.json"));
            const verification = { plan: from.history.plan, source: { url: request.plan.repository.url, commit: record.commit!, bundlePath: join(directory, "source.bundle"), objectStore: join(directory, "integration.git") } as PreparedRepositorySource, phase: "candidate" as const, effectId: `graph-join-${request.node}-${index}`, signal: request.signal };
            return { verification, services: containedServices(directory, original, options), plan: from.history.plan };
        }));
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
                if (await remoteDefaultBranch(delivery.publication.remote) === delivery.publication.sourceBranch) fail(`Review branch ${delivery.publication.sourceBranch} is the remote default branch; nothing was sent`);
                return;
            }
            if (node.kind === "loop") { if (!injectedRoles) requireRuntime(node.plan, request.node, request.directory); await deriveGraphChild(request); }
            else if (node.kind === "join") {
                const branches = request.reservation.input.branches ?? fail(`${request.node} has no branch candidates`);
                const owners = await Promise.all(branches.map(row => loopOwner(request.directory, row.candidate)));
                if (!await installedMergeMode()) fail(`Joins need Git 2.38 or later to integrate without a working tree. Nothing was dispatched and ${request.node} stays reserved.\nNext: install a newer Git, then wringer-drive graph resume --state ${quote(request.directory)}`);
                if (!injectedCommands) requireRuntime(owners[0]!.history.plan, request.node, request.directory);
            }
            else if (node.kind === "check") { const { from } = await checkRequest(request, false); if (!injectedCommands) requireRuntime(from.history.plan, request.node, request.directory); }
            else if (node.kind === "delivery") {
                const { node: delivery, from } = await deliveryRequest(request);
                await assertOrigin(delivery.publication);
                if (from.kind === "loop" && from.history.result.status !== "review-ready") fail(`Delivery needs the ${from.history.state.id} journey to be review-ready; it is ${from.history.result.status}`);
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
            } else if (node.kind === "join") {
                const directory = await child(request.directory, request.node, true), record = await integrate(request, directory);
                if (record.status === "merged") for (const row of await joinVerifications(request, directory, record)) await row.services.verifyCandidate(row.verification);
            } else if (node.kind === "delivery") {
                const { node: delivery, candidate, from, directory } = await deliveryRequest(request);
                if (from.kind === "join") { await prepareGraphDelivery(request, delivery, candidate, from, directory); return; }
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
            if (node.kind === "join") {
                if (!await present(join(directory, "integration.json"))) return null;
                const record: GraphIntegration = await readControllerFile(join(directory, "integration.json"));
                if (record.status === "conflict") return { kind: "complete", outcome: "conflict", candidate: null, evidenceSha256: hashValue({ integration: record, verifications: [] }) };
                const verifications = [];
                for (const row of await joinVerifications(request, directory, record)) {
                    if (!await present(join(directory, "verification", row.verification.effectId, "observation-record.json"))) return null;
                    const value = await row.services.reconcileVerification!(row.verification);
                    if (!value) return null;
                    if (value.candidateCommit !== record.commit) fail(`The ${request.node} verification observed a different integration`);
                    verifications.push(portableVerification(value));
                }
                const outcome = verifications.some(row => row.status === "unavailable") ? "unavailable" : verifications.some(row => row.status === "failed") ? "failed" : "integrated";
                return { kind: "complete", outcome, candidate: { source: { url: request.plan.repository.url, commit: record.commit! }, tree: record.tree!, owner: request.node }, evidenceSha256: hashValue({ integration: record, verifications }) };
            }
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
            if (from.kind === "join") {
                // Publish the exact prepared evidence commit to the review branch only.
                await git(["--git-dir", from.source.objectStore, "push", "--porcelain", "--", delivery.publication.remote, `${prepared.evidenceCommit}:refs/heads/${delivery.publication.sourceBranch}`], "Publishing the graph delivery");
                if (await remoteBranch(delivery.publication.remote, delivery.publication.sourceBranch) !== prepared.evidenceCommit) fail("Publication outcome is uncertain; the remote branch did not confirm the exact evidence commit");
                await immutableControllerFile(join(directory, "sent.json"), { ...prepared, status: "delivered", pushed: true });
                return;
            }
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
    { what: "Root source bundle, candidate and integration object stores, locks and staging", reason: "Transport and coordination state, not evidence; the candidate commit travels in the delivery envelope or the published review branch." },
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
        if (node.kind === "join" && row.result) {
            const record: GraphIntegration = await readControllerFile(await safePath(directory, `children/${id}/integration.json`));
            const verifications = record.status === "conflict" ? [] : await Promise.all(record.branches.map(async (_, index) => portableVerification((await readControllerFile(await safePath(directory, `children/${id}/verification/graph-join-${id}-${index}/result.json`))).value)));
            entry.evidence = await write(`nodes/${id}/integration.json`, JSON.stringify({ integration: record, verifications }, null, 2) + "\n");
        }
        if (node.kind === "delivery" && row.prepared) {
            const prepared = await readControllerFile(await safePath(directory, `children/${id}/prepared.json`));
            entry.prepared = await write(`nodes/${id}/prepared.json`, JSON.stringify(prepared, null, 2) + "\n");
            if (row.result) {
                const sent = await present(await safePath(directory, `children/${id}/sent.json`)) ? await readControllerFile(await safePath(directory, `children/${id}/sent.json`)) : { reconciled: "remote-branch", evidenceCommit: prepared.evidenceCommit, sourceBranch: (node as Delivery).publication.sourceBranch };
                entry.evidence = await write(`nodes/${id}/delivered.json`, JSON.stringify(sent, null, 2) + "\n");
            }
            // A join-owned delivery carries this graph export itself, not a loop delivery envelope.
            if (state.plan.nodes[row.prepared.candidate.owner]?.kind !== "join") {
                const bundle = await safePath(directory, `children/${row.prepared.candidate.owner}/state/deliveries/${prepared.deliveryId}/bundle`);
                await fs.mkdir(path.join(output, "deliveries"), { recursive: true, mode: 0o700 });
                await exportEvidenceBundle(bundle, path.join(output, "deliveries", id));
                entry.delivery = `deliveries/${id}`;
            }
        }
        if (!["router", "fork"].includes(node.kind)) nodes.push(entry);
    }
    const lines = nodes.map(row => { const recorded = state.nodes[row.id]!; return `- **${row.id}** (${row.kind}): ${recorded.result ? `${recorded.result.outcome}` : recorded.prepared ? "prepared" : "reserved"}${recorded.result?.candidate ? `, candidate \`${recorded.result.candidate.source.commit}\` from ${recorded.result.candidate.owner}` : ""}`; });
    const summary = `# Contained graph ${state.plan.id}\n\nPhase: ${state.phase}. Revision \`${state.revision}\`; ${state.events.length} events.\nSource ${state.plan.repository.url} @ \`${state.plan.repository.commit}\`.\n\n${lines.join("\n")}\n\nVerify with \`node read-bundle.mjs .\` (Node built-ins only). Integrity and lineage are not a rerun of behaviour, containment or human acceptance.\n`;
    const parallel = state.plan.schema_version === "wringer.contained-graph-plan.v2";
    await write("read-bundle.mjs", readerSource); await write("schema.json", JSON.stringify(parallel ? exportSchemaV2 : exportSchema, null, 2) + "\n"); await write("summary.md", summary);
    const index = { schema_version: parallel ? "wringer.contained-graph-export.v2" as const : "wringer.contained-graph-export.v1" as const, graph: { id: state.plan.id, sha256: state.plan.sha256, repository: state.plan.repository }, revision: state.revision, eventCount: state.events.length, files, nodes, omissions: GRAPH_OMISSIONS, limits: ["Engineering evidence of recorded decisions; not a live model, containment or independent human acceptance measurement.", "The graph actor is recorded, not authenticated.", ...(Object.values(state.plan.nodes).some(node => node.kind === "delivery" && path.isAbsolute(node.publication.remote)) ? ["graph/plan.json is carried verbatim because its digest binds the grant and every event. It names each delivery's declared publication remote; here that includes a local bare origin, a path on the exporting machine that is not resolvable elsewhere. Use an HTTPS or SSH remote for graphs whose evidence you share."] : [])] };
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
type ViewNode = { id: string; kind: string; required: boolean; input: string | null; state: string; outcome: string | null; route: { to: string; via: string[] } | null; candidate: { commit: string; tree: string; owner: string } | null; evidenceSha256: string | null; child: string | null };
type ViewAction = { action: "resume" | "decide" | "send" | "inspect-child"; node: string | null; prompt: string | null; inputSha256: string | null; preparedSha256: string | null; command: string };
export interface GraphStatusView {
    schema_version: "wringer.contained-graph-status.v1";
    graph: { id: string; sha256: string; repository: { url: string; commit: string } };
    revision: string; phase: string; reason: string | null; cursor: string; startedAt: string; deadline: string;
    allowance: { roleSessions: { reserved: number; ceiling: number }; verificationAttempts: { reserved: number; ceiling: number }; wallClockSeconds: number };
    nodes: (ViewNode & { input: string })[];
    next: { action: "resume" | "decide" | "send" | "inspect-child" | "none"; node: string | null; prompt: string | null; inputSha256: string | null; preparedSha256: string | null; command: string | null };
}
export interface ParallelGraphStatusView {
    schema_version: "wringer.contained-graph-status.v2";
    graph: { id: string; sha256: string; repository: { url: string; commit: string } };
    revision: string; phase: string; reason: string | null; active: string[]; holds: { node: string; kind: "human" | "child" | "send"; reason: string }[]; cancelled: string[];
    startedAt: string; deadline: string;
    allowance: { roleSessions: { reserved: number; ceiling: number }; verificationAttempts: { reserved: number; ceiling: number }; wallClockSeconds: number; parallelism: number };
    nodes: (ViewNode & { branch: { fork: string; branch: string } | null })[];
    actions: ViewAction[];
}
/** One derived view for CLI and later MCP inspection. It grants nothing. */
export function graphStatusView(directory: string, state: import("@wringer/scheduler").GraphState): GraphStatusView | ParallelGraphStatusView {
    const { plan } = state, order: string[] = [], graph = quote(directory);
    const visit = (id: string) => { if (id === "done" || id === "fail" || order.includes(id)) return; order.push(id); for (const next of graphEdges(plan.nodes[id]!)) visit(next); };
    visit(plan.entry);
    const rows: ViewNode[] = order.map(id => {
        const node = plan.nodes[id]!, row = state.nodes[id];
        const phase = state.cancelled.includes(id) ? "cancelled" : !row ? (node.kind === "router" ? "evaluated-inline" : "not-reached") : row.route ? "complete" : row.result ? "resulted" : row.sent ? "sent" : row.prepared ? "prepared" : row.decision ? "decided" : row.dispatched ? "dispatched" : "reserved";
        const candidate = row?.result?.candidate ?? row?.prepared?.candidate ?? null;
        return { id, kind: node.kind, required: plan.required.includes(id), input: graphInput(node), state: phase, outcome: row?.result?.outcome ?? null, route: row?.route ? { to: row.route.to, via: row.route.via } : null, candidate: candidate ? { commit: candidate.source.commit, tree: candidate.tree, owner: candidate.owner } : null, evidenceSha256: row?.result?.evidenceSha256 ?? row?.prepared?.evidenceSha256 ?? null, child: node.kind === "loop" && row?.dispatched ? `children/${id}/state` : null };
    });
    const decide = (id: string): ViewAction => { const input = hashValue(state.nodes[id]!.reservation.input); return { action: "decide", node: id, prompt: (plan.nodes[id] as Extract<ContainedGraphNode, { kind: "human-hold" }>).prompt, inputSha256: input, preparedSha256: null, command: `wringer-drive graph decide --state ${graph} --node ${id} --revision ${state.revision} --input ${input} --continue --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'` }; };
    const send = (id: string): ViewAction => { const prepared = hashValue(state.nodes[id]!.prepared); return { action: "send", node: id, prompt: null, inputSha256: null, preparedSha256: prepared, command: `wringer-drive graph send --state ${graph} --node ${id} --revision ${state.revision} --prepared ${prepared} --by 'YOUR NAME' --note 'WHY THIS EXACT DELIVERY MAY BE PUBLISHED'` }; };
    const child = (id: string, reason: string): ViewAction => ({ action: "inspect-child", node: id, prompt: reason, inputSha256: null, preparedSha256: null, command: `wringer-drive status --state ${quote(join(directory, "children", id, "state"))}` });
    const resume = (id: string | null): ViewAction => ({ action: "resume", node: id, prompt: null, inputSha256: null, preparedSha256: null, command: `wringer-drive graph resume --state ${graph}` });
    const allowance = { roleSessions: { reserved: state.reserved.roleSessions, ceiling: plan.budget.maxRoleSessions }, verificationAttempts: { reserved: state.reserved.verificationAttempts, ceiling: plan.budget.maxVerificationAttempts }, wallClockSeconds: plan.budget.wallClockSeconds };
    const identity = { id: plan.id, sha256: plan.sha256, repository: { url: plan.repository.url, commit: plan.repository.commit } };
    if (plan.schema_version === "wringer.contained-graph-plan.v2") {
        const branches = new Map<string, { fork: string; branch: string }>();
        for (const [fork, map] of Object.entries(graphRegions(plan))) for (const [branch, members] of Object.entries(map)) for (const member of members) branches.set(member, { fork, branch });
        const actions: ViewAction[] = [];
        if (!["complete", "failed", "expired"].includes(state.phase)) {
            for (const hold of state.holds) actions.push(hold.kind === "human" ? decide(hold.node) : hold.kind === "send" ? send(hold.node) : child(hold.node, hold.reason));
            const held = new Set(state.holds.map(hold => hold.node));
            if (state.active.some(id => !held.has(id))) actions.push(resume(state.active.find(id => !held.has(id)) ?? null));
        }
        return { schema_version: "wringer.contained-graph-status.v2", graph: identity, revision: state.revision, phase: state.phase, reason: state.reason, active: state.active, holds: state.holds, cancelled: state.cancelled, startedAt: state.startedAt, deadline: state.deadline, allowance: { ...allowance, parallelism: plan.parallelism ?? 1 }, nodes: rows.map(row => ({ ...row, branch: branches.get(row.id) ?? null })), actions };
    }
    const cursor = state.nodes[state.cursor];
    let next: GraphStatusView["next"] = { action: "none", node: null, prompt: null, inputSha256: null, preparedSha256: null, command: null };
    if (state.phase === "human-hold" && plan.nodes[state.cursor]?.kind === "human-hold" && cursor) next = decide(state.cursor);
    else if (state.phase === "human-hold") next = child(state.cursor, state.reason ?? "");
    else if (state.phase === "send-hold" && cursor?.prepared) next = send(state.cursor);
    else if (["pending", "uncertain"].includes(state.phase)) next = resume(state.cursor);
    return { schema_version: "wringer.contained-graph-status.v1", graph: identity, revision: state.revision, phase: state.phase, reason: state.reason, cursor: state.cursor, startedAt: state.startedAt, deadline: state.deadline, allowance, nodes: rows.map(row => ({ ...row, input: row.input ?? "" })), next };
}
export function renderGraphStatus(view: GraphStatusView | ParallelGraphStatusView): string {
    const width = Math.max(...view.nodes.map(node => node.id.length));
    const rows = view.nodes.map(node => `  ${node.id.padEnd(width)}  ${node.kind.padEnd(10)}  ${node.state}${node.outcome ? ` · ${node.outcome}` : ""}${node.route ? ` → ${node.route.via.length ? `${node.route.via.join(" → ")} → ` : ""}${node.route.to}` : ""}${node.candidate ? ` · candidate ${node.candidate.commit.slice(0, 12)} from ${node.candidate.owner}` : ""}${"branch" in node && node.branch ? ` · branch ${node.branch.branch}` : ""}${node.required ? "" : " · optional"}`);
    const allowance = `Allowance reserved: ${view.allowance.roleSessions.reserved}/${view.allowance.roleSessions.ceiling} role sessions, ${view.allowance.verificationAttempts.reserved}/${view.allowance.verificationAttempts.ceiling} verifier attempts; root deadline ${view.deadline}.`;
    if (view.schema_version === "wringer.contained-graph-status.v2") {
        const actions = view.actions.map(action => `${action.action === "decide" && action.prompt ? `Hold ${action.node}: ${action.prompt}\n` : ""}Next: ${action.command}`);
        return [`Graph ${view.graph.id} · ${view.phase}${view.reason ? `: ${view.reason}` : ""}`, `Revision ${view.revision}`, `Active: ${view.active.join(", ") || "none"}${view.cancelled.length ? ` · cancelled: ${view.cancelled.join(", ")}` : ""} · up to ${view.allowance.parallelism} branches at once`, ...rows, allowance, ...(actions.length ? actions : ["No further graph action is available."])].join("\n");
    }
    return [`Graph ${view.graph.id} · ${view.phase}${view.reason ? `: ${view.reason}` : ""}`, `Revision ${view.revision}`, ...rows, allowance,
        ...(view.next.prompt && view.next.action === "decide" ? [`Hold: ${view.next.prompt}`] : []),
        view.next.command ? `Next: ${view.next.command}` : "No further graph action is available."].join("\n");
}
