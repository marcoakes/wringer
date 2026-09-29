import { cp, mkdir, lstat, rename, symlink, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { copyDistributionDocs } from "./distribution-docs";
import { DISTRIBUTION } from "../packages/cli/src/routes";
import { verifyDistributionManifest, writeDistributionManifest } from "./distribution-manifest";

export async function buildDistribution(output?: string) {
    const root = resolve(import.meta.dir, ".."), id = crypto.randomUUID(), out = output ? resolve(output) : join(root, "dist");
    const generated = Bun.spawn([process.execPath, "scripts/generate-assertion-adapter.ts", "--check"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (await generated.exited) throw new Error("Contained assertion adapter differs from its source");
    const reader = Bun.spawn([process.execPath, "scripts/generate-bundle-reader.ts", "--check"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (await reader.exited) throw new Error("Independent bundle reader differs from its source");
    if (out === root || root.startsWith(out + "/")) throw new Error("Build output cannot replace a source parent");
    if (output) { try { await lstat(out); throw new Error("Explicit build output must not exist"); } catch (error: any) { if (error.code !== "ENOENT") throw error; } }
    const stage = join(root, "build", `distribution-${id}`);
    await mkdir(stage, { recursive: true });
    const { version } = await Bun.file(join(root, "package.json")).json();
    const git = (args: string[]) => { const result = Bun.spawnSync(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" }); if (result.exitCode) throw new Error("Cannot identify build source"); return result.stdout.toString().trim(); };
    const tracked = git(["ls-files", "--cached", "--others", "--exclude-standard"]).split("\n").sort();
    const sourceHash = createHash("sha256");
    for (const file of tracked) { sourceHash.update(file + "\0"); try { sourceHash.update(await readFile(join(root, file))); } catch (error: any) { if (error.code !== "ENOENT") throw error; sourceHash.update("[deleted]"); } sourceHash.update("\0"); }
    const source = { commit: git(["rev-parse", "HEAD"]), dirty: !!git(["status", "--porcelain=v1"]), contentSha256: sourceHash.digest("hex") };
    const command = [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "packages/cli/src/launcher.ts", "--outfile", join(stage, "wring")];
    const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (await child.exited) throw new Error("Executable build failed; previous distribution retained");
    for (const row of DISTRIBUTION.aliases) await symlink("wring", join(stage, row.alias));
    for (const asset of DISTRIBUTION.assets) await cp(join(root, asset.source), join(stage, asset.destination), { recursive: true });
    const documentation = await copyDistributionDocs(root, stage, { entrypoints: [...DISTRIBUTION.documentation] });
    await mkdir(join(stage, "docs/examples"), { recursive: true });
    for (const name of ["contained", "planning"]) await cp(join(root, `packages/plan/examples/${name}.yaml`), join(stage, `docs/examples/${name}.yaml`));
    const identity = { version, runtime: `Bun ${Bun.version}`, platform: process.platform, arch: process.arch, source };
    await writeFile(join(stage, "BUILD.json"), JSON.stringify({ ...identity, built_at: new Date().toISOString(), python_runtime: false, embedded_schemas: true }, null, 2) + "\n");
    const manifest = await writeDistributionManifest(stage, identity);
    await verifyDistributionManifest(stage);
    await mkdir(dirname(out), { recursive: true });
    let previous: string | undefined;
    if (!output) {
        try {
            const info = await lstat(out);
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Existing dist is not a real directory; nothing replaced");
            previous = join(root, "build", `retained-distribution-${id}`); await rename(out, previous);
        } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    try { await rename(stage, out); }
    catch (error) { if (previous) await rename(previous, out); throw error; }
    console.log(`Distribution: ${out}\n${manifest.files.length} entries; ${documentation.omissions.length} named historical omissions.${previous ? `\nPrevious output retained: ${previous}` : ""}`);
    return { directory: out, manifest };
}
if (import.meta.main) {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--output")) throw new Error("Usage: bun scripts/build.ts [--output NEW_DIRECTORY]");
    await buildDistribution(args[1]);
}
