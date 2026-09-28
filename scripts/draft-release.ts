/** Explicit draft-only publication with immutable-byte retry checks. Never tags,
 * promotes, overwrites assets, or treats a partial upload as a completed release. */
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runProcess } from "../packages/engine/src/process";
import { distributionHash as hash, releaseVersion, RELEASE_REPOSITORY } from "./distribution-manifest";
import { verifyReleaseArchive } from "../packages/cli/src/release-archive";
export async function draftReleasePlan(directory: string, tag: string) {
    const version = tag.slice(1); if (tag !== `v${version}` || !releaseVersion(version)) throw new Error("Select an exact v-prefixed prerelease tag");
    if (!version.includes("-")) throw new Error("This adoption workflow stages prereleases only");
    const assets: { name: string; path: string; sha256: string }[] = [], identities = [];
    for (const platform of ["darwin-arm64", "linux-x64"]) {
        const path = join(directory, `release-${platform}`), archive = `wringer-${version}-${platform}.tar.gz`, binary = `wring-${version}-${platform}`;
        const required = [archive, `${archive}.sha256`, `${archive}.manifest.json`, `${archive}.inventory.json`, `${archive}.claims.json`, binary, `${binary}.sha256`];
        if ((await readdir(path)).some(name => !required.includes(name))) throw new Error("Unexpected public release asset; inspect it before publication");
        for (const name of required) assets.push({ name, path: join(path, name), sha256: hash(await readFile(join(path, name))) });
        const bytes = await readFile(join(path, archive)), sha256 = hash(bytes), verified = verifyReleaseArchive(bytes, { sha256, version, platform });
        const claims = JSON.parse(await readFile(join(path, `${archive}.claims.json`), "utf8"));
        const manifestBytes = await readFile(join(path, `${archive}.manifest.json`)), inventory = JSON.parse(await readFile(join(path, `${archive}.inventory.json`), "utf8"));
        if (!manifestBytes.equals(verified.entries.find(e => e.path === "DISTRIBUTION.json")!.data) || claims.schema_version !== "wringer.release-claims.v1" || claims.archive !== archive || JSON.stringify(claims.source) !== JSON.stringify(verified.manifest.source) || inventory.schema_version !== "wringer.release-inventory.v1" || inventory.manifestSha256 !== hash(manifestBytes) || inventory.archive?.name !== archive || inventory.archive?.sha256 !== sha256 || inventory.archive?.bytes !== bytes.length || inventory.version !== version || inventory.platform !== platform || inventory.repository !== RELEASE_REPOSITORY || JSON.stringify(inventory.source) !== JSON.stringify(verified.manifest.source)) throw new Error("Release sidecar differs from its exact native archive");
        if (verified.manifest.source.dirty || claims.archiveSha256 !== sha256 || claims.platform !== platform || claims.version !== version || ["extractedRoutes", "installedOfflineArtifact", "npmOfflineCandidate"].some(key => claims.claims[key] !== "passed")) throw new Error("Exact clean-source native artifact claims are required before draft staging");
        if (await readFile(join(path, `${archive}.sha256`), "utf8") !== `${sha256}  ${archive}\n` || await readFile(join(path, `${binary}.sha256`), "utf8") !== `${hash(await readFile(join(path, binary)))}  ${binary}\n` || (verified.manifest.files.find(file => file.path === "wring") as any).sha256 !== hash(await readFile(join(path, binary)))) throw new Error("Bootstrap or archive bytes differ from the candidate");
        identities.push(verified.manifest.source);
    }
    if (JSON.stringify(identities[0]) !== JSON.stringify(identities[1])) throw new Error("Native candidates were built from different source identities");
    const notes = await readFile(join(import.meta.dir, "../docs/rebuild/RELEASE_NOTES.md"), "utf8");
    return { schema_version: "wringer.draft-release-plan.v1", tag, repository: RELEASE_REPOSITORY.slice("https://github.com/".length), source: identities[0]!, assets, notes, draftOnly: true, published: false };
}
export async function stageDraftRelease(directory: string, tag: string) {
    const plan = await draftReleasePlan(directory, tag), scratch = await mkdtemp(join(tmpdir(), "wringer-draft-stage-"));
    await writeFile(join(scratch, "notes.md"), plan.notes);
    async function gh(args: string[], allowFailure = false) {
        const result = await runProcess(["gh", ...args], { cwd: directory, timeout: 300, maxBytes: 4 * 1024 * 1024 });
        if (result.timed_out || result.stdout_truncated || result.stderr_truncated || result.exit_code && !allowFailure) throw new Error(`Draft release operation failed or is uncertain: ${result.stderr.slice(-1000)}`); return result;
    }
    let object = JSON.parse((await gh(["api", `repos/${plan.repository}/git/ref/tags/${tag}`])).stdout).object;
    for (let i = 0; object.type === "tag" && i < 5; i++) object = JSON.parse((await gh(["api", `repos/${plan.repository}/git/tags/${object.sha}`])).stdout).object;
    if (object.type !== "commit" || object.sha !== plan.source.commit) throw new Error("Remote tag does not bind the exact artifact source; no tag was changed");
    async function view() {
        const result = await gh(["release", "view", tag, "--repo", plan.repository, "--json", "isDraft,tagName,assets,url,body"], true);
        if (!result.exit_code) return JSON.parse(result.stdout);
        if (/release not found/i.test(result.stderr)) return null;
        throw new Error("Release lookup is unavailable or unauthorized; no draft creation was inferred");
    }
    let release = await view();
    if (!release) { await gh(["release", "create", tag, "--repo", plan.repository, "--verify-tag", "--draft", "--prerelease", "--title", `Wringer ${tag.slice(1)}`, "--notes-file", join(scratch, "notes.md")]); release = await view(); }
    if (!release || !release.isDraft || release.tagName !== tag || release.body.trim() !== plan.notes.trim()) throw new Error("The retained release is public or differs from these exact notes; it was not edited");
    const byName = new Map<string, any>(release.assets.map((asset: any) => [asset.name, asset]));
    if ([...byName.keys()].some(name => !plan.assets.some(asset => asset.name === name))) throw new Error("Existing draft has unrelated assets; they were not removed or overwritten");
    for (const asset of plan.assets) {
        if (byName.has(asset.name)) {
            const output = await mkdtemp(join(scratch, "asset-"));
            await gh(["release", "download", tag, "--repo", plan.repository, "--pattern", asset.name, "--dir", output]);
            if (hash(await readFile(join(output, asset.name))) !== asset.sha256) throw new Error("An existing draft asset has different bytes; no asset was overwritten");
        } else {
            if (!(await view())?.isDraft) throw new Error("Release is no longer a draft; upload stopped");
            await gh(["release", "upload", tag, "--repo", plan.repository, asset.path]);
        }
    }
    release = await view();
    if (!release?.isDraft || release.assets.length !== plan.assets.length || plan.assets.some(asset => !release.assets.some((a: any) => a.name === asset.name))) throw new Error("Draft publication remains incomplete; inspect retained assets before retrying");
    const result = { schema_version: "wringer.draft-release-result.v1", tag, url: release.url, source: plan.source, assets: plan.assets.map(({ path, ...asset }) => asset), draftOnly: true, promoted: false };
    await writeFile(join(directory, `draft-${tag}.json`), JSON.stringify(result, null, 2) + "\n"); return result;
}
if (import.meta.main) {
    const [directory, tag, apply] = process.argv.slice(2); if (!directory || !tag || apply && apply !== "--apply") throw new Error("Usage: bun scripts/draft-release.ts ARTIFACT_DIRECTORY TAG [--apply]");
    console.log(JSON.stringify(apply ? await stageDraftRelease(resolve(directory), tag) : await draftReleasePlan(resolve(directory), tag), null, 2));
}
