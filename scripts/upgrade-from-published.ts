/** Upgrade to a candidate archive from every published release, the way install.sh does it.
 * Each published release installs itself into a fresh private prefix with its own verified
 * executable, the bytes install.sh runs; the candidate's executable then previews and applies
 * the upgrade, and previews the way back. Only public release assets are downloaded: no
 * account, provider, job, model call or publication. CI runs this on every push (tests.yml).
 * Alpha.36 to alpha.41 each shipped unable to upgrade an older installation, and nothing ran.
 * Each upgrade starts from a computer that has run a job: before it, the application directory
 * gets a finished job's retained records as published releases leave them (beta gate run 2,
 * F10: alpha.42 refused every computer that had run one, and an empty one could not show it). */
import { link, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { extractReleaseArchive, verifyReleaseArchive } from "../packages/cli/src/release-archive";
import { distributionHash as hash, RELEASE_REPOSITORY } from "../packages/cli/src/distribution-manifest";
import { runProcess } from "../packages/engine/src/process";

const usage = "Usage: bun scripts/upgrade-from-published.ts CANDIDATE_ARCHIVE NEW_OUTPUT [--from VERSION]...";
const args = process.argv.slice(2), only: string[] = [];
for (let at = args.indexOf("--from"); at !== -1; at = args.indexOf("--from")) only.push(...args.splice(at, 2).slice(1));
const [candidateArg, outputArg] = args;
if (!candidateArg || !outputArg || args.length !== 2 || only.some(version => !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version))) throw new Error(usage);
const platform = `${process.platform}-${process.arch}`, project = RELEASE_REPOSITORY.replace("https://github.com/", "");
const output = resolve(outputArg); await mkdir(output);
const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-published-upgrade-")));
const scrub = (text: string) => text.replaceAll(root, "[scratch]").trim().slice(0, 2000);
const assets = (version: string) => ({ archive: `wringer-${version}-${platform}.tar.gz`, binary: `wring-${version}-${platform}` });
/** install.sh's checksum rule: one line, `HASH  NAME`, naming exactly this artifact. */
async function declared(path: string, name: string) {
    const line = (await readFile(path, "utf8")).replace(/\n$/, ""), wanted = line.slice(0, 64);
    if (!/^[a-f0-9]{64}$/.test(wanted) || line !== `${wanted}  ${name}`) throw new Error(`Invalid checksum declaration for ${name}`);
    return wanted;
}
async function unpack(path: string, version: string, into: string) {
    const name = path.split("/").at(-1)!, sha256 = await declared(`${path}.sha256`, name);
    const verified = verifyReleaseArchive(await readFile(path), { sha256, version });
    await mkdir(into, { mode: 0o700 }); await extractReleaseArchive(into, verified);
    return { path, sha256, version, directory: into, binary: join(into, "wring"), source: verified.manifest.source };
}
async function gh(argv: string[]) {
    for (let attempt = 1; ; attempt++) {
        const r = await runProcess(["gh", ...argv], { cwd: root, timeout: 300, maxBytes: 16 * 1024 * 1024, env: process.env });
        if (r.exit_code === 0 && !r.timed_out && !r.stdout_truncated) return r.stdout;
        if (attempt === 3) throw new Error(`gh ${argv.slice(0, 2).join(" ")} failed: ${scrub(r.stderr)}`);
        await Bun.sleep(5000 * attempt);
    }
}
const records: { release: string; name: string; exit: number | null; durationMs: number }[] = [];
async function run(release: string, name: string, argv: string[], env: NodeJS.ProcessEnv, cwd: string) {
    const r = await runProcess(argv, { cwd, timeout: 180, maxBytes: 4 * 1024 * 1024, env });
    records.push({ release, name, exit: r.exit_code, durationMs: r.duration_ms });
    if (r.exit_code !== 0 || r.timed_out || r.stdout_truncated || r.stderr_truncated) throw new Error(`${name} exited ${r.exit_code}: ${scrub(r.stderr || r.stdout)}`);
    return r.stdout;
}
const reports = (text: string, version: string) => text.split(/\s+/).includes(version);
/** Record contracts (schema/*.schema.json) in `from` that `to` lacks or carries changed. */
async function lacking(from: string, to: string) {
    const names = (await readdir(join(from, "schema"))).filter(name => name.endsWith(".schema.json")).sort(), out: string[] = [];
    for (const name of names) {
        const other = await readFile(join(to, "schema", name)).catch(() => null);
        if (!other || !other.equals(await readFile(join(from, "schema", name)))) out.push(`target-lacks-compatible-record:schema/${name}`);
    }
    return out;
}
/** Alpha.42 and earlier publish each captured candidate and playbook overlay by a hard link and
 * keep the attempt's pending name: one record under two names, inside its own reservation. */
async function retainFinishedJob(app: string) {
    const controller = join(app, "delegation-controllers", crypto.randomUUID(), crypto.randomUUID()), attempt = `attempt-${crypto.randomUUID()}`;
    for (const [directory, record, pending] of [[join(controller, "candidates", "worker-1"), "capture.json", "capture.pending.json"], [join(controller, "overlays", "e".repeat(64)), "overlay.json", "overlay.pending.json"]] as const) {
        await mkdir(join(directory, attempt), { recursive: true, mode: 0o700 });
        await writeFile(join(directory, attempt, pending), JSON.stringify({ identity: "f".repeat(64), retained: "as a finished job leaves it" }), { mode: 0o600 });
        await link(join(directory, attempt, pending), join(directory, record));
    }
}
async function digestOf(directory: string) {
    const files = (await readdir(directory, { recursive: true, withFileTypes: true })).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)).sort();
    return hash(JSON.stringify(await Promise.all(files.map(async path => ({ path: path.slice(directory.length + 1), sha256: hash(await readFile(path)) })))));
}

const results: Record<string, any>[] = [];
let candidate: Awaited<ReturnType<typeof unpack>> | undefined;
try {
    const named = /^wringer-(.+)-(darwin-arm64|linux-x64)\.tar\.gz$/.exec(candidateArg.split("/").at(-1) ?? "");
    if (!named || named[2] !== platform) throw new Error(`Select this platform's candidate archive (${platform})`);
    candidate = await unpack(resolve(candidateArg), named[1]!, join(root, "candidate"));
    const listed = await gh(["api", "--paginate", `repos/${project}/releases`, "--jq", ".[] | select(.draft | not) | {tag: .tag_name, published: .published_at, assets: [.assets[].name]}"]);
    // Every release install.sh can install on this platform: its four assets are published.
    const published = listed.split("\n").filter(Boolean).map(line => JSON.parse(line)).map(r => ({ ...r, version: String(r.tag).replace(/^v/, "") }))
        .filter(r => { const a = assets(r.version); return [a.archive, `${a.archive}.sha256`, a.binary, `${a.binary}.sha256`].every(name => r.assets.includes(name)); })
        .sort((a, b) => String(a.published).localeCompare(String(b.published)));
    const selected = only.length ? only.map(version => published.find(r => r.version === version) ?? (() => { throw new Error(`${version} is not a published release with ${platform} install assets`); })()) : published;
    for (const release of selected) {
        const version: string = release.version, row: Record<string, any> = { version };
        results.push(row);
        if (version === candidate.version) { row.skipped = "The candidate carries this published version; the release commit that changes the version upgrades from it."; continue; }
        const work = await mkdtemp(join(root, "release-")), download = join(work, "download"), app = join(work, "application"), home = join(work, "home"), prefix = join(work, "installation");
        row.passed = false;
        try {
            for (const directory of [download, app, home]) await mkdir(directory, { mode: 0o700 });
            const a = assets(version);
            await gh(["release", "download", release.tag, "--repo", project, "--dir", download, "--clobber", "--pattern", a.archive, "--pattern", `${a.archive}.sha256`, "--pattern", `${a.binary}.sha256`]);
            const previous = await unpack(join(download, a.archive), version, join(work, "previous"));
            row.archiveSha256 = previous.sha256;
            // install.sh executes the release's standalone binary; the archive must carry those bytes.
            if (hash(await readFile(previous.binary)) !== await declared(join(download, `${a.binary}.sha256`), a.binary)) throw new Error("The archive's executable is not the one install.sh runs");
            await writeFile(join(app, "retained.txt"), `application state kept across ${version} and ${candidate.version}\n`);
            let before = await digestOf(app); const env = { ...process.env, HOME: home, WRINGER_HOME: app };
            const json = async (name: string, argv: string[]) => JSON.parse(await run(version, name, argv, env, work));
            // install.sh's two calls, with an explicit private prefix and application directory.
            const install = (binary: string, selection: { path: string; sha256: string; version: string }) => [binary, "install", "--archive", selection.path, "--sha256", selection.sha256, "--release", selection.version, "--prefix", prefix, "--app-dir", app];
            const first = await json("published-install-preview", [...install(previous.binary, previous), "--dry-run", "--json"]);
            if (!first.eligible) throw new Error(`The published release could not install itself: ${first.holds.join(", ")}`);
            await run(version, "published-install-apply", [...install(previous.binary, previous), "--apply", "--expected", first.identity], env, work);
            const launcher = join(prefix, "bin", "wring");
            if (!reports(await run(version, "published-version", [launcher, "--version"], env, work), version)) throw new Error("The installed launcher reports another version");
            // The published release has now run a job, as far as its retained records go.
            await retainFinishedJob(app); before = await digestOf(app); row.finishedJob = "retained capture and overlay, each under two names";
            const upgrade = await json("candidate-upgrade-preview", [...install(candidate.binary, candidate), "--dry-run", "--json"]);
            row.upgrade = { eligible: upgrade.eligible, holds: upgrade.holds, ...(upgrade.holds.length ? { nextAction: upgrade.nextAction } : {}) };
            if (!upgrade.eligible || upgrade.holds.length) throw new Error(`Upgrade to ${candidate.version} held: ${upgrade.holds.join(", ")}`);
            await run(version, "candidate-upgrade-apply", [...install(candidate.binary, candidate), "--apply", "--expected", upgrade.identity], env, work);
            if (await readlink(join(prefix, "current")) !== `versions/${candidate.version}-${candidate.sha256}` || !reports(await run(version, "candidate-version", [launcher, "--version"], env, work), candidate.version)) throw new Error("The upgrade did not switch to the candidate");
            // The way back is held exactly on the record formats the candidate adds or changes.
            const expected = await lacking(candidate.directory, previous.directory), rollback = [launcher, "upgrade", "--rollback", "--prefix", prefix, "--app-dir", app];
            const back = await json("rollback-preview", [...rollback, "--dry-run", "--json"]);
            row.rollback = { eligible: back.eligible, holds: back.holds.length, expectedHolds: expected.length, applied: false };
            if (back.eligible !== !expected.length || JSON.stringify([...back.holds].sort()) !== JSON.stringify(expected)) throw new Error("The rollback preview differs from the record formats the candidate adds");
            if (back.eligible) {
                await run(version, "rollback-apply", [...rollback, "--apply", "--expected", back.identity], env, work);
                if (!reports(await run(version, "rolled-back-version", [launcher, "--version"], env, work), version)) throw new Error("The rollback did not restore the published release");
                row.rollback.applied = true;
            }
            if (await digestOf(app) !== before) throw new Error("Installation changed application state");
            row.passed = true;
        } catch (error: any) { row.error = scrub(String(error?.message ?? error)); }
        finally { await rm(work, { recursive: true, force: true }); }
    }
} finally {
    const tested = results.filter(r => !r.skipped);
    await writeFile(join(output, "result.json"), JSON.stringify({ schema_version: "wringer.published-upgrade-measurement.v1", kind: "Published archives installed by their own executables, then upgraded by the candidate's over a finished job's retained records, in a temporary filesystem; no account, provider, job, model call or publication", platform, repository: RELEASE_REPOSITORY, candidate: candidate ? { version: candidate.version, archiveSha256: candidate.sha256, source: candidate.source } : null, passed: tested.length > 0 && tested.every(r => r.passed), releases: results, records }, null, 2) + "\n");
    await rm(root, { recursive: true, force: true });
}
const tested = results.filter(r => !r.skipped), failed = tested.filter(r => !r.passed);
if (!tested.length) throw new Error("No published release was upgraded from");
if (failed.length) { console.error(failed.map(r => `${r.version}: ${r.error}`).join("\n")); process.exit(1); }
console.log(`Upgraded to ${candidate!.version} from ${tested.length} published releases on ${platform} (${results.length - tested.length} skipped); each way back was held exactly on the record formats the candidate adds, and applied where it adds none`);
