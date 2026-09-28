import { validateAdoptionRecord } from "./adoption-records";
import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { join } from "node:path";
import { createAssistantService } from "./assistant";
import { recoverAssistantRunner } from "./assistant-runner";
import { readDelegationJob, delegationControllerRoot } from "./delegation-jobs";
import { assistantId, assistantExists, assistantInventory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { withMaintenanceLock } from "./maintenance";
async function context(root: string, jobId: string) {
    const job = await readDelegationJob(root, assistantId(jobId));
    return createAssistantService(await delegationControllerRoot(root, job.workspaceId, job.contextId));
}
export async function inspectDelegationRecovery(root: string, jobId: string, operationId?: string) {
    const service = await context(root, jobId), runner = await service.runner.status(), view = await service.status(jobId);
    const operation = operationId ? await service.runner.read(assistantId(operationId)) : null;
    if (operation && operation.jobId !== jobId) throw new Error("This operation belongs to another job");
    const action = operation ? "reconcile-terminal-domain-evidence" : "release-dead-runner-owner";
    const value = { schema_version: "wringer.delegation-recovery-preview.v1", jobId, operationId: operationId ?? null, action, ownerState: runner.ownerState, ownerIdentity: runner.owner ? hashValue(runner.owner) : null, revision: view.revision, operationIdentity: operation ? hashValue(operation) : null, uncertainty: view.uncertainty, eligible: operation ? operation.status === "uncertain" || !!operation.reconciliation : runner.ownerState === "dead", dispatched: false, note: "Recovery never repeats an effect, refunds a reservation or renews authority. An uncertain operation can settle only from complete retained terminal domain evidence. Paid effects and publication may remain unresolved." };
    const preview = { ...value, identity: hashValue(value) };
    await validateAdoptionRecord(preview); return preview;
}
export async function applyDelegationRecovery(root: string, jobId: string, operationId: string | undefined, expected: string, actor: string) {
    if (!/^[a-f0-9]{64}$/.test(expected) || !actor.trim() || actor.length > 200 || new Redactor().scrub(actor) !== actor) throw new Error("Use the exact recovery preview and bounded actor");
    return withMaintenanceLock(root, async () => {
        const prefix = `maintenance/domain-recoveries/${expected}`;
        const saved = await assistantExists(root, `${prefix}/decision.json`) ? await readAssistantRecord<any>(root, `${prefix}/decision.json`) : null;
        if (saved && (saved.preview.identity !== expected || saved.preview.jobId !== jobId || saved.preview.operationId !== (operationId ?? null))) throw new Error("Recovery decision belongs to a different job or operation");
        const present = (record: any) => ({ identity: expected, jobId, operationId: operationId ?? null, resultIdentity: record.resultIdentity, dispatched: false, nextAction: "Read retained job status. Restarting the page, resolving domain uncertainty and any new approval remain separate decisions." });
        if (await assistantExists(root, `${prefix}/result.json`)) {
            const record = await readAssistantRecord<any>(root, `${prefix}/result.json`);
            if (!saved || record.identity !== expected || record.jobId !== jobId || record.operationId !== (operationId ?? null)) throw new Error("Recovery result identity changed");
            return present(record);
        }
        const service = await context(root, jobId), preview = await inspectDelegationRecovery(root, jobId, operationId);
        let result: unknown;
        if (saved && preview.identity !== expected) {
            // A reply may be lost between the domain's durable completion and
            // this application's receipt. Derive only that exact prior effect.
            if (operationId) {
                const operation = await service.runner.read(operationId), { reconciliation, ...body } = operation;
                const prior = { ...body, status: "uncertain", ...(reconciliation?.priorError ? { error: reconciliation.priorError } : {}) };
                if (!reconciliation || hashValue(prior) !== saved.preview.operationIdentity) throw new Error("Retained operation does not establish this recovery completion");
                result = operation;
            } else {
                let found;
                for (const name of await assistantInventory(service.root, "runner/recoveries")) {
                    const record = await readAssistantRecord<any>(service.root, `runner/recoveries/${name}`);
                    if (record.schema_version === "wringer.assistant-runner-recovery.v1" && hashValue(record.owner) === saved.preview.ownerIdentity) found = record;
                }
                const current = await service.runner.status();
                if (!found || current.owner && hashValue(current.owner) === saved.preview.ownerIdentity) throw new Error("Retained ownership does not establish this recovery completion");
                result = { retainedRecovery: hashValue(found), releasedOwner: saved.preview.ownerIdentity };
            }
        } else {
            if (preview.identity !== expected) throw new Error("Recovery state changed; inspect the current retained operation");
            if (!preview.eligible) throw new Error("This owner or operation is not eligible for the selected recovery");
            await writeAssistantRecord(root, `${prefix}/decision.json`, { schema_version: "wringer.delegation-recovery-decision.v1", preview, actor });
            result = operationId ? await service.reconcile(jobId, operationId, true) : await recoverAssistantRunner(join(service.root, "runner"), { ownerToken: (await service.runner.status()).owner!.token, acknowledgeUncertain: true });
        }
        // The detailed result stays in its original controller, never copied to
        // a support export or treated as a grant for subsequent work.
        await writeAssistantRecord(root, `maintenance/domain-recoveries/${expected}/result.json`, { schema_version: "wringer.delegation-recovery-result.v1", identity: expected, jobId, operationId: operationId ?? null, resultIdentity: hashValue(result), dispatched: false });
        return { identity: expected, jobId, operationId: operationId ?? null, resultIdentity: hashValue(result), dispatched: false, nextAction: "Read retained job status. Restarting the page, resolving domain uncertainty and any new approval remain separate decisions." };
    });
}
