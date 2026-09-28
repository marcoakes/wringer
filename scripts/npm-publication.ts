/** Exact npm tarballs only; account bootstrap/trusted-publisher setup is external. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { runProcess } from "../packages/engine/src/process";
import { releaseVersion } from "./distribution-manifest";
import { distributionHash, parseDistributionManifest } from "./distribution-manifest";
import { readReleaseArchive } from "../packages/cli/src/release-archive";
/** Parse all package bytes before any registry lookup or publication. */
export function verifyNpmTarball(bytes: Buffer, selected: { name: string; version: string }, namespace: string) {
    const entries = readReleaseArchive(bytes);
    if (entries.some(e => e.kind !== "file" || !e.path.startsWith("package/") || entries.some(p => e.path.startsWith(p.path + "/")))) throw new Error("Unexpected npm archive entry");
    const get = (path: string) => { const e = entries.find(e => e.path === `package/${path}`); if (!e) throw new Error(`Missing npm package content: ${path}`); return e; };
    const pkg = JSON.parse(get("package.json").data.toString());
    if (pkg.name !== selected.name || pkg.version !== selected.version || pkg.private !== false || pkg.scripts || pkg.license !== "Apache-2.0" || pkg.repository?.url !== "https://github.com/marcoakes/wringer.git") throw new Error("Actual npm package identity or publication policy differs");
    if (pkg.name === `${namespace}/wringer`) {
        if (entries.map(e => e.path).sort().join() !== ["LICENSE", "README.md", "launcher.cjs", "package.json"].map(p => `package/${p}`).sort().join() || !(get("launcher.cjs").mode & 0o111) || !pkg.optionalDependencies || !Object.keys(pkg.optionalDependencies).length) throw new Error("Unexpected thin launcher contents");
        return { pkg, source: null };
    }
    const platform = pkg.name.slice(`${namespace}/wringer-`.length);
    if (!["darwin-arm64", "linux-x64"].includes(platform) || pkg.os?.join() !== platform.split("-")[0] || pkg.cpu?.join() !== platform.split("-")[1]) throw new Error("Native npm platform differs");
    const archive = get("dist/ARCHIVE-DISTRIBUTION.json"), manifest = parseDistributionManifest(archive.data), inventory = JSON.parse(get("dist/PACKAGE-CONTENTS.json").data.toString());
    if (manifest.source.dirty || manifest.version !== selected.version || `${manifest.platform}-${manifest.arch}` !== platform || inventory.schema_version !== "wringer.npm-platform.v1" || inventory.version !== selected.version || inventory.platform !== platform || !/^[a-f0-9]{64}$/.test(inventory.archiveSha256)) throw new Error("Native package is not an exact clean-source candidate");
    const files = [...manifest.files.filter(f => f.kind === "file"), { path: "ARCHIVE-DISTRIBUTION.json", kind: "file" as const, sha256: distributionHash(archive.data), bytes: archive.data.length, executable: false }].sort((a, b) => a.path.localeCompare(b.path));
    if (JSON.stringify(files) !== JSON.stringify(inventory.files) || entries.length !== files.length + 2) throw new Error("Native npm inventory differs from its original archive");
    for (const file of files) {
        const entry = get(`dist/${file.path}`);
        if (entry.data.length !== file.bytes || distributionHash(entry.data) !== file.sha256 || !!(entry.mode & 0o111) !== file.executable) throw new Error("Native npm content differs from its inventory");
    }
    return { pkg, source: manifest.source };
}
export async function prepareNpmPublication(channels: string, tarballs: string) {
    const report = JSON.parse(await readFile(join(channels, "CHANNELS.json"), "utf8"));
    if (report.schema_version !== "wringer.channels.v1" || report.fixture !== false || report.published !== false || !/^@[a-z0-9][a-z0-9-]*$/.test(report.namespace) || !releaseVersion(report.version) || !report.version.includes("-") || !Array.isArray(report.packages) || report.packages.length < 2 || report.packages.length > 3) throw new Error("Only a reviewed production prerelease channel set can be prepared for npm publication");
    const npm = Bun.which("npm"); if (!npm) throw new Error("npm is required for this separately selected channel");
    await mkdir(tarballs, { mode: 0o700 });
    const packages = [];
    for (const pkg of report.packages) {
        if (!/^npm-(launcher|darwin-arm64|linux-x64)$/.test(pkg.directory) || pkg.name !== `${report.namespace}/wringer${pkg.platform === "launcher" ? "" : `-${pkg.platform}`}`) throw new Error("Unexpected channel package name");
        const source = join(channels, pkg.directory), manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
        if (manifest.private !== false || manifest.name !== pkg.name || manifest.version !== report.version || manifest.scripts || manifest.repository.url !== "https://github.com/marcoakes/wringer.git") throw new Error("Production package manifest differs from the reviewed channel set");
        const packed = await runProcess([npm, "pack", "--json", "--offline", "--ignore-scripts", "--pack-destination", tarballs], { cwd: source, timeout: 180, maxBytes: 2 * 1024 * 1024 });
        if (packed.exit_code || packed.timed_out || packed.stdout_truncated) throw new Error("npm packing failed before publication");
        const result = JSON.parse(packed.stdout)[0];
        if (!/^[a-z0-9.-]+\.tgz$/.test(result.filename)) throw new Error("Unexpected npm artifact filename");
        const file = join(tarballs, result.filename), bytes = await readFile(file), integrity = "sha512-" + createHash("sha512").update(bytes).digest("base64");
        if (integrity !== result.integrity || result.name !== manifest.name || result.version !== manifest.version) throw new Error("npm tarball integrity differs from pack output");
        verifyNpmTarball(bytes, manifest, report.namespace);
        packages.push({ name: manifest.name, version: manifest.version, file: result.filename, integrity });
    }
    const plan = { schema_version: "wringer.npm-publication.v1", version: report.version, namespace: report.namespace, packages, tag: "next", published: false };
    await writeFile(join(tarballs, "PUBLICATION.json"), JSON.stringify(plan, null, 2) + "\n", { flag: "wx" }); return plan;
}
export async function publishNpmArtifacts(file: string, command: typeof runProcess = runProcess) {
    const plan = JSON.parse(await readFile(file, "utf8"));
    if (plan.schema_version !== "wringer.npm-publication.v1" || plan.tag !== "next" || plan.published !== false || !Array.isArray(plan.packages) || plan.packages.length < 2 || plan.packages.length > 3 || !releaseVersion(plan.version) || !plan.version.includes("-")) throw new Error("Invalid exact npm publication plan");
    if (!/^@[a-z0-9][a-z0-9-]*$/.test(plan.namespace) || new Set(plan.packages.map((p: any) => p.name)).size !== plan.packages.length || new Set(plan.packages.map((p: any) => p.file)).size !== plan.packages.length || plan.packages.filter((p: any) => p.name === `${plan.namespace}/wringer`).length !== 1) throw new Error("Invalid npm package set");
    const verified = [];
    for (const pkg of plan.packages) {
        if (!/^[a-z0-9.-]+\.tgz$/.test(pkg.file) || !new RegExp(`^${String(plan.namespace).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/wringer(?:-(?:linux-x64|darwin-arm64))?$`).test(pkg.name) || pkg.version !== plan.version || "sha512-" + createHash("sha512").update(await readFile(join(dirname(file), pkg.file))).digest("base64") !== pkg.integrity) throw new Error("Selected npm artifact changed before publication");
        verified.push(verifyNpmTarball(await readFile(join(dirname(file), pkg.file)), pkg, plan.namespace));
    }
    const launcher = verified.find(v => !v.source)!, natives = verified.filter(v => v.source);
    const dependencies = Object.fromEntries(natives.map(v => [v.pkg.name, plan.version]));
    if (Object.keys(launcher.pkg.optionalDependencies).sort().join() !== Object.keys(dependencies).sort().join() || Object.values(launcher.pkg.optionalDependencies).some(v => v !== plan.version) || natives.some(v => JSON.stringify(v.source) !== JSON.stringify(natives[0]!.source))) throw new Error("Launcher dependencies or native source identities differ");
    const npm = Bun.which("npm"); if (!npm) throw new Error("npm is required");
    const outcomes = [];
    for (const pkg of plan.packages) {
        const viewed = await command([npm, "view", "--registry", "https://registry.npmjs.org", `${pkg.name}@${pkg.version}`, "dist.integrity", "--json"], { cwd: resolve(file, ".."), timeout: 30, maxBytes: 65536 });
        if (viewed.timed_out || viewed.stdout_truncated || viewed.stderr_truncated) throw new Error("npm version lookup is uncertain; no publish attempted");
        if (viewed.exit_code === 0) {
            if (JSON.parse(viewed.stdout) !== pkg.integrity) throw new Error("Published npm version has different bytes; versions are never overwritten");
            outcomes.push({ name: pkg.name, alreadyPublished: true, integrity: pkg.integrity }); continue;
        }
        let error: any = null; try { error = JSON.parse(viewed.stdout).error; } catch {}
        if (error?.code !== "E404") throw new Error("npm lookup failed for a reason other than absent version; inspect account/registry access");
        const published = await command([npm, "publish", join(dirname(file), pkg.file), "--registry", "https://registry.npmjs.org", "--ignore-scripts", "--access", "public", "--tag", "next", "--provenance"], { cwd: resolve(file, ".."), timeout: 300, maxBytes: 65536 });
        if (published.exit_code || published.timed_out) throw new Error("npm publication is unfinished or uncertain; retry observes this exact version before another publish");
        const confirmed = await command([npm, "view", "--registry", "https://registry.npmjs.org", `${pkg.name}@${pkg.version}`, "dist.integrity", "--json"], { cwd: resolve(file, ".."), timeout: 30, maxBytes: 65536 });
        if (confirmed.exit_code || confirmed.stdout_truncated || JSON.parse(confirmed.stdout) !== pkg.integrity) throw new Error("Registry has not confirmed the exact published tarball; no success is recorded");
        outcomes.push({ name: pkg.name, alreadyPublished: false, integrity: pkg.integrity });
    }
    await writeFile(resolve(file, "../PUBLISHED.json"), JSON.stringify({ schema_version: "wringer.npm-publication-result.v1", version: plan.version, outcomes }, null, 2) + "\n"); return outcomes;
}
if (import.meta.main) {
    const [mode, first, second] = process.argv.slice(2);
    if (mode === "prepare" && first && second) console.log(JSON.stringify(await prepareNpmPublication(resolve(first), resolve(second)), null, 2));
    else if (mode === "publish" && first) console.log(JSON.stringify(await publishNpmArtifacts(resolve(first)), null, 2));
    else throw new Error("Usage: bun scripts/npm-publication.ts prepare CHANNELS NEW_TARBALL_DIRECTORY | publish PUBLICATION.json");
}
