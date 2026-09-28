/** Exercise two real archived executables against retained, unapproved work.
 * No account, provider, service, approval or publication action is performed. */
import { mkdir, mkdtemp, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { extractReleaseArchive, verifyReleaseArchive } from "../packages/cli/src/release-archive";
import { distributionHash as hash } from "../packages/cli/src/distribution-manifest";
import { runProcess } from "../packages/engine/src/process";

const [previousArg, candidateArg, outputArg] = process.argv.slice(2);
if (!previousArg || !candidateArg || !outputArg) throw new Error("Usage: bun scripts/migration-distribution.ts PREVIOUS_ARCHIVE CANDIDATE_ARCHIVE NEW_OUTPUT");
const output = resolve(outputArg), scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-migration-artifact-"))), prefix = join(scratch, "installation"), app = join(scratch, "application"), repo = join(scratch, "repository");
await mkdir(output); await mkdir(repo);
const records: { name: string; exit: number | null; durationMs: number }[] = [];
async function command(name: string, args: string[], expected = 0, input?: string) {
    const result = await runProcess(args, { cwd: repo, timeout: 90, maxBytes: 2 * 1024 * 1024, env: { ...process.env, WRINGER_HOME: app }, ...(input === undefined ? {} : { input }) });
    records.push({ name, exit: result.exit_code, durationMs: result.duration_ms });
    if (result.exit_code !== expected || result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error(`${name} failed: ${(result.stderr || result.stdout).replaceAll(scratch, "[fixture]")}`);
    return result.stdout;
}
async function archive(arg: string, name: string) {
    const path = resolve(arg), bytes = await readFile(path), sha256 = hash(bytes), match = /^wringer-(.+)-(darwin-arm64|linux-x64)\.tar\.gz$/.exec(path.split("/").at(-1)!);
    if (!match || await readFile(path + ".sha256", "utf8") !== `${sha256}  ${path.split("/").at(-1)}\n`) throw new Error("Named archive/checksum mismatch");
    const verified = verifyReleaseArchive(bytes, { sha256, version: match[1]! }), directory = join(scratch, name);
    await mkdir(directory); await extractReleaseArchive(directory, verified);
    return { path, sha256, version: verified.manifest.version, binary: join(directory, "wring"), source: verified.manifest.source };
}
const previous = await archive(previousArg, "previous"), candidate = await archive(candidateArg, "candidate");
const installed = join(prefix, "bin/wring");
async function json(name: string, binary: string, args: string[]) { return JSON.parse(await command(name, [binary, ...args, "--app-dir", app, "--json"])); }
async function install(name: string, selected: typeof candidate) {
    const args = ["upgrade", "--prefix", prefix, "--archive", selected.path, "--sha256", selected.sha256, "--release", selected.version];
    const preview = await json(`${name}-preview`, candidate.binary, args);
    if (!preview.eligible) throw new Error(`${name} unexpectedly held`);
    await json(`${name}-apply`, candidate.binary, [...args, "--apply", "--expected", preview.identity]);
}
async function stateDigest() {
    const files = (await readdir(app, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)).sort();
    return hash(JSON.stringify(await Promise.all(files.map(async path => ({ path: path.slice(app.length + 1), sha256: hash(await readFile(path)) })))));
}
let result: Record<string, unknown> = {};
try {
    for (const args of [["init", "-b", "main"], ["config", "user.name", "Automated migration fixture"], ["config", "user.email", "fixture@example.invalid"], ["config", "commit.gpgsign", "false"], ["config", "core.hooksPath", "/dev/null"]]) await command("scratch-git-setup", ["git", ...args]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n"); await writeFile(join(repo, "value.txt"), "retained original source\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "read", run: "cat value.txt" }] }));
    await command("scratch-source-add", ["git", "add", "."]); await command("scratch-source-commit", ["git", "commit", "-m", "Synthetic retained-work fixture"]);
    await install("previous-install", previous);
    if (!(await command("previous-executable-version", [installed, "--version"])).includes(previous.version)) throw new Error("Wrong previous executable");
    const workspace = await json("previous-workspace-create", installed, ["setup", "--repo", repo, "--mode", "verification", "--client", "generic", "--apply"]);
    const workspaceId = workspace.workspace?.id ?? workspace.id;
    if (typeof workspaceId !== "string") throw new Error("No workspace identity in setup result");
    // The intermediate alpha19 archive's first-job CLI is a retained known
    // failure. Use its working public MCP path to obtain genuine older records.
    const owner = Bun.spawn([installed, "job", "serve", "--workspace", workspaceId, "--app-dir", app], { cwd: repo, stdout: "ignore", stderr: "pipe" });
    const connection = join(app, "owners", workspaceId, "connection.json");
    let job: any;
    try {
        for (let n = 0; n < 100 && !await Bun.file(connection).exists(); n++) await Bun.sleep(50);
        if (!await Bun.file(connection).exists()) throw new Error("Previous owner did not start");
        const frames = [
            { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "migration-fixture", version: "1" } } },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "wringer.propose_verification", arguments: { intent: "Retain this original request without granting work", idempotencyKey: crypto.randomUUID() } } },
        ];
        const text = await command("previous-MCP-job-create", [installed, "mcp", "--connection", connection], 0, frames.map(f => JSON.stringify(f)).join("\n") + "\n");
        job = text.trim().split("\n").map(line => JSON.parse(line)).find(f => f.id === 1)?.result?.structuredContent;
        if (!job || job.isError) throw new Error("Previous MCP did not create an unapproved job");
    } finally {
        owner.kill("SIGINT");
        const timer = setTimeout(() => owner.kill("SIGKILL"), 5000);
        try {
            const exit = await owner.exited;
            records.push({ name: "previous-owner-interrupted", exit, durationMs: 0 });
            if (![0, 4].includes(exit) || await Bun.file(join(app, "owners", workspaceId, "owner.lock")).exists()) throw new Error("Previous owner did not release ownership on interruption");
        }
        finally { clearTimeout(timer); }
    }
    const id = job.jobId ?? job.id;
    if (typeof id !== "string") throw new Error("No retained job identity");
    const before = await json("previous-job-read", installed, ["job", "status", "--job", id]), beforeDigest = await stateDigest();
    await install("candidate-upgrade", candidate);
    if (!(await command("candidate-executable-version", [installed, "--version"])).includes(candidate.version)) throw new Error("Wrong candidate executable");
    const after = await json("candidate-job-read", installed, ["job", "status", "--job", id]);
    if (before.phase !== "approval" || after.phase !== "approval" || before.candidateIdentity !== after.candidateIdentity || JSON.stringify(before.remaining) !== JSON.stringify(after.remaining) || beforeDigest !== await stateDigest()) throw new Error("Upgrade changed retained source, state or authority");
    const rollback = await json("rollback-preview", installed, ["upgrade", "--rollback", "--prefix", prefix]);
    // This rebuild adds schemas. An older archive must refuse rollback without
    // deleting the still-readable candidate or converting retained records.
    if (rollback.eligible || !rollback.holds.some((h: string) => h.startsWith("target-lacks-compatible-record:"))) throw new Error("Expected older-format rollback hold");
    if (beforeDigest !== await stateDigest()) throw new Error("Rollback preview changed retained work");
    const removalArgs = ["uninstall", "--prefix", prefix], removal = await json("uninstall-preview", installed, removalArgs);
    if (!removal.eligible) throw new Error("Uninstall unexpectedly held");
    await json("uninstall-apply", installed, [...removalArgs, "--apply", "--expected", removal.identity]);
    if (beforeDigest !== await stateDigest() || (await readdir(join(prefix, "bin"))).length !== 0) throw new Error("Uninstall changed retained records or left launchers");
    const retained = await json("extracted-candidate-reads-retained-job", candidate.binary, ["job", "status", "--job", id]);
    if (retained.phase !== "approval") throw new Error("Retained job no longer readable after uninstall");
    result = { passed: true, originalStateSha256: beforeDigest, finalStateSha256: await stateDigest(), rollback: { eligible: false, holds: rollback.holds }, retainedPhase: retained.phase };
} finally {
    await writeFile(join(output, "result.json"), JSON.stringify({ schema_version: "wringer.migration-measurement.v1", kind: "Actual native archived binaries and temporary filesystem; unapproved job; no model or human acceptance", platform: `${process.platform}-${process.arch}`, previous: { version: previous.version, archiveSha256: previous.sha256 }, candidate: { version: candidate.version, archiveSha256: candidate.sha256, source: candidate.source }, modelCalls: 0, records, result }, null, 2) + "\n");
}
console.log(`${records.length} migration commands passed; older-schema rollback refused and all job bytes retained`);
