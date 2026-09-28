import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, realpath, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { git } from "@wringer/engine";
import { audit } from "@wringer/delivery";
import { hashBytes } from "@wringer/plan";
import { validateVerificationOutput } from "@wringer/mcp";
import { registerWorkspace, createVerificationJob, createAssistantDirectory, writeAssistantRecord, readAssistantRecord } from "@wringer/application";
import { createVerificationOwner } from "../src/verification-owner";
import { readAssistantConnection } from "../src/assistant-transport";
import * as clients from "../src/client-adapters";
import { installedLauncher } from "../src/adoption-cli";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
test("T16 failed owner construction releases its lock and listeners while preserving a pre-existing connection file", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-owner-startup-"))); cleanup.push(() => rm(root, { recursive: true, force: true })); await createAssistantDirectory(root);
    const id = crypto.randomUUID(); await writeAssistantRecord(root, `workspaces/${id}.json`, { schema_version: "wringer.workspace.v2", id, mode: "verification", repo: join(root, "inert-fixture"), client: "generic", preferences: { destination: null, profileId: null, credentialReferences: [] }, boundary: { approval: "cooperative-local", execution: "trusted-local" }, createdAt: new Date().toISOString() });
    const ownerRoot = join(root, "owners", id); await mkdir(ownerRoot, { recursive: true, mode: 0o700 }); const foreign = join(ownerRoot, "connection.json"); await writeFile(foreign, "pre-existing bytes", { mode: 0o600 });
    const servers: { server: ReturnType<typeof Bun.serve>; port: number }[] = [], realServe = Bun.serve;
    const spy = spyOn(Bun, "serve").mockImplementation(((options: any) => { const server = realServe(options); servers.push({ server, port: server.port! }); return server; }) as unknown as typeof Bun.serve);
    try {
        await expect(createVerificationOwner(root, id)).rejects.toThrow();
        expect(await Bun.file(join(ownerRoot, "owner.lock")).exists()).toBeFalse(); expect(await Bun.file(foreign).text()).toBe("pre-existing bytes");
        expect(servers).toHaveLength(2);
        for (const { port } of servers) await expect(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    } finally { spy.mockRestore(); for (const { server } of servers) server.stop(true); }
});
async function fixture(destination = false, repetitions = 3) {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-verification-owner-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    const repo = join(root, "repo"), app = join(root, "application"); await mkdir(repo);
    await git(repo, ["init", "-b", "main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n"); await writeFile(join(repo, "value.txt"), "actual result\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "check", run: "test -s value.txt" }], show: { one: "cat value.txt", two: "cat value.txt" }, ...(destination ? { deliver: { remote: "origin", base: "main" } } : {}) }));
    await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Fixture", intent: "Review two views", criteria: ["one", "two"].map(id => ({ id, title: id, human: true })), tasks: [{ id: "review", brief: "brief.md", objective: "Inspect views" }] }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const origin = join(root, "origin.git");
    if (destination) {
        await git(root, ["init", "--bare", "--initial-branch=main", origin]); await git(repo, ["remote", "add", "origin", origin]); await git(repo, ["push", "origin", "main"]);
        await writeFile(join(repo, "value.txt"), "changed actual result\n");
    }
    const workspace = await registerWorkspace(app, { repo, mode: "verification", client: "generic", ...(destination ? { destination: { remote: "origin", base: "main" } } : {}) });
    const job = await createVerificationJob(app, workspace.id, { intent: "Check and inspect the views", idempotencyKey: crypto.randomUUID(), repetitions });
    const owner = await createVerificationOwner(app, workspace.id); cleanup.push(() => owner.stop());
    const connection = await readAssistantConnection(owner.connectionPath), token = new URLSearchParams(new URL(owner.operatorUrl).hash.slice(1)).get("token")!;
    const api = (path: string, body?: unknown, credential = token) => fetch(owner.page + path, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${credential}`, origin: owner.page, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const call = async (name: string, args: unknown) => { const value = await owner.service.call(connection.token, name, args); validateVerificationOutput(name, value); return value; };
    const status = () => call("wringer.get_status", { jobId: job.id });
    const settled = async () => { for (let n = 0; n < 120; n++) { const row = await status(); if (row.phase !== "working") return row; await delay(25); } throw new Error("Fixture operation never settled"); };
    const approve = async () => { const pm = await owner.pm(job.id); expect((await api("/api/job/approve", { jobId: job.id, expectedRevision: pm.readyRevision, actor: "Automated fixture approval" })).status).toBe(202); return settled(); };
    return { root, repo, app, origin, owner, job, connection, api, call, status, settled, approve };
}
test("T04 operator approval, exact displays and empty-note acceptance complete within the original check grant", async () => {
    const f = await fixture();
    expect((await f.call("wringer.inspect_setup", {})).mode).toBe("verification");
    expect((await f.api(`/api/job?jobId=${f.job.id}`, undefined, f.connection.token)).status).toBe(401);
    await expect(f.call("wringer.approve", { jobId: f.job.id })).rejects.toThrow("unavailable through MCP");
    expect((await f.approve()).remaining).toMatchObject({ repetitions: 2 });
    const pm = await f.owner.pm(f.job.id); expect(pm.phase).toBe("review");
    const body = { jobId: f.job.id, expectedRevision: pm.readyRevision, expectedCandidateTree: pm.candidateTree, verdict: "met", displayIds: pm.displays.filter(row => row.criterionId !== "verification-report").map(row => row.displayId) };
    expect((await f.api("/api/job/decision", { ...body, displayIds: [] })).status).toBe(409);
    expect((await f.api("/api/job/decision", body)).status).toBe(202);
    const final = await f.settled(); expect(final.remaining).toMatchObject({ repetitions: 1 });
    const judgement = await Bun.file(join(f.repo, "wringer.judgements.yaml")).json();
    expect(judgement.judgements).toHaveLength(2); expect(judgement.judgements.every((row: any) => row.note === undefined)).toBeTrue();
    expect((await f.api("/api/job/decision", body)).status).toBe(409);
    expect((await f.status()).remaining).toMatchObject({ repetitions: 1 });
}, 20000);
test("T19 a no-model connection probe discovers the actual scoped contract without granting or starting work", async () => {
    const probe = (clients as any).probeRestrictedConnection; expect(typeof probe).toBe("function");
    const f = await fixture(), before = await f.status();
    const started = performance.now(), result = await probe(installedLauncher(), f.owner.connectionPath, "verification");
    expect(performance.now() - started).toBeLessThan(5000);
    expect(result.mode).toBe("verification"); expect(result.tools).toContain("wringer.run_checks"); expect(result.tools).not.toContain("wringer.approve");
    expect(result.modelCalls).toBe(0); expect((await f.status()).revision).toBe(before.revision); expect((await f.status()).operation).toBeNull();
}, 15000);
test("T23 verification evidence hashes the actual returned bytes and cannot splice different check observations", async () => {
    const f = await fixture(); await f.approve(); const before = await f.status(), handle = (before.evidence as any[])[0]; expect(handle).toBeDefined();
    const first: any = await f.call("wringer.get_evidence", { jobId: f.job.id, evidenceId: handle.id, contentIdentity: handle.contentIdentity, offset: 0, limit: 40 });
    expect(first.nextOffset).toBe(40); let content = first.content, offset = first.nextOffset;
    while (offset !== null) { const page: any = await f.call("wringer.get_evidence", { jobId: f.job.id, evidenceId: handle.id, contentIdentity: handle.contentIdentity, offset, limit: 8192 }); content += page.content; offset = page.nextOffset; }
    expect(hashBytes(Buffer.from(content))).toBe(handle.contentIdentity);
    await f.call("wringer.run_checks", { jobId: f.job.id, idempotencyKey: crypto.randomUUID(), expectedRevision: before.revision, expectedCandidateIdentity: before.candidateIdentity }); await f.settled();
    await expect(f.call("wringer.get_evidence", { jobId: f.job.id, evidenceId: handle.id, contentIdentity: handle.contentIdentity, offset: 40 })).rejects.toThrow("cursor");
}, 20000);
test("T10 verification review prepares a handover; only separate exact Send pushes an auditable branch once", async () => {
    const f = await fixture(true, 2); await f.approve(); const review = await f.owner.pm(f.job.id);
    const decision = { jobId: f.job.id, expectedRevision: review.readyRevision, expectedCandidateTree: review.candidateTree, verdict: "met", displayIds: review.displays.filter(row => row.criterionId !== "verification-report").map(row => row.displayId) };
    expect((await f.api("/api/job/decision", decision)).status).toBe(202); await f.settled();
    const ready = await f.owner.pm(f.job.id); expect(ready.phase).toBe("send");
    const completedChecks = await f.status(); expect(completedChecks.remaining).toMatchObject({ repetitions: 0 }); expect(completedChecks.nextAction).toMatchObject({ code: "send", actor: "operator", eligible: true });
    await expect(f.call("wringer.run_checks", { jobId: f.job.id, idempotencyKey: crypto.randomUUID(), expectedRevision: completedChecks.revision, expectedCandidateIdentity: completedChecks.candidateIdentity })).rejects.toThrow("eligible");
    expect(ready.destination?.remote).toBe(f.origin); expect(ready.preparedId).toBeTruthy();
    expect((await git(f.repo, ["ls-remote", "--heads", "origin", ready.destination!.sourceBranch])).stdout).toBe("");
    const send = { jobId: f.job.id, expectedRevision: ready.readyRevision, expectedCandidateTree: ready.candidateTree, preparedId: ready.preparedId };
    expect((await f.api("/api/job/send", { ...send, preparedId: crypto.randomUUID() })).status).toBe(409);
    expect((await f.api("/api/job/send", send)).status).toBe(200);
    const sent = await f.owner.pm(f.job.id); expect(sent.phase).toBe("sent"); expect(sent.publication?.status).toBe("Branch and evidence pushed; no PR, merge or deployment");
    const head = (await git(f.repo, ["ls-remote", "--heads", "origin", ready.destination!.sourceBranch])).stdout;
    expect((await f.api("/api/job/send", send)).status).toBe(409);
    expect((await git(f.repo, ["ls-remote", "--heads", "origin", ready.destination!.sourceBranch])).stdout).toBe(head);
    const clone = join(f.root, "fresh audit clone"); await git(f.root, ["clone", "--branch", ready.destination!.sourceBranch, f.origin, clone]);
    expect((await audit(clone, sent.publication!.deliveryId)).status).toBe("passed");
    await writeFile(join(f.repo, "value.txt"), "later unrelated task\n");
    const retained = await f.owner.pm(f.job.id); expect(retained.phase).toBe("sent"); expect(retained.publication).toEqual(sent.publication);
}, 30000);
test("T08 a lost run reply is idempotent after completion and stale cancellation cannot change state", async () => {
    const f = await fixture(); await f.approve(); const before = await f.status();
    const request = { jobId: f.job.id, idempotencyKey: crypto.randomUUID(), expectedRevision: before.revision, expectedCandidateIdentity: before.candidateIdentity };
    await f.call("wringer.run_checks", request); await f.settled();
    await f.call("wringer.run_checks", request); await f.settled();
    expect((await f.status()).remaining).toMatchObject({ repetitions: 1 });
    await expect(f.call("wringer.cancel", { ...request, idempotencyKey: crypto.randomUUID() })).rejects.toThrow("stale");
    expect((await f.status()).phase).not.toBe("stopped");
}, 20000);
test("T12 the visible Stop control stops an unapproved verification job without consuming a repetition", async () => {
    const f = await fixture(), page = await f.owner.pm(f.job.id), html = await (await fetch(f.owner.page)).text();
    expect(html).toContain('id="stop-job"');
    expect((await f.api("/api/job/stop", { jobId: f.job.id, expectedRevision: page.readyRevision, expectedCandidateTree: page.candidateTree })).status).toBe(200);
    const stopped = await f.status(); expect(stopped.phase).toBe("stopped"); expect(stopped.remaining).toMatchObject({ repetitions: 3 });
    expect((await f.api("/api/job/approve", { jobId: f.job.id, expectedRevision: page.readyRevision, actor: "Automated fixture" })).status).toBe(409);
});
test("verification inventory is paginated, workspace-scoped and does not approve or execute retained jobs", async () => {
    const f = await fixture(), second = await createVerificationJob(f.app, f.job.workspaceId, { intent: "Second unapproved request", idempotencyKey: crypto.randomUUID() });
    const foreign = await registerWorkspace(f.app, { repo: f.repo, mode: "verification", client: "codex" });
    await createVerificationJob(f.app, foreign.id, { intent: "Another workspace", idempotencyKey: crypto.randomUUID() });
    const before = (await readdir(f.app, { recursive: true })).sort();
    const one = await f.call("wringer.list_jobs", { limit: 1 }), two = await f.call("wringer.list_jobs", { offset: 1, limit: 1 });
    expect(one.nextOffset).toBe(1); expect(two.nextOffset).toBeNull();
    const jobs = [...one.jobs as any[], ...two.jobs as any[]]; expect(jobs.map(row => row.jobId).sort()).toEqual([f.job.id, second.id].sort());
    expect(jobs.every(row => row.outcome === "approval")).toBe(true);
    expect((await readdir(f.app, { recursive: true })).sort()).toEqual(before);
    await expect(f.call("wringer.list_jobs", { limit: 51 })).rejects.toThrow();
});
test("T09 correction preserves the request once and a changed candidate requires a fresh verdict", async () => {
    const f = await fixture(); await f.approve(); const page = await f.owner.pm(f.job.id), note = "Please use the corrected result text.";
    const correction = { jobId: f.job.id, expectedRevision: page.readyRevision, expectedCandidateTree: page.candidateTree, note };
    expect((await f.api("/api/job/correction", correction)).status).toBe(200);
    expect((await f.api("/api/job/correction", correction)).status).toBe(409);
    const recorded = await Bun.file(join(f.repo, "wringer.judgements.yaml")).json();
    expect(recorded.judgements.every((row: any) => row.note === note && row.verdict === "not_met")).toBeTrue();
    const corrected = await f.status(), handle = (corrected.evidence as any[]).find(row => row.kind === "review-decision");
    expect(handle).toBeDefined();
    const correctionPage: any = await f.call("wringer.get_evidence", { jobId: f.job.id, evidenceId: handle.id, contentIdentity: handle.contentIdentity, limit: 8192 });
    expect(JSON.parse(correctionPage.content)).toMatchObject({ verdict: "not_met", note, candidateIdentity: page.candidateTree });
    expect(hashBytes(Buffer.from(correctionPage.content))).toBe(handle.contentIdentity);
    await writeFile(join(f.repo, "value.txt"), "corrected result text\n");
    const before = await f.status(); await f.call("wringer.run_checks", { jobId: f.job.id, idempotencyKey: crypto.randomUUID(), expectedRevision: before.revision, expectedCandidateIdentity: before.candidateIdentity }); await f.settled();
    const next = await f.owner.pm(f.job.id); expect(next.phase).toBe("review"); expect(next.requirements.every(row => row.state === "unknown")).toBeTrue();
    expect((await f.status()).remaining).toMatchObject({ repetitions: 1 });
}, 20000);
test("T16 failed handover preparation is visible and retries preparation without renewing checks or sending", async () => {
    const f = await fixture(true, 2); await f.approve(); const review = await f.owner.pm(f.job.id);
    const retainedLock = join(f.app, "verification-jobs", f.job.id, "prepare.lock");
    await writeFile(retainedLock, "deliberate retained preparation fixture", { flag: "wx", mode: 0o600 });
    expect((await f.api("/api/job/decision", { jobId: f.job.id, expectedRevision: review.readyRevision, expectedCandidateTree: review.candidateTree, verdict: "met", displayIds: review.displays.filter(row => row.criterionId !== "verification-report").map(row => row.displayId) })).status).toBe(202);
    const blocked = await f.settled(); expect(blocked.phase).toBe("handover-blocked"); expect(blocked.remaining).toMatchObject({ repetitions: 0 });
    expect(blocked.nextAction).toMatchObject({ code: "prepare-handover", actor: "operator", eligible: true });
    const handle = (blocked.evidence as any[]).find(row => row.kind === "preparation-error"); expect(handle).toBeDefined();
    const failure: any = await f.call("wringer.get_evidence", { jobId: f.job.id, evidenceId: handle.id, contentIdentity: handle.contentIdentity, limit: 8192 });
    expect(JSON.parse(failure.content).reason.length).toBeGreaterThan(0);
    const page = await f.owner.pm(f.job.id); expect(page.phase).toBe("blocked"); expect(page.retryable).toBe(true); expect(page.retryLabel).toBe("Prepare handover");
    await unlink(retainedLock); // Explicit fixture recovery; the product must not erase it.
    expect((await f.api("/api/job/retry", { jobId: f.job.id, expectedRevision: page.readyRevision, expectedCandidateTree: page.candidateTree })).status).toBe(200);
    const ready = await f.status(); expect(ready.phase).toBe("send"); expect(ready.remaining).toMatchObject({ repetitions: 0 });
    expect((await git(f.repo, ["ls-remote", "--heads", "origin", f.job.destination!.branch])).stdout).toBe("");
}, 30000);

test("T17 lost Send response reconciles exact remote evidence without sending again; a code-only remote stays uncertain", async () => {
    const recovery = await import("../../application/src") as any;
    expect(typeof recovery.inspectVerificationSendRecovery).toBe("function");
    const f = await fixture(true, 2); await f.approve(); const review = await f.owner.pm(f.job.id);
    expect((await f.api("/api/job/decision", { jobId: f.job.id, expectedRevision: review.readyRevision, expectedCandidateTree: review.candidateTree, verdict: "met", displayIds: review.displays.filter(row => row.criterionId !== "verification-report").map(row => row.displayId) })).status).toBe(202); await f.settled();
    const ready = await f.owner.pm(f.job.id), send = { jobId: f.job.id, expectedRevision: ready.readyRevision, expectedCandidateTree: ready.candidateTree, preparedId: ready.preparedId };
    expect((await f.api("/api/job/send", send)).status).toBe(200);
    const path = join(f.app, "verification-jobs", f.job.id, "publication.json"), published = await readAssistantRecord<any>(f.app, `verification-jobs/${f.job.id}/publication.json`);
    await unlink(path); expect((await f.status()).uncertainty).toBeTrue();
    const branch = published.destination.branch, head = published.result.evidence_commit;
    await git(f.origin, ["update-ref", `refs/heads/${branch}`, published.result.commit, head]);
    const partial = await recovery.inspectVerificationSendRecovery(f.app, f.job.id); expect(partial.eligible).toBeFalse();
    await expect(recovery.applyVerificationSendRecovery(f.app, f.job.id, partial.identity, "Automated fixture")).rejects.toThrow("evidence");
    expect((await f.status()).uncertainty).toBeTrue();
    await git(f.origin, ["update-ref", `refs/heads/${branch}`, head, published.result.commit]);
    const sendLock = join(f.app, "verification-jobs", f.job.id, "send.lock");
    await writeFile(sendLock, JSON.stringify({ pid: process.pid }), { mode: 0o600 });
    expect((await recovery.inspectVerificationSendRecovery(f.app, f.job.id)).eligible).toBeFalse();
    await unlink(sendLock);
    const damaged = join(f.root, "damaged carried fixture");
    await git(f.root, ["clone", "--branch", branch, f.origin, damaged]);
    await git(damaged, ["config", "user.name", "Automated fixture"]); await git(damaged, ["config", "user.email", "fixture@example.invalid"]);
    const patch = `.wringer/deliveries/${published.result.delivery_id}/patch.diff`;
    await writeFile(join(damaged, patch), "Damaged carried evidence\n"); await git(damaged, ["add", "-f", "--", patch]);
    const damagedTree = (await git(damaged, ["write-tree"])).stdout.trim(), damagedHead = (await git(damaged, ["-c", "commit.gpgsign=false", "commit-tree", damagedTree, "-p", published.result.commit, "-m", "Damaged fixture evidence"])).stdout.trim();
    // Fetching a fixture object imports no work or grant; update only owned test refs.
    await git(f.repo, ["fetch", damaged, damagedHead]); await git(f.origin, ["fetch", damaged, damagedHead]);
    await git(f.repo, ["update-ref", `refs/heads/${branch}`, damagedHead, head]); await git(f.origin, ["update-ref", `refs/heads/${branch}`, damagedHead, head]);
    const corrupt = await recovery.inspectVerificationSendRecovery(f.app, f.job.id); expect(corrupt.eligible).toBeTrue();
    await expect(recovery.applyVerificationSendRecovery(f.app, f.job.id, corrupt.identity, "Automated fixture")).rejects.toThrow("audit failed");
    expect((await f.status()).uncertainty).toBeTrue();
    await git(f.repo, ["update-ref", `refs/heads/${branch}`, head, damagedHead]); await git(f.origin, ["update-ref", `refs/heads/${branch}`, head, damagedHead]);
    const complete = await recovery.inspectVerificationSendRecovery(f.app, f.job.id); expect(complete.eligible).toBeTrue();
    await expect(recovery.applyVerificationSendRecovery(f.app, f.job.id, "b".repeat(64), "Automated fixture")).rejects.toThrow("changed");
    const result = await recovery.applyVerificationSendRecovery(f.app, f.job.id, complete.identity, "Automated fixture");
    expect(result.schema_version).toBe("wringer.verification-publication.v2"); expect(result.observation.kind).toBe("exact-remote-head-and-carried-audit");
    expect((await f.status()).phase).toBe("sent");
    expect((await git(f.origin, ["rev-parse", `refs/heads/${branch}`])).stdout.trim()).toBe(head);
    expect(await recovery.applyVerificationSendRecovery(f.app, f.job.id, complete.identity, "Automated fixture")).toEqual(result);
    expect((await f.status()).remaining).toMatchObject({ repetitions: 0 });
    const copies = join(f.app, "maintenance", "send-recoveries", complete.identity, "copies"), beforeCopies = await readdir(copies);
    await unlink(path); // Completion reached the audit receipt but not the public job index.
    expect(await recovery.applyVerificationSendRecovery(f.app, f.job.id, complete.identity, "Automated fixture")).toEqual(result);
    expect(await readdir(copies)).toEqual(beforeCopies);
}, 30000);
