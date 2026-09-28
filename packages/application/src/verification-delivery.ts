import { open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { deliver, type DeliveryResult } from "@wringer/delivery";
import { git, validateDigests } from "@wringer/engine";
import { hashValue } from "@wringer/plan";
import { assistantExists, assistantId, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { verificationStatus } from "./verification-job";
import { readWorkspace } from "./workspaces";
export interface VerificationHandover {
    schema_version: "wringer.verification-handover.v1"; id: string; jobId: string;
    candidateIdentity: string; preview: DeliveryResult;
    expected: { fingerprint: string; tree: string; remoteURL: string; baseCommit: string };
    destination: { remote: string; base: string; branch: string }; publicationKind: "branch-only";
}
const file = (id: string, name: string) => `verification-jobs/${assistantId(id)}/${name}`;
export async function prepareVerificationHandover(root: string, id: string) {
    const status = await verificationStatus(root, id), destination = status.job.destination;
    if (!status.fresh || !status.board?.facts.readyToDeliver || !destination || !status.approval || status.uncertainty) throw new Error("Handover needs the current verified source, all required proof and review, and a declared destination");
    const name = file(id, `handovers/${status.candidateIdentity}.json`), workspace = await readWorkspace(root, status.job.workspaceId);
    if (await assistantExists(root, name)) {
        const retained = await readAssistantRecord<VerificationHandover>(root, name);
        if (!(await validateDigests(retained.preview.directory)).ok) throw new Error("Prepared handover evidence changed");
        return retained;
    }
    const lockPath = await assistantPath(root, file(id, "prepare.lock")), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Handover preparation is active or interrupted; inspect retained preparation before retrying"); });
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, jobId: id })); await lock.sync();
        const current = await verificationStatus(root, id);
        if (current.revision !== status.revision) throw new Error("Source or decisions advanced while preparing the handover");
        const preview = await deliver(workspace.repo, { run: status.board!.run!.path, ...destination, publicationKind: "branch-only" });
        const anchor = await Bun.file(join(preview.directory, "anchor.json")).json();
        const remoteURL = (await git(workspace.repo, ["remote", "get-url", destination.remote])).stdout.trim();
        const value: VerificationHandover = { schema_version: "wringer.verification-handover.v1", id: crypto.randomUUID(), jobId: id, candidateIdentity: status.candidateIdentity, preview, expected: { fingerprint: anchor.verified_fingerprint, tree: anchor.code_tree, remoteURL, baseCommit: anchor.base_commit }, destination, publicationKind: "branch-only" };
        await writeAssistantRecord(root, name, value); return value;
    } finally { await lock.close(); await unlink(lockPath); }
}
/** An operator call only. Reservation precedes every delivery side effect. An
 * interrupted or lost delivery is retained as uncertain, never replayed. */
export async function sendVerificationHandover(root: string, id: string, request: { expectedRevision: string; expectedCandidateIdentity: string; preparedId: string }) {
    assistantId(request.preparedId);
    const reservation = file(id, "send-request.json"), resultFile = file(id, "publication.json");
    if (await assistantExists(root, reservation)) {
        if (hashValue((await readAssistantRecord<any>(root, reservation)).request) !== hashValue(request)) throw new Error("A different Send is already recorded for this job");
        if (await assistantExists(root, resultFile)) return readAssistantRecord<any>(root, resultFile);
        throw new Error("Send outcome is uncertain. Inspect the recorded branch and evidence; no publication was repeated");
    }
    const status = await verificationStatus(root, id);
    if (status.revision !== request.expectedRevision || status.candidateIdentity !== request.expectedCandidateIdentity || status.phase !== "send" || !status.prepared || status.prepared.id !== request.preparedId || !status.fresh || !status.board?.facts.readyToDeliver || !status.approval) throw new Error("Send requires the exact current prepared and accepted candidate");
    const prepared = status.prepared as VerificationHandover, workspace = await readWorkspace(root, status.job.workspaceId);
    if (!(await validateDigests(prepared.preview.directory)).ok) throw new Error("Prepared handover evidence changed");
    const lockPath = await assistantPath(root, file(id, "send.lock")), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Send is active or uncertain; it was not repeated"); });
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, jobId: id })); await lock.sync();
        const latest = await verificationStatus(root, id);
        if (latest.revision !== request.expectedRevision) throw new Error("The prepared candidate advanced before Send");
        await writeAssistantRecord(root, reservation, { schema_version: "wringer.verification-send.v1", request, actor: status.approval.actor, at: new Date().toISOString(), destination: prepared.destination, expected: prepared.expected, publicationKind: "branch-only" });
        const result = await deliver(workspace.repo, { run: status.board!.run!.path, ...prepared.destination, send: true, expected: prepared.expected, publicationKind: "branch-only" });
        const value = { schema_version: "wringer.verification-publication.v1", preparedId: prepared.id, jobId: id, at: new Date().toISOString(), result, expected: prepared.expected, destination: prepared.destination, publicationKind: "branch-only" };
        await writeAssistantRecord(root, resultFile, value); return value;
    } finally { await lock.close(); await unlink(lockPath); }
}
