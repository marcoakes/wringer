import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test("explicit package test roots do not discover similarly named distribution copies", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-test-discovery-"))); roots.push(root);
    await mkdir(join(root, "packages/check/test"), { recursive: true });
    await mkdir(join(root, "dist/packages/check/test"), { recursive: true });
    await writeFile(join(root, "packages/check/test/real.test.ts"), 'import { expect, test } from "bun:test"; test("actual package check", () => expect(true).toBe(true));\n');
    await writeFile(join(root, "dist/packages/check/test/copied.test.ts"), 'throw new Error("REFERENCE_COPY_MUST_NOT_EXECUTE");\n');
    const run = async (target: string) => {
        const child = Bun.spawn([process.execPath, "test", target], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
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
        for (const target of targets) expect(target.startsWith("./packages/")).toBe(true);
    }
});
