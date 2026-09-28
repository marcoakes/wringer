import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAssertionAdapter } from "../../../runtime/assertion-adapter";
import { observeAssertions } from "../../records/src/assertions";
test("contained assertion adapter keeps empty, skipped, launch and truncated reports unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-adapter-fixture-"));
    const reporter = new URL("../../../runtime/node-reporter.mjs", import.meta.url).pathname;
    const input = { adapter: "node-test" as const, command: `node --test --test-reporter=${reporter} check.js`, requirements: ["value"], timeout: 3 };
    await writeFile(join(root, "check.js"), "");
    const plain = await runAssertionAdapter({ ...input, command: "node --test --test-reporter=tap check.js" }, root);
    expect(observeAssertions("value", () => plain.report as any, plain.exit, input.requirements).status).toBe("unavailable");
    for (const contents of ["", 'import {test} from "node:test"; test.skip("skipped", () => {});']) {
        await writeFile(join(root, "check.js"), contents); const value = await runAssertionAdapter(input, root);
        expect(observeAssertions("value", () => value.report as any, value.exit, input.requirements).status).toBe("unavailable");
    }
    const launch = await runAssertionAdapter({ ...input, command: "exit 127" }, root); expect(launch.exit).toBe(2); expect(launch.report.errors.length).toBeGreaterThan(0);
    const stale = await runAssertionAdapter({ ...input, report: "old.json" }, root); expect(stale.exit).toBe(2); expect(stale.report.errors[0]).toContain("freshness");
    const truncated = await runAssertionAdapter({ ...input, command: `node -e 'process.stdout.write("x".repeat(9*1024*1024))'` }, root); expect(truncated.exit).toBe(2);
    const timeout = await runAssertionAdapter({ ...input, command: "sleep 2", timeout: 1 }, root); expect(timeout.exit).toBe(2);
}, 10000);
