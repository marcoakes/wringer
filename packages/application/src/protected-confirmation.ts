import { createHash, createPublicKey, randomBytes, randomUUID, sign, verify, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { hashValue } from "@wringer/plan";
import { assistantId, assistantPath, readAssistantRecord, writeAssistantRecord } from "./assistant-store";

/** These records bind a decision. They do NOT attest how a key was enrolled,
 * establish an OS boundary, or turn a software test key into human presence. */
export interface ProtectedDecision {
    schema_version: "wringer.protected-decision.v1";
    controllerId: string;
    jobId: string;
    kind: "execution" | "human-review" | "publication";
    expectedRevision: string;
    expectedCandidateTree: string | null;
    actor: string;
    /** Exact original request plus complete action payload, not an LLM summary. */
    originalRequest: string;
    action: Record<string, unknown>;
}
export interface ConfirmationChallenge {
    schema_version: "wringer.confirmation-challenge.v1";
    id: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
    decision: ProtectedDecision;
}
export interface ConfirmationEnvelope {
    schema_version: "wringer.confirmation-envelope.v1";
    payload: string;
    controllerSignature: string;
}
export interface ConfirmationProof {
    schema_version: "wringer.confirmation-proof.v1";
    challengeId: string;
    keyId: string;
    signature: string;
}
export interface EnrolledConfirmationKey {
    schema_version: "wringer.confirmation-key.v1";
    keyId: string;
    publicKey: string;
    controllerId: string;
    /** Protected deployment enrollment record; a native JSON claim is not attestation. */
    enrollmentSha256: string;
}
export class ConfirmationRefusal extends Error {}
function insist(yes: unknown, message: string): asserts yes { if (!yes) throw new ConfirmationRefusal(message); }
const sha = /^[a-f0-9]{64}$/;
const tree = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
function fields(value: unknown, expected: string[]): asserts value is Record<string, any> {
    insist(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, "Expected an exact confirmation record");
    insist(Object.keys(value as object).sort().join(",") === expected.sort().join(","), "Unexpected or missing confirmation field");
}
function boundedText(value: unknown, maximum: number) {
    insist(typeof value === "string" && value.trim() && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value.replaceAll("\n", "").replaceAll("\t", "")) && Buffer.byteLength(value) <= maximum, "Confirmation text is empty, oversized or contains display-control characters");
}
function canonical(value: unknown, depth = 0): string {
    insist(depth <= 32, "Confirmation nesting exceeds its limit");
    if (value === null || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") { insist(Number.isFinite(value) && Number.isSafeInteger(value), "Confirmation numbers must be finite safe integers"); return JSON.stringify(value); }
    if (typeof value === "string") { insist(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value.replaceAll("\n", "").replaceAll("\t", "")), "Confirmation includes unsafe display characters"); return JSON.stringify(value); }
    if (Array.isArray(value)) return `[${value.map(x => canonical(x, depth + 1)).join(",")}]`;
    insist(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype, "Confirmation action must be inert JSON");
    return `{${Object.keys(value).sort().map(key => `${canonical(key, depth + 1)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
}
export function validateProtectedDecision(value: unknown): ProtectedDecision {
    fields(value, ["schema_version", "controllerId", "jobId", "kind", "expectedRevision", "expectedCandidateTree", "actor", "originalRequest", "action"]);
    insist(value.schema_version === "wringer.protected-decision.v1", "Unknown decision contract");
    assistantId(value.controllerId); assistantId(value.jobId);
    insist(["execution", "human-review", "publication"].includes(value.kind) && typeof value.expectedRevision === "string" && sha.test(value.expectedRevision), "Decision kind or revision is invalid");
    insist(value.expectedCandidateTree === null || typeof value.expectedCandidateTree === "string" && tree.test(value.expectedCandidateTree), "Invalid candidate identity");
    insist(value.kind === "execution" || value.expectedCandidateTree !== null, "Review and publication must bind a candidate");
    boundedText(value.actor, 200); boundedText(value.originalRequest, 16384);
    insist(value.action && typeof value.action === "object" && !Array.isArray(value.action) && Object.keys(value.action).length > 0, "The complete action payload is required");
    insist(Buffer.byteLength(canonical(value)) <= 128 * 1024, "Decision exceeds its bound");
    return JSON.parse(canonical(value));
}
function base64(value: unknown, max: number) {
    insist(typeof value === "string" && value.length > 0 && value.length <= max * 2 && /^[A-Za-z0-9+/]+={0,2}$/.test(value), "Invalid encoded confirmation data");
    const data = Buffer.from(value, "base64");
    insist(data.length <= max && data.toString("base64") === value, "Noncanonical or oversized confirmation data");
    return data;
}
/** Apple's Security framework exports a P-256 public point, not a secret. */
export function confirmationPublicKey(raw: string): KeyObject {
    const point = base64(raw, 65);
    insist(point.length === 65 && point[0] === 4, "Expected an uncompressed P-256 public key");
    return createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") } });
}
export function confirmationKeyId(raw: string) { confirmationPublicKey(raw); return createHash("sha256").update(base64(raw, 65)).digest("hex"); }
function p256(key: KeyObject) { insist(key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1", "Confirmation requires an enrolled P-256 key"); }
export function createConfirmationEnvelope(decision: ProtectedDecision, controllerKey: KeyObject, now = new Date(), ttlSeconds = 120): { challenge: ConfirmationChallenge; envelope: ConfirmationEnvelope } {
    p256(controllerKey); insist(controllerKey.type === "private", "Controller signing key is missing");
    insist(Number.isFinite(now.getTime()) && Number.isSafeInteger(ttlSeconds) && ttlSeconds >= 1 && ttlSeconds <= 120, "Confirmation validity must be between 1 and 120 seconds");
    const challenge: ConfirmationChallenge = { schema_version: "wringer.confirmation-challenge.v1", id: randomUUID(), nonce: randomBytes(32).toString("hex"), issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(), decision: validateProtectedDecision(decision) };
    const payload = Buffer.from(canonical(challenge));
    return { challenge, envelope: { schema_version: "wringer.confirmation-envelope.v1", payload: payload.toString("base64"), controllerSignature: sign("sha256", payload, controllerKey).toString("base64") } };
}
export function verifyConfirmationEnvelope(value: unknown, controllerKey: KeyObject, now = new Date()): ConfirmationChallenge {
    fields(value, ["schema_version", "payload", "controllerSignature"]);
    insist(value.schema_version === "wringer.confirmation-envelope.v1", "Unknown envelope contract"); p256(controllerKey);
    const payload = base64(value.payload, 192 * 1024), signature = base64(value.controllerSignature, 80);
    insist(verify("sha256", payload, controllerKey, signature), "The protected controller did not sign this decision");
    const challenge = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
    fields(challenge, ["schema_version", "id", "nonce", "issuedAt", "expiresAt", "decision"]);
    insist(challenge.schema_version === "wringer.confirmation-challenge.v1" && typeof challenge.nonce === "string" && sha.test(challenge.nonce), "Unknown confirmation challenge"); assistantId(challenge.id);
    validateProtectedDecision(challenge.decision);
    insist(typeof challenge.issuedAt === "string" && typeof challenge.expiresAt === "string", "Invalid confirmation dates");
    const issued = Date.parse(challenge.issuedAt), expires = Date.parse(challenge.expiresAt);
    insist(Number.isFinite(issued) && Number.isFinite(expires) && new Date(issued).toISOString() === challenge.issuedAt && new Date(expires).toISOString() === challenge.expiresAt && issued <= now.getTime() && expires > now.getTime() && expires - issued > 0 && expires - issued <= 120000, "Confirmation expired or has an invalid lifetime");
    insist(canonical(challenge) === payload.toString("utf8"), "Confirmation payload is ambiguous or noncanonical");
    return challenge as unknown as ConfirmationChallenge;
}
export function verifyConfirmationProof(envelope: ConfirmationEnvelope, raw: unknown, key: EnrolledConfirmationKey, controllerKey: KeyObject, expectedDecision: ProtectedDecision, now = new Date()) {
    const challenge = verifyConfirmationEnvelope(envelope, controllerKey, now);
    fields(raw, ["schema_version", "challengeId", "keyId", "signature"]);
    fields(key, ["schema_version", "keyId", "publicKey", "controllerId", "enrollmentSha256"]);
    insist(key.schema_version === "wringer.confirmation-key.v1" && typeof key.enrollmentSha256 === "string" && sha.test(key.enrollmentSha256) && key.keyId === confirmationKeyId(key.publicKey), "Invalid pinned confirmation enrollment");
    insist(key.controllerId === challenge.decision.controllerId && raw.schema_version === "wringer.confirmation-proof.v1" && raw.challengeId === challenge.id && raw.keyId === key.keyId, "Confirmation belongs to another key, controller or challenge");
    insist(hashValue(challenge.decision) === hashValue(validateProtectedDecision(expectedDecision)), "Decision changed after it was shown; obtain a fresh confirmation");
    insist(verify("sha256", base64(envelope.payload, 192 * 1024), confirmationPublicKey(key.publicKey), base64(raw.signature, 80)), "The enrolled confirmation key did not sign this exact decision");
    return challenge;
}

/** Use only inside an independently protected controller identity. Same-account
 * access can alter these files: this store is not itself the deployment boundary.
 * Claimed decisions never auto-replay, including when the process died before
 * invoking the action. A separate domain reconciliation must inspect the effect. */
export function createConfirmationStore(root: string, controllerKey: KeyObject) {
    const path = (id: string, suffix: string) => `confirmations/${assistantId(id)}/${suffix}.json`;
    return {
        async issue(decision: ProtectedDecision, now = new Date()) {
            const value = createConfirmationEnvelope(decision, controllerKey, now);
            await writeAssistantRecord(root, path(value.challenge.id, "challenge"), value.envelope);
            return value;
        },
        async execute<T>(id: string, proof: ConfirmationProof, key: EnrolledConfirmationKey, expected: ProtectedDecision, effect: () => Promise<T>, now = new Date()): Promise<T> {
            const envelope = await readAssistantRecord<ConfirmationEnvelope>(root, path(id, "challenge"));
            const challenge = verifyConfirmationProof(envelope, proof, key, controllerKey, expected, now);
            insist(challenge.id === id, "Confirmation identity changed");
            const destination = await assistantPath(root, path(id, "claimed")), temporary = `${destination}.${randomUUID()}.pending`;
            await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
            const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            const claim = { schema_version: "wringer.confirmation-claim.v1", id, decisionSha256: hashValue(expected), proofSha256: hashValue(proof), at: now.toISOString(), outcome: "uncertain-until-domain-reconciled" };
            try { await file.writeFile(JSON.stringify({ ...claim, sha256: hashValue(claim) })); await file.sync(); }
            finally { await file.close(); }
            try { await link(temporary, destination); }
            catch (error: any) { if (error.code === "EEXIST") throw new ConfirmationRefusal("This decision was already claimed. Inspect its domain outcome; it was not replayed."); throw error; }
            finally { await unlink(temporary); }
            const directory = await open(dirname(destination), "r"); try { await directory.sync(); } finally { await directory.close(); }
            // The domain guard must still compare its current revision/candidate
            // atomically. A valid signature does not waive ordinary plan checks.
            const result = await effect();
            await writeAssistantRecord(root, path(id, "completed"), { schema_version: "wringer.confirmation-completion.v1", id, decisionSha256: hashValue(expected), note: "The guarded domain action returned. Read its recorded outcome; this is not a claim of successful work or publication." });
            return result;
        },
    };
}
