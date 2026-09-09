import { cp, mkdir, lstat, symlink, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { copyDistributionDocs } from "./distribution-docs";
const root = resolve(import.meta.dir, ".."), out = join(root, "dist");
const { version } = await Bun.file(join(root, "package.json")).json();
await mkdir(out, { recursive: true });
const command = [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "packages/cli/src/launcher.ts", "--outfile", "dist/wring"];
const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit", env: process.env });
if (await child.exited)
    throw new Error("Native executable build failed");
const headless = Bun.spawn([process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "scripts/headless.ts", "--outfile", "dist/wringer-headless"], { cwd: root, stdout: "inherit", stderr: "inherit", env: process.env });
if (await headless.exited)
    throw new Error("Headless executable build failed");
const assistant = Bun.spawn([process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "packages/cli/src/assistant-cli.ts", "--outfile", "dist/wringer-assistant"], { cwd: root, stdout: "inherit", stderr: "inherit", env: process.env });
if (await assistant.exited) throw new Error("Assistant executable build failed");
const figmaBroker = Bun.spawn([process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "packages/figma-connect/src/serve.ts", "--outfile", "dist/wringer-figma-broker"], { cwd: root, stdout: "inherit", stderr: "inherit", env: process.env });
if (await figmaBroker.exited) throw new Error("Figma connection broker executable build failed");
for (const name of ["wringer-board", "wringer-drive"]) {
    const path = join(out, name);
    try {
        const info = await lstat(path);
        if (!info.isSymbolicLink())
            throw new Error(`Refusing to replace non-symlink ${path}`);
        await unlink(path);
    }
    catch (e: any) {
        if (e.code !== "ENOENT")
            throw e;
    }
    await symlink("wring", path);
}
await cp(join(root, "schema"), join(out, "schema"), { recursive: true });
const documentation = await copyDistributionDocs(root, out);
await mkdir(join(out, "docs/examples"), { recursive: true });
await cp(join(root, "packages/plan/examples/contained.yaml"), join(out, "docs/examples/contained.yaml"));
await cp(join(root, "packages/plan/examples/planning.yaml"), join(out, "docs/examples/planning.yaml"));
await writeFile(join(out, "BUILD.json"), JSON.stringify({ version, runtime: `Bun ${Bun.version}`, platform: process.platform, arch: process.arch, built_at: new Date().toISOString(), python_runtime: false, embedded_schemas: true }, null, 2) + "\n");
console.log(`Native distribution: ${out}\nDocumentation: ${documentation.files.length} carried reference files; ${documentation.omissions.length} private/local evidence links explicitly omitted.`);
