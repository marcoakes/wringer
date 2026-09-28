import { lstat, mkdir, open, rename } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor, VERSION } from "@wringer/engine";
import { assistantId, assistantInventory, assistantPath } from "./assistant-store";
import { validateAdoptionRecord } from "./adoption-records";
import { readWorkspace } from "./workspaces";
import { readVerificationJob, verificationStatus } from "./verification-job";
import { readDelegationJob, delegationJobStatus } from "./delegation-jobs";
const excluded = ["project source", "request and review prose", "keys and provider traces", "cookies and private operator links", "client configuration backups", "private owner and coordination recovery archives", "raw logs and machine paths"];
const state = (value: unknown) => typeof value === "string" && /^[a-z][a-z-]{0,99}$/.test(value) ? value : "unavailable";
/** Construct from an allowlist of derived facts. Never recursively copy the
 * application directory, connection records, provider traces or client backups. */
export async function previewDiagnostics(root: string, workspaceId: string, offset = 0) {
    if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error("Use a bounded diagnostic page offset");
    const workspace = await readWorkspace(root, assistantId(workspaceId)), names = await assistantInventory(root, workspace.mode === "verification" ? "verification-jobs" : "delegation-jobs"), selected = [];
    for (const name of names) {
        if (workspace.mode === "delegation" && !/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        const id = workspace.mode === "delegation" ? name.slice(0, -5) : name;
        try {
            const job = workspace.mode === "verification" ? await readVerificationJob(root, id) : await readDelegationJob(root, id);
            if (job.workspaceId === workspaceId) selected.push({ id: job.id, schema: job.schema_version });
        } catch { // Unknown ownership cannot be attributed to the selected workspace.
            throw new Error("A job ownership record is unreadable. Inspect local recovery state; no private record was exported");
        }
    }
    const jobs = [];
    for (const row of selected.slice(offset, offset + 100)) {
        const base = { jobId: row.id, mode: workspace.mode, schemaVersion: row.schema, monetaryCost: null };
        try {
            if (workspace.mode === "verification") {
                const value = await verificationStatus(root, row.id);
                jobs.push({ ...base, phase: state(value.phase), outcome: state(value.outcome), revision: value.revision, uncertainty: value.uncertainty, operationIds: value.operation ? [value.operation.id] : [], stopCodes: value.nextAction.eligible ? [] : [state(value.nextAction.code)], repetitionsRemaining: value.remaining.repetitions, approvalExpiresAt: value.remaining.expiresAt });
            } else {
                const value = await delegationJobStatus(root, row.id);
                jobs.push({ ...base, phase: state(value.phase), outcome: state(value.outcome), revision: value.revision, uncertainty: value.uncertainty, operationIds: value.operationIds, stopCodes: value.stopCodes.map(state), repetitionsRemaining: null, approvalExpiresAt: value.approvalExpiresAt });
            }
        } catch {
            jobs.push({ ...base, phase: null, outcome: "unreadable", revision: null, uncertainty: true, operationIds: null, stopCodes: [`${workspace.mode}-observation-unreadable`], repetitionsRemaining: null, approvalExpiresAt: null });
        }
    }
    const report = { schema_version: "wringer.diagnostic-report.v1", version: VERSION, host: { platform: process.platform, architecture: process.arch, runtime: `Bun ${Bun.version}` }, workspace: { id: workspace.id, schemaVersion: workspace.schema_version, mode: workspace.mode, client: workspace.client, boundary: workspace.boundary }, support: { artifactIdentity: "not-observed-by-this-export", containment: "not-measured-by-this-export", liveClient: "not-measured-by-this-export", protectedHumanPresence: "unavailable" }, jobs, page: { offset, count: jobs.length, nextOffset: offset + jobs.length < selected.length ? offset + jobs.length : null }, excluded };
    const content = JSON.stringify(report, null, 2) + "\n";
    if (Buffer.byteLength(content) > 512 * 1024 || new Redactor().scrub(content) !== content || content.includes(root) || content.includes(workspace.repo)) throw new Error("Diagnostic allowlist/redaction boundary refused this export");
    const manifest = { schema_version: "wringer.diagnostic-manifest.v1", included: [{ path: "report.json", bytes: Buffer.byteLength(content), sha256: hashBytes(Buffer.from(content)) }], excluded, sharing: "Inspect this export before deliberately sharing it. No upload is performed." };
    const preview = { schema_version: "wringer.diagnostic-preview.v1", identity: hashValue({ report, manifest }), report, manifest };
    await validateAdoptionRecord(preview);
    return preview;
}
/** New directory only, with a retained private staging directory on failure.
 * Existing output is never replaced and no upload happens here. */
export async function exportDiagnostics(root: string, workspaceId: string, output: string, expectedIdentity: string, offset = 0) {
    const preview = await previewDiagnostics(root, workspaceId, offset);
    if (preview.identity !== expectedIdentity) throw new Error("Diagnostic state changed; inspect the exact new preview before exporting");
    if (!isAbsolute(output)) throw new Error("Choose an absolute new diagnostic output directory");
    await assistantPath(dirname(output), output);
    try { await lstat(output); throw new Error("Diagnostic output already exists; no files were replaced"); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    const stage = output + `.wringer-${crypto.randomUUID()}.pending`; await mkdir(stage, { mode: 0o700 });
    for (const [name, value] of [["report.json", preview.report], ["manifest.json", preview.manifest]] as const) {
        const handle = await open(join(stage, name), "wx", 0o600); try { await handle.writeFile(JSON.stringify(value, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
    }
    // Reserving the destination avoids replacing a directory created since the
    // initial read; rename would otherwise replace an unrelated empty directory.
    await mkdir(output, { mode: 0o700 });
    await rename(stage, output);
    const parent = await open(dirname(output), "r"); try { await parent.sync(); } finally { await parent.close(); }
    return { directory: output, identity: preview.identity, manifest: preview.manifest, uploaded: false };
}
