import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";
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
    console.log(`Verified release tag ${tag}`);
}
else if (mode === "package") {
    const platform = `${process.platform}-${process.arch}`;
    if (process.env.WRINGER_RELEASE_PLATFORM && process.env.WRINGER_RELEASE_PLATFORM !== platform)
        throw new Error("Runner architecture differs from its advertised artifact platform");
    const build = await Bun.file(join(root, "dist/BUILD.json")).json();
    if (build.version !== version || `${build.platform}-${build.arch}` !== platform || build.python_runtime !== false)
        throw new Error("Build metadata does not match this release");
    const out = join(root, "dist/release");
    await mkdir(out, { recursive: true });
    const name = `wringer-${version}-${platform}.tar.gz`;
    const result = await runProcess(["tar", "-czf", join(out, name), "-C", join(root, "dist"), "wring", "wringer-board", "wringer-drive", "wringer-headless", "BUILD.json", "schema", "docs"], { cwd: root, timeout: 120 });
    if (result.exit_code !== 0)
        throw new Error(result.stderr || "Packaging failed");
    const hash = createHash("sha256").update(await readFile(join(out, name))).digest("hex");
    await writeFile(join(out, `${name}.sha256`), `${hash}  ${name}\n`);
    console.log(join(out, name));
}
else {
    throw new Error("Usage: bun scripts/release.ts check-tag|package");
}
