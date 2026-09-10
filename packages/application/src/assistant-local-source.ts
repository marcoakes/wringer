import { constants } from "node:fs";
import { link, mkdir, mkdtemp, open, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hashBytes, hashValue, type ExecutionPlan } from "@wringer/plan";
import { LOCAL_SOURCE_URL, inspectLocalSourceBundle } from "@wringer/runtime";
import { assistantExists, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";

/** Written beside a profile by `prepare --local`; kept privately by `init`. */
export interface LocalSourceRecord {
    schema_version: "wringer.local-source.v1";
    planSha256: string;
    url: string;
    commit: string;
    rootCommit: string;
    bundleSha256: string;
    bundleBytes: number;
}
export const LOCAL_SOURCE_MISSING = "This profile names a local-only source; its prepared bundle was not found beside the profile. Repeat prepare --local, or select a hosted source with --source-url.";
const BUNDLE_LIMIT = 64 * 1024 * 1024, fields = ["bundleBytes", "bundleSha256", "commit", "planSha256", "rootCommit", "schema_version", "url"];
export const isLocalSource = (plan: Pick<ExecutionPlan, "repository">) => LOCAL_SOURCE_URL.test(plan.repository.url);
export const localSourceSiblings = (profilePath: string) => ({ record: `${profilePath}.source.json`, bundle: `${profilePath}.source.bundle` });
const kept = (plan: ExecutionPlan) => `local-source/${plan.plan_sha256}`;
const refuse = (why: string) => new Error(`The prepared local source beside this profile ${why}. Nothing was initialised; repeat prepare --local.`);

/** Null when absent; never follows a symlink or reads past its bound. */
async function bounded(path: string, limit: number): Promise<Buffer | null> {
    let file;
    try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (error: any) { if (error.code === "ENOENT") return null; throw refuse("is not a regular file"); }
    try {
        const info = await file.stat();
        if (!info.isFile() || info.size > limit) throw refuse("is not a bounded regular file");
        const bytes = Buffer.alloc(info.size + 1); let offset = 0;
        while (offset < bytes.length) { const next = await file.read(bytes, offset, bytes.length - offset, null); if (!next.bytesRead) break; offset += next.bytesRead; }
        if (offset !== info.size) throw refuse("changed while it was read");
        return bytes.subarray(0, offset);
    } finally { await file.close(); }
}

/** Checks the prepared pair against this exact profile and returns the bytes it
 * checked, so what init keeps is what was verified, not a second read. */
export async function verifyLocalSource(plan: ExecutionPlan, siblings: { record: string; bundle: string }): Promise<{ record: LocalSourceRecord; bundle: Buffer }> {
    if (!isLocalSource(plan)) throw new Error("A hosted profile has no local source to verify.");
    const raw = await bounded(siblings.record, 64 * 1024), bundle = await bounded(siblings.bundle, BUNDLE_LIMIT);
    if (!raw || !bundle) throw new Error(LOCAL_SOURCE_MISSING);
    let record: LocalSourceRecord;
    try { record = JSON.parse(raw.toString("utf8")); } catch { throw refuse("has an unreadable record"); }
    if (!record || typeof record !== "object" || Array.isArray(record) || Object.keys(record).sort().join() !== fields.join() || record.schema_version !== "wringer.local-source.v1") throw refuse("has an unreadable record");
    if (record.planSha256 !== plan.plan_sha256 || record.url !== plan.repository.url || record.commit !== plan.repository.commit || `local://${record.rootCommit}` !== plan.repository.url) throw refuse("was prepared for a different profile");
    if (record.bundleBytes !== bundle.length || record.bundleSha256 !== hashBytes(bundle)) throw refuse("changed after preparation: its bundle no longer matches the SHA-256 its record names");
    const scratch = await mkdtemp(join(tmpdir(), "wringer-local-source-check-"));
    try {
        const copy = join(scratch, "source.bundle");
        await writeFile(copy, bundle, { flag: "wx", mode: 0o600 });
        const held = await inspectLocalSourceBundle(copy).catch(() => { throw refuse("is not a readable Git bundle"); });
        if (held.head !== record.commit) throw refuse("does not hold the profile's commit; it was bundled from another state of the checkout");
        if (held.roots.length !== 1 || held.roots[0] !== record.rootCommit) throw refuse("does not have the single root commit the profile names");
    } finally { await rm(scratch, { recursive: true, force: true }); }
    return { record, bundle };
}

/** Init only: the verified bytes enter private controller storage once. */
export async function keepLocalSource(root: string, plan: ExecutionPlan, verified: { record: LocalSourceRecord; bundle: Buffer }) {
    const name = `${kept(plan)}/source.bundle`, path = await assistantPath(root, name);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${crypto.randomUUID()}.pending`, file = await open(temp, "wx", 0o600);
    try { await file.writeFile(verified.bundle); await file.sync(); } finally { await file.close(); }
    try {
        try { await link(temp, path); }
        catch (error: any) { if (error.code !== "EEXIST") throw error; const existing = await bounded(path, BUNDLE_LIMIT); if (!existing || hashBytes(existing) !== verified.record.bundleSha256) throw new Error("This controller already keeps different local source bytes for this profile. They were not overwritten."); }
        const directory = await open(dirname(path), "r"); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temp); }
    await writeAssistantRecord(root, `${kept(plan)}/source.json`, verified.record);
    return readAssistantLocalSource(root, plan);
}

/** Every later use re-reads the kept bytes; nothing starts from a changed copy. */
export async function readAssistantLocalSource(root: string, plan: ExecutionPlan): Promise<{ record: LocalSourceRecord; bundlePath: string }> {
    const missing = "This controller keeps no verified copy of its local-only source, or the copy changed. No work can start from it; initialise a controller from the prepared profile.";
    if (!isLocalSource(plan) || !await assistantExists(root, `${kept(plan)}/source.json`)) throw new Error(missing);
    const record = await readAssistantRecord<LocalSourceRecord>(root, `${kept(plan)}/source.json`), bundlePath = await assistantPath(root, `${kept(plan)}/source.bundle`);
    const expected = { schema_version: "wringer.local-source.v1", planSha256: plan.plan_sha256, url: plan.repository.url, commit: plan.repository.commit, rootCommit: plan.repository.url.slice("local://".length), bundleSha256: record.bundleSha256, bundleBytes: record.bundleBytes };
    const bytes = await bounded(bundlePath, BUNDLE_LIMIT).catch(() => null);
    if (hashValue(record) !== hashValue(expected) || !bytes || bytes.length !== record.bundleBytes || hashBytes(bytes) !== record.bundleSha256) throw new Error(missing);
    return { record, bundlePath };
}
