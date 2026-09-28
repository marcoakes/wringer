import { test, expect } from "bun:test";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashValue } from "@wringer/plan";
import { readAssistantRecord, writeAssistantRecord } from "../src/assistant-store";

const lineage = () => ({ schema_version: "wringer.proposal-lineage.v1", jobId: crypto.randomUUID(), parentJobId: crypto.randomUUID(), rootJobId: crypto.randomUUID(), parentRevision: "a".repeat(64), proposalIdentity: "b".repeat(64) });
test("new durable records refuse malformed writes before allocating files", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-record-shape-")));
    await expect(writeAssistantRecord(root, "invalid.json", { ...lineage(), authority: "approved" })).rejects.toThrow("record shape");
    expect(await Bun.file(join(root, "invalid.json")).exists()).toBe(false);
    await expect(writeAssistantRecord(root, "invalid-id.json", { ...lineage(), jobId: "../other" })).rejects.toThrow("record shape");
});
test("valid content hash does not bless a malformed retained record", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-record-read-"))), value = lineage();
    await writeAssistantRecord(root, "lineage.json", value);
    expect(await readAssistantRecord<typeof value>(root, "lineage.json")).toEqual(value);
    const changed = { ...value, parentRevision: "not-a-digest" };
    await writeFile(join(root, "lineage.json"), JSON.stringify({ ...changed, sha256: hashValue(changed) }));
    await expect(readAssistantRecord(root, "lineage.json")).rejects.toThrow("record shape");
});
test("legacy record envelope semantics remain unchanged", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-record-legacy-")));
    const value = { schema_version: "wringer.assistant-cancellation.v1", jobId: crypto.randomUUID(), requestId: crypto.randomUUID(), requestedAtRevision: "a".repeat(64) };
    await writeAssistantRecord(root, "legacy.json", value);
    expect(await readAssistantRecord<typeof value>(root, "legacy.json")).toEqual(value);
    expect(JSON.parse(await readFile(join(root, "legacy.json"), "utf8")).sha256).toBe(hashValue(value));
});
