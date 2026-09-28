/** Invoked only by the separately authorized GHCR publication job. */
import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";
import { distributionHash, releaseVersion } from "../packages/cli/src/distribution-manifest";
export function publicationReference(repository: string, record: any) {
    if (!/^ghcr\.io\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(repository) || record.schema_version !== "wringer.runtime-image-artifact.v1" || !releaseVersion(record.version) || !/^[a-f0-9]{40}$/.test(record.commit) || !["x64", "arm64"].includes(record.arch) || record.platform !== (record.arch === "x64" ? "linux/amd64" : "linux/arm64") || !/^sha256:[a-f0-9]{64}$/.test(record.imageId) || !/^[a-f0-9]{64}$/.test(record.archiveSha256) || record.tag !== `wringer-build:${record.version}-${record.arch}-${record.commit}`) throw new Error("Image publication identity is invalid");
    return `${repository}:${record.version}-${record.commit}-${record.arch}`;
}
export function remoteImageIdentity(value: any) {
    if (!value || Array.isArray(value) || !/^sha256:[a-f0-9]{64}$/.test(value.Descriptor?.digest) || !/^sha256:[a-f0-9]{64}$/.test(value.SchemaV2Manifest?.config?.digest)) throw new Error("Registry did not return a single architecture image with a measured digest");
    return { digest: value.Descriptor.digest as string, imageId: value.SchemaV2Manifest.config.digest as string };
}
type CommandResult = Pick<Awaited<ReturnType<typeof runProcess>>, "exit_code" | "stdout" | "stderr" | "timed_out" | "stdout_truncated" | "stderr_truncated">;
export async function publishImageArtifacts(directory: string, repository: string, invoke: (argv: string[], cwd: string) => Promise<CommandResult> = (argv, cwd) => runProcess(argv, { cwd, timeout: 600, maxBytes: 2 * 1024 * 1024 })) {
    const records = [], candidates = [];
    for (const name of (await readdir(directory)).sort()) {
        if (!/^runtime-image-(arm64|x64)$/.test(name)) throw new Error("Unexpected image artifact directory");
        const path = join(directory, name), record = JSON.parse(await readFile(join(path, "IMAGE.json"), "utf8")), ref = publicationReference(repository, record), archive = join(path, "image.tar.gz");
        if ((await stat(archive)).size > 2 * 1024 ** 3 || distributionHash(await readFile(archive)) !== record.archiveSha256) throw new Error("Runtime image archive differs from native build evidence");
        candidates.push({ path, record, ref, archive });
    }
    if (candidates.length !== 2 || new Set(candidates.map(c => c.record.platform)).size !== 2 || new Set(candidates.map(c => `${c.record.version}:${c.record.commit}`)).size !== 1) throw new Error("Both matching native architecture build records are required before publication");
    for (const { path, record, ref, archive } of candidates) {
        async function command(argv: string[]) { return invoke(argv, path); }
        async function inspect() {
            const result = await command(["docker", "manifest", "inspect", "--verbose", ref]);
            if (result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error("Registry observation incomplete");
            if (result.exit_code === 0) return remoteImageIdentity(JSON.parse(result.stdout));
            if (/manifest unknown|no such manifest/i.test(result.stderr) && !/denied|unauthorized|forbidden|timeout/i.test(result.stderr)) return null;
            throw new Error("Registry access is unavailable or uncertain; no publication was attempted");
        }
        let remote = await inspect(), pushed = false;
        if (remote && remote.imageId !== record.imageId) throw new Error("An immutable image reference already names different content; it will not be replaced");
        if (!remote) {
            for (const argv of [["docker", "image", "load", "--input", archive], ["docker", "image", "tag", record.imageId, ref], ["docker", "image", "push", ref]]) {
                const result = await command(argv); if (result.exit_code || result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error("Image publication is unfinished; inspect this exact reference before retrying");
            }
            pushed = true; remote = await inspect(); if (!remote || remote.imageId !== record.imageId) throw new Error("Published image has no matching registry observation");
        }
        const result = { schema_version: "wringer.runtime-image-publication.v1", ref, digest: `${repository}@${remote.digest}`, imageId: record.imageId, archiveSha256: record.archiveSha256, platform: record.platform, commit: record.commit, pushed, modelCalls: 0, containmentClaims: "none; guided runtime readiness remains separately measured" };
        const output = join(path, "PUBLISHED.json");
        let retained: any = null;
        try { retained = JSON.parse(await readFile(output, "utf8")); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
        if (retained) {
            if (retained.schema_version !== result.schema_version || retained.ref !== result.ref || retained.digest !== result.digest || retained.imageId !== result.imageId || retained.archiveSha256 !== result.archiveSha256 || retained.commit !== result.commit || retained.platform !== result.platform) throw new Error("Retained image publication receipt changed");
            records.push(retained);
        } else { await writeFile(output, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); records.push(result); }
    }
    if (records.length !== 2 || new Set(records.map(record => record.platform)).size !== 2 || new Set(records.map(record => record.commit)).size !== 1) throw new Error("Both native architecture build records are required");
    return records;
}
if (import.meta.main) {
    if (!process.argv[2] || !process.env.REGISTRY_REPOSITORY) throw new Error("Use the selected artifact directory and explicit REGISTRY_REPOSITORY inside the authorized publication job");
    console.log(JSON.stringify(await publishImageArtifacts(resolve(process.argv[2]), process.env.REGISTRY_REPOSITORY.toLowerCase()), null, 2));
}
