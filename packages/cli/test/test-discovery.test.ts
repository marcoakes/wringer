import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VALIDATION_GROUPS } from "../../../scripts/validate";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("explicit package test roots do not discover similarly named distribution copies", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-test-discovery-"))); roots.push(root);
    await mkdir(join(root, "packages/check/test"), { recursive: true });
    await mkdir(join(root, "dist/packages/check/test"), { recursive: true });
    await writeFile(join(root, "packages/check/test/real.test.ts"), 'import { expect, test } from "bun:test"; test("actual package check", () => expect(true).toBe(true));\n');
    await writeFile(join(root, "dist/packages/check/test/copied.test.ts"), 'throw new Error("REFERENCE_COPY_MUST_NOT_EXECUTE");\n');
    const run = async (target: string) => {
        // Never inherit the runner's environment: an agent marker such as
        // CLAUDECODE makes Bun omit passing test names, so the proof below would
        // depend on who ran it rather than on what was discovered.
        const child = Bun.spawn([process.execPath, "test", target], { cwd: root, env: { PATH: process.env.PATH ?? "" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => child.kill(), 5000);
        try {
            const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            return { exitCode, output: stdout + stderr };
        } finally { clearTimeout(timer); }
    };
    // Bun treats an unprefixed argument as a substring filter. Prove this
    // fixture exposes the original build-before-test failure, not an empty pass.
    const control = await run("packages");
    expect(control.exitCode).not.toBe(0);
    expect(control.output).toContain("REFERENCE_COPY_MUST_NOT_EXECUTE");
    expect(control.output).toContain("actual package check");
    for (const target of ["./packages", "./packages/check/test", "./packages/check/test/real.test.ts"]) {
        const selected = await run(target);
        expect(selected.exitCode).toBe(0);
        expect(selected.output).toContain("actual package check");
        expect(selected.output).not.toContain("REFERENCE_COPY_MUST_NOT_EXECUTE");
    }
});

test("repository, action and validation commands declare test paths instead of substring filters", async () => {
    const root = new URL("../../../", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
    expect(manifest.scripts.test).toBe("bun test ./packages");
    expect(manifest.scripts.check).toContain("bun test ./packages");
    expect(manifest.scripts.corpus).toBe("bun test ./packages/records/test/contract.test.ts");
    const gate = await readFile(new URL(".wringer.yaml", root), "utf8");
    expect(gate).toContain("run: bun test ./packages\n");
    const validate = await readFile(new URL("scripts/validate.ts", root), "utf8");
    const commands = [...validate.matchAll(/\[process\.execPath, "test", ([^\]]+)\]/g)];
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
        const targets = JSON.parse(`[${command[1]}]`) as string[];
        expect(targets.length).toBeGreaterThan(0);
        // An explicit file may also narrow test names with Bun's -t. The path
        // remains mandatory: a name filter must never become a discovery root.
        expect(targets[0]!.startsWith("./packages/")).toBe(true);
        for (let index = 0; index < targets.length; index++) {
            const target = targets[index]!;
            if (target === "-t") { expect(index).toBeGreaterThan(0); expect(targets[++index]?.trim().length).toBeGreaterThan(0); }
            else expect(target.startsWith("./packages/")).toBe(true);
        }
    }
});

test("every CI job installs the pinned browser before its checks, and the jobs together run each validation group once", async () => {
    const workflow = Bun.YAML.parse(await readFile(new URL("../../../.github/workflows/tests.yml", import.meta.url), "utf8")) as { jobs: Record<string, { steps: { run?: string; uses?: string }[] }> };
    const validation = /^bun run validate --group ([a-z]+)$/, groups: string[] = [];
    for (const name of ["bun", "rehearsals", "action"]) {
        expect(workflow.jobs[name], name).toBeDefined();
        const steps = workflow.jobs[name]!.steps;
        const browser = steps.findIndex(step => step.run === "bun node_modules/playwright/cli.js install --with-deps chromium");
        const checks = steps.findIndex(step => validation.test(step.run ?? "") || step.uses === "./");
        expect(browser, name).toBeGreaterThan(-1);
        expect(checks, name).toBeGreaterThan(browser);
    }
    for (const job of Object.values(workflow.jobs)) for (const step of job.steps) {
        // An ungrouped run would put every stage back into one job.
        expect(step.run ?? "").not.toMatch(/validate(\.ts)?\s*$/);
        const group = step.run?.match(validation)?.[1];
        if (group) groups.push(group);
    }
    // Groups are derived from stage names in scripts/validate.ts; a deleted or duplicated group job is refused here.
    expect(groups.sort()).toEqual([...VALIDATION_GROUPS].sort());
});
