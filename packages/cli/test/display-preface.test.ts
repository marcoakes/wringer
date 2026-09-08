import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("blind display explains its intentional failure scenarios before showing either report", () => {
    const repo = fileURLToPath(new URL("../../../", import.meta.url));
    const result = Bun.spawnSync([process.execPath, "examples/pm-blind-task/display.ts"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output.startsWith("These scenarios intentionally contain failures.")).toBe(true);
    expect(output).toContain("One failed import");
    expect(output).toContain("Two failed imports");
    expect(output).toContain("not a claim that the pipelines succeeded or that a person approved");
});
