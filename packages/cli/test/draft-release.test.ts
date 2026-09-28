import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installerFixture } from "./fixtures/installer";
import { readReleaseArchive, encodeReleaseArchive } from "../src/release-archive";
import { distributionHash as hash } from "../src/distribution-manifest";
import { draftReleasePlan } from "../../../scripts/draft-release";
import { releaseClaims } from "../../../scripts/release-claims";
test("release claims refuse npm observations from another archive", async () => {
    const f = await installerFixture(), version = "1.0.0-test.2", artifact = await f.archive(version), platform = `${process.platform}-${process.arch}`, name = `wringer-${version}-${platform}.tar.gz`, evidence = join(f.root, "evidence");
    await writeFile(join(f.root, name), artifact.bytes);
    const manifest = readReleaseArchive(artifact.bytes).find(e => e.path === "DISTRIBUTION.json")!; await writeFile(join(f.root, name + ".manifest.json"), manifest.data);
    for (const dir of ["extracted", "installer", "npm"]) await mkdir(join(evidence, dir), { recursive: true });
    await writeFile(join(evidence, "extracted/result.json"), JSON.stringify({ archive: { sha256: hash(artifact.bytes) }, checks: [{ passed: true }] }));
    await writeFile(join(evidence, "installer/result.json"), JSON.stringify({ archiveSha256: hash(artifact.bytes), platform, records: Array.from({ length: 13 }, () => ({ name: "synthetic", exit: 0 })) }));
    await writeFile(join(evidence, "npm/result.json"), JSON.stringify({ platform, version, archiveIdentities: [{ platform, sha256: "f".repeat(64) }], records: [{ exit: 0 }] }));
    await expect(releaseClaims(f.root, evidence, platform, version)).rejects.toThrow("artifact");
});
test("draft staging binds sidecar identity and claims to both exact native archives", async () => {
    const f = await installerFixture(), version = "1.0.0-test.1", original = await f.archive(version);
    for (const platform of ["darwin-arm64", "linux-x64"]) {
        const entries = readReleaseArchive(original.bytes), build = entries.find(e => e.path === "BUILD.json")!, manifestEntry = entries.find(e => e.path === "DISTRIBUTION.json")!;
        const manifest = JSON.parse(manifestEntry.data.toString()); [manifest.platform, manifest.arch] = platform.split("-"); manifest.source.dirty = false;
        build.data = Buffer.from(JSON.stringify({ version, platform: manifest.platform, arch: manifest.arch, python_runtime: false }));
        const buildFile = manifest.files.find((f: any) => f.path === "BUILD.json"); buildFile.bytes = build.data.length; buildFile.sha256 = hash(build.data); manifestEntry.data = Buffer.from(JSON.stringify(manifest));
        const bytes = encodeReleaseArchive(entries), archive = `wringer-${version}-${platform}.tar.gz`, binary = `wring-${version}-${platform}`, dir = join(f.root, `release-${platform}`); await mkdir(dir);
        const binaryBytes = entries.find(e => e.path === "wring")!.data;
        const claims = { schema_version: "wringer.release-claims.v1", archive, archiveSha256: hash(bytes), source: manifest.source, version, platform, claims: { extractedRoutes: "passed", installedOfflineArtifact: "passed", npmOfflineCandidate: "passed" } };
        const inventory = { schema_version: "wringer.release-inventory.v1", archive: { name: archive, sha256: hash(bytes), bytes: bytes.length }, manifestSha256: hash(manifestEntry.data), version, platform, source: manifest.source, repository: manifest.repository };
        for (const [name, data] of [[archive, bytes], [binary, binaryBytes], [archive + ".sha256", `${hash(bytes)}  ${archive}\n`], [binary + ".sha256", `${hash(binaryBytes)}  ${binary}\n`], [archive + ".manifest.json", manifestEntry.data], [archive + ".claims.json", JSON.stringify(claims)], [archive + ".inventory.json", JSON.stringify(inventory)]] as const) await writeFile(join(dir, name), data);
    }
    expect((await draftReleasePlan(f.root, `v${version}`)).assets).toHaveLength(14);
    const dir = join(f.root, "release-darwin-arm64"), base = `wringer-${version}-darwin-arm64.tar.gz`;
    for (const suffix of ["manifest", "inventory", "claims"]) {
        const file = join(dir, `${base}.${suffix}.json`), original = await readFile(file, "utf8"), value = JSON.parse(original);
        value.source.commit = "f".repeat(40); await writeFile(file, JSON.stringify(value));
        await expect(draftReleasePlan(f.root, `v${version}`)).rejects.toThrow("sidecar"); await writeFile(file, original);
    }
});
