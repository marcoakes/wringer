import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { runProcess } from "./process";
import { EngineError, type Snapshot } from "./types";
import { sha256, Redactor } from "./io";
const baseExclusions = ["--", ".", ":(exclude).wringer", ":(exclude).wringer/**"];
export async function git(repo: string, args: string[], allowFailure = false) {
    const r = await runProcess(["git", "-c", "core.quotePath=false", ...args], { cwd: repo, timeout: 15, maxBytes: 20 * 1024 * 1024, redactor: new Redactor([], {}, [], false) });
    if (r.stdout_truncated || r.stderr_truncated)
        throw new EngineError(`git ${args[0]} exceeded the bounded capture limit; refusing an incomplete snapshot`);
    if ((r.exit_code !== 0 || r.timed_out) && !allowFailure)
        throw new EngineError(`git ${args[0]} failed: ${new Redactor().scrub(r.stderr.trim())}`);
    return r;
}
async function fileHash(path: string) {
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(path))
        hash.update(bytes);
    return hash.digest("hex");
}
export async function snapshot(repo: string, options: {
    exclude?: string[];
} = {}): Promise<Snapshot> {
    const exclusions = [...baseExclusions, ...(options.exclude ?? []).map(path => `:(exclude)${path}`)];
    const rootResult = await git(resolve(repo), ["rev-parse", "--show-toplevel"]);
    const root = await realpath(rootResult.stdout.trim());
    for (const marker of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD"]) {
        const p = await git(root, ["rev-parse", "--git-path", marker]);
        try {
            await lstat(resolve(root, p.stdout.trim()));
            throw new EngineError(`Repository has ${marker} in progress; finish or abort that operation before verification`, 3);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                throw e;
        }
    }
    const [head, branch, status, diff, names, untracked] = await Promise.all([git(root, ["rev-parse", "--verify", "HEAD"], true), git(root, ["symbolic-ref", "--short", "HEAD"], true), git(root, ["status", "--porcelain=v1", "-z", ...exclusions]), git(root, ["diff", "--no-ext-diff", "--no-textconv", ...((await git(root, ["rev-parse", "--verify", "HEAD"], true)).exit_code === 0 ? ["HEAD"] : []), ...exclusions]), git(root, ["diff", "--name-only", "-z", "--no-ext-diff", "--no-textconv", ...exclusions]), git(root, ["ls-files", "--others", "--exclude-standard", "-z", ...exclusions])]);
    const paths = untracked.stdout.split("\0").filter(Boolean).sort();
    const hashes: Record<string, string> = {};
    for (const path of paths) {
        try {
            const file = join(root, path), st = await lstat(file);
            if (st.isSymbolicLink())
                hashes[path] = `120000:${sha256(await readlink(file))}`;
            else if (st.isFile())
                hashes[path] = `${st.mode & 0o111 ? "100755" : "100644"}:${await fileHash(file)}`;
            else
                hashes[path] = "unsupported";
        }
        catch {
            hashes[path] = "unreadable";
        }
    }
    const statusPaths: string[] = [];
    const fields = status.stdout.split("\0").filter(Boolean);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!;
        statusPaths.push(field.slice(3));
        if (/[RC]/.test(field.slice(0, 2)) && fields[i + 1])
            statusPaths.push(fields[++i]!);
    }
    const head_sha = head.exit_code === 0 ? head.stdout.trim() : null;
    const changed_files = [...new Set([...names.stdout.split("\0").filter(Boolean), ...statusPaths, ...paths])].sort();
    const trackedContent: Record<string, string> = {};
    for (const path of changed_files.filter(p => !paths.includes(p))) {
        try {
            const file = join(root, path), st = await lstat(file);
            trackedContent[path] = st.isSymbolicLink() ? `120000:${sha256(await readlink(file))}` : st.isFile() ? `${st.mode & 0o111 ? "100755" : "100644"}:${await fileHash(file)}` : "unsupported";
        }
        catch {
            trackedContent[path] = "deleted-or-unreadable";
        }
    }
    return { root, head_sha, branch: branch.exit_code === 0 ? branch.stdout.trim() : null, dirty: !!status.stdout, changed_files, untracked: paths, status: status.stdout.replaceAll("\0", "\n"), diff: diff.stdout, untracked_hashes: hashes, fingerprint: sha256(JSON.stringify([head_sha, status.stdout, diff.stdout, hashes, trackedContent])) };
}
export async function fingerprint(repo: string) { return (await snapshot(repo)).fingerprint; }
/** The judgement file must not invalidate itself; all product/config/spec bytes still bind. */
export async function humanSourceFingerprint(repo: string) { return (await snapshot(repo, { exclude: ["wringer.judgements.yaml"] })).fingerprint; }
