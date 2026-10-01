/** What a candidate changed, for the person deciding whether to send it: the files and a
 * bounded patch against the approved base commit, read from the candidate's own bundle in
 * a private scratch repository that is removed afterwards. Text for display only. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "@wringer/engine";

export interface CandidateChange {
    baseCommit: string;
    candidateCommit: string;
    /** Lines added and removed; null for a binary file. */
    files: { path: string; added: number | null; removed: number | null }[];
    patch: string;
    /** The patch or file list was longer than the page shows; the bundle has all of it. */
    truncated: boolean;
}
export const CHANGE_PATCH_LIMIT = 65536, CHANGE_FILE_LIMIT = 200;
const commit = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
// Repository and user configuration never choose how this diff is produced.
const HARDENED = ["-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "protocol.file.allow=always"];

export async function readCandidateChange(bundlePath: string, baseCommit: string, candidateCommit: string): Promise<CandidateChange> {
    if (!commit.test(baseCommit) || !commit.test(candidateCommit)) throw new Error("A change is read only between exact commits");
    const scratch = await mkdtemp(join(tmpdir(), "wringer-change-"));
    try {
        await git(scratch, ["init", "--bare", "--quiet", scratch]);
        await git(scratch, [...HARDENED, "fetch", "--quiet", "--no-tags", bundlePath, "+refs/heads/*:refs/candidate/*"]);
        const range = [baseCommit, candidateCommit, "--"];
        const listed = (await git(scratch, [...HARDENED, "diff", "--numstat", "-z", "--no-renames", ...range])).stdout.split("\0").filter(Boolean);
        const files = listed.map(row => {
            const [added, removed, ...path] = row.split("\t");
            return { path: path.join("\t"), added: added === "-" ? null : Number(added), removed: removed === "-" ? null : Number(removed) };
        });
        const patch = (await git(scratch, [...HARDENED, "diff", "--no-color", "--no-ext-diff", "--no-renames", ...range])).stdout;
        const truncated = patch.length > CHANGE_PATCH_LIMIT || files.length > CHANGE_FILE_LIMIT;
        return { baseCommit, candidateCommit, files: files.slice(0, CHANGE_FILE_LIMIT), patch: patch.length > CHANGE_PATCH_LIMIT ? patch.slice(0, CHANGE_PATCH_LIMIT) : patch, truncated };
    } finally { await rm(scratch, { recursive: true, force: true }); }
}
