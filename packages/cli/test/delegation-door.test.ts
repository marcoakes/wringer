/** The documented trusted-local door, as a newcomer meets it. Each case is a dead
 * end one reached by following docs/START_AGENT.md on 2026-10-31 at alpha.39. */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDelegationProfile, createAssistantDirectory, createDelegationJob, inspectDelegationProfile, registerWorkspace } from "@wringer/application";
import { git } from "@wringer/engine";
import { chromium } from "playwright";
import { assistantCommand } from "../src/assistant-cli";
import { stopForPerson } from "../src/assistant-job";
import { callAssistantConnection } from "../src/assistant-transport";
import { createDelegationOwner } from "../src/delegation-owner";
import { validatePmJob } from "@wringer/board";
import { dispatch } from "../src/app";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const INTENT = "Return the value as 5.";
const proposal = { intent: INTENT, title: "Return five", criteria: [{ id: "test", title: "The test passes", quote: INTENT, kind: "check", required: true }], checks: [{ id: "test", criteria: ["test"] }] };

async function fixture(layout: "src" | "root" = "src", destination?: { remote: string; base: string }) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-door-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = join(root, "repo"), app = join(root, "app"); await mkdir(join(repo, "tests"), { recursive: true });
    await git(repo, ["init", "--initial-branch=main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    if (layout === "src") { await mkdir(join(repo, "src")); await writeFile(join(repo, "src/value.ts"), "export const value = 1;\n"); } else await writeFile(join(repo, "value.ts"), "export const value = 1;\n");
    await writeFile(join(repo, "tests/check.ts"), 'throw new Error("Inspection must not run me");\n');
    await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { test: "bun tests/check.ts" } }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    await createAssistantDirectory(app);
    if (layout === "root") return { root, repo, app };
    const preview = await inspectDelegationProfile(app, repo, { runtime: "trusted-local", worker: { adapter: "claude-agent-acp" }, judge: { adapter: "claude-agent-acp" }, source: { kind: "local" }, dependencies: "none" } as any);
    const profile = await applyDelegationProfile(app, preview, { expectedIdentity: preview.identity, actor: "Automated fixture operator", cooperativeLocal: true });
    const workspace = await registerWorkspace(app, { repo, mode: "delegation", client: "claude-code", execution: "trusted-local", profileId: profile.id, ...(destination ? { destination } : {}) });
    return { root, repo, app, workspace };
}
const setupArgs = (app: string, repo: string, extra: string[] = []) => ["setup", "--app-dir", app, "--repo", repo, "--client", "claude-code", "--mode", "delegation", "--runtime", "trusted-local", "--worker-adapter", "claude-agent-acp", "--judge-adapter", "claude-agent-acp", "--source", "local", "--dependencies", "none", "--dry-run", ...extra];

test("a client connecting before any owner runs is told exactly how to start one", async () => {
    const f = await fixture(), connection = join(f.app, "owners", f.workspace!.id, "connection.json");
    // The owner directory does not exist until an owner has run: the raw error was an lstat ENOENT.
    await expect(assistantCommand(["mcp", "--connection", connection])).rejects.toThrow(`wring job open --workspace ${f.workspace!.id}`);
}, 15000);

test("the connection preview says the owner must be started", async () => {
    const f = await fixture();
    const preview: any = await dispatch(["connect", "--app-dir", f.app, "--workspace", f.workspace!.id, "--client", "claude-code", "--scope", "project", "--dry-run"]);
    expect(preview.value.note).toContain(`wring job open --workspace ${f.workspace!.id}`);
}, 15000);

test("a job prepared while the owner runs can be proposed on at once", async () => {
    const f = await fixture();
    const owner = await createDelegationOwner(f.app, f.workspace!.id); cleanup.push(() => owner.stop());
    // Another process's `wring job new`, before the owner's next one-second sweep.
    const job = await createDelegationJob(f.app, f.workspace!.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    const status: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: job.id });
    expect(status.code).toBeUndefined(); expect(status.outcome).toBe("needs-decision");
    const proposed: any = await callAssistantConnection(owner.connectionPath, "wringer.propose", { workspaceId: f.workspace!.id, idempotencyKey: crypto.randomUUID(), proposal });
    expect(proposed.code).toBeUndefined(); expect(proposed.outcome).toBe("awaiting-approval");
}, 30000);

test("a repository with no conventional source folder is told which flag to use and what it could name", async () => {
    const f = await fixture("root");
    const refusal: any = await dispatch(setupArgs(f.app, f.repo)).then(() => new Error("Setup widened scope"), error => error);
    expect(refusal.message).toContain("--writable PATH");
    expect(refusal.message).toContain("value.ts");
    expect(refusal.next_move).toBe("wring setup --help");
    expect((await dispatch(setupArgs(f.app, f.repo, ["--writable", "value.ts"]))).value).toMatchObject({ selection: { writable: ["value.ts"] } });
}, 15000);

test("a setup with no destination says a finished job could not be sent, before anything is kept", async () => {
    const f = await fixture();
    const without: any = await dispatch(setupArgs(f.app, f.repo));
    expect(without.value.limits.join("\n")).toContain("--remote NAME --base BRANCH");
    const withDestination: any = await dispatch(setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main"]));
    expect(withDestination.value.limits.join("\n")).not.toContain("--remote NAME --base BRANCH");
    // Choosing a destination does not change the reviewed profile's identity.
    expect(withDestination.value.identity).toBe(without.value.identity);
}, 15000);

test("the approval page says when the result could not be sent, and a locked page names its command", async () => {
    const f = await fixture();
    const owner = await createDelegationOwner(f.app, f.workspace!.id); cleanup.push(() => owner.stop());
    const locked = await fetch(owner.page + "/api/jobs");
    expect(locked.status).toBe(401);
    expect(((await locked.json()) as any).error).toContain(`wring job open --workspace ${f.workspace!.id}`);
    await createDelegationJob(f.app, f.workspace!.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    const proposed: any = await callAssistantConnection(owner.connectionPath, "wringer.propose", { workspaceId: f.workspace!.id, idempotencyKey: crypto.randomUUID(), proposal });
    const bearer = owner.operatorUrl.split("#token=")[1]!;
    const read = async (path: string) => (await fetch(owner.page + path, { headers: { Authorization: `Bearer ${bearer}` } })).json() as Promise<any>;
    const job = await read(`/api/job?jobId=${proposed.jobId}`);
    expect(job.phase).toBe("approval");
    expect(job.nextAction).toContain("cannot be sent");
    expect(job.nextAction).toContain("--remote NAME --base BRANCH");
    // Two jobs on one request stay tellable apart in the picker.
    const { jobs } = await read("/api/jobs");
    expect(jobs.length).toBe(2);
    for (const row of jobs) expect(Date.parse(row.createdAt)).toBeGreaterThan(0);
    // The documented route answers the job `wring job new` made. Since alpha.44 (W7) the picker keeps that
    // job under its own ID, and its revised record is only a revision of it.
    const placeholder = jobs.find((row: any) => row.jobId !== proposed.jobId).jobId;
    const pending: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: placeholder });
    const revised: any = await callAssistantConnection(owner.connectionPath, "wringer.revise_proposal", { jobId: placeholder, idempotencyKey: crypto.randomUUID(), expectedRevision: pending.revision, proposal });
    expect(revised.outcome).toBe("awaiting-approval");
    const after = (await read("/api/jobs")).jobs;
    expect(after.map((row: any) => row.jobId).sort()).toEqual([placeholder, proposed.jobId].sort());
    expect(after.find((row: any) => row.jobId === placeholder).revisionIds).toEqual([revised.jobId]);
    expect((await read(`/api/job?jobId=${placeholder}`)).phase).toBe("approval");
}, 30000);

test("a stop only a new check can resolve tells the person what to do, without controller paths", () => {
    const copy = stopForPerson("acceptance-born-green")!;
    expect(copy).toContain("add a test that fails today");
    expect(copy).not.toContain("[controller]");
    expect(stopForPerson("worker-stopped")).toBeNull();
    expect(stopForPerson(undefined)).toBeNull();
});

test("the private page unlocks in the same tab, drops its stale notice and never repeats a stop", async () => {
    const f = await fixture();
    const owner = await createDelegationOwner(f.app, f.workspace!.id); cleanup.push(() => owner.stop());
    await createDelegationJob(f.app, f.workspace!.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    const proposed: any = await callAssistantConnection(owner.connectionPath, "wringer.propose", { workspaceId: f.workspace!.id, idempotencyKey: crypto.randomUUID(), proposal });
    const browser = await chromium.launch({ headless: true }); cleanup.push(() => browser.close());
    const page = await browser.newPage();
    // The decision link an assistant relays carries no credential, so a first visit is locked.
    await page.goto(`${owner.page}/?jobId=${proposed.jobId}`);
    await page.locator("#job-message").filter({ hasText: `wring job open --workspace ${f.workspace!.id}` }).waitFor({ timeout: 10000 });
    await page.locator("#job-empty").filter({ hasText: "once this browser is unlocked" }).waitFor({ timeout: 10000 });
    // The same tab then follows the private link: only the fragment differs.
    await page.goto(`${owner.page}/?jobId=${proposed.jobId}#token=${owner.operatorUrl.split("#token=")[1]}`);
    await page.locator("#approval-panel").waitFor({ state: "visible", timeout: 15000 });
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.locator("#approval-source").innerText()).toContain("The local repository on this computer");
    expect(await page.locator("#job-next-action").innerText()).toContain("cannot be sent");
    expect(await page.locator("#approval-agents").isVisible()).toBeTrue();
    expect(await page.locator("#approval-agents").innerText()).toContain(`have not been checked. To check them without a model prompt, run wring job check --workspace ${f.workspace!.id}`);
    // Two jobs on one request stay tellable apart.
    const options = await page.locator("#job-picker option").allInnerTexts();
    const labelled = options.filter(text => text.endsWith(INTENT));
    expect(labelled.length).toBe(2);
    for (const text of labelled) expect(text).toMatch(/\d.* · /);
    // A decision the controller accepted: its notice goes once the recorded outcome is shown.
    await page.locator("#stop-job").click();
    await page.waitForFunction(() => document.getElementById("phase-title")?.textContent !== "Approve the work, then leave it with us.", undefined, { timeout: 15000 });
    await page.waitForFunction(() => !document.getElementById("job-message")?.textContent?.includes("received your decision"), undefined, { timeout: 15000 });
    const shown = await page.evaluate(() => ({ lead: document.getElementById("job-next-action")!.hidden, errorHidden: document.getElementById("job-error")!.hidden }));
    expect(shown).toEqual({ lead: true, errorHidden: false });
}, 60000);

/** The adapter the profile names is `npx …`: a stand-in on PATH keeps this a real process and real ACP, with no model. */
async function adapterOnPath(root: string, body: string) {
    const directory = join(root, "stub-bin"); await mkdir(directory);
    await writeFile(join(directory, "npx"), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    const path = process.env.PATH; process.env.PATH = `${directory}:${path}`;
    cleanup.push(async () => { process.env.PATH = path; });
}
const fixtureAgent = join(import.meta.dir, "../../application/fixtures/host-acp-agent.ts");

test("the check starts each agent without a prompt, records what happened and says what it does not prove", async () => {
    const f = await fixture(); await adapterOnPath(f.root, `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixtureAgent)} worker`);
    const checked: any = await dispatch(["job", "check", "--app-dir", f.app, "--workspace", f.workspace!.id]);
    expect(checked.exit).toBe(0);
    expect(checked.value).toMatchObject({ schema_version: "wringer.agent-check.v1", workspaceId: f.workspace!.id, ready: true, promptSent: false, modelWorkRequested: false });
    expect(checked.value.roles.map((row: any) => [row.role, row.ready])).toEqual([["worker", true], ["judge", true]]);
    expect(checked.value.roles[0].agent).toEqual({ name: "host-fixture", version: "0" });
    expect(checked.text).toContain("worker: Started host-fixture 0 and opened a session.");
    expect(checked.text).toContain("No model prompt was sent.");
    expect(checked.text).toContain("does not show its sign-in still works");
    expect(checked.text).toContain(`Next: wring job new --workspace ${f.workspace!.id}`);
    // A session opens in a throwaway clone: nothing in the repository changed.
    expect((await git(f.repo, ["status", "--porcelain"])).stdout).toBe("");
}, 30000);

test("an agent that cannot start fails the check before anyone approves, and the page says so", async () => {
    const f = await fixture(); await adapterOnPath(f.root, `echo "npm error network unreachable" >&2\nexit 1`);
    const checked: any = await dispatch(["job", "check", "--app-dir", f.app, "--workspace", f.workspace!.id]);
    expect(checked.exit).toBe(3);
    expect(checked.value.ready).toBe(false);
    expect(checked.value.roles[0]).toMatchObject({ role: "worker", ready: false, agent: null });
    expect(checked.value.roles[0].detail).toContain("could not start: npm error network unreachable");
    expect(checked.text).toContain("Next: fix what stopped it, then run wring job check");
    const owner = await createDelegationOwner(f.app, f.workspace!.id); cleanup.push(() => owner.stop());
    await createDelegationJob(f.app, f.workspace!.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    const proposed: any = await callAssistantConnection(owner.connectionPath, "wringer.propose", { workspaceId: f.workspace!.id, idempotencyKey: crypto.randomUUID(), proposal });
    const browser = await chromium.launch({ headless: true }); cleanup.push(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`${owner.page}/?jobId=${proposed.jobId}#token=${owner.operatorUrl.split("#token=")[1]}`);
    await page.locator("#approval-panel").waitFor({ state: "visible", timeout: 15000 });
    const line = page.locator("#approval-agents");
    expect(await line.isVisible()).toBeTrue();
    expect(await line.innerText()).toContain("could not start: npm error network unreachable");
    expect(await line.innerText()).toContain("Approving now would stop at that step");
    expect(await line.getAttribute("class")).toContain("error");
    // A later check replaces what the page shows, without anyone reloading it.
    process.env.PATH = process.env.PATH!.replace(`${join(f.root, "stub-bin")}:`, "");
    await adapterOnPath(await mkdtemp(join(f.root, "second-")), `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(fixtureAgent)} worker`);
    expect(((await dispatch(["job", "check", "--app-dir", f.app, "--workspace", f.workspace!.id])) as any).exit).toBe(0);
    await page.waitForFunction(() => document.getElementById("approval-agents")?.textContent?.includes("each one started and opened a session"), undefined, { timeout: 15000 });
    expect(await line.getAttribute("class")).not.toContain("error");
}, 60000);

test("an unchecked workspace says how to check, and approval is still possible", async () => {
    const f = await fixture();
    const owner = await createDelegationOwner(f.app, f.workspace!.id); cleanup.push(() => owner.stop());
    await createDelegationJob(f.app, f.workspace!.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    const proposed: any = await callAssistantConnection(owner.connectionPath, "wringer.propose", { workspaceId: f.workspace!.id, idempotencyKey: crypto.randomUUID(), proposal });
    const job: any = await (await fetch(`${owner.page}/api/job?jobId=${proposed.jobId}`, { headers: { Authorization: `Bearer ${owner.operatorUrl.split("#token=")[1]}` } })).json();
    expect(job.phase).toBe("approval");
    expect(job.agentCheck).toEqual({ command: `wring job check --workspace ${f.workspace!.id}`, latest: null });
    expect(validatePmJob(job).agentCheck).toEqual(job.agentCheck);
    expect(() => validatePmJob({ ...job, agentCheck: { command: "x", latest: { at: "not a date", ready: true, roles: [], limit: "" } } })).toThrow("incomplete or unreadable");
}, 30000);

test("the check is only for a workspace that starts agents on this computer", async () => {
    const f = await fixture();
    await writeFile(join(f.repo, ".wringer.yaml"), "version: 1\ngates:\n  - id: test\n    run: bun tests/check.ts\n");
    await git(f.repo, ["add", "."]); await git(f.repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "Checks"]);
    const verification = await registerWorkspace(f.app, { repo: f.repo, mode: "verification", client: "claude-code" });
    await expect(dispatch(["job", "check", "--app-dir", f.app, "--workspace", verification.id])).rejects.toThrow("has no coding agents to check");
    const contained = await registerWorkspace(f.app, { repo: f.repo, mode: "delegation", client: "generic", profileId: f.workspace!.preferences.profileId! });
    await expect(dispatch(["job", "check", "--app-dir", f.app, "--workspace", contained.id])).rejects.toThrow("wring runtime measure");
}, 30000);

test("job new names the prepared job for the assistant, and job open --print hands the person its private link", async () => {
    // Beta gate run 1: Codex was never told the job job new prepared, and the private page
    // could only be unlocked in the default browser.
    const f = await fixture();
    const created: any = await dispatch(["job", "new", "--app-dir", f.app, "--workspace", f.workspace!.id, "--intent", INTENT]);
    expect(created.text).toContain(`Please delegate this to Wringer on prepared job ${created.value.id}: YOUR REQUEST`);
    expect(created.text).toContain("Nothing is proposed or approved yet.");
    const owner = join(f.app, "owners", f.workspace!.id), url = `http://127.0.0.1:4567/#token=${"a".repeat(64)}`; await mkdir(owner, { recursive: true });
    await writeFile(join(owner, "operator.json"), JSON.stringify({ schema_version: "wringer.operator-location.v1", pid: process.pid, url }));
    const printed: any = await dispatch(["job", "open", "--app-dir", f.app, "--workspace", f.workspace!.id, "--job", created.value.id, "--print"]);
    expect(printed.value).toEqual({ opened: false, printed: true, url: `http://127.0.0.1:4567/?jobId=${created.value.id}#token=${"a".repeat(64)}`, workspaceId: f.workspace!.id, jobId: created.value.id });
    expect(printed.text).toContain(printed.value.url); expect(printed.text).toContain("Anyone who opens it can act as you");
    await expect(dispatch(["job", "open", "--app-dir", f.app, "--workspace", f.workspace!.id, "--print=yes"])).rejects.toThrow("--print takes no value");
});

test("the skill and guides send an assistant to the prepared job, name trusted-local plainly and say approval starts the work", async () => {
    // Beta gate run 1 (F2, F3, F4, F8, F9): what Codex read did not match what Wringer does.
    const read = (path: string) => Bun.file(new URL(`../../../${path}`, import.meta.url)).text();
    const skill = await read("integrations/wringer/SKILL.md"), agent = await read("docs/START_AGENT.md"), local = await read("docs/native/TRUSTED_LOCAL.md"), pm = await read("docs/START_PM.md");
    expect(skill).toContain("Before proposing, call `wringer.list_jobs`"); expect(skill).toContain("do not call the job or its delivery contained");
    expect(skill.split("\n").find(line => line.startsWith("description:"))).not.toContain("propose a bounded contained");
    expect(agent).toContain("Approval starts the work by itself."); expect(agent).not.toContain("Once approved, `wringer.start`");
    for (const text of [agent, local]) expect(text).toContain("`--auto-approve`");
    for (const text of [local, pm]) expect(text).toContain("--print");
});
