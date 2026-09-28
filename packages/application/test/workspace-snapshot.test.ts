import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, runProcess } from "@wringer/engine";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-filter-inspection-"))); roots.push(root);
    const repo = join(root, "repo"), global = join(root, "global.gitconfig"); await mkdir(repo);
    await git(repo, ["init", "-b", "main"]);
    for (const [key, value] of [["user.name", "Automated fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]]) await git(repo, ["config", key!, value!]);
    await writeFile(join(repo, "source.txt"), "source\n");
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture"]);
    await writeFile(global, '[filter "fixture"]\n\tclean = "sh -c \'echo executed > filter-executed; cat\'"\n');
    async function inspect() {
        const module = new URL("../src/workspaces.ts", import.meta.url).href;
        return runProcess([process.execPath, "--eval", `import { safeWorkspaceSnapshot } from ${JSON.stringify(module)}; try { console.log(JSON.stringify(await safeWorkspaceSnapshot(process.argv[1]))); } catch (error) { console.error(error.message); process.exitCode = 2; }`, repo], { cwd: repo, env: { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: "1" }, timeout: 15, maxBytes: 1024 * 1024 });
    }
    return { repo, global, inspect };
}
test("unused inherited Git filters do not block source inspection or execute commands", async () => {
    const f = await fixture();
    await writeFile(join(f.repo, "source.txt"), "changed\n");
    const result = await f.inspect();
    expect(result.exit_code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ dirty: true, changed_files: ["source.txt"] });
    expect(await Bun.file(join(f.repo, "filter-executed")).exists()).toBe(false);
});
for (const source of ["worktree attributes", "index attributes", "global attributes", "untracked files"]) {
    test(`source inspection refuses active Git filters from ${source} before execution`, async () => {
        const f = await fixture();
        const attributes = source === "global attributes" ? join(f.repo, "../global.attributes") : join(f.repo, ".gitattributes");
        await writeFile(attributes, source === "untracked files" ? "*.new filter=fixture\n" : "*.txt filter=fixture\n");
        if (source === "global attributes") await writeFile(f.global, await readFile(f.global, "utf8") + `\n[core]\n\tattributesFile = ${JSON.stringify(attributes)}\n`);
        if (source === "index attributes") { await git(f.repo, ["add", ".gitattributes"]); await rm(attributes); }
        if (source === "untracked files") await writeFile(join(f.repo, "space\nline.new"), "new source\n");
        await writeFile(join(f.repo, "source.txt"), "changed\n");
        const result = await f.inspect();
        expect(result.exit_code).toBe(2);
        expect(result.stderr).toContain("Git content filters need a separate reviewed source-preparation route");
        expect(await Bun.file(join(f.repo, "filter-executed")).exists()).toBe(false);
    });
}
