import { test, expect } from "bun:test";
import { createHash } from "node:crypto";
import { renderContainedBoard, renderContainedCertificate, renderContainedDocuments, type ContainedDeliveryProjection } from "../src/projection";
import { legacyContainedDocumentsV1 } from "../src/contained";
const root = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
test("published view renderers retain exact historical bytes; new wording needs a new contract", async () => {
    const view: ContainedDeliveryProjection = await Bun.file(`${root}/schema/fixtures/contained-delivery-view-v1.json`).json(), reason = "Frozen fixture falsification reason.";
    const manifest = { id: view.deliveryId, source: view.source, counts: view.counts, auditCommand: view.auditCommand, falsify: { command: view.falsifyCommand, reason } };
    const human = view.criteria.filter(c => c.kind === "human").map(c => ({ judgement: { criterionId: c.id, note: c.note, by: c.by } }));
    const texts = { board: renderContainedBoard(view), certificate: JSON.stringify(renderContainedCertificate(view)), ...renderContainedDocuments(view, reason), ...Object.fromEntries(Object.entries(legacyContainedDocumentsV1({ name: view.name } as any, manifest, human)).map(([k, value]) => [`legacy-${k}`, value])) };
    const hashes = Object.fromEntries(Object.entries(texts).map(([k, value]) => [k, createHash("sha256").update(value).digest("hex")]));
    expect(hashes).toEqual(await Bun.file(`${root}/schema/fixtures/contained-renderers-golden.json`).json());
});
test("immutable HTML cannot execute a requirement title or person's note", async () => {
    const view: ContainedDeliveryProjection = await Bun.file(`${root}/schema/fixtures/contained-delivery-view-v1.json`).json();
    view.name = "<script>alert(1)</script>"; view.criteria[0]!.note = '<img src=x onerror="alert(1)">';
    const html = renderContainedBoard(view);
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("default-src 'none'");
});
