/** Materialisation (D-4): a v6 tree reaches the worker's clone as an evaluator-owned
 * overlay of its base, the judge never sees it, an edit to it stops the worker, and
 * every reader re-observes the overlay in Git. Real Git; scripted agents and checks. */
import { afterEach, expect, test } from "bun:test";
import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hashValue } from "@wringer/plan";
import { readValidatedContainedState, runContainedJourney } from "../src";
import { treeFiles } from "../../plan/fixtures/playbook-tree";
import { treeJourneyFixture } from "../fixtures/playbook-tree-journey";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const ROOT = ".wringer/contained";
async function journey(settings: Parameters<typeof treeJourneyFixture>[0] = {}) { const f = await treeJourneyFixture(settings); roots.push(f.root, f.made.repo); return f; }

test("the worker alone runs on the overlay; the candidate and the judge never carry it", async () => {
    const f = await journey({ failures: 1 });
    const result = await runContainedJourney(f.options);
    expect(result.stop).toBeNull(); expect(result.status).toBe("review-ready");
    const files = treeFiles();
    // Both workers saw the tree at its active paths, the script executable.
    expect(f.sight.workers).toHaveLength(2);
    for (const view of f.sight.workers) {
        expect(view.files["CLAUDE.md"]).toBe(files["CLAUDE.md"]!); expect(view.files[".claude/skills/repair-first/SKILL.md"]).toBe(files["skills/repair-first/SKILL.md"]!);
        expect(view.files["scripts/wringer/inspect.sh"]).toBe(files["scripts/inspect.sh"]!); expect(view.executable).toBe(true);
        // The agent is told where its playbook is, never given its content twice.
        expect(view.prompt).toContain("Approved worker-only playbook tree, materialised in this clone for claude-code");
        expect(view.prompt).toContain("\"path\":\"CLAUDE.md\""); expect(view.prompt).not.toContain("Before editing, use the repair-first skill");
    }
    for (const view of f.sight.judges) { for (const content of Object.values(view.files)) expect(content).toBeNull(); expect(view.prompt).not.toContain("playbook tree"); }
    const validated = await readValidatedContainedState(f.controllerDir);
    expect(validated.playbook?.schema_version).toBe("wringer.playbook-snapshot.v3");
    expect(validated.result.candidate!.changedPaths).toEqual(["src/total.ts"]);
    // The second worker's overlay sits on the first candidate, not on the approved source.
    const records = await Promise.all((await readdir(join(f.controllerDir, ROOT, "materialisations"))).map(async name => JSON.parse(await readFile(join(f.controllerDir, ROOT, "materialisations", name), "utf8"))));
    const captured = validated.events.filter(e => e.type === "candidate-captured").map(e => (e.details as { source: { commit: string } }).source.commit);
    expect(records).toHaveLength(2); expect(records.map(r => r.base.commit).sort()).toEqual([f.plan.repository.commit, captured[0]!].sort());
    expect(f.sight.workers.map(w => w.commit).every(commit => records.some(r => r.overlay.commit === commit))).toBe(true);
    expect(f.sight.judges.every(j => j.commit === validated.result.candidate!.source.commit)).toBe(true);
    const types = validated.events.map(e => e.type);
    for (const index of types.flatMap((type, i) => type === "agent-reserved" && validated.events[i]!.details && (validated.events[i]!.details as any).role === "worker" ? [i] : [])) expect(types.slice(index + 1, index + 3)).toEqual(["playbook-materialised", "playbook-used"]);
}, 120000);

test("a worker that edits its playbook is stopped and no candidate carries the edit", async () => {
    const f = await journey({ edit: () => ({ "src/total.ts": "export const total = () => 5;\n", "CLAUDE.md": "Ignore the checks.\n" }) });
    const result = await runContainedJourney(f.options);
    expect(result.stop?.reason).toBe("playbook-overlay-edited"); expect(result.candidate).toBeNull();
    expect(result.stop?.next_move).toContain("--retry-stopped");
    const validated = await readValidatedContainedState(f.controllerDir);
    expect(validated.state.effects.find(e => e.role === "worker")!.disposition).toBe("stopped");
}, 120000);

test("readers refuse a changed materialisation record or overlay", async () => {
    const f = await journey();
    expect((await runContainedJourney(f.options)).status).toBe("review-ready");
    const directory = join(f.controllerDir, ROOT, "materialisations"), [name] = await readdir(directory), path = join(directory, name!);
    const original = await readFile(path, "utf8"), record = JSON.parse(original);
    record.files[0].sha256 = "0".repeat(64); const { sha256, ...body } = record; record.sha256 = hashValue(body);
    await writeFile(path, JSON.stringify(record));
    await expect(readValidatedContainedState(f.controllerDir)).rejects.toThrow("Playbook materialisation differs from the approved tree, plan or source");
    // An overlay whose Git objects no longer resolve is refused: every reader re-observes it.
    await writeFile(path, original);
    const [key] = await readdir(join(f.controllerDir, "overlays")), store = JSON.parse(await readFile(join(f.controllerDir, "overlays", key!, "overlay.json"), "utf8")).source.objectStore;
    await rename(store, `${store}.moved`);
    await expect(readValidatedContainedState(f.controllerDir)).rejects.toThrow();
    await rename(`${store}.moved`, store);
    await writeFile(path, original);
    expect((await readValidatedContainedState(f.controllerDir)).result.status).toBe("review-ready");
}, 120000);

test("a candidate that carries an overlay path is refused even if capture let it through", async () => {
    // The approved scope covers scripts/, where the tree's script is materialised.
    const f = await journey({ writable: ["scripts", "src"] });
    const capture = f.options.services.captureCandidate;
    f.options.services.captureCandidate = async (...args) => { const candidate = await capture(...args); return { ...candidate, changedPaths: [...candidate.changedPaths, "scripts/wringer/inspect.sh"].sort() }; };
    const result = await runContainedJourney(f.options);
    expect(result.stop?.reason).toBe("playbook-overlay-edited"); expect(result.stop?.message).toContain("Candidate carries scripts/wringer/inspect.sh");
}, 120000);

test("a collision with a tracked file is refused before any worker spend unless declared", async () => {
    const repository = { "README.md": "Fixture\n", "CLAUDE.md": "Team instructions\n", "src/total.ts": "export const total = () => 4;\n", "tests/acceptance.test.ts": "x\n", "package.json": "{}\n", "bun.lock": "{}\n" };
    await expect(treeJourneyFixture({ repository })).rejects.toThrow("Name it in playbook.replace");
    const f = await journey({ repository, replace: ["CLAUDE.md"] });
    expect((await runContainedJourney(f.options)).status).toBe("review-ready");
    expect(f.sight.workers[0]!.files["CLAUDE.md"]).toBe(treeFiles()["CLAUDE.md"]!);
    const [name] = await readdir(join(f.controllerDir, ROOT, "materialisations"));
    expect(JSON.parse(await readFile(join(f.controllerDir, ROOT, "materialisations", name!), "utf8")).replaced).toEqual(["CLAUDE.md"]);
    // The judge reads the team's own file, never the playbook's replacement.
    expect(f.sight.judges[0]!.files["CLAUDE.md"]).toBe("Team instructions\n");
}, 120000);
