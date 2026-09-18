import { afterEach, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditRehearsalClone } from "../../../scripts/rehearsal-clone-audit";
import { Redactor } from "../../engine/src/io";
import { runProcess } from "../../engine/src/process";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const deliveryId = `contained-${"a".repeat(24)}`;
async function fixture(options: { outside?: string; modifySource?: boolean; previousEvidence?: boolean } = {}) {
    const root = await mkdtemp(join(tmpdir(), "wringer-clone-lineage-")); roots.push(root);
    const source = join(root, "source"), clone = join(root, "reviewed-change");
    await mkdir(source);
    const git = async (cwd: string, args: string[]) => {
        const result = await runProcess(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", cwd, ...args], { cwd: root, timeout: 10, env: { PATH: "/usr/bin:/bin", HOME: root, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, redactor: new Redactor([], {}, [], false) });
        if (result.exit_code !== 0 || result.timed_out) throw new Error(result.stderr);
        return result.stdout.trim();
    };
    const put = async (path: string, text: string) => { await mkdir(join(source, path, ".."), { recursive: true }); await writeFile(join(source, path), text); };
    const commit = async (message: string) => { await git(source, ["add", "-A"]); await git(source, ["commit", "-m", message]); return git(source, ["rev-parse", "HEAD"]); };
    await git(source, ["init", "--initial-branch=main"]);
    await put(".gitignore", ".evidence/\n"); await put(".gitattributes", "src/app.ts filter=fixture\n"); await put("src/app.ts", "inert original fixture bytes\n");
    const base = await commit("original source");
    await put("src/app.ts", "inert corrected fixture bytes\n");
    const prefix = `.wringer/deliveries/${deliveryId}/`;
    if (options.previousEvidence) await put(prefix + "existing.json", "old evidence\n");
    const codeCommit = await commit("corrected source");
    const tree = await git(source, ["rev-parse", "HEAD^{tree}"]);
    await put(prefix + "manifest.json", "inert fixture manifest, not a bundle audit\n");
    await put(prefix + "nested/tab\tand\nnewline.json", "NUL-delimited path fixture\n");
    if (options.outside) await put(options.outside, "unexpected evidence-commit addition\n");
    if (options.modifySource) await put("src/app.ts", "changed after review\n");
    if (options.previousEvidence) await put(prefix + "existing.json", "rewritten evidence\n");
    const evidenceCommit = await commit("evidence additions");
    await git(root, ["clone", "--no-local", "--", source, clone]);
    const input = { clone, delivery: { deliveryId, codeCommit, evidenceCommit }, projection: { deliveryId, source: { codeCommit, tree } } };
    return { root, source, clone, base, input, prefix, git: (args: string[]) => git(clone, args) };
}

test("fresh no-local clone binds exact evidence commit, source parent/tree and NUL-delimited evidence additions", async () => {
    const f = await fixture(), result = await auditRehearsalClone(f.input);
    expect(result).toMatchObject({ ...f.input.delivery, sourceTree: f.input.projection.source.tree, cleanCheckout: true });
    expect(result.evidenceFiles).toEqual([f.prefix + "manifest.json", f.prefix + "nested/tab\tand\nnewline.json"]);
});

test("an extra commit is rejected even when the original audited bundle remains unchanged", async () => {
    const f = await fixture();
    await f.git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "extra commit"]);
    await expect(auditRehearsalClone(f.input)).rejects.toThrow("HEAD is not the pinned evidence commit");
});

test("wrong source parent, projected source tree and projection identity cannot borrow valid evidence", async () => {
    const f = await fixture();
    await expect(auditRehearsalClone({ ...f.input, delivery: { ...f.input.delivery, codeCommit: f.base }, projection: { ...f.input.projection, source: { ...f.input.projection.source, codeCommit: f.base } } })).rejects.toThrow("one parent");
    await expect(auditRehearsalClone({ ...f.input, projection: { ...f.input.projection, source: { ...f.input.projection.source, tree: f.base } } })).rejects.toThrow("source tree");
    await expect(auditRehearsalClone({ ...f.input, projection: { ...f.input.projection, deliveryId: `contained-${"b".repeat(24)}` } })).rejects.toThrow("projection disagree");
});

test("a merge evidence commit is rejected even when its first parent and tree appear correct", async () => {
    const f = await fixture(), tree = await f.git(["rev-parse", "HEAD^{tree}"]);
    const merge = await f.git(["commit-tree", tree, "-p", f.input.delivery.codeCommit, "-p", f.base, "-m", "multiple parents"]);
    await f.git(["checkout", "--detach", merge]);
    await expect(auditRehearsalClone({ ...f.input, delivery: { ...f.input.delivery, evidenceCommit: merge } })).rejects.toThrow("one parent");
});

for (const outside of ["extra.txt", `.wringer/deliveries/${deliveryId}-lookalike/file.json`, `.wringer/deliveries/contained-${"b".repeat(24)}/file.json`]) test(`refuse an evidence commit adding outside the exact delivery prefix: ${outside}`, async () => {
    const f = await fixture({ outside });
    await expect(auditRehearsalClone(f.input)).rejects.toThrow("only add files inside its exact delivery directory");
});

test("evidence cannot modify reviewed source or rewrite an existing evidence file", async () => {
    for (const options of [{ modifySource: true }, { previousEvidence: true }]) {
        const f = await fixture(options);
        await expect(auditRehearsalClone(f.input)).rejects.toThrow("only add files inside its exact delivery directory");
    }
});

for (const mode of ["tracked", "staged", "untracked", "ignored", "assume-unchanged", "skip-worktree"]) test(`refuse dirty or concealed checkout: ${mode}`, async () => {
    const f = await fixture();
    if (["assume-unchanged", "skip-worktree"].includes(mode)) await f.git(["update-index", `--${mode}`, "src/app.ts"]);
    const path = mode === "untracked" ? "untracked.txt" : mode === "ignored" ? ".evidence/output.txt" : "src/app.ts";
    await mkdir(join(f.clone, path, ".."), { recursive: true }); await writeFile(join(f.clone, path), "unreviewed checkout bytes\n");
    if (mode === "staged") await f.git(["add", "src/app.ts"]);
    await expect(auditRehearsalClone(f.input)).rejects.toThrow(["assume-unchanged", "skip-worktree"].includes(mode) ? "index contains hidden" : "checkout has");
});

test("reject revision expressions and delivery path traversal before Git inspection", async () => {
    const f = await fixture();
    await expect(auditRehearsalClone({ ...f.input, delivery: { ...f.input.delivery, evidenceCommit: "HEAD" } })).rejects.toThrow("complete Git object hashes");
    await expect(auditRehearsalClone({ ...f.input, delivery: { ...f.input.delivery, deliveryId: "../other" } })).rejects.toThrow("invalid pinned delivery ID");
});

test("repository filter settings and includes are rejected before worktree inspection can execute them", async () => {
    const f = await fixture(), marker = join(f.root, "filter-was-executed");
    await f.git(["config", "filter.fixture.clean", `/usr/bin/touch '${marker.replaceAll("'", "'\\''")}'`]);
    await writeFile(join(f.clone, "src/app.ts"), "force a worktree refresh\n");
    await expect(auditRehearsalClone(f.input)).rejects.toThrow("worktree filters");
    expect(await access(marker).then(() => true, () => false)).toBe(false);
    await f.git(["config", "--unset", "filter.fixture.clean"]);
    const config = join(f.root, "hidden-filter.config");
    await writeFile(config, `[filter "fixture"]\n\tprocess = /usr/bin/touch ${marker}\n`);
    await f.git(["config", "include.path", config]);
    await expect(auditRehearsalClone(f.input)).rejects.toThrow("worktree filters");
    expect(await access(marker).then(() => true, () => false)).toBe(false);
});
