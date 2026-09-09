import { lstat } from "node:fs/promises";
import { hashValue, type ExecutionPlan } from "@wringer/plan";
import { processDriver, type CapturedImageArtifact } from "@wringer/runtime";
import { parseDesignSnapshot, inspectPng, assertRepositoryDisclosure, type DesignSnapshot } from "@wringer/design";

export interface ContainedDisplayVisuals { snapshotSha256: string; referenceAssets: CapturedImageArtifact[]; captures: CapturedImageArtifact[]; }
/** Read immutable source objects only: no checkout, shell, hooks or repository DSL. */
export async function readPinnedDesignSnapshot(plan: ExecutionPlan, objectStore: string): Promise<DesignSnapshot | null> {
    if (!plan.design) return null;
    const info = typeof objectStore === "string" ? await lstat(objectStore) : null;
    if (!info?.isDirectory() || info.isSymbolicLink()) throw new Error("Visual evidence needs the controller's pinned source object store");
    const git = async (args: string[]) => {
        const result = await processDriver.command(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "--git-dir", objectStore, ...args], { env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 30000 });
        if (result.code !== 0) throw new Error("Pinned design snapshot does not resolve from the approved source");
        return result.stdout;
    };
    const rows = (await git(["--literal-pathspecs", "ls-tree", "-z", plan.repository.commit, "--", plan.design.snapshotPath])).split("\0").filter(Boolean);
    if (rows.length !== 1 || !/^100(?:644|755) blob [a-f0-9]{40,64}\t/.test(rows[0]!) || rows[0]!.slice(rows[0]!.indexOf("\t") + 1) !== plan.design.snapshotPath) throw new Error("Design snapshot must be one pinned regular Git blob, never a symlink");
    const blob = rows[0]!.split(" ")[2]!.split("\t")[0]!, size = Number((await git(["cat-file", "-s", blob])).trim());
    if (!Number.isInteger(size) || size < 1 || size > 16 * 1024 * 1024) throw new Error("Pinned design snapshot exceeds its bounded record limit");
    const snapshot = parseDesignSnapshot(await git(["cat-file", "blob", blob]));
    if (snapshot.snapshot_sha256 !== plan.design.snapshotSha256) throw new Error("Pinned design snapshot differs from the approved digest");
    assertRepositoryDisclosure(snapshot);
    return snapshot;
}
export function referenceImages(plan: ExecutionPlan, criterionId: string, snapshot: DesignSnapshot): CapturedImageArtifact[] {
    const review = plan.design?.reviews.find(row => row.criterionId === criterionId);
    if (!review || snapshot.snapshot_sha256 !== plan.design?.snapshotSha256) throw new Error("Visual review has no matching approved design snapshot");
    return review.referenceIds.map(id => {
        const asset = snapshot.assets.find(row => row.id === id);
        if (!asset) throw new Error(`Design reference ${id} is absent from the pinned snapshot`);
        return { id, path: plan.design!.snapshotPath, mimeType: "image/png", base64: asset.base64, ...inspectPng(asset.base64) };
    });
}
function imageRecord(value: any): CapturedImageArtifact {
    if (!value || Object.keys(value).sort().join(",") !== "base64,bytes,height,id,mimeType,path,sha256,width" || value.mimeType !== "image/png" || typeof value.path !== "string" || typeof value.id !== "string") throw new Error("Visual evidence is not an exact PNG image record");
    const measured = inspectPng(value.base64);
    if (["sha256", "bytes", "width", "height"].some(key => value[key] !== measured[key as keyof typeof measured])) throw new Error("Visual image metadata differs from the actual PNG bytes");
    return value;
}
/** Version and plan binding is checked even when no snapshot is supplied. Callers
 * accepting a decision/publication also compare against the exact source blob. */
export function assertContainedDisplayVisuals(receipt: any, plan: ExecutionPlan, snapshot?: DesignSnapshot | null): void {
    const review = plan.design?.reviews.find(row => row.criterionId === receipt.criterionId);
    if (!review) {
        if (receipt.schema_version !== "wringer.contained-display.v1" || receipt.visuals !== undefined || receipt.measured?.artifacts !== undefined) throw new Error("Undeclared visual evidence or display version");
        return;
    }
    const visuals = receipt.visuals;
    if (receipt.schema_version !== "wringer.contained-display.v2" || !visuals || Object.keys(visuals).sort().join(",") !== "captures,referenceAssets,snapshotSha256" || visuals.snapshotSha256 !== plan.design!.snapshotSha256 || !Array.isArray(visuals.referenceAssets) || !Array.isArray(visuals.captures)) throw new Error("Visual display is missing its approved design and image evidence");
    if (hashValue(visuals.referenceAssets.map((row: any) => row.id)) !== hashValue(review.referenceIds) || hashValue(visuals.captures.map((row: any) => ({ id: row.id, path: row.path, mimeType: row.mimeType, width: row.width, height: row.height }))) !== hashValue(review.captures)) throw new Error("Visual display omitted, replaced or reordered a declared image");
    let bytes = 0;
    for (const image of [...visuals.referenceAssets, ...visuals.captures]) { bytes += imageRecord(image).bytes; if (bytes > 16 * 1024 * 1024) throw new Error("Visual display exceeds the aggregate image limit"); }
    if (visuals.referenceAssets.some((row: any) => row.path !== plan.design!.snapshotPath) || hashValue(receipt.measured?.artifacts) !== hashValue(visuals.captures)) throw new Error("Visual display differs from its contained runtime exports");
    if (snapshot && hashValue(visuals.referenceAssets) !== hashValue(referenceImages(plan, receipt.criterionId, snapshot))) throw new Error("Visual references differ from the exact pinned source snapshot");
}
