import { expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { installerFixture } from "./fixtures/installer";
import { generateReleaseChannels } from "../../../scripts/release-channels";
import { distributionHash, distributionFiles } from "../src/distribution-manifest";
import { verifyNpmPackInventory } from "../../../scripts/npm-pack-inventory";
async function channelFixture() {
    const f = await installerFixture(), archive = await f.archive("1.0.0-test.1"), artifacts = join(f.root, "artifacts"), output = join(f.root, "channels"); await mkdir(artifacts);
    const name = `wringer-${archive.selection.version}-${process.platform}-${process.arch}.tar.gz`;
    await writeFile(join(artifacts, name), archive.bytes); await writeFile(join(artifacts, name + ".sha256"), `${distributionHash(archive.bytes)}  ${name}\n`);
    const report = await generateReleaseChannels(artifacts, output, { scope: "@wringer-fixture", fixture: true }); return { ...f, artifacts, output, report };
}
test("actual npm tarball agrees with its channel inventory and packages no controller secrets or install hooks", async () => {
    const f = await channelFixture(), platform = `${process.platform}-${process.arch}`, directory = join(f.output, `npm-${platform}`);
    // npm's display redactor mistakes this ordinary evidence filename for a token.
    const evidence = "docs/browser-54127b7f-b29f-44d4-b8a7-82b8ce9ad6b9.json";
    await mkdir(join(directory, "dist/docs")); await writeFile(join(directory, "dist", evidence), '{"fixture":true}\n');
    const inventory = JSON.parse(await readFile(join(directory, "dist/PACKAGE-CONTENTS.json"), "utf8"));
    inventory.files = (await distributionFiles(join(directory, "dist"))).filter(f => f.path !== "PACKAGE-CONTENTS.json");
    await writeFile(join(directory, "dist/PACKAGE-CONTENTS.json"), JSON.stringify(inventory));
    const packed = Bun.spawnSync(["npm", "pack", "--offline", "--ignore-scripts", "--json", "--cache", join(f.root, "cache"), "--pack-destination", f.output], { cwd: directory });
    expect(packed.exitCode).toBe(0); const result = JSON.parse(packed.stdout.toString())[0];
    const manifest = JSON.parse(await readFile(join(directory, "dist/PACKAGE-CONTENTS.json"), "utf8"));
    const expected = ["package.json", "dist/PACKAGE-CONTENTS.json", ...manifest.files.map((f: any) => `dist/${f.path}`)].sort();
    const bytes = await readFile(join(f.output, result.filename)), inventoryBytes = await readFile(join(directory, "dist/PACKAGE-CONTENTS.json")), packageBytes = await readFile(join(directory, "package.json"));
    const paths = verifyNpmPackInventory(bytes, inventoryBytes, packageBytes);
    expect(paths).toEqual(expected); expect(paths).toContain(`dist/${evidence}`);
    expect(paths.some(path => /(^|\/)(AGENTS\.md|CLAUDE\.md|connection\.json|operator\.json)$/.test(path))).toBe(false);
    // Corrupt the archive independently of npm's display summary and source inventory.
    const mutate = (change: (entries: ReturnType<typeof readReleaseArchive>) => void) => {
        const entries = readReleaseArchive(bytes); change(entries);
        return () => verifyNpmPackInventory(encodeReleaseArchive(entries), inventoryBytes, packageBytes);
    };
    expect(mutate(entries => { entries.splice(entries.findIndex(e => e.path === "package/dist/LICENSE"), 1); })).toThrow("Actual npm archive differs");
    expect(mutate(entries => { entries.push({ path: "package/unexpected", kind: "file", mode: 0o644, target: "", data: Buffer.from("extra") }); })).toThrow("Actual npm archive differs");
    expect(mutate(entries => { const e = entries.find(e => e.path === "package/dist/LICENSE")!; e.data = Buffer.from("x".repeat(e.data.length)); })).toThrow("content");
    expect(mutate(entries => { entries.find(e => e.path === "package/dist/wring")!.mode = 0o644; })).toThrow("content");
    expect(mutate(entries => { const e = entries.find(e => e.path === "package/dist/LICENSE")!; e.kind = "symlink"; e.target = "wring"; e.data = Buffer.alloc(0); })).toThrow("Actual npm archive differs");
    expect(mutate(entries => { entries.find(e => e.path === "package/package.json")!.data = Buffer.from("{}"); })).toThrow("content");
    expect(mutate(entries => { entries.find(e => e.path === "package/dist/PACKAGE-CONTENTS.json")!.data = Buffer.from("{}"); })).toThrow("content");
    const launcher = JSON.parse(await readFile(join(f.output, "npm-launcher/package.json"), "utf8"));
    expect(launcher.license).toBe("Apache-2.0"); expect(launcher.private).toBe(true); expect(launcher.scripts).toBeUndefined();
    expect(Object.values(launcher.optionalDependencies)).toEqual(["1.0.0-test.1"]);
    const server = JSON.parse(await readFile(join(f.output, "server.json"), "utf8")); expect(server.packages[0].identifier).toBe(launcher.name); expect(server.packages[0].version).toBe(launcher.version); expect(server.remotes).toBeUndefined();
});
test("production namespace is never inferred from a missing registry name", async () => {
    const f = await channelFixture(); await expect(generateReleaseChannels(f.artifacts, join(f.root, "unused"), { scope: "@available-is-not-owned", fixture: false })).rejects.toThrow("namespace proof");
});

import { publishNpmArtifacts } from "../../../scripts/npm-publication";
import { createHash } from "node:crypto";
import { readReleaseArchive, encodeReleaseArchive } from "../src/release-archive";
import { verifyNpmTarball } from "../../../scripts/npm-publication";
test("npm publication validates actual tarball contents before any registry call", async () => {
    const f = await installerFixture(), data = Buffer.from("not a package archive"), integrity = "sha512-" + createHash("sha512").update(data).digest("base64"), version = "1.0.0-test.1";
    await writeFile(join(f.root, "a.tgz"), data); await writeFile(join(f.root, "b.tgz"), data);
    const plan = { schema_version: "wringer.npm-publication.v1", version, namespace: "@wringer-fixture", tag: "next", published: false, packages: [{ name: "@wringer-fixture/wringer-darwin-arm64", version, file: "a.tgz", integrity }, { name: "@wringer-fixture/wringer", version, file: "b.tgz", integrity }] };
    const path = join(f.root, "PUBLICATION.json"); await writeFile(path, JSON.stringify(plan)); let calls = 0;
    await expect(publishNpmArtifacts(path, async () => { calls++; return { exit_code: 2, stdout: "", stderr: "synthetic registry must not be called", timed_out: false, stdout_truncated: false, stderr_truncated: false, duration_ms: 0, interrupted: false }; })).rejects.toThrow();
    expect(calls).toBe(0);
});

async function publishFixture() {
    const f = await channelFixture(), packages = [];
    for (const p of f.report.packages) {
        const directory = join(f.output, p.directory), manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
        manifest.private = false; await writeFile(join(directory, "package.json"), JSON.stringify(manifest));
        const packed = Bun.spawnSync(["npm", "pack", "--offline", "--ignore-scripts", "--json", "--cache", join(f.root, "cache"), "--pack-destination", f.output], { cwd: directory });
        expect(packed.exitCode).toBe(0); const result = JSON.parse(packed.stdout.toString())[0], file = join(f.output, result.filename);
        let bytes: Buffer = await readFile(file);
        if (p.platform !== "launcher") {
            const entries = readReleaseArchive(bytes), archive = entries.find(e => e.path === "package/dist/ARCHIVE-DISTRIBUTION.json")!, contents = entries.find(e => e.path === "package/dist/PACKAGE-CONTENTS.json")!;
            const original = JSON.parse(archive.data.toString()); original.source.dirty = false; archive.data = Buffer.from(JSON.stringify(original));
            const inventory = JSON.parse(contents.data.toString()), row = inventory.files.find((f: any) => f.path === "ARCHIVE-DISTRIBUTION.json"); row.bytes = archive.data.length; row.sha256 = distributionHash(archive.data); contents.data = Buffer.from(JSON.stringify(inventory));
            bytes = encodeReleaseArchive(entries); await writeFile(file, bytes);
        }
        packages.push({ name: p.name, version: f.report.version, file: result.filename, integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64") });
    }
    const plan = { schema_version: "wringer.npm-publication.v1", version: f.report.version, namespace: f.report.namespace, tag: "next", published: false, packages }, path = join(f.output, "PUBLICATION.json");
    await writeFile(path, JSON.stringify(plan)); return { ...f, plan, path };
}
const commandResult = (stdout: string) => ({ exit_code: 0, stdout, stderr: "", timed_out: false, stdout_truncated: false, stderr_truncated: false, duration_ms: 1, interrupted: false });
test("npm publication accepts actual pack bytes, retries exact existing versions read-only, and refuses changed versions", async () => {
    const f = await publishFixture(); let calls = 0;
    const inspect = async (argv: string | string[]) => { calls++; expect(argv[1]).toBe("view"); const pkg = f.plan.packages.find(p => argv.includes(`${p.name}@${p.version}`))!; return commandResult(JSON.stringify(pkg.integrity)); };
    expect((await publishNpmArtifacts(f.path, inspect)).every(p => p.alreadyPublished)).toBe(true);
    await publishNpmArtifacts(f.path, inspect); expect(calls).toBe(4);
    await expect(publishNpmArtifacts(f.path, async () => commandResult(JSON.stringify("different")))).rejects.toThrow("different bytes");
    const native = f.plan.packages[0]!, entries = readReleaseArchive(await readFile(join(f.output, native.file)));
    entries.find(e => e.path === "package/dist/wring")!.data = Buffer.from("changed binary");
    expect(() => verifyNpmTarball(encodeReleaseArchive(entries), native, f.plan.namespace)).toThrow("content differs");
    const pkg = entries.find(e => e.path === "package/package.json")!, metadata = JSON.parse(pkg.data.toString()); metadata.private = true; pkg.data = Buffer.from(JSON.stringify(metadata));
    expect(() => verifyNpmTarball(encodeReleaseArchive(entries), native, f.plan.namespace)).toThrow("publication policy");
});
