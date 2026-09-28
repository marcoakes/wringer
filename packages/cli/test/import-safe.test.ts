import { expect, test } from "bun:test";

test("T02 importing command entrypoints does not run a command or write protocol output", async () => {
    const modules = ["packages/cli/src/cli.ts", "packages/cli/src/launcher.ts", "packages/cli/src/board-cli.ts", "packages/cli/src/drive-cli.ts", "packages/cli/src/assistant-cli.ts", "scripts/headless.ts", "packages/figma-connect/src/serve.ts"];
    const root = new URL("../../../", import.meta.url).pathname;
    for (const module of modules) {
        const child = Bun.spawn([process.execPath, "-e", `await import(${JSON.stringify(root + module)}); process.stdout.write('import-safe');`], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "" } });
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, stdout, stderr }, module).toEqual({ code: 0, stdout: "import-safe", stderr: "" });
    }
});
