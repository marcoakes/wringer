/** Read-only Git checks that bind a rehearsal's fresh checkout to its audited bundle.
 * Bundle validation remains separate; no repository program is executed here. */
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Redactor } from "../packages/engine/src/io";
import { runProcess } from "../packages/engine/src/process";

export interface RehearsalCloneAuditInput {
    clone: string;
    delivery: { deliveryId: string; evidenceCommit: string; codeCommit: string };
    projection: { deliveryId: string; source: { codeCommit: string; tree: string } };
}

export async function auditRehearsalClone(input: RehearsalCloneAuditInput) {
    const { delivery, projection } = input;
    const insist = (condition: unknown, message: string) => { if (!condition) throw new Error(`Fresh-clone lineage: ${message}`); };
    const hash = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
    insist(isAbsolute(input.clone), "clone root must be absolute");
    insist(/^contained-[a-f0-9]{24}$/.test(delivery.deliveryId), "invalid pinned delivery ID");
    insist([delivery.evidenceCommit, delivery.codeCommit, projection.source.codeCommit, projection.source.tree].every(value => hash.test(value)), "expected complete Git object hashes");
    insist(projection.deliveryId === delivery.deliveryId && projection.source.codeCommit === delivery.codeCommit, "publication and audited projection disagree");
    const clone = await realpath(input.clone);
    const gitDirectory = await lstat(join(clone, ".git"));
    insist(gitDirectory.isDirectory() && !gitDirectory.isSymbolicLink(), "expected an ordinary fresh clone with its own Git directory");
    const git = async (args: string[]) => {
        const result = await runProcess(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.ignoreStat=false", "-c", "core.fileMode=true", "-C", clone, ...args], {
            cwd: clone, timeout: 20, maxBytes: 8 * 1024 * 1024,
            env: { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", LANG: "C" },
            redactor: new Redactor([], {}, [], false),
        });
        insist(result.exit_code === 0 && !result.timed_out && !result.interrupted && !result.stdout_truncated && !result.stderr_truncated, "bounded read-only Git inspection failed");
        return result.stdout;
    };
    // Worktree refresh can run clean/process filters. An ordinary new clone has
    // no such local settings; refuse includes that could conceal them as well.
    const config = (await git(["config", "--local", "--no-includes", "--list", "-z"])).split("\0").filter(Boolean);
    insist(config.every(entry => !/^(?:filter\.|include\.|includeif\.|extensions\.worktreeconfig$)/i.test(entry.split("\n", 1)[0]!)), "local configuration can load or execute worktree filters");
    insist(await realpath((await git(["rev-parse", "--show-toplevel"])).trim()) === clone, "audit must start at the clone root");
    const head = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
    insist(head === delivery.evidenceCommit, "HEAD is not the pinned evidence commit");
    // Read the actual object header: shallow boundaries must not hide parents.
    const headers = (await git(["cat-file", "-p", head])).split("\n\n", 1)[0]!.split("\n");
    const parents = headers.filter(line => line.startsWith("parent ")).map(line => line.slice(7));
    insist(parents.length === 1 && parents[0] === delivery.codeCommit, "evidence commit must have exactly the pinned source commit as its one parent");
    const sourceTree = (await git(["rev-parse", "--verify", `${delivery.codeCommit}^{tree}`])).trim();
    insist(sourceTree === projection.source.tree, "source tree differs from the audited projection");
    const evidencePath = `.wringer/deliveries/${delivery.deliveryId}/`;
    const changes = (await git(["diff-tree", "--no-commit-id", "--no-renames", "--no-ext-diff", "--no-textconv", "-r", "--name-status", "-z", delivery.codeCommit, head, "--"])).split("\0");
    insist(changes.pop() === "" && changes.length > 0 && changes.length % 2 === 0, "evidence commit must contain a bounded nonempty path diff");
    const evidenceFiles: string[] = [];
    for (let i = 0; i < changes.length; i += 2) {
        const status = changes[i], path = changes[i + 1]!;
        insist(status === "A" && path.startsWith(evidencePath) && path.length > evidencePath.length, "evidence commit must only add files inside its exact delivery directory");
        evidenceFiles.push(path);
    }
    // Index flags can conceal tracked edits from status; fresh clones need neither.
    const entries = (await git(["ls-files", "-v", "-z"])).split("\0");
    insist(entries.pop() === "" && entries.every(entry => entry.startsWith("H ")), "index contains hidden or unresolved tracked entries");
    insist(!(await git(["ls-files", "--stage", "-z"])).split("\0").some(entry => entry.startsWith("160000 ")), "submodule worktrees are outside this fresh-clone audit");
    insist(await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--ignore-submodules=none"]) === "", "checkout has tracked, untracked or ignored changes");
    return { deliveryId: delivery.deliveryId, evidenceCommit: head, codeCommit: delivery.codeCommit, sourceTree, evidencePath, evidenceFiles, cleanCheckout: true as const };
}
