/** Fault probes run only in a disposable checkout. Retain control and restored
 * transcripts so infrastructure errors cannot masquerade as a caught fault. */
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
export interface Reversion { name: string; file: string; before: string; after: string; test: string; pattern: string }
export async function runReversions(name: string, tests: string[], cases: Reversion[], options: { gitFixture?: boolean } = {}) {
    const root = resolve(import.meta.dir, ".."), scratch = await realpath(await mkdtemp(join(tmpdir(), `wringer-${name}-guards-`))), evidence = join(root, "docs/rebuild/evidence", name);
    await mkdir(evidence, { recursive: true });
    const listed = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
    if (listed.exitCode) throw new Error("Could not inventory the source checkout");
    for (const file of listed.stdout.toString().split("\0").filter(Boolean)) {
        await mkdir(dirname(join(scratch, file)), { recursive: true });
        try { await cp(join(root, file), join(scratch, file)); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    await mkdir(join(scratch, "node_modules/@wringer"), { recursive: true });
    for (const entry of await readdir(join(root, "node_modules"))) if (entry !== "@wringer") await symlink(join(root, "node_modules", entry), join(scratch, "node_modules", entry));
    for (const entry of await readdir(join(scratch, "packages"))) {
        await symlink(join(scratch, "packages", entry), join(scratch, "node_modules/@wringer", entry));
        try { await cp(join(root, "packages", entry, "node_modules"), join(scratch, "packages", entry, "node_modules"), { recursive: true, verbatimSymlinks: true }); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    if (options.gitFixture) {
        for (const args of [["init", "-b", "fixture"], ["config", "user.name", "Automated reversion fixture"], ["config", "user.email", "fixture@example.invalid"], ["config", "commit.gpgsign", "false"], ["config", "core.hooksPath", "/dev/null"], ["add", "."], ["commit", "-m", "Isolated source measurement"]]) {
            const result = Bun.spawnSync(["git", ...args], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
            if (result.exitCode) throw new Error("Could not initialize the selected isolated Git fixture");
        }
    }
    async function run(label: string, args: string[]) {
        const child = Bun.spawn([process.execPath, "test", ...args], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
        const [exit, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        const transcript = (out + err).replaceAll(scratch, "[isolated-checkout]").replaceAll(root, "[checkout]");
        await writeFile(join(evidence, `${label}.log`), transcript);
        return { exit, assertions: transcript.includes("expect() calls"), failed: transcript.includes("(fail)") };
    }
    const control = await run("isolated-control", tests); if (control.exit) throw new Error("Isolated control failed. No mutation result is valid.");
    const results = [];
    for (const probe of cases) {
        const path = join(scratch, probe.file), original = await readFile(path, "utf8");
        if (original.split(probe.before).length !== 2) throw new Error(`Mutation target is not unique: ${probe.name}`);
        await writeFile(path, original.replace(probe.before, probe.after));
        try {
            const observed = await run(`revert-${probe.name}`, [probe.test, "--test-name-pattern", probe.pattern]);
            results.push({ name: probe.name, ...observed, caught: observed.exit !== 0 && observed.failed });
            console.log(`${probe.name}: ${results.at(-1)!.caught ? "red" : "NOT RED"}`);
        } finally { await writeFile(path, original); }
    }
    const restored = await run("restored-green", tests);
    await writeFile(join(evidence, "reversions.json"), JSON.stringify({ baseline: "7f4cc542fd1149c00a3be0ee8949c895b95ef0c3", kind: "Automated deterministic engineering fixtures; no live model or human judgment", control, results, restored }, null, 2) + "\n");
    if (restored.exit || results.some(row => !row.caught)) throw new Error("The reversion gate did not pass; inspect retained results");
}
