import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashBytes } from "@wringer/plan";
import { inspectBundle } from "../../../examples/evidence/read-bundle.mjs";
const roots: string[] = [];
test("native reader asset remains byte-identical to the independent source", async () => {
    expect(await readFile(new URL("../../../integrations/bundle-reader.txt", import.meta.url), "utf8")).toBe(await readFile(new URL("../../../examples/evidence/read-bundle.mjs", import.meta.url), "utf8"));
});
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "wringer-independent-reader-")); roots.push(root);
    const output = join(root, "export"), payload = join(output, "evidence"); await mkdir(payload, { recursive: true });
    const manifest = { schema_version: "wringer.contained-delivery.v4", id: "synthetic-integrity-only", source: { codeCommit: "a".repeat(40), tree: "b".repeat(40) } };
    const contents: Record<string, string> = { "manifest.json": JSON.stringify(manifest), "summary.md": "Synthetic byte-integrity fixture. This is not a semantically valid delivery.", "engineering.json": JSON.stringify({ loopDecisions: [] }) };
    const seal = { schema_version: "wringer.digests.v1", algorithm: "sha256", files: Object.fromEntries(Object.entries(contents).map(([name, value]) => [name, hashBytes(value)])) };
    for (const [name, value] of Object.entries(contents)) await writeFile(join(payload, name), value);
    await writeFile(join(payload, "digests.json"), JSON.stringify(seal));
    const envelope = { "read-bundle.mjs": "Fixture bytes only; never executed.", "schema.json": "{}", "summary.md": contents["summary.md"]! };
    for (const [name, value] of Object.entries(envelope)) await writeFile(join(output, name), value);
    const index = { schema_version: "wringer.bundle-index.v1", payload: "evidence", bundleFamily: manifest.schema_version, deliveryId: manifest.id, source: { commit: manifest.source.codeCommit, tree: manifest.source.tree }, digestsSha256: hashBytes(JSON.stringify(seal)), manifestSha256: hashBytes(contents["manifest.json"]!), files: Object.fromEntries(Object.entries(envelope).map(([name, value]) => [name, hashBytes(value)])) };
    const save = () => writeFile(join(output, "bundle.json"), JSON.stringify(index)); await save();
    return { root, output, payload, index, seal, save };
}
test("independent reader checks byte integrity without inventing semantic acceptance", async () => {
    const f = await fixture(), value = await inspectBundle(f.output);
    expect(value.integrity).toBe("passed"); expect(value.semanticAudit).toBe("not-run");
    expect(value.source.commit).toBe("a".repeat(40)); expect(value.decisions).toEqual([]);
});
test("independent reader refuses source substitution, changed seals, unknown payloads and envelope tampering", async () => {
    for (const alter of [
        (f: Awaited<ReturnType<typeof fixture>>) => { f.index.source.commit = "c".repeat(40); },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.index.digestsSha256 = "c".repeat(64); },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.index.payload = "../outside"; },
        (f: Awaited<ReturnType<typeof fixture>>) => { f.index.bundleFamily = "wringer.unknown.v1"; },
        (f: Awaited<ReturnType<typeof fixture>>) => { delete (f.index.files as any)["summary.md"]; },
    ]) { const f = await fixture(); alter(f); await f.save(); await expect(inspectBundle(f.output)).rejects.toThrow(); }
    for (const name of ["summary.md", "read-bundle.mjs", "schema.json", "evidence/summary.md"]) {
        const f = await fixture(); await writeFile(join(f.output, name), "changed"); await expect(inspectBundle(f.output)).rejects.toThrow();
    }
});
test("independent reader rejects unlisted files and symlink transport instead of following them", async () => {
    for (const extra of ["evidence/unlisted.txt", "unlisted.txt"]) {
        const f = await fixture(); await writeFile(join(f.output, extra), "unlisted"); await expect(inspectBundle(f.output)).rejects.toThrow("inventory");
    }
    const f = await fixture(), link = join(f.root, "alias"); await symlink(f.output, link);
    await expect(inspectBundle(link)).rejects.toThrow("Symlink");
    const content = await readFile(join(f.payload, "summary.md"));
    await writeFile(join(f.root, "outside"), content); await rm(join(f.payload, "summary.md"));
    await symlink(join(f.root, "outside"), join(f.payload, "summary.md"));
    await expect(inspectBundle(f.output)).rejects.toThrow("Symlink");
});
test("independent reader refuses nonportable filenames even under a matching seal", async () => {
    const f = await fixture(), name = "outside\\private";
    await writeFile(join(f.payload, name), "unknown"); f.seal.files[name] = hashBytes("unknown");
    const bytes = JSON.stringify(f.seal); await writeFile(join(f.payload, "digests.json"), bytes); f.index.digestsSha256 = hashBytes(bytes); await f.save();
    await expect(inspectBundle(f.output)).rejects.toThrow("Unsafe evidence path");
});
