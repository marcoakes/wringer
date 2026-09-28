import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";
import { verifyDistributionManifest } from "./distribution-manifest";
import { packageReleaseArchive } from "../packages/cli/src/release-archive";
import { writeReleaseInventory } from "./release-inventory";
const root = resolve(import.meta.dir, "..");
const { version } = await Bun.file(join(root, "package.json")).json();
const mode = process.argv[2];
if (mode === "check-tag") {
    const tag = process.env.WRINGER_RELEASE_TAG;
    if (!tag || tag !== `v${version}` || !/^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(tag))
        throw new Error("Release tag must exactly match package.json");
    const result = await runProcess(["git", "tag", "--points-at", "HEAD"], { cwd: root, timeout: 10 });
    if (result.exit_code !== 0 || !result.stdout.trim().split("\n").includes(tag))
        throw new Error("The selected tag does not point to this checkout");
    const status = await runProcess(["git", "status", "--porcelain=v1"], { cwd: root, timeout: 10 });
    if (status.exit_code || status.stdout.trim()) throw new Error("A tagged release requires clean source; local dirty candidates can only be packaged for measurement");
    console.log(`Verified release tag ${tag}`);
}
else if (mode === "package") {
    const platform = `${process.platform}-${process.arch}`;
    if (process.env.WRINGER_RELEASE_PLATFORM && process.env.WRINGER_RELEASE_PLATFORM !== platform)
        throw new Error("Runner architecture differs from its advertised artifact platform");
    const distribution = resolve(process.env.WRINGER_DISTRIBUTION ?? join(root, "dist"));
    const manifest = await verifyDistributionManifest(distribution);
    const build = await Bun.file(join(distribution, "BUILD.json")).json();
    if (build.version !== version || `${build.platform}-${build.arch}` !== platform || build.python_runtime !== false)
        throw new Error("Build metadata does not match this release");
    const out = resolve(process.env.WRINGER_RELEASE_OUTPUT ?? join(root, "build/release"));
    await mkdir(out, { recursive: true });
    const name = `wringer-${version}-${platform}.tar.gz`;
    if (await Bun.file(join(out, name)).exists()) throw new Error("Archive already exists; choose a fresh release output directory");
    await writeFile(join(out, name), await packageReleaseArchive(distribution), { flag: "wx" });
    const hash = createHash("sha256").update(await readFile(join(out, name))).digest("hex");
    await writeFile(join(out, `${name}.sha256`), `${hash}  ${name}\n`);
    const binaryName = `wring-${version}-${platform}`, binary = await readFile(join(distribution, "wring"));
    await writeFile(join(out, binaryName), binary, { flag: "wx", mode: 0o755 });
    await writeFile(join(out, `${binaryName}.sha256`), `${createHash("sha256").update(binary).digest("hex")}  ${binaryName}\n`, { flag: "wx" });
    await writeFile(join(out, `${name}.manifest.json`), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
    await writeReleaseInventory(root, out, { name, sha256: hash, bytes: (await readFile(join(out, name))).length }, manifest);
    console.log(join(out, name));
}
else {
    throw new Error("Usage: bun scripts/release.ts check-tag|package");
}
