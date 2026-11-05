/** What beta gate run 2 (alpha.42, 2026-11-05) found at the door, as the person met it:
 * docs/adoption/evidence/alpha42/BETA_GATE_RUN2_2026-11-05.md. Real trusted-local workspaces,
 * a real `wring job serve` process, real client files in scratch folders; no agent or model. */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDelegationProfile, createAssistantDirectory, createAssistantService, createDelegationJob, delegationControllerRoot, inspectDelegationProfile, readDelegationContext, registerWorkspace } from "@wringer/application";
import { git } from "@wringer/engine";
import { callAssistantConnection } from "../src/assistant-transport";
import { applyClientConnection, previewClientConnection, type ClientSelection } from "../src/client-adapters";
import { createDelegationOwner } from "../src/delegation-owner";
import { installedLauncher } from "../src/adoption-cli";
import { closeOwner } from "../src/owner-close";
import { dispatch } from "../src/app";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const INTENT = "Return the value as 5.";
const present = (path: string) => Bun.file(path).exists().then(file => file || readdir(path).then(() => true, () => false));

async function fixture(destination = false) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-gate2-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = join(root, "repo"), app = join(root, "app"); await mkdir(join(repo, "src"), { recursive: true });
    await git(repo, ["init", "--initial-branch=main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "src/value.ts"), "export const value = 1;\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { test: "bun src/value.ts" } }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    if (destination) { await git(root, ["init", "--bare", "origin.git"]); await git(repo, ["remote", "add", "origin", join(root, "origin.git")]); }
    await createAssistantDirectory(app);
    const preview = await inspectDelegationProfile(app, repo, { runtime: "trusted-local", worker: { adapter: "claude-agent-acp" }, judge: { adapter: "claude-agent-acp" }, source: { kind: "local" }, dependencies: "none" } as any);
    const profile = await applyDelegationProfile(app, preview, { expectedIdentity: preview.identity, actor: "Automated fixture operator", cooperativeLocal: true });
    const workspace = await registerWorkspace(app, { repo, mode: "delegation", client: "codex", execution: "trusted-local", profileId: profile.id, ...(destination ? { destination: { remote: "origin", base: "main" } } : {}) });
    return { root, repo, app, workspace };
}

test("a job's review branch is named after the job, and its evidence explains the internal workspace (F11)", async () => {
    // Claude Code warned the person that the report's workspace ID and the branch's ID "don't match".
    const f = await fixture(true);
    const owner = await createDelegationOwner(f.app, f.workspace.id); cleanup.push(() => owner.stop());
    const job = await createDelegationJob(f.app, f.workspace.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    expect((await readDelegationContext(f.app, f.workspace.id, job.contextId)).destination?.sourceBranch).toBe("wringer/job");
    const controller = await createAssistantService(await delegationControllerRoot(f.app, f.workspace.id, job.contextId));
    expect((await controller.destination(job.id))?.sourceBranch).toBe(`wringer/job/${job.id}`);
    const status: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: job.id });
    expect(status.workspaceId).toBe(f.workspace.id);
    const handle = status.evidence.find((row: any) => row.kind === "report");
    let content = "", offset: number | null = 0;
    while (offset !== null) {
        const page: any = await callAssistantConnection(owner.connectionPath, "wringer.get_evidence", { jobId: job.id, evidenceId: handle.id, contentIdentity: handle.contentIdentity, offset, limit: 8192 });
        content += page.content; offset = page.nextOffset;
    }
    const report = JSON.parse(content);
    expect(report.identities.connectedWorkspaceId).toBe(f.workspace.id);
    expect(report.identities.internalWorkspaceId).toBe(controller.workspace.id);
    expect(report.identities.internalWorkspaceId).not.toBe(f.workspace.id);
    expect(report.identities.note).toContain("names that internal workspace, not the connected one");
    expect(report.identities.note).toContain("wringer/job/ followed by the job's ID");
}, 30000);

test("job close stops the owner that job open left running, and says when there is none (F12)", async () => {
    // The installer's hold said "Stop running owners", and no documented command did.
    const f = await fixture(), owners = join(f.app, "owners", f.workspace.id);
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/launcher.ts"), "job", "serve", "--app-dir", f.app, "--workspace", f.workspace.id], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    cleanup.push(async () => { if (child.exitCode === null) { child.kill(); await child.exited; } });
    for (let n = 0; n < 300 && !await Bun.file(join(owners, "operator.json")).exists(); n++) await Bun.sleep(50);
    expect(await Bun.file(join(owners, "operator.json")).exists()).toBe(true);
    // A job still working would be interrupted, so nothing is signalled.
    const refused = await closeOwner(f.app, f.workspace, { working: async () => [{ jobId: "1".repeat(8) + "-1111-1111-1111-" + "1".repeat(12), state: "running" }] });
    expect(refused.exit).toBe(3); expect(refused.text).toContain("is still working, so the owner was not stopped");
    expect(child.exitCode).toBeNull(); expect(await Bun.file(join(owners, "owner.lock")).exists()).toBe(true);
    const closed: any = await dispatch(["job", "close", "--app-dir", f.app, "--workspace", f.workspace.id]);
    expect(closed.value).toMatchObject({ closed: true, running: false }); expect(closed.text).toContain(`wring job open --workspace ${f.workspace.id} starts it again`);
    await child.exited;
    for (const name of ["owner.lock", "operator.json", "connection.json"]) expect(await Bun.file(join(owners, name)).exists()).toBe(false);
    const again: any = await dispatch(["job", "close", "--app-dir", f.app, "--workspace", f.workspace.id]);
    expect(again.value).toMatchObject({ closed: false, running: false }); expect(again.text).toContain("No operator owner is running");
}, 60000);

test("job close never signals a process the owner record names but that is not the owner (F12)", async () => {
    // A recorded process number can be reused after an owner dies without its records.
    const f = await fixture(), owners = join(f.app, "owners", f.workspace.id); await mkdir(owners, { recursive: true });
    await writeFile(join(owners, "owner.lock"), JSON.stringify({ pid: process.pid, workspaceId: f.workspace.id, at: new Date().toISOString() }));
    const refused = await closeOwner(f.app, f.workspace);
    expect(refused.exit).toBe(3); expect(refused.text).toContain(`Process ${process.pid}, named by the owner record of workspace ${f.workspace.id}, is not its operator owner`);
    await writeFile(join(owners, "owner.lock"), JSON.stringify({ pid: 2 ** 22 + 12345, workspaceId: f.workspace.id }));
    const dead = await closeOwner(f.app, f.workspace);
    expect(dead.exit).toBe(3); expect(dead.text).toContain(`wring recover --workspace ${f.workspace.id} --dry-run`);
}, 30000);

test("removing a connection removes what connect made, keeps the rest, and says what to do next (F14)", async () => {
    // It printed connect's next step and left empty skill folders and a one-newline .codex/config.toml.
    const f = await fixture(), home = join(f.root, "home"); await mkdir(join(home, ".codex"), { recursive: true });
    const base = { client: "codex", scope: "project", repo: f.repo, home, workspaceId: f.workspace.id, launcher: installedLauncher(), mode: "delegation" } as ClientSelection;
    await writeFile(join(home, ".codex/config.toml"), `[projects."${f.repo}"]\ntrust_level = "trusted"\n`);
    await applyClientConnection(f.app, base, (await previewClientConnection(f.app, base)).identity);
    expect(await present(join(f.repo, ".agents/skills/wringer/SKILL.md"))).toBe(true);
    const preview: any = await dispatch(["connect", "--app-dir", f.app, "--workspace", f.workspace.id, "--client", "codex", "--scope", "project", "--remove", "--dry-run"]);
    expect(preview.value.changes.map((row: any) => row.action)).toEqual(["remove", "remove"]);
    expect(preview.value.emptyDirectories).toEqual([".agents/skills/wringer", ".agents/skills", ".agents", ".codex"].map(path => join(f.repo, path)));
    expect(preview.text).toContain("Nothing was removed yet."); expect(preview.text).not.toContain("Start the operator owner");
    expect(preview.value.note).not.toContain("wring job open");
    const removed: any = await dispatch(["connect", "--app-dir", f.app, "--workspace", f.workspace.id, "--client", "codex", "--scope", "project", "--remove", "--apply", "--expected", preview.value.identity]);
    expect(removed.text).toContain("Removed. Reload the client"); expect(removed.text).toContain(`wring job close --workspace ${f.workspace.id}`);
    expect((await readdir(f.repo)).sort()).toEqual([".git", "package.json", "src"]);
    // At user scope the user's own configuration file stays, and a folder holding anything else stays.
    const user = { ...base, scope: "user" } as ClientSelection;
    await mkdir(join(home, ".agents/skills/another"), { recursive: true }); await writeFile(join(home, ".agents/skills/another/SKILL.md"), "---\nname: another\n---\n");
    await applyClientConnection(f.app, user, (await previewClientConnection(f.app, user)).identity);
    const userRemoval = { ...user, remove: true } as ClientSelection;
    await applyClientConnection(f.app, userRemoval, (await previewClientConnection(f.app, userRemoval)).identity);
    expect(Bun.TOML.parse(await Bun.file(join(home, ".codex/config.toml")).text())).toEqual({ projects: { [f.repo]: { trust_level: "trusted" } } });
    expect(await present(join(home, ".agents/skills/wringer"))).toBe(false);
    expect(await Bun.file(join(home, ".agents/skills/another/SKILL.md")).exists()).toBe(true);
}, 30000);
