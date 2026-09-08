import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfirmationEnvelope, verifyConfirmationEnvelope, verifyConfirmationProof, confirmationKeyId, validateProtectedDecision, createConfirmationStore, type ProtectedDecision, type ConfirmationEnvelope, type ConfirmationProof, type EnrolledConfirmationKey } from "../src/protected-confirmation";
import { readAssistantRecord } from "../src/assistant-store";

// SOFTWARE KEYS ONLY. These tests prove binding/replay mechanics, not biometrics,
// trusted enrollment, OS isolation, actual-client denial or a human PM verdict.
const dirs: string[] = [];
afterEach(async () => { for (const path of dirs.splice(0)) await rm(path, { recursive: true, force: true }); });
async function scratch() { const path = await realpath(await mkdtemp(join(tmpdir(), "wringer-confirmation-test-"))); dirs.push(path); return path; }
const keys = () => generateKeyPairSync("ec", { namedCurve: "prime256v1" });
function point(key: KeyObject) { const jwk = key.export({ format: "jwk" }); return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64"); }
function fixture() {
    const controller = keys(), human = keys(), raw = point(human.publicKey), now = new Date("2026-09-08T12:00:00.000Z");
    const decision: ProtectedDecision = { schema_version: "wringer.protected-decision.v1", controllerId: crypto.randomUUID(), jobId: crypto.randomUUID(), kind: "execution", expectedRevision: "a".repeat(64), expectedCandidateTree: null, actor: "Synthetic test operator", originalRequest: "Keep these original words.\n  This is a fixture, not a human decision.", action: { planSha256: "b".repeat(64), budget: { max_sessions: 4, wall_clock_seconds: 300 }, scope: ["src"], expiresAt: "2026-09-08T12:05:00.000Z" } };
    const key: EnrolledConfirmationKey = { schema_version: "wringer.confirmation-key.v1", keyId: confirmationKeyId(raw), publicKey: raw, controllerId: decision.controllerId, enrollmentSha256: "e".repeat(64) };
    const approve = (envelope: ConfirmationEnvelope, id: string): ConfirmationProof => ({ schema_version: "wringer.confirmation-proof.v1", challengeId: id, keyId: key.keyId, signature: sign("sha256", Buffer.from(envelope.payload, "base64"), human.privateKey).toString("base64") });
    return { controller, human, now, decision, key, approve };
}
describe("protected confirmation binding primitives — not live human proof", () => {
    test("exact original words and complete action survive both signatures", () => {
        const f = fixture(), { envelope, challenge } = createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now);
        expect(verifyConfirmationEnvelope(envelope, f.controller.publicKey, f.now)).toEqual(challenge);
        const result = verifyConfirmationProof(envelope, f.approve(envelope, challenge.id), f.key, f.controller.publicKey, f.decision, f.now);
        expect(result.decision).toEqual(f.decision);
        expect(result.decision.originalRequest).toBe(f.decision.originalRequest);
        expect(envelope.payload).not.toContain("PRIVATE KEY");
    });
    test("wrong controller, wrong key, extra authority and forged signature fail", () => {
        const f = fixture(), { envelope, challenge } = createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now), proof = f.approve(envelope, challenge.id);
        expect(() => verifyConfirmationEnvelope(envelope, keys().publicKey, f.now)).toThrow("controller did not sign");
        for (const bad of [{ ...proof, signature: Buffer.from("forged").toString("base64") }, { ...proof, challengeId: crypto.randomUUID() }, { ...proof, keyId: "0".repeat(64) }, { ...proof, approved: true }]) expect(() => verifyConfirmationProof(envelope, bad, f.key, f.controller.publicKey, f.decision, f.now)).toThrow();
        expect(() => verifyConfirmationProof(envelope, proof, { ...f.key, controllerId: crypto.randomUUID() }, f.controller.publicKey, f.decision, f.now)).toThrow();
        expect(() => verifyConfirmationProof(envelope, proof, { ...f.key, publicKey: point(keys().publicKey) }, f.controller.publicKey, f.decision, f.now)).toThrow();
    });
    test("every changed decision field needs a new confirmation", () => {
        const f = fixture(), { envelope, challenge } = createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now), proof = f.approve(envelope, challenge.id);
        for (const change of [{ actor: "Someone else" }, { jobId: crypto.randomUUID() }, { controllerId: crypto.randomUUID() }, { expectedRevision: "b".repeat(64) }, { expectedCandidateTree: "c".repeat(40) }, { originalRequest: "Different words" }, { action: { ...f.decision.action, scope: ["."] } }, { action: { ...f.decision.action, budget: { max_sessions: 5 } } }, { action: { ...f.decision.action, destination: "elsewhere" } }]) expect(() => verifyConfirmationProof(envelope, proof, f.key, f.controller.publicKey, { ...f.decision, ...change }, f.now)).toThrow();
    });
    test("review and publication cannot reuse execution confirmation", () => {
        const f = fixture(), { envelope, challenge } = createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now);
        for (const kind of ["human-review", "publication"] as const) {
            expect(() => validateProtectedDecision({ ...f.decision, kind })).toThrow("bind a candidate");
            const next = { ...f.decision, kind, expectedCandidateTree: "c".repeat(40) };
            expect(() => verifyConfirmationProof(envelope, f.approve(envelope, challenge.id), f.key, f.controller.publicKey, next, f.now)).toThrow("Decision changed");
        }
    });
    test("fresh challenge expires and future/oversized lifetimes are refused", () => {
        const f = fixture(), { envelope } = createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now);
        for (const at of [new Date(f.now.getTime() - 1), new Date(f.now.getTime() + 120000)]) expect(() => verifyConfirmationEnvelope(envelope, f.controller.publicKey, at)).toThrow("expired");
        for (const ttl of [0, -1, 121, Infinity, NaN, 1.5]) expect(() => createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now, ttl)).toThrow();
    });
    test("noncanonical, duplicate JSON, invalid types, display tricks and executable input are refused", () => {
        const f = fixture(), { envelope } = createConfirmationEnvelope(f.decision, f.controller.privateKey, f.now);
        const payload = Buffer.from(envelope.payload, "base64");
        for (const bytes of [Buffer.from(" " + payload), Buffer.from(payload.toString().replace('"nonce":', '"nonce":"' + "f".repeat(64) + '","nonce":'))]) {
            const bad = { ...envelope, payload: bytes.toString("base64"), controllerSignature: sign("sha256", bytes, f.controller.privateKey).toString("base64") };
            expect(() => verifyConfirmationEnvelope(bad, f.controller.publicKey, f.now)).toThrow("noncanonical");
        }
        for (const change of [{ expectedRevision: ["a".repeat(64)] }, { action: { unsafe: () => true } }, { action: { amount: Infinity } }, { actor: "A\u202eB" }, { originalRequest: "bad\u0000text" }, { originalRequest: "x".repeat(16385) }, { extra: true }]) expect(() => validateProtectedDecision({ ...f.decision, ...change })).toThrow();
    });
    test("concurrent submissions claim once and retain an auditable claim before effects", async () => {
        const f = fixture(), root = await scratch(), store = createConfirmationStore(root, f.controller.privateKey), { challenge, envelope } = await store.issue(f.decision, f.now), proof = f.approve(envelope, challenge.id);
        let effects = 0;
        const run = () => store.execute(challenge.id, proof, f.key, f.decision, async () => {
            const claim = await readAssistantRecord(root, `confirmations/${challenge.id}/claimed.json`);
            expect(claim.outcome).toBe("uncertain-until-domain-reconciled"); effects++; return "domain-result";
        }, f.now);
        const outcomes = await Promise.allSettled(Array.from({ length: 12 }, run));
        expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1); expect(effects).toBe(1);
        await expect(run()).rejects.toThrow("already claimed");
        expect((await readAssistantRecord(root, `confirmations/${challenge.id}/completed.json`)).id).toBe(challenge.id);
    });
    test("lost or failed action does not replay after constructing a fresh store", async () => {
        const f = fixture(), root = await scratch(), store = createConfirmationStore(root, f.controller.privateKey), { challenge, envelope } = await store.issue(f.decision, f.now), proof = f.approve(envelope, challenge.id);
        let effects = 0;
        await expect(store.execute(challenge.id, proof, f.key, f.decision, async () => { effects++; throw new Error("Simulated lost domain response"); }, f.now)).rejects.toThrow("lost domain");
        const reopened = createConfirmationStore(root, f.controller.privateKey);
        await expect(reopened.execute(challenge.id, proof, f.key, f.decision, async () => { effects++; }, f.now)).rejects.toThrow("already claimed"); expect(effects).toBe(1);
    });
    test("invalid proof and changed domain expectations never reserve or execute", async () => {
        const f = fixture(), root = await scratch(), store = createConfirmationStore(root, f.controller.privateKey), { challenge, envelope } = await store.issue(f.decision, f.now);
        let calls = 0;
        await expect(store.execute(challenge.id, f.approve(envelope, challenge.id), f.key, { ...f.decision, actor: "Different" }, async () => { calls++; }, f.now)).rejects.toThrow("Decision changed");
        await store.execute(challenge.id, f.approve(envelope, challenge.id), f.key, f.decision, async () => { calls++; }, f.now); expect(calls).toBe(1);
    });
    test("controller symlink escape is refused", async () => {
        const f = fixture(), root = await scratch(), outside = await scratch(); await symlink(outside, join(root, "confirmations"));
        await expect(createConfirmationStore(root, f.controller.privateKey).issue(f.decision, f.now)).rejects.toThrow("symlinks");
    });
});
