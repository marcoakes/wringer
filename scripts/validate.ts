/** One bounded validation envelope; use this when the host requires permission for local test sockets. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
// The bootstrap must load before workspace dependency links have been repaired.
import { runProcess } from "../packages/engine/src/process";
import { Redactor } from "../packages/engine/src/io";
const workspace = resolve(import.meta.dir, ".."), repo = workspace, id = new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(repo, ".wringer", `native-validation-${id}`);
await mkdir(directory, { recursive: true });
const environment = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}` };
const stages: [
    string,
    string[],
    string
][] = [
    ["workspace-links", [process.execPath, "install", "--frozen-lockfile", "--offline"], workspace],
    // Exercise checks with a built distribution present, as the public Action does.
    ["standalone-build", [process.execPath, "scripts/build.ts"], workspace],
    ...(process.platform === "darwin" ? [
        ["native-confirmation-build", [process.execPath, "scripts/build-confirmation.ts"], workspace],
        // Capability/refusal probe only: never enrolls or signs a human decision.
        ["native-confirmation-probe", [join(workspace, "dist/native/wringer-confirm"), "probe"], workspace],
    ] as [string, string[], string][] : []),
    ["assistant-check", [process.execPath, "test", "./packages/mcp/test", "./packages/application/test/assistant.test.ts", "./packages/application/test/assistant-runner.test.ts", "./packages/application/test/assistant-journey.test.ts", "./packages/cli/test/assistant-cli.test.ts", "./packages/cli/test/assistant-console.test.ts", "./packages/cli/test/assistant-transport.test.ts", "./packages/cli/test/assistant-lifecycle.test.ts", "./packages/cli/test/distribution-docs.test.ts", "./packages/cli/test/test-discovery.test.ts"], workspace],
    ["native-check", [process.execPath, "run", "check"], workspace],
    ["portable-python-corpus", [process.execPath, "test", "./packages/records/test", "./packages/board/test", "./packages/scheduler/test/health.test.ts"], workspace],
    ["standalone-contract", [process.execPath, "scripts/distribution.ts"], workspace],
    ["compiled-contained-contract", [process.execPath, "scripts/contained-distribution.ts"], workspace],
    ["local-delivery-fixture", [process.execPath, "scripts/demo.ts"], workspace],
    ["compiled-version", [join(workspace, "dist/wring"), "--version"], repo],
    ["compiled-board", [join(workspace, "dist/wringer-board"), "--help"], repo],
    ["compiled-drive", [join(workspace, "dist/wringer-drive"), "--help"], repo],
    ["compiled-assistant", [join(workspace, "dist/wringer-assistant"), "--help"], repo],
    ["compiled-assistant-lifecycle", [process.execPath, "scripts/assistant-distribution.ts"], workspace],
    // No-spend scripted engineering proof, never a live-client or PM blind-test claim.
    ["assistant-launch-rehearsal", [process.execPath, "scripts/assistant-launch-rehearsal.ts"], workspace],
];
const results: unknown[] = [];
const selected = process.argv.slice(2);
for (const name of selected)
    if (!stages.some(stage => stage[0] === name))
        throw new Error(`Unknown validation stage ${name}`);
for (const [name, command, cwd] of stages) {
    if (selected.length && !selected.includes(name))
        continue;
    console.log(`Checking ${name}…`);
    const stageEnvironment = name === "portable-python-corpus" ? { ...environment, WRINGER_TEST_CORPUS: join(workspace, "packages/records/test/corpus.json") } : environment;
    const result = await runProcess(command, { cwd, env: stageEnvironment, timeout: name === "assistant-launch-rehearsal" ? 300 : 600, maxBytes: 8 * 1024 * 1024, redactor: new Redactor() });
    await writeFile(join(directory, `${name}.stdout.log`), result.stdout);
    await writeFile(join(directory, `${name}.stderr.log`), result.stderr);
    results.push({ name, exit_code: result.exit_code, timed_out: result.timed_out, duration_ms: result.duration_ms });
    await writeFile(join(directory, "result.json"), JSON.stringify({ directory, results }, null, 2) + "\n");
    console.log(`${name}: ${result.exit_code === 0 && !result.timed_out ? "PASS" : "FAIL"} (${result.duration_ms} ms)`);
    if (result.exit_code !== 0 || result.timed_out) {
        console.log(result.stdout.slice(-5000) + result.stderr.slice(-5000));
        process.exitCode = 1;
        break;
    }
}
console.log(`Validation record: ${directory}`);
