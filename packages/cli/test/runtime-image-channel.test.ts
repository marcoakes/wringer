import { expect, test } from "bun:test";
import { runtimeImagePlan } from "../../../scripts/runtime-image-artifact";
import { publicationReference, remoteImageIdentity } from "../../../scripts/runtime-image-publish";
test("native image plans use pinned isolated context inputs and never qualify emulation or host workers", async () => {
    for (const arch of ["arm64", "x64"] as const) {
        const plan = await runtimeImagePlan("linux", arch); expect(plan.modelCalls).toBe(0); expect(plan.files).toHaveLength(9);
        expect(plan.files.every(file => file.path.startsWith("runtime/") && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
        expect(plan.bases.node).toMatch(/@sha256:[a-f0-9]{64}$/); expect(plan.containmentClaims).toContain("none");
    }
    await expect(runtimeImagePlan("darwin", "arm64")).rejects.toThrow("native Linux");
    await expect(runtimeImagePlan("linux", "ia32")).rejects.toThrow("native Linux");
});
test("image publication references bind version, source, architecture and immutable image identity", () => {
    const record = { schema_version: "wringer.runtime-image-artifact.v1", version: "1.0.0-test.1", arch: "arm64", platform: "linux/arm64", commit: "a".repeat(40), imageId: "sha256:" + "b".repeat(64), archiveSha256: "c".repeat(64), tag: `wringer-build:1.0.0-test.1-arm64-${"a".repeat(40)}` };
    expect(publicationReference("ghcr.io/example/runtime", record)).toBe(`ghcr.io/example/runtime:1.0.0-test.1-${record.commit}-arm64`);
    expect(() => publicationReference("ghcr.io/example/runtime", { ...record, platform: "linux/amd64" })).toThrow("identity");
    expect(() => publicationReference("other.example/runtime", record)).toThrow("identity");
    const observed = { Descriptor: { digest: "sha256:" + "d".repeat(64) }, SchemaV2Manifest: { config: { digest: record.imageId } } };
    expect(remoteImageIdentity(observed).imageId).toBe(record.imageId);
    expect(() => remoteImageIdentity({ manifests: [] })).toThrow("single architecture");
});

import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishImageArtifacts } from "../../../scripts/runtime-image-publish";
import { distributionHash } from "../src/distribution-manifest";
async function imageFixture(arches = ["arm64", "x64"]) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-image-channel-")));
    for (const arch of arches) {
        const directory = join(root, "runtime-image-" + arch), bytes = Buffer.from("synthetic image artifact; never passed to Docker"); await mkdir(directory);
        const record = { schema_version: "wringer.runtime-image-artifact.v1", version: "1.0.0-test.1", arch, platform: arch === "x64" ? "linux/amd64" : "linux/arm64", commit: "a".repeat(40), imageId: "sha256:" + (arch === "x64" ? "b" : "c").repeat(64), archiveSha256: distributionHash(bytes), tag: `wringer-build:1.0.0-test.1-${arch}-${"a".repeat(40)}` };
        await writeFile(join(directory, "IMAGE.json"), JSON.stringify(record)); await writeFile(join(directory, "image.tar.gz"), bytes);
    }
    return root;
}
const response = (stdout: string, code = 0, stderr = "") => ({ exit_code: code, stdout, stderr, timed_out: false, stdout_truncated: false, stderr_truncated: false });
test("all native image inputs must pass before any registry or Docker effect", async () => {
    const root = await imageFixture(["arm64"]); let commands = 0;
    await expect(publishImageArtifacts(root, "ghcr.io/example/runtime", async () => { commands++; return response("", 2, "synthetic command must not run"); })).rejects.toThrow();
    expect(commands).toBe(0);
});
test("exact already-published image retry is read-only and different content refuses", async () => {
    const root = await imageFixture(); let writes = 0;
    const inspect = async (argv: string[], cwd: string) => {
        if (argv[1] !== "manifest") { writes++; throw new Error("Unexpected registry write"); }
        const record = JSON.parse(await readFile(join(cwd, "IMAGE.json"), "utf8"));
        return response(JSON.stringify({ Descriptor: { digest: "sha256:" + "d".repeat(64) }, SchemaV2Manifest: { config: { digest: record.imageId } } }));
    };
    const first = await publishImageArtifacts(root, "ghcr.io/example/runtime", inspect); expect(first.every(row => row.pushed === false)).toBe(true);
    const again = await publishImageArtifacts(root, "ghcr.io/example/runtime", inspect); expect(again).toEqual(first); expect(writes).toBe(0);
    await expect(publishImageArtifacts(await imageFixture(), "ghcr.io/example/runtime", async () => response(JSON.stringify({ Descriptor: { digest: "sha256:" + "d".repeat(64) }, SchemaV2Manifest: { config: { digest: "sha256:" + "e".repeat(64) } } })))).rejects.toThrow("different content");
});
