import { validateAdoptionRecord } from "./adoption-records";
import { mkdir, statfs } from "node:fs/promises";
import { join } from "node:path";
import { audit } from "@wringer/delivery";
import { git, Redactor, runProcess } from "@wringer/engine";
import { hashValue } from "@wringer/plan";
import { assistantExists, assistantId, assistantInventory, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readVerificationJob } from "./verification-job";
import { readWorkspace } from "./workspaces";
import { inspectLockRecovery, withMaintenanceLock } from "./maintenance";
const objectId = /^[a-f0-9]{40}([a-f0-9]{24})?$/;
const quotation = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
async function original(root: string, jobId: string) {
    const job = await readVerificationJob(root, assistantId(jobId)), workspace = await readWorkspace(root, job.workspaceId), prefix = `verification-jobs/${jobId}`;
    const request = await readAssistantRecord<any>(root, `${prefix}/send-request.json`);
    if (request.schema_version !== "wringer.verification-send.v1" || request.publicationKind !== "branch-only" || !/^[a-f0-9]{64}$/.test(request.request?.expectedCandidateIdentity)) throw new Error("This job has no valid branch-only Send reservation");
    const prepared = await readAssistantRecord<any>(root, `${prefix}/handovers/${request.request.expectedCandidateIdentity}.json`);
    if (prepared.jobId !== jobId || prepared.id !== request.request.preparedId || prepared.candidateIdentity !== request.request.expectedCandidateIdentity || hashValue(prepared.expected) !== hashValue(request.expected) || hashValue(prepared.destination) !== hashValue(request.destination) || hashValue(job.destination) !== hashValue(request.destination)) throw new Error("The retained Send no longer matches its exact prepared source and destination");
    return { job, workspace, request, prepared, prefix };
}
async function gitObject(repo: string, spec: string) {
    const result = await git(repo, ["show", spec]);
    if (Buffer.byteLength(result.stdout) > 2 * 1024 * 1024) throw new Error("Carried delivery metadata exceeds its read bound");
    return JSON.parse(result.stdout);
}
async function inspect(root: string, jobId: string) {
    const retained = await original(root, jobId), { workspace, request, prepared } = retained;
    const ref = `refs/heads/${request.destination.branch}`;
    await git(workspace.repo, ["check-ref-format", ref]);
    const remote = await git(workspace.repo, ["-c", "protocol.ext.allow=never", "ls-remote", "--heads", "--", request.expected.remoteURL, ref]);
    const rows = remote.stdout.trim().split("\n").filter(Boolean).map(row => row.split(/\s+/));
    if (rows.length > 1 || rows.some(row => row.length !== 2 || !objectId.test(row[0]!) || row[1] !== ref)) throw new Error("Remote branch observation is ambiguous");
    const remoteHead = rows[0]?.[0] ?? null, local = await git(workspace.repo, ["rev-parse", "--verify", `${ref}^{commit}`], true), localHead = local.exit_code === 0 && objectId.test(local.stdout.trim()) ? local.stdout.trim() : null;
    let delivery: { id: string; codeCommit: string; anchorIdentity: string; manifestIdentity: string } | null = null;
    if (remoteHead && localHead === remoteHead) {
        const inventory = await git(workspace.repo, ["ls-tree", "-z", "--name-only", `${localHead}:.wringer/deliveries`], true);
        if (inventory.exit_code === 0) for (const id of inventory.stdout.split("\0").filter(Boolean)) {
            if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error("Carried delivery path is invalid");
            const anchor = await gitObject(workspace.repo, `${localHead}:.wringer/deliveries/${id}/anchor.json`);
            if (anchor.code_tree !== prepared.expected.tree || anchor.verified_fingerprint !== prepared.expected.fingerprint || anchor.base_commit !== prepared.expected.baseCommit) continue;
            const manifest = await gitObject(workspace.repo, `${localHead}:.wringer/deliveries/${id}/manifest.json`);
            if (anchor.delivery_id !== id || anchor.schema_version !== "wringer.native.delivery-anchor.v1" || !objectId.test(anchor.code_commit) || manifest.delivery_id !== id || manifest.branch !== request.destination.branch || manifest.base !== prepared.expected.baseCommit || manifest.result?.commit !== anchor.code_commit || manifest.result?.pushed !== true || manifest.mode !== "live") throw new Error("Carried evidence does not bind the original Send");
            if ((await git(workspace.repo, ["rev-parse", `${anchor.code_commit}^{tree}`])).stdout.trim() !== prepared.expected.tree || (await git(workspace.repo, ["rev-parse", `${localHead}^`])).stdout.trim() !== anchor.code_commit) throw new Error("Remote source/evidence commits do not bind the exact prepared source");
            if (delivery) throw new Error("Multiple carried deliveries claim the same reserved Send");
            delivery = { id, codeCommit: anchor.code_commit, anchorIdentity: hashValue(anchor), manifestIdentity: hashValue(manifest) };
        }
    }
    const sizes = (await git(workspace.repo, ["count-objects", "-v"])).stdout.split("\n");
    let gitBytes = 0; for (const name of ["size", "size-pack"]) { const row = sizes.find(line => line.startsWith(name + ": ")); if (!row || !/^[0-9]+$/.test(row.slice(name.length + 2))) throw new Error("Local Git copy size is unavailable"); gitBytes += Number(row.slice(name.length + 2)) * 1024; }
    let checkoutBytes = 0;
    if (localHead) {
        const listing = await git(workspace.repo, ["ls-tree", "-rl", "-z", localHead]);
        const rows = listing.stdout.split("\0").filter(Boolean);
        if (rows.length > 100000) throw new Error("The private audit checkout exceeds its entry bound");
        for (const row of rows) { const fields = row.split("\t", 1)[0]!.trim().split(/\s+/); if (fields[1] !== "blob" || !/^[0-9]+$/.test(fields[3]!)) throw new Error("The private audit copy has an unmeasured tree entry"); checkoutBytes += Number(fields[3]); }
    }
    let sendOwner = "absent";
    if (await assistantExists(root, `${retained.prefix}/send.lock`)) {
        try { sendOwner = (await inspectLockRecovery(root, { kind: "verification-send", id: jobId })).ownerState; } catch { sendOwner = "unknown"; }
    }
    const eligible = !!delivery && sendOwner === "absent" && gitBytes + checkoutBytes <= 512 * 1024 * 1024;
    const value = { schema_version: "wringer.verification-send-recovery-preview.v1", jobId, requestIdentity: hashValue(request), preparedId: prepared.id, remoteHead, localHead, delivery, gitBytes, checkoutBytes, sendOwner, maxLocalCopyBytes: 512 * 1024 * 1024, eligible, action: "observe-exact-remote-evidence", dispatched: false, reason: eligible ? "The exact remote head has matching local source/evidence metadata. Apply makes a private local Git copy and audits its carried evidence before recording the observation. Nothing is pushed." : "Complete matching remote evidence is not established, or the bounded local copy is too large. Preserve Send uncertainty. A source-only push, absent branch or changed head cannot complete this handover." };
    const preview = { ...value, identity: hashValue(value) }; await validateAdoptionRecord(preview);
    return { retained, preview };
}
export async function inspectVerificationSendRecovery(root: string, jobId: string) { return (await inspect(root, jobId)).preview; }
async function inertGit(cwd: string, args: string[]) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
    const result = await runProcess(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never", ...args], { cwd, env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "0", GIT_TERMINAL_PROMPT: "0" }, timeout: 60, maxBytes: 2 * 1024 * 1024 });
    if (result.exit_code || result.timed_out || result.stdout_truncated || result.stderr_truncated) throw new Error("The bounded private Git audit copy could not be completed. Existing Send uncertainty remains; nothing was pushed");
    return result.stdout.trim();
}
export async function applyVerificationSendRecovery(root: string, jobId: string, expected: string, actor: string) {
    assistantId(jobId);
    if (!/^[a-f0-9]{64}$/.test(expected) || !actor.trim() || actor.length > 200 || new Redactor().scrub(actor) !== actor) throw new Error("Use the exact Send recovery preview and bounded actor");
    return withMaintenanceLock(root, async () => {
        const prefix = `verification-jobs/${jobId}`, receipt = `${prefix}/publication.json`, recovery = `maintenance/send-recoveries/${expected}`;
        if (await assistantExists(root, receipt)) {
            const value = await readAssistantRecord<any>(root, receipt);
            if (value.jobId !== jobId || value.observation?.recoveryIdentity !== expected) throw new Error("A different publication is already recorded; it was not replaced");
            return value;
        }
        const { retained, preview } = await inspect(root, jobId);
        if (preview.identity !== expected) throw new Error("Send recovery observation changed; inspect its exact current head");
        if (!preview.eligible || !preview.delivery) throw new Error("Complete remote evidence was not established. Keep the original Send uncertain");
        await writeAssistantRecord(root, `${recovery}/decision.json`, { schema_version: "wringer.verification-send-recovery-decision.v1", preview, actor });
        const savedPath = `${recovery}/audited-publication.json`;
        if (await assistantExists(root, savedPath)) {
            const saved = await readAssistantRecord<any>(root, savedPath), clone = await assistantPath(root, `${recovery}/copies/${assistantId(saved.copyId)}/repository`), value = saved.publication;
            if (value.jobId !== jobId || value.observation.recoveryIdentity !== expected || value.result.directory !== join(clone, ".wringer/deliveries", preview.delivery.id) || hashValue(saved.audit) !== value.observation.auditIdentity || hashValue(value.expected) !== hashValue(retained.prepared.expected) || value.result.evidence_commit !== preview.remoteHead) throw new Error("Retained audit receipt identity changed");
            if (await inertGit(clone, ["rev-parse", "HEAD"]) !== preview.remoteHead || (await audit(clone, preview.delivery.id)).status !== "passed") throw new Error("Retained carried evidence changed; no recovered publication was recorded");
            await writeAssistantRecord(root, receipt, value); return value;
        }
        const free = await statfs(root);
        if (free.bavail * free.bsize < preview.gitBytes + preview.checkoutBytes + 256 * 1024 * 1024) throw new Error("Insufficient free space for the reviewed private audit copy and reserve");
        const attempts = await assistantInventory(root, `${recovery}/copies`);
        if (attempts.length >= 3) throw new Error("Three explicit local audit copies are retained. Inspect them before more local copying; no Send was replayed");
        const copyId = crypto.randomUUID(), copy = await assistantPath(root, `${recovery}/copies/${copyId}`); await mkdir(copy, { recursive: true, mode: 0o700 });
        const clone = join(copy, "repository");
        await inertGit(copy, ["init", "--template=/dev/null", clone]);
        await inertGit(clone, ["fetch", "--no-tags", "--", retained.workspace.repo, preview.remoteHead!]);
        if (await inertGit(clone, ["rev-parse", "FETCH_HEAD"]) !== preview.remoteHead) throw new Error("The private audit copy does not contain the selected remote object");
        await inertGit(clone, ["checkout", "--detach", preview.remoteHead!]);
        const observed = await audit(clone, preview.delivery.id);
        if (observed.status !== "passed") throw new Error("The carried evidence audit failed. Original Send uncertainty remains; no publication was repeated");
        if ((await inspect(root, jobId)).preview.identity !== expected) throw new Error("Remote or retained Send identity changed while the evidence was audited");
        const result = { delivery_id: preview.delivery.id, directory: join(clone, ".wringer/deliveries", preview.delivery.id), branch: retained.request.destination.branch, commit: preview.delivery.codeCommit, evidence_commit: preview.remoteHead, pushed: true, mode: "live", audit_command: `wring audit --delivery ${quotation(preview.delivery.id)} --repo .`, falsify_command: `wring verify --falsify --delivery ${quotation(preview.delivery.id)} --repo .`, next_move: "The exact remote source and carried evidence were observed. No PR, merge or deployment is implied." };
        const value = { schema_version: "wringer.verification-publication.v2", preparedId: retained.prepared.id, jobId, at: new Date().toISOString(), result, expected: retained.prepared.expected, destination: retained.prepared.destination, publicationKind: "branch-only", observation: { kind: "exact-remote-head-and-carried-audit", recoveryIdentity: expected, remoteHead: preview.remoteHead, auditIdentity: hashValue(observed), actor } };
        await writeAssistantRecord(root, savedPath, { schema_version: "wringer.audited-verification-publication.v1", copyId, audit: observed, publication: value });
        await writeAssistantRecord(root, receipt, value); return value;
    });
}
