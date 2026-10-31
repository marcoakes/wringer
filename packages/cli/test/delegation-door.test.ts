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
    // The documented route answers the job `wring job new` made, and the replaced proposal leaves the picker.
    const placeholder = jobs.find((row: any) => row.jobId !== proposed.jobId).jobId;
    const pending: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: placeholder });
    const revised: any = await callAssistantConnection(owner.connectionPath, "wringer.revise_proposal", { jobId: placeholder, idempotencyKey: crypto.randomUUID(), expectedRevision: pending.revision, proposal });
    expect(revised.outcome).toBe("awaiting-approval");
    const after = (await read("/api/jobs")).jobs.map((row: any) => row.jobId);
    expect(after).toContain(revised.jobId); expect(after).not.toContain(placeholder);
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
