/** Native OCI image build/inventory only. This is not a delegation adapter or
 * a substitute for the independent Apple Container/gVisor permission probes. */
import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";
import { distributionHash as hash, releaseVersion } from "../packages/cli/src/distribution-manifest";
const root = resolve(import.meta.dir, ".."), inputs = ["Containerfile", "package.json", "bun.lock", "os-snapshot.lock.json", "prepare-os.ts", "model-launch.ts", "smoke-acp.ts", "network-probe.ts", "probe.ts"];
export async function runtimeImagePlan(platform = process.platform, arch = process.arch) {
    if (platform !== "linux" || !["arm64", "x64"].includes(arch)) throw new Error("Image artifacts require native Linux arm64 or x64 execution; no emulated target is qualified");
    const target = arch === "arm64" ? "linux/arm64" : "linux/amd64", lock = JSON.parse(await readFile(join(root, "runtime/base-images.lock.json"), "utf8")), bases = lock.platforms[target];
    const version = (await Bun.file(join(root, "package.json")).json()).version; if (!releaseVersion(version)) throw new Error("Invalid package version");
    if (!bases || !/^docker.io\/oven\/bun@sha256:[a-f0-9]{64}$/.test(bases.bun.reference) || !/^docker.io\/library\/node@sha256:[a-f0-9]{64}$/.test(bases.node.reference)) throw new Error("Runtime base image pins differ");
    const source = await runProcess(["git", "rev-parse", "HEAD"], { cwd: root, timeout: 10, maxBytes: 1024 });
    if (source.exit_code || !/^[a-f0-9]{40}$/.test(source.stdout.trim())) throw new Error("Source commit unavailable");
    const files = []; for (const name of inputs) files.push({ path: `runtime/${name}`, sha256: hash(await readFile(join(root, "runtime", name))) });
    return { schema_version: "wringer.runtime-image-plan.v1", platform: target, arch, version, commit: source.stdout.trim(), tag: `wringer-build:${version}-${arch}-${source.stdout.trim()}`, bases: { bun: bases.bun.reference, node: bases.node.reference }, files, modelCalls: 0, containmentClaims: "none; run separate Apple Container/gVisor probes" };
}
export async function buildRuntimeImageArtifact(output: string) {
    const plan = await runtimeImagePlan(); await mkdir(output, { mode: 0o700 }); await mkdir(join(output, "context/runtime"), { recursive: true });
    for (const file of plan.files) await cp(join(root, file.path), join(output, "context", file.path));
    await writeFile(join(output, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    async function run(name: string, argv: string[], timeout = 60) {
        const result = await runProcess(argv, { cwd: output, timeout, maxBytes: 8 * 1024 * 1024 });
        await writeFile(join(output, name + ".log"), result.stdout + result.stderr);
        if (result.exit_code || result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error(`Runtime image ${name} failed; retained measurements remain in the selected output`); return result.stdout;
    }
    await run("build", ["docker", "build", "--platform", plan.platform, "--build-arg", `BUN_BASE_IMAGE=${plan.bases.bun}`, "--build-arg", `NODE_BASE_IMAGE=${plan.bases.node}`, "--tag", plan.tag, "--file", join(output, "context/runtime/Containerfile"), join(output, "context")], 1800);
    const observed = JSON.parse(await run("inventory", ["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--entrypoint", "bun", plan.tag, "/opt/wringer-smoke/probe.ts", "inventory"]));
    const expected = JSON.parse(await readFile(join(root, "runtime/package.json"), "utf8"));
    if (observed.bun !== "1.4.2" || !String(observed.node).startsWith("24.") || hash(await readFile(join(root, "runtime/bun.lock"))) !== observed.lock || hash(await readFile(join(root, "runtime/model-launch.ts"))) !== observed.modelLauncher || JSON.stringify(observed.packages) !== JSON.stringify(expected.dependencies)) throw new Error("Executed runtime inventory differs from pinned inputs");
    await run("os-packages", ["docker", "run", "--rm", "--network", "none", "--read-only", "--cap-drop", "ALL", "--entrypoint", "cat", plan.tag, "/opt/wringer-agents/os-packages.txt"]);
    const inspect = JSON.parse(await run("image-inspect", ["docker", "image", "inspect", plan.tag]))[0];
    if (inspect.Os !== "linux" || inspect.Architecture !== (plan.arch === "x64" ? "amd64" : "arm64") || !/^sha256:[a-f0-9]{64}$/.test(inspect.Id)) throw new Error("Actual image architecture/identity differs");
    await run("save", ["docker", "image", "save", "--output", join(output, "image.tar"), plan.tag], 300);
    if ((await stat(join(output, "image.tar"))).size > 2 * 1024 ** 3) throw new Error("Owned runtime image archive exceeds 2 GiB bound");
    await run("compress", ["gzip", "-n", join(output, "image.tar")], 300);
    const archive = await readFile(join(output, "image.tar.gz"));
    const result = { ...plan, schema_version: "wringer.runtime-image-artifact.v1", measurement: "native-build-and-no-model-inventory", imageId: inspect.Id, archiveSha256: hash(archive), archiveBytes: archive.length, observed, publishedDigest: null };
    await writeFile(join(output, "IMAGE.json"), JSON.stringify(result, null, 2) + "\n"); return result;
}
if (import.meta.main) {
    const [mode, output] = process.argv.slice(2);
    if (mode === "plan") console.log(JSON.stringify(await runtimeImagePlan(), null, 2));
    else if (mode === "build" && output) console.log(JSON.stringify(await buildRuntimeImageArtifact(resolve(output)), null, 2));
    else throw new Error("Usage: bun scripts/runtime-image-artifact.ts plan|build NEW_OUTPUT");
}
