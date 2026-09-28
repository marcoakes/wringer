import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor, safePath, validateDigests } from "@wringer/engine";
import { assistantExists, assistantId, assistantInventory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readVerificationJob, readVerificationObservation, type Observation } from "./verification-job";
import { readWorkspace } from "./workspaces";
import { inspectLockRecovery, withMaintenanceLock } from "./maintenance";
import { validateAdoptionRecord } from "./adoption-records";
async function inspect(root: string, jobId: string, selected?: string) {
    const job = await readVerificationJob(root, assistantId(jobId)), workspace = await readWorkspace(root, job.workspaceId), prefix = `verification-jobs/${jobId}`;
    const rows = await Promise.all((await assistantInventory(root, `${prefix}/operations`)).filter(p => p.endsWith(".json")).map(p => readAssistantRecord<any>(root, `${prefix}/operations/${p}`)));
    const operation = selected ? rows.find(r => r.id === assistantId(selected)) : rows.sort((a, b) => b.sequence - a.sequence)[0];
    if (!operation || operation.jobId !== jobId) throw new Error("Select an existing verification operation");
    let owner = "absent";
    if (await assistantExists(root, `${prefix}/execution.lock`)) { try { owner = (await inspectLockRecovery(root, { kind: "verification", id: jobId })).ownerState; } catch { owner = "unknown"; } }
    const previous = await readVerificationObservation(root, jobId, operation.id);
    let observation: Observation | null = null, bundleIdentity: string | null = null, reason = "The original operation has no recoverable sealed outcome. Keep it uncertain; do not replay it. Legacy operations have no exact output binding.";
    if (operation.schema_version === "wringer.verification-operation.v2" && operation.evidence === `.wringer/runs/verification-${operation.id}`) {
        try {
            const directory = await safePath(workspace.repo, operation.evidence);
            if (!(await validateDigests(directory)).ok) throw new Error("Incomplete or altered evidence");
            const completion = JSON.parse(await readFile(join(directory, "completion.json"), "utf8")), snapshot = JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8")), selection = JSON.parse(await readFile(join(directory, "selection.json"), "utf8")), manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
            if (completion.schema_version !== "wringer.verification-completion.v1" || completion.run_id !== manifest.run_id || completion.run_id !== selection.run_id || completion.fingerprint !== snapshot.fingerprint || snapshot.fingerprint !== operation.request.expectedCandidateIdentity || completion.selection_sha256 !== hashBytes(Buffer.from(JSON.stringify(selection))) || hashValue([...(selection.selected ?? [])].sort()) !== hashValue([...job.selection].sort()) || !selection.strict || ![0, 1, 2, 4].includes(completion.exit_code) || completion.status !== (completion.exit_code === 4 ? "interrupted" : completion.exit_code === 0 ? "passed" : "failed") || !Number.isFinite(Date.parse(completion.completed_at))) throw new Error("Outcome/source binding differs");
            const { head_sha, branch, dirty, fingerprint } = snapshot;
            observation = { schema_version: "wringer.verification-observation.v1", operationId: operation.id, jobId, at: completion.completed_at, evidence: operation.evidence, exit: completion.exit_code, source: { head_sha, branch, dirty, fingerprint }, outcome: completion.exit_code === 4 ? "interrupted" : "completed", displays: [] };
            bundleIdentity = hashBytes(await readFile(join(directory, "digests.json")));
            reason = "The exact sealed check outcome can be recorded without executing commands. Lost display observations are not inferred; review remains unavailable until a later explicitly granted run supplies them. Existing repetition and expiry limits remain spent.";
        } catch { reason = "The reserved output is missing, incomplete, altered, or does not bind this operation. Preserve uncertainty; no command can be replayed by recovery."; }
    }
    const eligible = !!observation && owner === "absent" && (!previous || previous.outcome === "unconfirmed");
    const value = { schema_version: "wringer.verification-recovery-preview.v1", jobId, operationId: operation.id, operationIdentity: hashValue(operation), bundleIdentity, owner, eligible, observation, reason, dispatched: false };
    const preview = { ...value, identity: hashValue(value) }; await validateAdoptionRecord(preview); return preview;
}
export const inspectVerificationRecovery = inspect;
export async function applyVerificationRecovery(root: string, jobId: string, operationId: string | undefined, expected: string, actor: string) {
    if (!/^[a-f0-9]{64}$/.test(expected) || !actor.trim() || actor.length > 200 || new Redactor().scrub(actor) !== actor) throw new Error("Select the exact recovery preview and bounded actor");
    return withMaintenanceLock(root, async () => {
        const preview = await inspect(root, jobId, operationId), path = `verification-jobs/${assistantId(jobId)}/resolved/${preview.operationId}.json`;
        if (await assistantExists(root, path)) {
            const retained = await readAssistantRecord<any>(root, path);
            if (retained.identity !== expected || retained.actor !== actor || retained.operationIdentity !== preview.operationIdentity || retained.bundleIdentity !== preview.bundleIdentity) throw new Error("Retained verification recovery changed");
            return retained;
        }
        if (preview.identity !== expected || !preview.eligible || !preview.observation) throw new Error("Verification recovery is stale or unavailable; nothing was executed");
        const result = { schema_version: "wringer.verification-recovery-result.v1", identity: expected, jobId, operationId: preview.operationId, operationIdentity: preview.operationIdentity, bundleIdentity: preview.bundleIdentity, observation: preview.observation, actor, dispatched: false };
        await writeAssistantRecord(root, path, result); return result;
    });
}
