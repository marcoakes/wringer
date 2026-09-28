/** Actual candidate -> offline bootstrap -> installed routes -> uninstall. */
import { mkdtemp, readFile, writeFile, readdir, realpath, mkdir, chmod } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../packages/engine/src/process";
import { distributionHash } from "../packages/cli/src/distribution-manifest";
const repo = resolve(import.meta.dir, ".."), artifacts = resolve(process.argv[2] ?? join(repo, "build/release"));
const version = (await Bun.file(join(repo, "package.json")).json()).version, platform = `${process.platform}-${process.arch}`;
const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-installer-artifact-"))), downloads = join(root, "offline download"), prefix = join(root, "installed version"), appDir = join(root, "retained state");
const evidence = resolve(process.argv[3] ?? join(repo, "build/installer-measurement")); await mkdir(evidence, { recursive: true });
const records: { name: string; exit: number | null; durationMs: number }[] = [];
const env = { ...process.env, PATH: "/usr/bin:/bin", WRINGER_HOME: appDir };
async function run(name: string, argv: string[], exit = 0) {
    const result = await runProcess(argv, { cwd: root, env, timeout: 90, maxBytes: 2 * 1024 * 1024 });
    records.push({ name, exit: result.exit_code, durationMs: result.duration_ms });
    if (result.exit_code !== exit || result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error(`${name} failed (${result.exit_code}): ${result.stderr.slice(-2000)}`);
    return result.stdout;
}
const shell = ["/bin/sh", join(repo, "packaging/install.sh"), "--release", version, "--from", artifacts, "--download-to", downloads, "--prefix", prefix, "--app-dir", appDir];
const preview = JSON.parse(await run("bootstrap-preview-without-bun", shell));
if (!preview.eligible || preview.state.current !== null) throw new Error("Initial install preview was not eligible");
await run("bootstrap-apply-exact-preview", [...shell, "--apply", "--expected", preview.identity]);
const launcher = join(prefix, "bin/wring");
await run("installed-version", [launcher, "--version"]);
for (const name of ["wring", "wringer-drive", "wringer-board", "wringer-assistant", "wringer-headless", "wringer-figma-broker"]) await run(`installed-route-${name}`, [join(prefix, "bin", name), "--help"]);
const demo = await run("installed-no-model-demo", [launcher, "demo", "--json"]);
if (!demo.includes('"simulation"') && !demo.includes('"modelCalls": 0')) throw new Error("Demo did not identify its simulation boundary");
// The same bootstrap refuses corrupt data before invoking the executable.
const binary = join(downloads, `wring-${version}-${platform}`); await chmod(binary, 0o600); await writeFile(binary, "corrupt candidate");
await run("bootstrap-corrupt-binary-refused", shell, 2);
await mkdir(appDir, { recursive: true, mode: 0o700 }); await writeFile(join(appDir, "retained-evidence.txt"), "keep this evidence\n");
const uninstallArgs = [launcher, "uninstall", "--prefix", prefix, "--app-dir", appDir, "--json"];
const removal = JSON.parse(await run("installed-uninstall-preview", uninstallArgs));
await run("installed-uninstall-apply", [...uninstallArgs, "--apply", "--expected", removal.identity]);
if ((await readdir(join(prefix, "bin"))).length || await readFile(join(appDir, "retained-evidence.txt"), "utf8") !== "keep this evidence\n") throw new Error("Uninstall ownership or retained evidence differs");
const archive = join(artifacts, `wringer-${version}-${platform}.tar.gz`), bytes = await readFile(archive);
await writeFile(join(evidence, "result.json"), JSON.stringify({ schema_version: "wringer.installer-measurement.v1", kind: "local candidate artifact, offline bootstrap, actual host, no Bun on PATH", version, platform, archiveSha256: distributionHash(bytes), archiveBytes: bytes.length, modelCalls: 0, publicDownload: "unmeasured", records }, null, 2) + "\n");
console.log(`${records.length} installer artifact observations passed; ${join(evidence, "result.json")}`);
