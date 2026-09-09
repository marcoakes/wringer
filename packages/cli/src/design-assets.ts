import { join } from "node:path";
import { hashValue, type ExecutionPlan } from "@wringer/plan";
import { assertContainedDisplayVisuals, readPinnedDesignSnapshot } from "@wringer/workflow";
import type { PmJob, PmVisualAsset } from "@wringer/board";
import type { DesignSnapshot } from "@wringer/design";
import { readController, readControllerFile } from "../../application/src/controller";

export function projectDesignDisplay(receipt: any, plan: ExecutionPlan): PmJob["displays"][number]["visuals"] {
    const review = plan.design?.reviews.find(row => row.criterionId === receipt.criterionId);
    if (!review && receipt.schema_version === "wringer.contained-display.v1") return undefined;
    const { sha256, ...body } = receipt;
    if (sha256 !== hashValue(body) || receipt.acceptanceSha256 !== plan.acceptance_sha256) throw new Error("The visual display receipt changed or belongs to a different approval.");
    if (receipt.success !== true) return undefined;
    assertContainedDisplayVisuals(receipt, plan);
    const image = (asset: any): PmVisualAsset => ({ id: asset.id, title: asset.id.replaceAll(/[-_]/g, " "), sha256: asset.sha256, bytes: asset.bytes, width: asset.width, height: asset.height });
    return { snapshotSha256: receipt.visuals.snapshotSha256, referenceAssets: receipt.visuals.referenceAssets.map(image), captures: receipt.visuals.captures.map(image) };
}

export interface PmDesignAssetRequest { displayId: string; kind: "reference" | "capture"; assetId: string; }
export function parsePmDesignAssetRequest(url: URL): PmDesignAssetRequest & { jobId: string } {
    const fields = ["jobId", "displayId", "kind", "assetId"], keys = [...url.searchParams.keys()];
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    const jobId = url.searchParams.get("jobId") ?? "", displayId = url.searchParams.get("displayId") ?? "", kind = url.searchParams.get("kind"), assetId = url.searchParams.get("assetId") ?? "";
    if (keys.length !== fields.length || fields.some(key => url.searchParams.getAll(key).length !== 1) || keys.some(key => !fields.includes(key)) || !uuid.test(jobId) || !uuid.test(displayId) || !["reference", "capture"].includes(kind ?? "") || !assetId || assetId.length > 200) throw new Error("Select one recorded image from this job. Image paths and remote URLs are not accepted.");
    return { jobId, displayId, kind: kind as "reference" | "capture", assetId };
}

/** Only PNG bytes already bound to the current controller receipt are served.
 * No request field is ever interpreted as a filename or remote URL. */
export async function readPmDesignAsset(state: string, job: PmJob, request: PmDesignAssetRequest): Promise<Uint8Array> {
    const display = job.displays.find(row => row.displayId === request.displayId);
    if (!job.candidateTree || !display?.success || display.candidateTree !== job.candidateTree || !display.visuals) throw new Error("This image is not part of the current successfully displayed result.");
    const projected = (request.kind === "reference" ? display.visuals.referenceAssets : display.visuals.captures).find(asset => asset.id === request.assetId);
    if (!projected) throw new Error("This image was not declared for this display.");
    const history = await readController(state, false, true);
    if (history.events.at(-1)?.sha256 !== job.revision || history.result.candidate?.tree !== job.candidateTree) throw new Error("The source advanced before the image could be read.");
    const receipt = await readControllerFile(join(state, "displays", `${request.displayId}.json`));
    const snapshot = await readPinnedDesignSnapshot(history.plan, (history.state.source as any)?.objectStore);
    if (!snapshot) throw new Error("The pinned design reference is unavailable.");
    return validatedPmDesignAssetBytes(job, request, receipt, history.plan, snapshot);
}

/** Shared by the HTTP reader and adversarial byte-binding probes. */
export function validatedPmDesignAssetBytes(job: PmJob, request: PmDesignAssetRequest, receipt: any, plan: ExecutionPlan, snapshot: DesignSnapshot): Uint8Array {
    const display = job.displays.find(row => row.displayId === request.displayId);
    if (!job.candidateTree || !display?.success || display.candidateTree !== job.candidateTree || !display.visuals || !["reference", "capture"].includes(request.kind)) throw new Error("This image is not part of the current successfully displayed result.");
    const projected = (request.kind === "reference" ? display.visuals.referenceAssets : display.visuals.captures).find(asset => asset.id === request.assetId);
    if (!projected || receipt.id !== display.displayId || receipt.criterionId !== display.criterionId || receipt.candidateTree !== job.candidateTree || receipt.measured?.sourceChanged !== false || receipt.measured?.sourceTree !== job.candidateTree || hashValue(projectDesignDisplay(receipt, plan)) !== hashValue(display.visuals)) throw new Error("The retained image does not match the displayed source and receipt.");
    assertContainedDisplayVisuals(receipt, plan, snapshot);
    const asset = (request.kind === "reference" ? receipt.visuals.referenceAssets : receipt.visuals.captures).find((row: any) => row.id === request.assetId);
    return new Uint8Array(Buffer.from(asset.base64, "base64"));
}
