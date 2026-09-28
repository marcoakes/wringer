/** npm's real pack/install path, offline and without lifecycle hooks. */
import { readFile, mkdir, writeFile, readdir, realpath, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../packages/engine/src/process";
import { distributionHash } from "../packages/cli/src/distribution-manifest";
const channels = resolve(process.argv[2] ?? "build/channels"), report = JSON.parse(await readFile(join(channels, "CHANNELS.json"), "utf8"));
const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-npm-measure-"))), tarballs: string[] = [], records: unknown[] = [];
const evidence = resolve(process.argv[3] ?? "build/channel-measurement"); await mkdir(evidence, { recursive: true });
const npm = Bun.which("npm"), node = Bun.which("node"); if (!npm || !node) throw new Error("This npm-channel measurement requires Node and npm; the native installer remains independent");
async function run(name: string, command: string[], cwd: string) {
    const result = await runProcess(command, { cwd, timeout: 180, maxBytes: 4 * 1024 * 1024 });
    if (result.exit_code || result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error(`${name}: ${result.stderr.slice(-2000)}`);
    records.push({ name, exit: result.exit_code, durationMs: result.duration_ms }); return result.stdout;
}
for (const pkg of report.packages) {
    const directory = join(channels, pkg.directory);
    const packed = JSON.parse(await run(`npm-pack-${pkg.platform}`, [npm, "pack", "--ignore-scripts", "--offline", "--json", "--cache", join(root, "cache"), "--pack-destination", root], directory))[0];
    if (pkg.platform !== "launcher") {
        const contents = JSON.parse(await readFile(join(directory, "dist/PACKAGE-CONTENTS.json"), "utf8")), expected = ["package.json", "dist/PACKAGE-CONTENTS.json", ...contents.files.map((f: any) => "dist/" + f.path)].sort();
        if (JSON.stringify(packed.files.map((f: any) => f.path).sort()) !== JSON.stringify(expected)) throw new Error("Actual npm archive differs from its channel inventory");
    }
    tarballs.push(join(root, packed.filename));
}
const install = join(root, "installed"); await mkdir(install); await writeFile(join(install, "package.json"), '{"name":"wringer-local-channel-measurement","private":true}');
await run("npm-install-selected-tarballs-offline", [npm, "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--cache", join(root, "cache"), ...tarballs], install);
for (const [name, expected] of Object.entries({ wring: "Wringer · Bun/TypeScript", "wringer-drive": "wringer-drive · one durable PM journey", "wringer-board": "wringer-board · one set of facts", "wringer-assistant": "Wringer assistant entry point", "wringer-headless": "wringer-drive · one durable PM journey", "wringer-figma-broker": "Wringer Figma OAuth broker" })) {
    const text = await run(`npm-launch-${name}`, [join(install, "node_modules/.bin", name), "--help"], root);
    if (!text.includes(expected)) throw new Error(`npm compatibility alias dispatched the wrong command: ${name}`);
}
const demo = await run("npm-installed-demo", [join(install, "node_modules/.bin/wring"), "demo", "--json"], root); if (!demo.includes('"simulation"')) throw new Error("Installed npm demo did not declare simulation");
await run("npm-registry-no-download-launch", [npm, "exec", "--offline", "--no", "--", report.packages.find((p: any) => p.platform === "launcher").name, "--help"], install);
await run("formula-ruby-syntax", ["ruby", "-c", join(channels, "wringer.rb")], root);
const hashes = []; for (const file of tarballs) hashes.push({ file: file.slice(root.length + 1), sha256: distributionHash(await readFile(file)) });
await writeFile(join(evidence, "result.json"), JSON.stringify({ schema_version: "wringer.channel-measurement.v1", kind: "Actual offline npm pack/install and launcher on this host; generated Homebrew syntax check", platform: `${process.platform}-${process.arch}`, version: report.version, fixtureNamespace: report.fixture, archiveIdentities: report.packages.filter((p: any) => p.platform !== "launcher").map((p: any) => ({ platform: p.platform, sha256: p.archiveSha256 })), packageDigests: hashes, publicInstall: "unmeasured", homebrewInstall: "unmeasured: syntax and same-artifact demo only; separate native Brew fixture required", modelCalls: 0, records }, null, 2) + "\n");
console.log(`${records.length} channel observations passed; ${join(evidence, "result.json")}`);
