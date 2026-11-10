/** What the 2026-11-09 end-to-end review found at the doors (alpha.44, "the doors, honestly"):
 * ~/Claude/WRINGER_E2E_AND_MARKET_REVIEW_2026-11-09.md, Part A §A2–A3. Real trusted-local
 * workspaces, a real owner and job page in a headless browser, real client files in scratch
 * folders, and a stand-in `npx` that exits before any agent starts; no agent or model runs. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDelegationProfile, createAssistantDirectory, createAssistantService, createDelegationJob, delegationControllerRoot, inspectDelegationProfile, readDelegationJob, registerWorkspace } from "@wringer/application";
import { git } from "@wringer/engine";
import { chromium } from "playwright";
import { callAssistantConnection } from "../src/assistant-transport";
import { createDelegationOwner } from "../src/delegation-owner";
import { dispatch } from "../src/app";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const INTENT = "Return the value as 5.";
const proposal = { intent: INTENT, title: "Return five", criteria: [{ id: "test", title: "The test passes", quote: INTENT, kind: "check", required: true }], checks: [{ id: "test", criteria: ["test"] }] };

async function repository(root: string) {
    const repo = join(root, "repo"); await mkdir(join(repo, "src"), { recursive: true }); await mkdir(join(repo, "tests"));
    await git(repo, ["init", "--initial-branch=main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "src/value.ts"), "export const value = 1;\n");
    await writeFile(join(repo, "tests/check.ts"), 'import { value } from "../src/value";\nif (value !== 5) throw new Error("value is not 5");\n');
    await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { test: "bun tests/check.ts" } }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    await git(root, ["init", "--bare", "origin.git"]); await git(repo, ["remote", "add", "origin", join(root, "origin.git")]);
    return repo;
}
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-alpha44-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = await repository(root), app = join(root, "app");
    await createAssistantDirectory(app);
    const preview = await inspectDelegationProfile(app, repo, { runtime: "trusted-local", worker: { adapter: "claude-agent-acp" }, judge: { adapter: "claude-agent-acp" }, source: { kind: "local" }, dependencies: "none", writable: ["src"] } as any);
    const profile = await applyDelegationProfile(app, preview, { expectedIdentity: preview.identity, actor: "Automated fixture operator", cooperativeLocal: true });
    const workspace = await registerWorkspace(app, { repo, mode: "delegation", client: "claude-code", execution: "trusted-local", profileId: profile.id, destination: { remote: "origin", base: "main" } });
    return { root, repo, app, workspace };
}
const setupArgs = (app: string, repo: string, extra: string[] = []) => ["setup", "--app-dir", app, "--repo", repo, "--client", "claude-code", "--mode", "delegation", "--runtime", "trusted-local", "--worker-adapter", "claude-agent-acp", "--judge-adapter", "claude-agent-acp", "--source", "local", "--dependencies", "none", "--writable", "src", ...extra];

test("an application directory others can read is refused with its path and chmod 700, not wring --help (W1)", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-alpha44-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = await repository(root), app = join(root, "app"); await mkdir(app, { mode: 0o755 }); await chmod(app, 0o755);
    const preview: any = await dispatch([...setupArgs(app, repo), "--dry-run"]);
    const refused: any = await dispatch([...setupArgs(app, repo), "--apply", "--expected", preview.value.identity, "--actor", "Automated fixture operator", "--cooperative-local"]).then(() => new Error("Setup applied"), error => error);
    expect(refused.message).toContain(`${app} is readable by others (mode 0755)`);
    expect(refused.message).toContain("Nothing was changed.");
    expect(refused.next_move.startsWith(`chmod 700 ${app}`)).toBeTrue();
    expect(refused.next_move).toContain("default application directory");
    expect(refused.next_move).not.toBe("wring --help");
    // After the printed fix, the same apply succeeds.
    await chmod(app, 0o700);
    const applied: any = await dispatch([...setupArgs(app, repo), "--apply", "--expected", preview.value.identity, "--actor", "Automated fixture operator", "--cooperative-local"]);
    expect(applied.text).toContain("Registered trusted-local workspace");
}, 30000);

test("the setup preview shows the destination it will record, outside the profile's identity (N1)", async () => {
    const f = await fixture();
    const kept: any = await dispatch([...setupArgs(f.app, f.repo), "--remote", "origin", "--base", "main", "--dry-run"]);
    expect(kept.value.destination).toEqual({ remote: "origin", base: "main", recorded: expect.stringContaining("only after the person's Send") });
    expect(kept.text).toContain("Destination: remote origin, base main");
    const none: any = await dispatch([...setupArgs(f.app, f.repo), "--dry-run"]);
    expect(none.value.destination).toBeNull();
    expect(none.text).toContain("Destination: none selected");
    expect(none.value.limits.some((limit: string) => limit.includes("No handover destination is selected"))).toBeTrue();
    expect(none.value.identity).toBe(kept.value.identity);
}, 30000);

test("a project connection says not to commit its files and keeps them out of git status (W2)", async () => {
    const f = await fixture();
    const preview: any = await dispatch(["connect", "--app-dir", f.app, "--workspace", f.workspace.id, "--client", "claude-code", "--scope", "project", "--dry-run"]);
    expect(preview.value.repositoryFiles.advice).toContain("Do not commit .mcp.json and .claude/skills/wringer/: they hold absolute paths to this computer's Wringer install and its owner.");
    expect(preview.value.repositoryFiles.exclude).toEqual({ path: ".git/info/exclude", add: ["/.mcp.json", "/.claude/skills/wringer/"], remove: false });
    expect(preview.text).toContain("Repository: Do not commit .mcp.json");
    const applied: any = await dispatch(["connect", "--app-dir", f.app, "--workspace", f.workspace.id, "--client", "claude-code", "--scope", "project", "--apply", "--expected", preview.value.identity]);
    expect(applied.text).toContain("Repository: Do not commit .mcp.json");
    expect(await Bun.file(join(f.repo, ".mcp.json")).exists()).toBeTrue();
    expect((await git(f.repo, ["status", "--short"])).stdout).toBe("");
    // A repository that already ignores them is not edited; the advice still stands.
    const again: any = await dispatch(["connect", "--app-dir", f.app, "--workspace", f.workspace.id, "--client", "claude-code", "--scope", "project", "--dry-run"]);
    expect(again.value.repositoryFiles.exclude.add).toEqual([]);
    expect(again.value.repositoryFiles.advice).toContain("An ignore rule here already covers them.");
    expect(again.value.changes.map((row: any) => row.path)).not.toContain(join(f.repo, ".git/info/exclude"));
}, 30000);

/** The adapter the profile names is `npx …`: a stand-in on PATH that exits before any agent starts. */
async function npxThatCannotStart(root: string) {
    const directory = join(root, "stub-bin"); await mkdir(directory);
    await writeFile(join(directory, "npx"), "#!/bin/sh\necho 'stub npx: no model spent' >&2\nexit 86\n", { mode: 0o755 });
    const path = process.env.PATH; process.env.PATH = `${directory}:${path}`;
    cleanup.push(async () => { process.env.PATH = path; });
}

test("a revised request stays one job under the ID job new printed; a stopped worker names who retries (W7, W4)", async () => {
    const f = await fixture(); await npxThatCannotStart(f.root);
    const owner = await createDelegationOwner(f.app, f.workspace.id); cleanup.push(() => owner.stop());
    const prepared = await createDelegationJob(f.app, f.workspace.id, { intent: INTENT, idempotencyKey: crypto.randomUUID() });
    const pending: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: prepared.id });
    const revised: any = await callAssistantConnection(owner.connectionPath, "wringer.revise_proposal", { jobId: prepared.id, idempotencyKey: crypto.randomUUID(), expectedRevision: pending.revision, proposal });
    expect(revised.outcome).toBe("awaiting-approval"); expect(revised.jobId).not.toBe(prepared.id);
    // The decision link the assistant relays names the job the person was given.
    expect(revised.decision.page).toBe(`${owner.page}/?jobId=${prepared.id}`);
    // wring job list: one job, the revision shown only as a revision.
    const listed: any = await dispatch(["job", "list", "--app-dir", f.app, "--workspace", f.workspace.id]);
    expect(listed.value.jobs).toEqual([{ jobId: prepared.id, workspaceId: f.workspace.id, mode: "delegation", intent: INTENT, parentJobId: null, requestRevision: { number: 2, recordedAs: revised.jobId } }]);
    const status: any = await dispatch(["job", "status", "--app-dir", f.app, "--job", revised.jobId]);
    expect(status.value.jobId).toBe(prepared.id); expect(status.value.outcome).toBe("awaiting-approval"); expect(status.value.requestRevision).toEqual({ number: 2, recordedAs: revised.jobId });
    // wring job open --job with either ID opens the job under the ID job new printed.
    for (const id of [prepared.id, revised.jobId]) {
        const opened: any = await dispatch(["job", "open", "--app-dir", f.app, "--workspace", f.workspace.id, "--job", id, "--print"]);
        expect(new URL(opened.value.url).searchParams.get("jobId")).toBe(prepared.id); expect(opened.value.jobId).toBe(prepared.id);
    }
    // The page: one job in the picker, the current revision's state, then the approved worker's stop.
    const browser = await chromium.launch({ headless: true }); cleanup.push(() => browser.close());
    const page = await browser.newPage();
    await page.goto(`${owner.page}/?jobId=${revised.jobId}#token=${owner.operatorUrl.split("#token=")[1]}`);
    await page.locator("#approval-panel").waitFor({ state: "visible", timeout: 15000 });
    expect(await page.locator("#job-mode").innerText()).toContain("request revision 2");
    expect((await page.locator("#job-picker option").allInnerTexts()).filter(text => text.endsWith(INTENT)).length).toBe(1);
    expect(await page.locator("#job-picker").inputValue()).toBe(prepared.id);
    await page.locator("#approval-actor").fill("Automated fixture operator");
    await page.locator("#approve-job").click();
    await page.locator("#blocked-panel").waitFor({ state: "visible", timeout: 60000 });
    expect(await page.locator("#job-error").innerText()).toContain("could not start: stub npx: no model spent");
    expect(await page.locator("#blocked-title").innerText()).toBe("Your coding assistant can retry this step");
    expect(await page.locator("#blocked-step").innerText()).toContain("Ask your coding assistant to retry the stopped step.");
    // The assistant is told to retry with wringer.continue, with the stop's own words.
    const stopped: any = await callAssistantConnection(owner.connectionPath, "wringer.get_status", { jobId: revised.jobId });
    expect(stopped.nextAction).toEqual({ code: "continue", actor: "assistant", eligible: true, reason: expect.stringContaining('call wringer.continue with action "retry-stopped"') });
    expect(stopped.nextAction.reason).toContain("could not start: stub npx: no model spent");
    // The evidence report names the job by that ID, and its own ID only as a revision.
    const handle = stopped.evidence.find((row: any) => row.kind === "report");
    let content = "", offset: number | null = 0;
    while (offset !== null) {
        const chunk: any = await callAssistantConnection(owner.connectionPath, "wringer.get_evidence", { jobId: revised.jobId, evidenceId: handle.id, contentIdentity: handle.contentIdentity, offset, limit: 8192 });
        content += chunk.content; offset = chunk.nextOffset;
    }
    const report = JSON.parse(content);
    expect(report.identities.job).toEqual({ jobId: prepared.id, requestRevision: 2, recordedAs: revised.jobId });
    expect(report.identities.note).toContain(`The job is ${prepared.id}, the ID wring job new printed; this is revision 2 of its request, recorded as ${revised.jobId}`);
    // The review branch is named after that job, too.
    const job = await readDelegationJob(f.app, revised.jobId);
    const controller = await createAssistantService(await delegationControllerRoot(f.app, f.workspace.id, job.contextId));
    expect((await controller.destination(revised.jobId))?.sourceBranch).toBe(`wringer/job/${prepared.id}`);
    expect(await readFile(join(f.repo, "src/value.ts"), "utf8")).toBe("export const value = 1;\n");
}, 120000);

test("a file where the application directory should be is named and refused, not a raw EEXIST (alpha.47)", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-alpha47-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = await repository(root), file = join(root, "not-a-directory"); await writeFile(file, "");
    const preview: any = await dispatch([...setupArgs(file, repo), "--dry-run"]).catch(error => error);
    const refused: any = preview instanceof Error ? preview : await dispatch([...setupArgs(file, repo), "--apply", "--expected", preview.value.identity, "--actor", "Automated fixture operator", "--cooperative-local"]).then(() => new Error("Setup applied"), error => error);
    expect(refused.message).toContain(`${file} is not a directory`);
    expect(refused.message).not.toContain("EEXIST");
    expect(refused.next_move).not.toContain("chmod");
}, 30000);
