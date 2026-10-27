/** TEST SUPPORT ONLY: a real Git repository holding one playbook tree, and the v6
 * selection that pins it. Repo-local identity, signing disabled, no global config. */
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hashBytes } from "../src/canonical";
import type { PlaybookSelection, PlaybookSurface } from "../src/types";
import { PLAYBOOK_ALWAYS_ON, playbookTreeEntry } from "../src/playbook-paths";

export const TREE_ID = "repair-first";
export const TREE_DIRECTORY = `wringer/playbooks/${TREE_ID}/`;
export const MANIFEST_PATH = `${TREE_DIRECTORY}manifest.json`;
/** A small valid tree: always-on file, one triggered skill, one referenced script, notes. */
export function treeFiles(surface: PlaybookSurface = "claude-code"): Record<string, string> {
    const always = PLAYBOOK_ALWAYS_ON[surface];
    return {
        [always]: "# Worker playbook\nBefore editing, use the repair-first skill: read the failing check, then change the smallest source file.\nRun scripts/wringer/inspect.sh to list the checks.\n",
        "skills/repair-first/SKILL.md": "---\nname: repair-first\ndescription: Use when an acceptance check fails; read its output before editing.\n---\nRead the named check's output, then repair src/ only.\n",
        "scripts/inspect.sh": "#!/bin/sh\nset -eu\nls tests\n",
        "NOTES.md": "Fixture tree; no efficacy measured.\n",
    };
}
export function treeManifest(surface: PlaybookSurface, files: Record<string, string>, overrides: Record<string, unknown> = {}) {
    const rows = Object.keys(files).sort().map(path => ({ path, sha256: hashBytes(files[path]!), kind: playbookTreeEntry(surface, path)?.kind ?? "notes" }));
    return { schema_version: "wringer.playbook.v2", id: TREE_ID, revision: "one", title: "Repair from the failing check", role: "worker", taskFamily: "total", surface, files: rows, limits: ["Fixture only; no efficacy measured."], evaluationRefs: [], ...overrides };
}
export async function git(repo: string, ...args: string[]) {
    const child = Bun.spawn(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code) throw new Error(err); return out.trim();
}
export const REPOSITORY_FILES: Record<string, string> = { "README.md": "Fixture\n", "src/total.ts": "export const total = () => 4;\n", "tests/acceptance.test.ts": "import { expect, test } from \"bun:test\";\nimport { total } from \"../src/total\";\ntest(\"total\", () => expect(total()).toBe(5));\n", "package.json": "{}\n", "bun.lock": "{}\n" };
/** Commit the repository and tree; returns the commit and the exact v6 selection. */
export async function treeRepository(options: { surface?: PlaybookSurface; files?: Record<string, string>; manifest?: Record<string, unknown>; repository?: Record<string, string>; extraTreeFiles?: Record<string, string>; replace?: string[] } = {}) {
    const surface = options.surface ?? "claude-code", files = options.files ?? treeFiles(surface);
    const repo = await mkdtemp(join(tmpdir(), "wringer-playbook-tree-"));
    await git(repo, "init", "-q");
    const write = async (path: string, content: string) => { await mkdir(dirname(join(repo, path)), { recursive: true }); await writeFile(join(repo, path), content); };
    for (const [path, content] of Object.entries(options.repository ?? REPOSITORY_FILES)) await write(path, content);
    for (const [path, content] of Object.entries({ ...files, ...options.extraTreeFiles })) await write(TREE_DIRECTORY + path, content);
    const manifest = JSON.stringify(options.manifest ?? treeManifest(surface, files));
    await write(MANIFEST_PATH, manifest);
    await git(repo, "add", "-A"); await git(repo, "commit", "-qm", "Fixture with a playbook tree");
    const selection: PlaybookSelection = { path: MANIFEST_PATH, sha256: hashBytes(manifest), taskFamily: "total", surface, files: Object.keys(files).sort().map(path => ({ path: TREE_DIRECTORY + path, sha256: hashBytes(files[path]!) })), ...(options.replace ? { replace: options.replace } : {}) };
    return { repo, commit: await git(repo, "rev-parse", "HEAD"), selection, manifest };
}
