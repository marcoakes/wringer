import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { compileExecutionPlan, hashValue } from "@wringer/plan";
import { createDesignSnapshot, inspectPng } from "@wringer/design";
import { referenceImages } from "@wringer/workflow";
import { parsePmDesignAssetRequest, projectDesignDisplay, validatedPmDesignAssetBytes } from "../src/design-assets";
import type { PmJob } from "@wringer/board";

const profile = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const jobId = "11111111-1111-4111-8111-111111111111", displayId = "22222222-2222-4222-8222-222222222222";
function png(red = 255) {
    const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type: string, data = Buffer.alloc(0)) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b; };
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,red,0,0,255]))), chunk("IEND")]).toString("base64");
}
function fixture() {
    const plan = structuredClone(profile), base64 = png(), snapshot = createDesignSnapshot({ title: "Owned test reference", disclosure: "repository-permitted", context: "Match the approved reference", assets: [{ id: "reference", title: "Reference", pngBase64: base64 }] });
    plan.design = { snapshotPath: "design/reference.json", snapshotSha256: snapshot.snapshot_sha256, reviews: [{ criterionId: "visual", referenceIds: ["reference"], captures: [{ id: "desktop", path: "capture/desktop.png", mimeType: "image/png", width: 1, height: 1 }] }] };
    const capture = { ...plan.design.reviews[0]!.captures[0]!, ...inspectPng(base64), base64 };
    const body = { schema_version: "wringer.contained-display.v2", id: displayId, criterionId: "visual", candidateTree: "c".repeat(40), acceptanceSha256: plan.acceptance_sha256, success: true, measured: { sourceTree: "c".repeat(40), sourceChanged: false, artifacts: [capture] }, visuals: { snapshotSha256: snapshot.snapshot_sha256, referenceAssets: referenceImages(plan, "visual", snapshot), captures: [capture] } };
    const receipt = { ...body, sha256: hashValue(body) };
    const job = { jobId, candidateTree: receipt.candidateTree, displays: [{ criterionId: "visual", displayId, candidateTree: receipt.candidateTree, success: true, visuals: projectDesignDisplay(receipt, plan) }] } as PmJob;
    return { plan, receipt, snapshot, job, base64, request: { displayId, kind: "capture" as const, assetId: "desktop" } };
}

test("asset request only accepts one exact scoped identity, never paths, URLs, duplicate selectors or capabilities", () => {
    const route = `http://127.0.0.1/api/job/asset?jobId=${jobId}&displayId=${displayId}&kind=capture&assetId=desktop`;
    expect(parsePmDesignAssetRequest(new URL(route))).toEqual({ jobId, displayId, kind: "capture", assetId: "desktop" });
    for (const value of [route + "&path=/etc/passwd", route + "&url=https://remote.invalid/image.png", route + "&token=secret", route + "&assetId=second", route.replace(displayId, "../../other"), route.replace("kind=capture", "kind=html"), route.replace("assetId=desktop", "assetId=")]) expect(() => parsePmDesignAssetRequest(new URL(value))).toThrow();
});

test("visual projection carries image identities and dimensions without encoded pixels or storage paths", () => {
    const f = fixture(), projection = projectDesignDisplay(f.receipt, f.plan)!;
    expect(projection.captures[0]).toEqual({ id: "desktop", title: "desktop", sha256: inspectPng(f.base64).sha256, bytes: Buffer.from(f.base64, "base64").length, width: 1, height: 1 });
    expect(JSON.stringify(projection)).not.toContain(f.base64); expect(JSON.stringify(projection)).not.toContain("capture/desktop.png");
    expect(projectDesignDisplay({ schema_version: "wringer.contained-display.v1", criterionId: "text" }, f.plan)).toBeUndefined();
    for (const mutate of [(v: any) => v.sha256 = "0".repeat(64), (v: any) => v.acceptanceSha256 = "0".repeat(64), (v: any) => v.visuals.captures[0].base64 = png(0)]) { const changed = structuredClone(f.receipt); mutate(changed); expect(() => projectDesignDisplay(changed, f.plan)).toThrow(); }
});

test("image bytes require intact current receipt, exact declared asset and original pinned reference", () => {
    const f = fixture();
    expect(Buffer.from(validatedPmDesignAssetBytes(f.job, f.request, f.receipt, f.plan, f.snapshot)).toString("base64")).toBe(f.base64);
    expect(Buffer.from(validatedPmDesignAssetBytes(f.job, { displayId, kind: "reference", assetId: "reference" }, f.receipt, f.plan, f.snapshot)).toString("base64")).toBe(f.base64);
    for (const mutate of [
        (f: ReturnType<typeof fixture>) => f.job.candidateTree = "e".repeat(40),
        (f: ReturnType<typeof fixture>) => f.job.displays[0]!.success = false,
        (f: ReturnType<typeof fixture>) => f.request.assetId = "../../private",
        (f: ReturnType<typeof fixture>) => f.request.displayId = "33333333-3333-4333-8333-333333333333",
        (f: ReturnType<typeof fixture>) => f.receipt.measured.sourceChanged = true,
        (f: ReturnType<typeof fixture>) => f.receipt.visuals.captures[0]!.path = "/etc/passwd",
        (f: ReturnType<typeof fixture>) => f.snapshot.assets[0]!.base64 = png(0),
    ]) { const changed = fixture(); mutate(changed); expect(() => validatedPmDesignAssetBytes(changed.job, changed.request, changed.receipt, changed.plan, changed.snapshot)).toThrow(); }
});
