/** Plan v6 and playbook.v2: the tree selection compiles inertly, every listed file is
 * protected, and the pinned reader refuses each rule it states. Real Git, no model. */
import { afterEach, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { openReader } from "../../records/src/read";
import { assertPlaybookPlacement, compileDeclaration, compileExecutionPlan, compilePlanningRequest, discoverEnvironment, hashBytes, measuredLoopPlan, playbookActiveFiles, readPinnedPlaybook, readPinnedPlaybookTree, sourceFamily, validateExecutionPlan, validatePlaybookTreeSnapshot, type PlanDeclaration, type PlaybookSelection } from "../src";
import { MANIFEST_PATH, TREE_DIRECTORY, treeFiles, treeManifest, treeRepository } from "../fixtures/playbook-tree";

const original = compileExecutionPlan(await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const repos: string[] = [];
afterEach(async () => { for (const repo of repos.splice(0)) await rm(repo, { recursive: true, force: true }); });
function declaration(commit: string, playbook?: PlaybookSelection, version = 6): PlanDeclaration {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...data } = structuredClone(original);
    return { version, ...data, repository: { ...data.repository, commit }, ...(playbook ? { playbook } : {}) } as PlanDeclaration;
}
async function tree(options: Parameters<typeof treeRepository>[0] = {}) { const made = await treeRepository(options); repos.push(made.repo); return made; }
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);

test("a v6 plan pins a tree: manifest and every file protected, measured loop, either runtime family", async () => {
    const { commit, selection } = await tree();
    const plan = compileDeclaration(declaration(commit, selection));
    expect(plan.schema_version).toBe("wringer.execution-plan.v6");
    expect(measuredLoopPlan(plan)).toBe(true); expect(sourceFamily(plan)).toBe("hosted");
    for (const path of [MANIFEST_PATH, ...selection.files!.map(f => f.path)]) expect(plan.acceptance.protected_paths).toContain(path);
    expect(validateExecutionPlan(plan)).toEqual(plan);
    expect((await reader.validate(plan, "execution-plan-v6.schema.json")).ok).toBe(true);
    const trusted = compileDeclaration({ ...declaration(commit, selection), runtime: { kind: "trusted-local", network: { policy: "unenforced" }, env: [...plan.runtime.env!] } } as any);
    expect(trusted.runtime.kind).toBe("trusted-local");
    expect((await reader.validate(trusted, "execution-plan-v6.schema.json")).ok).toBe(true);
    const none = compileDeclaration(declaration(commit));
    expect(none.playbook).toBeUndefined(); expect((await reader.validate(none, "execution-plan-v6.schema.json")).ok).toBe(true);
});

test("tree selection rules refuse before anything reads the repository", async () => {
    const { commit, selection } = await tree();
    const refuse = (change: (s: any) => void, message: string, version = 6) => { const s = structuredClone(selection) as any; change(s); expect(() => compileDeclaration(declaration(commit, s, version))).toThrow(message); };
    refuse(() => {}, "A playbook tree (surface, files, replace) needs a version 6 plan", 3);
    refuse(s => { s.path = "wringer/playbooks/repair-first.json"; }, "its selection path is wringer/playbooks/<id>/manifest.json");
    refuse(s => { s.surface = "cursor"; }, "names its adapter surface");
    refuse(s => { s.files.push({ path: "src/total.ts", sha256: "a".repeat(64) }); }, "is not a claude-code playbook path under");
    refuse(s => { s.files.push({ path: `${TREE_DIRECTORY}AGENTS.md`, sha256: "a".repeat(64) }); }, "is not a claude-code playbook path under");
    refuse(s => { s.files = s.files.filter((f: any) => !f.path.endsWith("CLAUDE.md")); }, "has exactly one always-on CLAUDE.md");
    refuse(s => { s.replace = ["README.md"]; }, "which this tree does not materialise");
    refuse(s => { s.files[0].sha256 = "x"; }, "Every playbook file needs its exact SHA256");
    expect(() => compileDeclaration({ ...declaration(commit, selection), design: { snapshotPath: "design.json", snapshotSha256: "a".repeat(64), reviews: [] } } as any)).toThrow("cannot declare design");
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, acceptance, ...data } = compileDeclaration(declaration(commit));
    expect(() => compilePlanningRequest({ version: 6, ...data, agents: { ...data.agents, planner: data.agents.judge }, budget: { ...data.budget, max_planner_turns: 1 } })).toThrow("Planner-drafted acceptance uses plan versions 1 to 4");
});

test("the pinned reader returns an exact v3 snapshot and its active files", async () => {
    const { repo, commit, selection } = await tree();
    const plan = compileDeclaration(declaration(commit, selection));
    await expect(readPinnedPlaybook(repo, plan)).rejects.toThrow("read it with readPinnedPlaybookTree");
    const snapshot = (await readPinnedPlaybookTree(repo, plan, { environment: await discoverEnvironment(repo, plan) }))!;
    expect(snapshot.schema_version).toBe("wringer.playbook-snapshot.v3");
    expect(validatePlaybookTreeSnapshot(snapshot, { tools: ["bun"] })).toEqual(snapshot);
    expect((await reader.validate(snapshot, "playbook-snapshot-v3.schema.json")).ok).toBe(true);
    expect((await reader.validate(snapshot.manifest, "playbook-v2.schema.json")).ok).toBe(true);
    expect(playbookActiveFiles(snapshot).map(f => [f.activePath, f.mode])).toEqual([[".claude/skills/repair-first/SKILL.md", "100644"], ["CLAUDE.md", "100644"], ["scripts/wringer/inspect.sh", "100755"]]);
    const codex = await tree({ surface: "codex" }), codexPlan = compileDeclaration(declaration(codex.commit, codex.selection));
    expect(playbookActiveFiles((await readPinnedPlaybookTree(codex.repo, codexPlan))!).map(f => f.activePath)).toEqual([".agents/skills/repair-first/SKILL.md", "AGENTS.md", "scripts/wringer/inspect.sh"]);
    const tampered = structuredClone(snapshot) as any; tampered.files[0].content += "x";
    expect(() => validatePlaybookTreeSnapshot(tampered, { tools: ["bun"] })).toThrow("differs from its manifest digest");
});

test("the tree must be exactly its manifest and listed files, each digest exact", async () => {
    const extra = await tree({ extraTreeFiles: { "notes/unlisted.md": "Not in the manifest\n" } });
    await expect(readPinnedPlaybookTree(extra.repo, compileDeclaration(declaration(extra.commit, extra.selection)))).rejects.toThrow("holds exactly its manifest and listed files");
    const wrong = await tree(), selection = structuredClone(wrong.selection); selection.files![0]!.sha256 = hashBytes("other");
    await expect(readPinnedPlaybookTree(wrong.repo, compileDeclaration(declaration(wrong.commit, selection)))).rejects.toThrow("differs from its selected SHA256");
    const manifestDigest = structuredClone(wrong.selection); manifestDigest.sha256 = hashBytes("other");
    await expect(readPinnedPlaybookTree(wrong.repo, compileDeclaration(declaration(wrong.commit, manifestDigest)))).rejects.toThrow("manifest SHA256 differs");
});

async function contentRefusal(files: Record<string, string>, message: string, tools?: string[]) {
    const made = await tree({ files });
    let plan = compileDeclaration(declaration(made.commit, made.selection));
    if (tools) plan = compileDeclaration({ ...declaration(made.commit, made.selection), environment: { ...plan.environment, tools: tools.map(name => ({ name, version: "1", probe: [name, "--version"] })) } } as any);
    await expect(readPinnedPlaybookTree(made.repo, plan)).rejects.toThrow(message);
}
test("content rules: always-on cap, triggered skills, front matter, script references and parses, credentials", async () => {
    const base = treeFiles();
    await contentRefusal({ ...base, "CLAUDE.md": "# Worker\nuse repair-first\nRun scripts/wringer/inspect.sh\n" + "x".repeat(8200) }, "capped at 8 KiB");
    await contentRefusal({ ...base, "CLAUDE.md": "# Worker\nRun scripts/wringer/inspect.sh\n" }, "Skill repair-first is never named in CLAUDE.md; an untriggered skill is refused");
    await contentRefusal({ ...base, "skills/repair-first/SKILL.md": "---\nname: repair-first\ndescription: Use it.\nhooks: PreToolUse\n---\nBody\n" }, "may carry only name and description; hooks is refused");
    await contentRefusal({ ...base, "skills/repair-first/SKILL.md": "---\nname: repair-first\ndescription: Use it.\nallowed-tools: Bash\n---\nBody\n" }, "allowed-tools is refused");
    await contentRefusal({ ...base, "skills/repair-first/SKILL.md": "No front matter\n" }, "starts with front matter");
    await contentRefusal({ ...base, "CLAUDE.md": "# Worker\nuse repair-first\nRun scripts/wringer/missing.sh\n" }, "invokes scripts/wringer/missing.sh, which this tree does not contain");
    await contentRefusal({ ...base, "CLAUDE.md": "# Worker\nuse repair-first\nRun scripts/inspect.sh\n" }, "names the tree path scripts/inspect.sh; name its materialised path scripts/wringer/inspect.sh");
    await contentRefusal({ ...base, "scripts/inspect.sh": "#!/bin/sh\nif then fi (\n" }, "does not parse as sh");
    await contentRefusal({ ...base, "scripts/check.mjs": "export const = ;\n", "CLAUDE.md": base["CLAUDE.md"] + "Also scripts/wringer/check.mjs\n" }, "does not parse");
    await contentRefusal({ ...base, "scripts/check.py": "print('ok')\n" }, "declares no python tool");
    await contentRefusal({ ...base, "NOTES.md": "token ghp_" + "a".repeat(36) + "\n" }, "contains a detected credential");
    const big = { ...base }; for (let i = 0; i < 40; i++) big[`notes/n${i}.md`] = "y".repeat(7000);
    await contentRefusal(big, "exceeds 256 KiB");
});

test("placement never replaces a tracked file silently", async () => {
    const tracked = await tree({ repository: { "README.md": "Fixture\n", "CLAUDE.md": "Team instructions\n", "src/total.ts": "x\n", "tests/acceptance.test.ts": "x\n", "package.json": "{}\n", "bun.lock": "{}\n" } });
    const plan = compileDeclaration(declaration(tracked.commit, tracked.selection));
    // Discovery refuses before any effect; the reader refuses again against a retained map.
    await expect(discoverEnvironment(tracked.repo, plan)).rejects.toThrow("which the repository already tracks. Name it in playbook.replace");
    const replacing = compileDeclaration(declaration(tracked.commit, { ...tracked.selection, replace: ["CLAUDE.md"] }));
    expect((await readPinnedPlaybookTree(tracked.repo, replacing, { environment: await discoverEnvironment(tracked.repo, replacing) }))!.sha256).toBe(tracked.selection.sha256);
    const untracked = await tree();
    const stale = compileDeclaration(declaration(untracked.commit, { ...untracked.selection, replace: ["CLAUDE.md"] }));
    expect(() => assertPlaybookPlacement(stale, [{ path: "README.md", mode: "100644" }])).toThrow("which the repository does not track");
    expect(() => assertPlaybookPlacement(compileDeclaration(declaration(untracked.commit, untracked.selection)), [{ path: ".claude", mode: "100644" }])).toThrow("collides with a tracked file or directory");
});

test("a v6 manifest is refused on kind, order or shape it cannot honour", async () => {
    const files = treeFiles(), bad = (overrides: Record<string, unknown>) => tree({ files, manifest: treeManifest("claude-code", files, overrides) });
    for (const [overrides, message] of [[{ role: "judge" }, "worker-only wringer.playbook.v2"], [{ files: treeManifest("claude-code", files).files.map(f => f.path === "NOTES.md" ? { ...f, kind: "skill" } : f) }, "is not a skill file"], [{ files: [...treeManifest("claude-code", files).files].reverse() }, "listed in path order"]] as const) {
        const made = await bad(overrides as Record<string, unknown>);
        await expect(readPinnedPlaybookTree(made.repo, compileDeclaration(declaration(made.commit, made.selection)))).rejects.toThrow(message);
    }
});
