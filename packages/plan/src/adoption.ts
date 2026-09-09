import { canonicalJson, freezeData, hashValue } from "./canonical";
import type { PlaybookAdoptionReceipt } from "./types";

/** Checks the retained receipt's exact content, not the external experiment's
 * eligibility or a person's authenticated presence. No registry is consulted. */
export function validatePlaybookAdoption(value: unknown): PlaybookAdoptionReceipt {
    canonicalJson(value);
    const v = value as PlaybookAdoptionReceipt;
    const keys = ["schema_version", "repository", "taskFamily", "action", "actor", "note", "at", "previousRevision", "previousDigest", "selectedDigest", "experimentSha256", "evidenceRevision", "appliesTo", "executionApproved", "sha256"];
    const hash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
    const text = (x: unknown, max: number) => typeof x === "string" && !!x.trim() && !x.includes("\0") && x.length <= max;
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k)) || v.schema_version !== "wringer.playbook-adoption.v1"
        || !text(v.repository, 4096) || typeof v.taskFamily !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v.taskFamily)
        || !["promote", "rollback"].includes(v.action) || !text(v.actor, 200) || !text(v.note, 16000) || !text(v.at, 64) || !Number.isFinite(Date.parse(v.at))
        || !hash(v.previousRevision) || !(v.previousDigest === null || hash(v.previousDigest)) || !(v.selectedDigest === null || hash(v.selectedDigest))
        || !hash(v.experimentSha256) || !hash(v.evidenceRevision) || !hash(v.sha256) || v.appliesTo !== "future-plans-only" || v.executionApproved !== false)
        throw new Error("Playbook adoption must be an exact bounded future-only provenance receipt");
    const { sha256, ...body } = v;
    if (hashValue(body) !== sha256) throw new Error("Playbook adoption receipt content or digest changed");
    return freezeData(structuredClone(v));
}
