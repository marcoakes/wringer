import { createHash } from "node:crypto";
import type { StoppedWorkerEdits } from "./types";

export const STOPPED_EDITS_MAX_BYTES = 8 * 1024 * 1024;
/** Best effort by design: the session has already stopped, and that stop is what gets
 * reported. A failed read is recorded as one and never replaces it. Undefined means the
 * worker left nothing. */
export async function keepStoppedEdits(baseCommit: string, read: () => Promise<{ patch: string; paths: string[] }>, redact: (text: string) => string): Promise<StoppedWorkerEdits | undefined> {
    let patch: string, paths: string[];
    try { ({ patch, paths } = await read()); }
    catch { return { baseCommit, paths: [], bytes: 0, patch: null, sha256: null, omitted: "capture-failed" }; }
    if (!patch && !paths.length) return undefined;
    const kept = { baseCommit, paths: paths.map(redact), bytes: Buffer.byteLength(patch) };
    if (redact(patch) !== patch) return { ...kept, patch: null, sha256: null, omitted: "credential-detected" };
    if (kept.bytes > STOPPED_EDITS_MAX_BYTES) return { ...kept, patch: null, sha256: null, omitted: "too-large" };
    return { ...kept, patch, sha256: createHash("sha256").update(patch).digest("hex"), omitted: null };
}
export const namesFromGit = (output: string) => output.split("\0").filter(Boolean);
