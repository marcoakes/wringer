import { expect, test } from "bun:test";
import type { ExecutionPlan } from "@wringer/plan";
import { createDesignSnapshot, inspectPng } from "@wringer/design";
import { assertContainedDisplayVisuals, referenceImages } from "../src/display-visuals";
import { unitPng } from "../../runtime/test/fixtures/png";

function fixture() {
    const snapshot = createDesignSnapshot({ title: "Parser unit reference", context: "One reference pixel", disclosure: "repository-permitted", assets: [{ id: "reference", title: "Unit pixel, not a screenshot", pngBase64: unitPng() }] });
    // The full execution-plan validator is tested separately; this is the pure
    // image/declaration comparison called by controller, workflow and audit.
    const plan = { design: { snapshotPath: "design.json", snapshotSha256: snapshot.snapshot_sha256, reviews: [{ criterionId: "look", referenceIds: ["reference"], captures: [{ id: "desktop", path: "outputs/desktop.png", mimeType: "image/png", width: 1, height: 1 }] }] } } as ExecutionPlan;
    const base64 = unitPng(21), captures = [{ id: "desktop", path: "outputs/desktop.png", mimeType: "image/png", base64, ...inspectPng(base64) }];
    const receipt: any = { schema_version: "wringer.contained-display.v2", criterionId: "look", measured: { artifacts: captures }, visuals: { snapshotSha256: snapshot.snapshot_sha256, referenceAssets: referenceImages(plan, "look", snapshot), captures } };
    return { snapshot, plan, receipt };
}
test("exact reference/capture PNG records agree with approved declarations and runtime exports", () => {
    const { snapshot, plan, receipt } = fixture();
    expect(() => assertContainedDisplayVisuals(receipt, plan, snapshot)).not.toThrow();
    expect(receipt.visuals.referenceAssets[0].sha256).not.toBe(receipt.visuals.captures[0].sha256);
});
test("missing, fabricated, mismatched or undeclared visual data never becomes a display", () => {
    const mutations: ((receipt: any) => void)[] = [
        row => { row.schema_version = "wringer.contained-display.v1"; },
        row => { delete row.visuals; },
        row => { row.visuals.snapshotSha256 = "f".repeat(64); },
        row => { row.visuals.referenceAssets = []; },
        row => { row.visuals.captures = []; },
        row => { row.visuals.captures[0].width = 2; },
        row => { row.visuals.captures[0].bytes++; },
        row => { row.visuals.captures[0].sha256 = "a".repeat(64); },
        row => { row.visuals.captures[0].base64 = Buffer.from("<svg>not a PNG</svg>").toString("base64"); },
        row => { row.visuals.captures[0].path = "private/key.png"; },
        row => { row.visuals.captures[0].extraAuthority = true; },
        row => { row.measured.artifacts = []; },
        row => { row.visuals.referenceAssets[0].path = "other-design.json"; },
        row => { row.visuals.referenceAssets[0] = { ...row.visuals.referenceAssets[0], base64: unitPng(90), ...inspectPng(unitPng(90)) }; },
    ];
    for (const mutate of mutations) { const { snapshot, plan, receipt } = fixture(); mutate(receipt); expect(() => assertContainedDisplayVisuals(receipt, plan, snapshot)).toThrow(); }
});
test("legacy displays remain valid only without undeclared image authority", () => {
    const plan = {} as ExecutionPlan, receipt: any = { schema_version: "wringer.contained-display.v1", criterionId: "text", measured: {} };
    expect(() => assertContainedDisplayVisuals(receipt, plan)).not.toThrow();
    receipt.visuals = {}; expect(() => assertContainedDisplayVisuals(receipt, plan)).toThrow("Undeclared");
    delete receipt.visuals; receipt.measured.artifacts = []; expect(() => assertContainedDisplayVisuals(receipt, plan)).toThrow("Undeclared");
});
test("a design cannot silently omit an approved reference asset", () => {
    const { snapshot, plan } = fixture(); plan.design!.reviews[0]!.referenceIds = ["not-in-snapshot"];
    expect(() => referenceImages(plan, "look", snapshot)).toThrow("absent");
});
