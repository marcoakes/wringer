import { expect, test } from "bun:test";
import { runProcess } from "@wringer/engine";
test("headless entrypoint is the drive control plane, not a direct coding agent", async () => {
    const launcher = new URL("../../../scripts/headless.ts", import.meta.url).pathname;
    const source = await Bun.file(launcher).text();
    expect(source).toContain('"wringer-drive"');
    expect(source).not.toContain("--dangerously");
    expect(source).not.toContain("codex exec");
    const result = await runProcess([process.execPath, launcher, "--help"], { cwd: new URL("../../../", import.meta.url).pathname, timeout: 10 });
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("wringer-drive");
});
