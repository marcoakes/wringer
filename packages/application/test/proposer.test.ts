/** Release 2 F: replicate set -> evidence tree -> one proposer session -> a validated
 * playbook tree whose every change cites a trajectory moment, or KEEP_BASE. Real Git
 * journeys and capture; scripted agents; no model, runtime or provider. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { compileDeclaration, hashBytes, type ExecutionPlan } from "@wringer/plan";
import { digest, prepareRepositorySource, processDriver, runtimeProvenanceVersion, TRUSTED_LOCAL_PROVENANCE, TRUSTED_LOCAL_SENTENCE, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";
import { assertNoOracleLeak, buildProposerEvidence, collectReplicateSet, createPlaybookProposalRequestV2, createReplicateGrant, DEFAULT_DENY_GLOBS, proposePlaybookTree, readPlaybookProposalResult, registerReplicateSet, replicateDivergence, REPLICATE_ACTOR_PREFIX, writeProposerEvidence, type ProposerEvidence } from "../src";
import { runAndValidateTreeJourney, treeWorld, type TreeWorld } from "../../workflow/fixtures/playbook-tree-journey";
import { openReader } from "../../records/src/read";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
async function git(cwd: string, ...args: string[]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, env }); if (r.code !== 0) throw new Error(r.stderr); return r.stdout; }
async function privateDir(prefix: string) { const path = await mkdtemp(join(tmpdir(), prefix)); await chmod(path, 0o700); roots.push(path); return path; }
const prediction = { statement: "SCRIPTED: one fewer worker attempt without a lost requirement.", metric: "worker-attempts" as const, minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false };

/** Two replicates of the no-playbook v6 plan: the second fails its check once first. */
async function evidenceWorld() {
    const world = await treeWorld({ select: false }); roots.push(world.root, world.repo);
    const replicates = await privateDir("wringer-proposer-replicates-");
    const set = await registerReplicateSet(replicates, { id: "total-replicates", taskFamily: "total", plan: world.plan, k: 2, sourceTree: world.environment.source_tree, wallClockSeconds: 900 });
    const grant = createReplicateGrant(set, { actor: "Fixture operator", expiresAt: new Date(Date.now() + 3600000).toISOString(), credentialNames: [...(world.plan.runtime.env ?? [])] });
    await collectReplicateSet(replicates, grant, { fixture: { run: (plan, state, slot) => runAndValidateTreeJourney(world, plan, state, { actor: `${REPLICATE_ACTOR_PREFIX} Fixture operator`, failures: slot.index - 1 }) } });
    const divergence = await replicateDivergence(replicates);
    const journeys = ["replicate-01", "replicate-02"].map(label => ({ label, state: join(replicates, "journeys", label) }));
    const input = { plan: world.plan, taskFamily: "total", journeys, replicateSet: { sha256: set.sha256, divergence }, patterns: null, baseline: null, fence: { heldOutIds: ["held-out-total-9"], oracleDigests: ["9".repeat(64)], denyGlobs: [...DEFAULT_DENY_GLOBS] } };
    return { world, replicates, set, divergence, input, built: await buildProposerEvidence(input) };
}
function proposerPlan(world: TreeWorld, id: string, trusted = false): ExecutionPlan {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, playbook, ...raw } = world.plan;
    return compileDeclaration({ version: trusted ? 5 : 6, ...raw, ...(trusted ? { runtime: { kind: "trusted-local", network: { policy: "unenforced" }, env: [...(raw.runtime.env ?? [])] } } : {}), scope: { writable: [`wringer/proposals/${id}`] } } as any);
}
function request(world: TreeWorld, record: ProposerEvidence, id: string, trusted = false) {
    const plan = proposerPlan(world, id, trusted);
    return createPlaybookProposalRequestV2({ plan, proposalId: id, outputDirectory: `wringer/proposals/${id}`, surface: "claude-code", dimension: "procedure", taskFamily: "total", baseline: null, evidence: record, replicateSet: { sha256: record.replicateSetSha256!, divergenceSha256: record.divergenceSha256! }, prediction, actor: "Fixture operator", grantedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(), maxSessions: 1, maxTurns: 1, wallClockSeconds: 600, credentialNames: [...(plan.agents.worker.env ?? [])], dataScope: "this-repository-only", action: "propose-one-worker-playbook-tree" });
}
/** A tree a proposer might write, citing a real [ACTION] line of replicate-02's trajectory. */
async function goodTree(clone: string, directory: string, overrides: Record<string, string | null> = {}) {
    const trajectory = (await readFile(join(clone, "wringer/evidence/REPLICATES/replicate-02/trajectory.md"), "utf8")).split("\n");
    const line = trajectory.findIndex(text => text.includes("[ACTION]")) + 1;
    const files: Record<string, string | null> = {
        "CLAUDE.md": "# Worker\nBefore editing, use the check-first skill and run scripts/wringer/run-check.sh.\n",
        "skills/check-first/SKILL.md": "---\nname: check-first\ndescription: Use when a check fails; read its expectation before editing.\n---\nRead the failing assertion, then change only src/.\n",
        "scripts/run-check.sh": "#!/bin/sh\nset -eu\nbun test tests/acceptance.test.ts\n",
        "NOTES.md": `- CLAUDE.md: replicate-02 line ${line} — the second attempt read the source before the check.\n- skills/check-first/SKILL.md: replicate-02 line ${line} — same moment.\n- scripts/run-check.sh: replicate-02 line ${line} — the check's expectation was never run first.\n`,
        ...overrides,
    };
    const kept = Object.entries(files).filter((row): row is [string, string] => row[1] !== null);
    const kinds: Record<string, string> = { "CLAUDE.md": "always-on", "NOTES.md": "notes" };
    const manifest = { schema_version: "wringer.playbook.v2", id: "check-first", revision: "one", title: "Run the check before editing", role: "worker", taskFamily: "total", surface: "claude-code", files: kept.map(([path, content]) => ({ path, sha256: hashBytes(content), kind: kinds[path] ?? (path.endsWith("SKILL.md") ? "skill" : "script") })).sort((a, b) => a.path.localeCompare(b.path)), limits: ["Fixture proposal; untested."], evaluationRefs: [] };
    for (const [path, content] of [...kept, ["manifest.json", JSON.stringify(manifest)] as [string, string]]) { await mkdir(dirname(join(clone, directory, path)), { recursive: true }); await writeFile(join(clone, directory, path), content); }
    return line;
}
/** A scripted proposer: clones its evidence overlay, writes, returns the staged change. */
function proposer(write: (clone: string, request: RoleExecutionRequest) => Promise<void>, seen: { prompt?: string; evidence?: string[] } = {}, trusted = false) {
    return async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        const clone = await mkdtemp(join(tmpdir(), "wringer-proposer-clone-")); roots.push(clone);
        await git(tmpdir(), "clone", "-q", "--no-checkout", request.repo.bundlePath!, clone); await git(clone, "checkout", "-q", "--detach", request.repo.commit);
        seen.prompt = request.prompt; seen.evidence = (await git(clone, "ls-files", "wringer/evidence")).trim().split("\n");
        await write(clone, request);
        await git(clone, "add", "-A");
        const patch = (await processDriver.command(["git", "-C", clone, "diff", "--cached", "--binary", "--full-index", request.repo.commit, "--"], { env })).stdout;
        const provenance = trusted
            ? { schema_version: TRUSTED_LOCAL_PROVENANCE, runtimeId: "wringer-worker-fixture", role: "worker", kind: "trusted-local", boundary: "trusted-local", established: "none", repository: { url: request.repo.url, commit: request.repo.commit }, workspace: "fresh-temporary-clone", repositoryAccess: "read-write", declared: request.runtime, observed: { fixture: true }, limits: [TRUSTED_LOCAL_SENTENCE] }
            : { schema_version: runtimeProvenanceVersion(request.repo.url), runtimeId: crypto.randomUUID(), role: "worker", kind: request.runtime.kind, image: request.runtime.image, repository: { url: request.repo.url, commit: request.repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: request.runtime, observed: { fixture: true }, limits: ["Fixture"] };
        return { status: "completed", text: "Proposed.", sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", change: { baseCommit: request.repo.commit, patch, sha256: digest(patch) }, provenance } as unknown as RoleExecutionResult;
    };
}
async function propose(f: Awaited<ReturnType<typeof evidenceWorld>>, id: string, write: Parameters<typeof proposer>[0], options: { trusted?: boolean; seen?: Parameters<typeof proposer>[1] } = {}) {
    const root = await privateDir("wringer-proposal-");
    const record = await writeProposerEvidence(root, f.built);
    const fixtureSource = (plan: ExecutionPlan, state: string) => prepareRepositorySource({ ...plan.repository, bundlePath: f.world.bundlePath }, { controllerDir: state });
    const result = await proposePlaybookTree(root, request(f.world, record, id, options.trusted), { fixtureSource, fixtureExecutor: proposer(write, options.seen, options.trusted) });
    return { root, result };
}

test("evidence: task, numbered trajectories, products, divergence and today's playbook; held-out material refused by name and content", async () => {
    const f = await evidenceWorld(), paths = f.built.files.map(file => file.path);
    for (const path of ["TASK.md", "MISSION.md", "PLAYBOOK/NONE.md", "LESSONS/NONE.md", "DIVERGENCE.md", "REPLICATES/replicate-01/trajectory.md", "REPLICATES/replicate-01/produced.md", "REPLICATES/replicate-02/trajectory.md"]) expect(paths).toContain(`wringer/evidence/${path}`);
    const trajectory = f.built.files.find(file => file.path.endsWith("replicate-02/trajectory.md"))!.content;
    expect(trajectory).toContain("[ACTION]"); expect(trajectory).toContain("cite a moment as `replicate-02 line N`");
    expect(f.built.files.find(file => file.path.endsWith("replicate-02/produced.md"))!.content).toContain("candidate");
    expect(f.built.files.find(file => file.path.endsWith("DIVERGENCE.md"))!.content).toContain("first failure");
    expect(f.built.record.journeys.map(j => j.label)).toEqual(["replicate-01", "replicate-02"]);
    expect((await reader.validate(f.built.record, "proposer-evidence-v1.schema.json")).ok).toBe(true);
    // The fence: a held-out identity, an oracle digest and a denied path each refuse, naming where.
    const revision = f.built.record.journeys[0]!.journalRevision;
    await expect(buildProposerEvidence({ ...f.input, fence: { ...f.input.fence, heldOutIds: ["expects"] } })).rejects.toThrow(/Held-out item expects appears in wringer\/evidence\/REPLICATES\/replicate-0\d\/trajectory\.md, read from/);
    await expect(buildProposerEvidence({ ...f.input, fence: { ...f.input.fence, oracleDigests: [revision] } })).rejects.toThrow("An oracle digest appears in wringer/evidence/REPLICATES/replicate-01/trajectory.md");
    await expect(buildProposerEvidence({ ...f.input, fence: { ...f.input.fence, denyGlobs: [...DEFAULT_DENY_GLOBS, "**/DIVERGENCE.md"] } })).rejects.toThrow("Held-out material by name in wringer/evidence/DIVERGENCE.md");
    expect(() => assertNoOracleLeak([{ path: "wringer/evidence/x/labels.json", content: "{}" }], f.input.fence)).toThrow("by name");
    await expect(buildProposerEvidence({ ...f.input, plan: proposerPlan(f.world, "other") })).rejects.toThrow("ran another plan");
    expect(() => assertNoOracleLeak([], { ...f.input.fence, denyGlobs: [] })).toThrow("keeps the default denied paths");
}, 240000);

test("a proposer reads its evidence in its clone and writes a validated tree that cites the moment", async () => {
    const f = await evidenceWorld(), seen: { prompt?: string; evidence?: string[] } = {};
    const { root, result } = await propose(f, "p1", clone => goodTree(clone, "wringer/proposals/p1").then(() => {}), { seen });
    expect(result.status).toBe("proposed"); expect(result.reason).toBeNull();
    expect(result.changed).toEqual(["CLAUDE.md", "scripts/run-check.sh", "skills/check-first/SKILL.md"]);
    expect(result.notes!.citations.every(c => c.label === "replicate-02" && c.line > 1)).toBe(true);
    expect(seen.evidence).toContain("wringer/evidence/MISSION.md"); expect(seen.prompt).toContain("read wringer/evidence/MISSION.md first");
    expect(seen.prompt).toContain("KEEP_BASE is a real answer"); expect(seen.prompt).not.toContain("[ACTION]");
    expect((await reader.validate(result, "playbook-proposal-result-v2.schema.json")).ok).toBe(true);
    expect((await reader.validate(JSON.parse(await readFile(join(root, "proposal-request.json"), "utf8")), "playbook-proposal-request-v2.schema.json")).ok).toBe(true);
    expect(await readPlaybookProposalResult(root)).toEqual(result);
    // One reservation: asking again returns the recorded result, never a second session.
    const retained = JSON.parse(await readFile(join(root, "proposal-request.json"), "utf8"));
    expect(await proposePlaybookTree(root, retained, { fixtureExecutor: async () => { throw new Error("A second session was started"); } })).toEqual(result);
    // Another request on the same directory is different work: refused, nothing spent.
    await expect(proposePlaybookTree(root, request(f.world, f.built.record, "p1"))).rejects.toThrow("names different work");
}, 240000);

test("KEEP_BASE is recorded as no change; a trusted-local proposer is accepted (R-A)", async () => {
    const f = await evidenceWorld();
    const keep = await propose(f, "p2", async clone => { await mkdir(join(clone, "wringer/proposals/p2"), { recursive: true }); await writeFile(join(clone, "wringer/proposals/p2/NOTES.md"), "KEEP_BASE\nBoth attempts reached the same candidate; nothing in the trajectories points at the way of working.\n"); }, { trusted: true });
    expect(keep.result.status).toBe("no-change-proposed"); expect(keep.result.files.map(f => f.path)).toEqual(["NOTES.md"]); expect(keep.result.reason).toBeNull();
    expect(keep.result.notes!.text).toStartWith("KEEP_BASE");
}, 240000);

test("a proposal is stopped when it writes outside its directory, leaves a skill untriggered or cites no real moment", async () => {
    const f = await evidenceWorld();
    const outside = await propose(f, "p3", async clone => { await goodTree(clone, "wringer/proposals/p3"); await writeFile(join(clone, "src/total.ts"), "export const total = () => 5;\n"); });
    expect(outside.result.status).toBe("stopped"); expect(outside.result.reason).toContain("outside wringer/proposals/p3/");
    const untriggered = await propose(f, "p4", clone => goodTree(clone, "wringer/proposals/p4", { "CLAUDE.md": "# Worker\nRun scripts/wringer/run-check.sh first.\n" }).then(() => {}));
    expect(untriggered.result.status).toBe("stopped"); expect(untriggered.result.reason).toContain("an untriggered skill is refused");
    const uncited = await propose(f, "p5", clone => goodTree(clone, "wringer/proposals/p5", { "NOTES.md": "- CLAUDE.md: seemed right.\n- skills/check-first/SKILL.md: replicate-02 line 3\n- scripts/run-check.sh: replicate-02 line 3\n" }).then(() => {}));
    expect(uncited.result.status).toBe("stopped"); expect(uncited.result.reason).toContain("NOTES.md cites no trajectory moment for CLAUDE.md");
    const unreal = await propose(f, "p6", clone => goodTree(clone, "wringer/proposals/p6", { "NOTES.md": "- CLAUDE.md: replicate-02 line 99999\n- skills/check-first/SKILL.md: replicate-07 line 3\n- scripts/run-check.sh: replicate-02 line 3\n" }).then(() => {}));
    expect(unreal.result.status).toBe("stopped"); expect(unreal.result.reason).toContain("cites no trajectory moment for CLAUDE.md");
    const unlisted = await propose(f, "p9", async clone => { await goodTree(clone, "wringer/proposals/p9"); await writeFile(join(clone, "wringer/proposals/p9/extra.md"), "Not in the manifest\n"); });
    expect(unlisted.result.status).toBe("stopped"); expect(unlisted.result.reason).toContain("exactly its manifest and the files it lists");
    const evidenceEdit = await propose(f, "p7", async clone => { await goodTree(clone, "wringer/proposals/p7"); await writeFile(join(clone, "wringer/evidence/MISSION.md"), "Changed\n"); });
    expect(evidenceEdit.result.status).toBe("stopped"); expect(evidenceEdit.result.reason).toContain("outside wringer/proposals/p7/");
}, 600000);

test("a request must name exactly the evidence's repository, baseline and replicate set", async () => {
    const f = await evidenceWorld(), record = f.built.record;
    const { sha256, schema_version, ...input } = request(f.world, record, "p8");
    expect(() => createPlaybookProposalRequestV2({ ...input, replicateSet: null })).toThrow("exactly the replicate set");
    expect(() => createPlaybookProposalRequestV2({ ...input, outputDirectory: "wringer/playbooks/p8" })).toThrow("one directory, wringer/proposals/<id>");
    expect(() => createPlaybookProposalRequestV2({ ...input, plan: proposerPlan(f.world, "other") })).toThrow("exactly its proposal directory");
    expect(() => createPlaybookProposalRequestV2({ ...input, taskFamily: "reports" })).toThrow("another repository, source revision or task family");
}, 240000);
