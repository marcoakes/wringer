/**
 * The source comparison a CI coordinator makes by hand.
 *
 * ZenJev's `ci-verify.mjs` checked `git rev-parse HEAD` and `git status --porcelain`
 * before AND after verification, because a gate that edits tracked source and then
 * passes leaves a green result that no longer describes the commit anybody will
 * review. Wringer captured its snapshot fingerprint before the gates and nothing
 * after, so the second half of that check had no home.
 *
 * `exact_source` is about TRACKED paths and nothing else. Ignored build output is
 * permitted — a build that writes `dist/` is not a gate rewriting the product, and
 * refusing it would make strict mode unusable on every real project — so it is
 * counted rather than hidden. A path Git neither tracks nor ignores is neither:
 * it changes the fingerprint, it does not take the claim away, and the sentence
 * says so rather than leaving a reader to wonder why two digests differ.
 */
import { git, snapshot } from "./git";
import type { Snapshot } from "./types";
export interface StrictSource {
    before: string;
    after: string;
    changed_tracked: string[];
    permitted_ignored: number;
    exact_source: boolean;
    reason: string;
}
/** How many paths Git ignores were present when the checks finished. */
async function ignoredPaths(repo: string): Promise<number> {
    const listed = await git(repo, ["status", "--porcelain=v1", "-z", "--ignored=matching", "--", ".", ":(exclude).wringer", ":(exclude).wringer/**"], true);
    if (listed.exit_code !== 0)
        return 0;
    return listed.stdout.split("\0").filter(entry => entry.startsWith("!!")).length;
}
export async function strictSource(repo: string, before: Snapshot): Promise<StrictSource> {
    const after = await snapshot(repo);
    const tracked = (snap: Snapshot) => new Set(snap.changed_files.filter(path => !snap.untracked.includes(path)));
    const wasTracked = tracked(before), isTracked = tracked(after);
    const changed_tracked = [...new Set([...isTracked].filter(path => !wasTracked.has(path)))].sort();
    const appeared = after.untracked.filter(path => !before.untracked.includes(path));
    const permitted_ignored = await ignoredPaths(repo);
    const exact_source = changed_tracked.length === 0;
    const aside = [
        permitted_ignored ? `${permitted_ignored} ignored path(s) are present, which is permitted build output` : "",
        appeared.length ? `${appeared.length} path(s) Git neither tracks nor ignores appeared (${appeared.slice(0, 4).join(", ")}${appeared.length > 4 ? ", …" : ""}), which this claim does not cover` : "",
    ].filter(Boolean).join("; ");
    return {
        before: before.fingerprint, after: after.fingerprint, changed_tracked, permitted_ignored, exact_source,
        reason: exact_source
            ? `Strict: no tracked file changed while the checks ran${aside ? `; ${aside}` : ""}. This result describes the commit under review.`
            : `Strict: ${changed_tracked.length} tracked file(s) changed while the checks ran (${changed_tracked.slice(0, 8).join(", ")}${changed_tracked.length > 8 ? ", …" : ""}). A gate wrote to the source under review, so this run cannot leave an exact-source claim however green its gates were${aside ? `; ${aside}` : ""}.`,
    };
}
