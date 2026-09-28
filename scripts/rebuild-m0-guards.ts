/** Controlled reversions in an owned disposable copy. Never edits the working tree. */
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dir, ".."), scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-rebuild-m0-")));
const evidence = join(root, "docs/rebuild/evidence/m0");
await mkdir(evidence, { recursive: true });
const files = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root }).stdout.toString().trim().split("\n");
for (const file of files) { await mkdir(dirname(join(scratch, file)), { recursive: true }); await cp(join(root, file), join(scratch, file)); }
await mkdir(join(scratch, "node_modules/@wringer"), { recursive: true });
for (const entry of await readdir(join(root, "node_modules")))
    if (entry !== "@wringer") await symlink(join(root, "node_modules", entry), join(scratch, "node_modules", entry));
for (const entry of await readdir(join(scratch, "packages"))) {
    await symlink(join(scratch, "packages", entry), join(scratch, "node_modules/@wringer", entry));
    try { await cp(join(root, "packages", entry, "node_modules"), join(scratch, "packages", entry, "node_modules"), { recursive: true, verbatimSymlinks: true }); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
}
const control = Bun.spawn([process.execPath, "test", "packages/mcp/test", "packages/application/test/assistant.test.ts"], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
const [controlExit, controlOut, controlErr] = await Promise.all([control.exited, new Response(control.stdout).text(), new Response(control.stderr).text()]);
await writeFile(join(evidence, "isolated-control.txt"), (controlOut + controlErr).replaceAll(scratch, "[isolated-checkout]").replaceAll(root, "[checkout]"));
if (controlExit) throw new Error("Isolated control failed; no mutation result can be claimed");
const transport = "packages/mcp/src/server.ts", application = "packages/application/src/assistant.ts";
const sources = new Map(await Promise.all([transport, application].map(async file => [file, await readFile(join(root, file), "utf8")] as const)));
const cases = [
    { name: "serial-stdio", file: transport, before: "dispatch(line); messages++;", after: "await emit(await session.receive(line)); messages++;", test: "packages/mcp/test/stdio-progress.test.ts", pattern: "handles status" },
    { name: "ignored-wait-cancellation", file: transport, before: 'waits.get(`${typeof params.requestId}:${params.requestId}`)?.abort();', after: "void 0;", test: "packages/mcp/test/stdio-progress.test.ts", pattern: "releases only" },
    { name: "unbounded-long-polls", file: transport, before: "waits.size >= 12", after: "waits.size >= 1000", test: "packages/mcp/test/stdio-progress.test.ts", pattern: "overload" },
    { name: "parallel-writers", file: transport, before: 'writer = writer.then(async () => { await output.write(new TextEncoder().encode(`${JSON.stringify(response)}\\n`)); });', after: 'writer = (async () => { await output.write(new TextEncoder().encode(`${JSON.stringify(response)}\\n`)); })();', test: "packages/mcp/test/stdio.test.ts", pattern: "slow output" },
    { name: "unbounded-response-queue", file: transport, before: "while (inFlight.size >= 32) await Promise.race(inFlight);", after: "// injected absence of transport backpressure", test: "packages/mcp/test/stdio.test.ts", pattern: "slow output" },
    { name: "stale-saturated-join", file: application, before: "const entry = { began: Number.POSITIVE_INFINITY", after: "if (live.length >= MAX_CONCURRENT_INSPECTIONS) return structuredClone(await live[live.length - 1]!.promise);\n        const entry = { began: Number.POSITIVE_INFINITY", test: "packages/application/test/assistant.test.ts", pattern: "T13 staggered" },
    { name: "poisoned-admission", file: application, before: "live.map(row => row.promise.then(() => {}, () => {}))", after: "live.map(row => row.promise)", test: "packages/application/test/assistant.test.ts", pattern: "T13 an older" },
];
const results = [];
for (const row of cases) {
    const original = sources.get(row.file)!;
    if (!original.includes(row.before)) throw new Error(`Mutation target changed: ${row.name}`);
    await writeFile(join(scratch, row.file), original.replace(row.before, row.after));
    try {
        const child = Bun.spawn([process.execPath, "test", row.test, "--test-name-pattern", row.pattern], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
        const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        const transcript = (out + err).replaceAll(scratch, "[isolated-checkout]").replaceAll(root, "[checkout]");
        await writeFile(join(evidence, `revert-${row.name}.txt`), transcript);
        results.push({ name: row.name, expected: "test fails", exit: code, observed: code !== 0 && transcript.includes("(fail)") ? "red" : "NOT RED" });
    } finally { await writeFile(join(scratch, row.file), original); }
}
const green = Bun.spawn([process.execPath, "test", "packages/mcp/test", "packages/application/test/assistant.test.ts"], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
const [code, out, err] = await Promise.all([green.exited, new Response(green.stdout).text(), new Response(green.stderr).text()]);
await writeFile(join(evidence, "restored-green.txt"), (out + err).replaceAll(scratch, "[isolated-checkout]").replaceAll(root, "[checkout]"));
await writeFile(join(evidence, "reversions.json"), JSON.stringify({ baseline: "7f4cc542fd1149c00a3be0ee8949c895b95ef0c3", kind: "deterministic fixture; no provider/human measurement", results, restored_exit: code }, null, 2) + "\n");
console.log(JSON.stringify({ results, restored_exit: code }, null, 2));
if (results.some(row => row.observed !== "red") || code !== 0) process.exitCode = 1;
