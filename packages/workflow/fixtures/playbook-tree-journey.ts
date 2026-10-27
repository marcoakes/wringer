/** TEST SUPPORT ONLY: real-Git journeys on a v6 plan. Source, overlay, capture and
 * validation are real; the agents and the check commands are scripted. Never starts a
 * sandbox, agent or provider. */
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { compileDeclaration, compileExecutionPlan, createExecutionAuthority, discoverEnvironment, type EnvironmentMap, type ExecutionPlan, type PlaybookSelection, type PlaybookSurface } from "@wringer/plan";
import { digest, prepareRepositorySource, processDriver, runtimeProvenanceVersion, type PreparedRepositorySource, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { containedServices } from "../../application/src/services";
import { treeRepository } from "../../plan/fixtures/playbook-tree";
import { readValidatedContainedState, runContainedJourney } from "../src/contained";
import type { ContainedJourneyOptions } from "../src/contained-types";

const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
const gitEnv = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
async function git(cwd: string, ...args: string[]) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: gitEnv });
    if (result.code !== 0) throw new Error(result.stderr); return result.stdout.trim();
}
export interface RoleSight { commit: string; files: Record<string, string | null>; executable: boolean; prompt: string; }
export interface TreeWorld { plan: ExecutionPlan; repo: string; commit: string; selection: PlaybookSelection; root: string; bundlePath: string; environment: EnvironmentMap; }
/** A repository with a playbook tree, and a v6 plan that selects it (or none). */
export async function treeWorld(settings: { surface?: PlaybookSurface; replace?: string[]; repository?: Record<string, string>; select?: boolean; selection?: (s: PlaybookSelection) => PlaybookSelection; protect?: boolean; writable?: string[] } = {}): Promise<TreeWorld> {
    const made = await treeRepository({ surface: settings.surface, replace: settings.replace, ...(settings.repository ? { repository: settings.repository } : {}) });
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...raw } = compileExecutionPlan(template, { format: "yaml" });
    const selection = settings.selection ? settings.selection(made.selection) : made.selection, select = settings.select ?? true;
    // A no-playbook arm protects the tree too, so a comparison differs only in the playbook.
    const protectedPaths = [...raw.acceptance.protected_paths, ...(select || settings.protect ? [selection.path, ...selection.files!.map(f => f.path)] : [])];
    const plan = compileDeclaration({ version: 6, ...raw, repository: { ...raw.repository, commit: made.commit }, acceptance: { ...raw.acceptance, protected_paths: protectedPaths }, ...(settings.writable ? { scope: { writable: settings.writable } } : {}), budget: { ...raw.budget, max_sessions: 12, max_worker_turns: 4, max_judge_turns: 4 }, ...(select ? { playbook: selection } : {}) });
    const root = await mkdtemp(join(tmpdir(), "wringer-tree-journey-")), bundlePath = join(root, "source.bundle");
    await git(made.repo, "bundle", "create", bundlePath, "--all");
    return { plan, repo: made.repo, commit: made.commit, selection, root, bundlePath, environment: await discoverEnvironment(made.repo, plan) };
}
const WATCHED = [".claude/skills/repair-first/SKILL.md", ".agents/skills/repair-first/SKILL.md", "CLAUDE.md", "AGENTS.md", "PLAYBOOK.md", "scripts/wringer/inspect.sh"];
/** One journey of `plan` in `controllerDir`: checks fail `failures` times before passing. */
export async function runTreeJourney(world: Pick<TreeWorld, "bundlePath" | "environment">, plan: ExecutionPlan, controllerDir: string, settings: { actor?: string; failures?: number; edit?: (attempt: number) => Record<string, string>; worker?: (request: RoleExecutionRequest, clone: string) => Promise<void> } = {}) {
    const prepared = await prepareRepositorySource({ ...plan.repository, bundlePath: world.bundlePath }, { controllerDir });
    const environment = world.environment.plan_sha256 === plan.plan_sha256 ? world.environment : await (async () => { throw new Error("Discover the environment of this exact plan first"); })();
    const sight = { workers: [] as RoleSight[], judges: [] as RoleSight[], requests: [] as RoleExecutionRequest[] };
    let workers = 0, verifications = 0;
    const scratch = await mkdtemp(join(tmpdir(), "wringer-tree-roles-"));
    const tree = async (source: PreparedRepositorySource) => git(scratch, "--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`);
    const services = containedServices(controllerDir, prepared, { runCommands: async request => {
        const baseline = request.repo.commit === plan.repository.commit, failed = baseline || ++verifications <= (settings.failures ?? 0);
        const results = request.commands.map(command => ({ id: command.id, code: command.id.startsWith("acceptance/") && failed ? 1 : 0, stdout: command.id.startsWith("acceptance/") ? failed ? "expected 5, received 4" : "1 pass" : "ok", stderr: "", durationMs: 1 }));
        // As the real verifier does: the digest of the protected inputs at the acceptance source.
        const acceptance = request.acceptanceSource as PreparedRepositorySource | undefined;
        const authority = acceptance ? (await processDriver.command(["git", "--literal-pathspecs", "--git-dir", acceptance.objectStore, "ls-tree", "-r", "-z", acceptance.commit, "--", ...(request.protectedFiles ?? [])], { env: gitEnv })).stdout : null;
        return { sourceChanged: false, sourceTree: await tree(request.repo as PreparedRepositorySource), checkInputsSha256: authority ? digest(authority) : "d".repeat(64), results, provenance: { schema_version: runtimeProvenanceVersion(plan.repository.url), role: "verifier", runtimeId: randomUUID(), kind: plan.runtime.kind, image: plan.runtime.image!, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: plan.runtime, observed: { writableDirectories: plan.environment.writable_directories, fixture: true }, limits: ["Scripted checks; no runtime execution"] } } as any;
    } });
    const executeRole = async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        sight.requests.push(request);
        const clone = await mkdtemp(join(scratch, `${request.role}-`));
        await git(scratch, "clone", "-q", "--no-checkout", request.repo.bundlePath!, clone); await git(clone, "checkout", "-q", "--detach", request.repo.commit);
        const files: Record<string, string | null> = {};
        for (const path of WATCHED) files[path] = await readFile(join(clone, path), "utf8").catch(() => null);
        const view = { commit: request.repo.commit, files, executable: await stat(join(clone, "scripts/wringer/inspect.sh")).then(info => (info.mode & 0o111) !== 0, () => false), prompt: request.prompt };
        let change: RoleExecutionResult["change"];
        const events = [{ sessionUpdate: "tool_call", toolCallId: `${request.role}-1`, title: "Read src/total.ts", kind: "read", status: "pending" }, { sessionUpdate: "tool_call_update", toolCallId: `${request.role}-1`, status: "completed", content: [{ type: "content", content: { type: "text", text: "export const total = () => 4;" } }] }, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: request.role === "worker" ? "The total returns 4; the check expects 5." : "Reviewed the candidate." } }];
        if (request.role === "worker") {
            sight.workers.push(view); workers++;
            if (settings.worker) await settings.worker(request, clone);
            else for (const [path, content] of Object.entries(settings.edit?.(workers) ?? { "src/total.ts": `export const total = () => ${4 + workers};\n` })) { await mkdir(dirname(join(clone, path)), { recursive: true }); await writeFile(join(clone, path), content); }
            await git(clone, "add", "-A");
            const patch = (await processDriver.command(["git", "-C", clone, "diff", "--cached", "--binary", "--full-index", request.repo.commit, "--"], { env: gitEnv })).stdout;
            change = { baseCommit: request.repo.commit, patch, sha256: digest(patch) };
        } else sight.judges.push(view);
        const text = request.role === "worker" ? "Changed the total." : JSON.stringify({ criteria: plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: true, reason: "Scripted review" })), note: "Scripted" });
        return { status: "completed", text, sessionId: randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, usage: { inputTokens: 10, outputTokens: 5 }, events: events.map(update => ({ type: "acp.update", update })), stderr: "", ...(change ? { change } : {}), provenance: { schema_version: runtimeProvenanceVersion(request.repo.url), runtimeId: randomUUID(), role: request.role, kind: plan.runtime.kind, image: plan.runtime.image!, repository: { url: request.repo.url, commit: request.repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: request.role === "worker" ? "read-write" : "read-only", declared: plan.runtime, observed: { fixture: true }, limits: ["No real runtime or provider"] } } as RoleExecutionResult;
    };
    const options: ContainedJourneyOptions = { controllerDir, plan, environment, authority: createExecutionAuthority(plan, { actor: settings.actor ?? "Fixture operator", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() }), services, executeRole };
    return { options, sight, prepared, scratch };
}
/** One world and one journey of its plan, ready to run. */
export async function treeJourneyFixture(settings: Parameters<typeof treeWorld>[0] & Parameters<typeof runTreeJourney>[3] = {}) {
    const world = await treeWorld(settings), controllerDir = join(world.root, "controller");
    const run = await runTreeJourney(world, world.plan, controllerDir, settings);
    return { plan: world.plan, made: { repo: world.repo, commit: world.commit, selection: world.selection }, root: world.root, controllerDir, options: run.options, sight: run.sight, world, scratch: run.scratch };
}
/** Run and validate: the fixture form of a fresh research journey. */
export async function runAndValidateTreeJourney(world: Pick<TreeWorld, "bundlePath" | "environment">, plan: ExecutionPlan, controllerDir: string, settings: Parameters<typeof runTreeJourney>[3] = {}) {
    const run = await runTreeJourney(world, plan, controllerDir, settings), result = await runContainedJourney(run.options);
    return { result, validated: await readValidatedContainedState(controllerDir), sight: run.sight };
}
