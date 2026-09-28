import { expect, test } from "bun:test";
import { resolve, sep } from "node:path";
import { validationStages } from "../../../scripts/validate";

test("optional confirmation build and probe leave the sealed distribution untouched", async () => {
    if (process.platform !== "darwin") {
        expect(validationStages(process.platform).some(([name]) => name.startsWith("native-confirmation-"))).toBe(false);
        return;
    }
    const stages = validationStages(), build = stages.find(([name]) => name === "native-confirmation-build")!, probe = stages.find(([name]) => name === "native-confirmation-probe")!;
    const distribution = resolve(build[2], "dist");
    const child = Bun.spawn(build[1], { cwd: build[2], stdout: "pipe", stderr: "pipe" });
    const [exit, text, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(exit, err).toBe(0);
    const result = JSON.parse(text);
    expect(resolve(result.output).startsWith(distribution + sep)).toBe(false);
    expect(probe[1][0]).toBe(result.output);
    expect(result.installed).toBe(false); expect(result.protectedReady).toBe(false);
    const measured = Bun.spawn(probe[1], { cwd: probe[2], stdout: "pipe", stderr: "pipe" });
    const [code] = await Promise.all([measured.exited, new Response(measured.stdout).text(), new Response(measured.stderr).text()]);
    expect(code).toBe(0);
}, 30000);
