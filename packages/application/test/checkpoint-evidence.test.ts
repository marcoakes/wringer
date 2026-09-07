import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { assertPortableFacts, collectCheckpoint, collectValidation, sourcePathIncluded, testSummaries } from "../../../scripts/checkpoint-evidence";

test("checkpoint keeps actual failed/passing test summaries and leaves absent counts unknown", () => {
    const parsed = testSummaries(" 322 pass\n 1 skip\n 4 fail\n 2422 expect() calls\nRan 327 tests across 33 files. [211.05s]\n 5 pass\n 0 fail\nRan 5 tests across 1 file. [223.00ms]\n");
    expect(parsed).toEqual([{ passed: 322, skipped: 1, failed: 4, assertions: 2422, tests: 327, files: 33, duration: "211.05s" }, { passed: 5, failed: 0, skipped: null, assertions: null, tests: 5, files: 1, duration: "223.00ms" }]);
    expect(testSummaries("Tests look green, no measured summary available")).toEqual([]);
});
test("checkpoint hashes retained evidence without copying raw output or machine paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-checkpoint-")), directory = join(root, ".wringer/validation");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "result.json"), JSON.stringify({ directory: "/Users/private/machine", results: [{ name: "native-check", exit_code: 1, timed_out: false, duration_ms: 100 }] }));
    const raw = "private stdout on /Users/private/machine\n";
    await writeFile(join(directory, "native-check.stdout.log"), raw);
    await writeFile(join(directory, "native-check.stderr.log"), " 2 pass\n 1 fail\nRan 3 tests across 1 file. [100.00ms]\n");
    const value = await collectValidation(root, directory), encoded = JSON.stringify(value);
    expect(value.stages[0]!.exit_code).toBe(1);
    expect(value.stages[0]!.streams[0]!.artifact.sha256).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(value.stages[0]!.streams[1]!.test_summaries[0]!.failed).toBe(1);
    expect(encoded).not.toContain("/Users/");
    expect(encoded).not.toContain("private stdout");
    expect(value.receipt.path).toBe(".wringer/validation/result.json");
    await expect(collectValidation(root, resolve(root, "../outside"))).rejects.toThrow("inside the repository");
    expect(await readFile(join(directory, "native-check.stdout.log"), "utf8")).toBe(raw);
});
test("checkpoint source scope includes implementation inputs and excludes local/evidence artifacts", () => {
    for (const path of ["packages/application/src/discovery.ts", "packages/application/test/discovery.test.ts", "runtime/Containerfile", "runtime/package.json", "schema/frozen.json", "examples/example.yaml", ".github/workflows/tests.yml", "package.json", "bun.lock", ".wringer.yaml", "scripts/checkpoint-evidence.ts"]) expect(sourcePathIncluded(path)).toBe(true);
    for (const path of [".wringer/runtime/report.json", "dist/wring", "node_modules/package.json", "docs/evidence/checkpoint.json", "docs/README.md", "runtime/.env", "runtime/.env.production", "runtime/profile.local.json", "runtime/private.key", "runtime/agent.log"]) expect(sourcePathIncluded(path)).toBe(false);
});
test("checkpoint inventory facts reject credentials, full environments, local paths and raw logs", () => {
    expect(() => assertPortableFacts({ image: "example.invalid/tools@sha256:" + "a".repeat(64), packages: [{ name: "bun", version: "1.4.2" }], platform: "linux/arm64" })).not.toThrow();
    for (const value of [{ environment: { ANY: "value" } }, { env: [] }, { api_key: "unshaped-sensitive-value" }, { authorization: "private value" }, { stdout: "private log" }, { source: "/Users/operator/image.json" }, { source: "/opt/local/inventory.json" }, { source: "file:///tmp/private" }, { value: "-----BEGIN OPENSSH PRIVATE KEY-----" }]) expect(() => assertPortableFacts(value)).toThrow();
});
test("checkpoint refuses an existing output before reading Git or replacing retained evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-checkpoint-exclusive-")), output = "retained.json", original = "{\"status\":\"failed\"}\n";
    await writeFile(join(root, output), original);
    await expect(collectCheckpoint({ root, validations: ["missing-validation"], output })).rejects.toThrow("never overwritten");
    expect(await readFile(join(root, output), "utf8")).toBe(original);
});
