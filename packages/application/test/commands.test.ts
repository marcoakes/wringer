import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { hashValue } from "@wringer/plan";
import { sha256 } from "@wringer/engine";
import { activeWorkspaceCommand, hasActiveWorkspaceCommand, latestWorkspacePublication, workspacePublicationBlocksHandover, parseWorkspaceCommand, queueWorkspaceCommand, readWorkspaceCommand, recoverWorkspaceCommand, type WorkspaceCommand, type WorkspaceCommandDependencies } from "../src/commands";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const revision = "a".repeat(64), tree = "b".repeat(40);
const command = (action: WorkspaceCommand["action"] = "resume", payload = {}): WorkspaceCommand => ({ idempotencyKey: crypto.randomUUID(), expectedRevision: revision, expectedCandidateTree: tree, action, payload });
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-workspace-command-"))); roots.push(root); return root; }
const deps = (overrides: Partial<WorkspaceCommandDependencies> = {}): WorkspaceCommandDependencies => ({
    readController: async () => ({ plan: { plan_sha256: revision, runtime: { env: [] }, acceptance: { criteria: [{ id: "human", kind: "human" }] } }, events: [{ sha256: revision }], state: { id: "fixture-journey", stage: "ready" }, result: { status: "review-ready", candidate: { tree, source: { commit: "e".repeat(40) } } } }) as any,
    controllerStatus: async () => ({ revision, candidateTree: tree, actions: ["resume", "show", "review", "request-revision", "deliver"].map(id => ({ id, enabled: true })) }) as any,
    execute: async () => ({ effect: "fixture" }),
    readProjection: async () => { throw new Error("No audit fixture supplied"); }, ...overrides,
});
async function retained(state: string, request: WorkspaceCommand, pid = process.pid) {
    const owner = { schema_version: "wringer.workspace-operation.v1", commandId: request.idempotencyKey, requestSha256: hashValue(request), pid, token: crypto.randomUUID(), at: new Date().toISOString() };
    await json(join(state, `.wringer/application/commands/${request.idempotencyKey}/request.json`), { schema_version: "wringer.workspace-command.v2", command: request, sha256: hashValue(request), owner, at: owner.at });
    return owner;
}
async function json(path: string, value: unknown) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(value)); }
async function settled(state: string, request: WorkspaceCommand) {
    for (let count = 0; count < 200; count++) { const value = await readWorkspaceCommand(state, request.idempotencyKey); if (value.status !== "running" && !await hasActiveWorkspaceCommand(state)) return value; await Bun.sleep(5); }
    throw new Error("Fixture command did not settle");
}
async function deadPid() { const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" }); await child.exited; return child.pid; }

describe("workspace command ownership and immutable request identity", () => {
    test("explicit decisions allow no comment, preserve original words and reject invented identity or ambiguous batches", () => {
        const decision = { criterionId: "human", displayId: crypto.randomUUID(), verdict: "met" };
        expect(parseWorkspaceCommand(command("review-decision", decision)).payload).toEqual(decision);
        const note = "  My exact original words.\nIncluding this line.  ";
        expect(parseWorkspaceCommand(command("review-decisions", { decisions: [{ ...decision, note }] })).payload.decisions).toEqual([{ ...decision, note }]);
        for (const payload of [{ ...decision, by: "Invented person" }, { ...decision, note: null }, { ...decision, note: " " }, { ...decision, verdict: "yes" }, { ...decision, displayId: "missing" }]) expect(() => parseWorkspaceCommand(command("review-decision", payload))).toThrow();
        for (const decisions of [[], [decision, decision], [{ ...decision, by: "Invented" }], Array.from({ length: 65 }, (_, i) => ({ ...decision, criterionId: `h${i}` }))]) expect(() => parseWorkspaceCommand(command("review-decisions", { decisions }))).toThrow();
        expect(() => parseWorkspaceCommand(command("review", decision))).toThrow();
    });
    test("rejects arbitrary inputs and requires explicit complete decisions", () => {
        for (const input of [ { ...command(), path: "/tmp/file" }, command("resume", { executeRole: "code" }), command("show", { criterionId: "../outside" }), command("review", { criterionId: "human" }), command("publish", { preparedId: "../x" }), command("prepare-delivery", { remote: "https://user:secret@example.com/repo", sourceBranch: "review", targetBranch: "main" }), command("prepare-delivery", { remote: "/tmp/origin.git", sourceBranch: "main", targetBranch: "main" }) ]) expect(() => parseWorkspaceCommand(input)).toThrow();
        const original = command("request-revision", { by: "Pat", note: "Please make the heading readable." }), copy = parseWorkspaceCommand(original); original.payload.note = "Changed later";
        expect(copy.payload.note).toBe("Please make the heading readable.");
    });
    test("one request executes once; a duplicate observes and different content refuses", async () => {
        const state = await scratch(), request = command(); let calls = 0;
        await queueWorkspaceCommand(state, request, {}, deps({ execute: async () => { calls++; return { ok: true }; } }));
        expect((await settled(state, request)).status).toBe("completed");
        expect((await queueWorkspaceCommand(state, request, {}, deps())).status).toBe("completed");
        await expect(queueWorkspaceCommand(state, { ...request, action: "show", payload: { criterionId: "human" } }, {}, deps())).rejects.toThrow("different command");
        expect(calls).toBe(1);
        const resultPath = join(state, `.wringer/application/commands/${request.idempotencyKey}/result.json`), result = JSON.parse(await readFile(resultPath, "utf8")); result.result = { ok: "tampered" }; await json(resultPath, result);
        await expect(readWorkspaceCommand(state, request.idempotencyKey)).rejects.toThrow("changed");
    });
    test("stale revisions, stale authority and unavailable actions fail before effects", async () => {
        const state = await scratch(); let calls = 0;
        for (const options of [
            deps({ controllerStatus: async () => ({ revision: "c".repeat(64), candidateTree: tree, actions: [] }) as any }),
            deps({ readController: async (_state, current) => { if (current) throw new Error("Authority expired"); return (await deps().readController(state)); } }),
            deps({ controllerStatus: async () => ({ revision, candidateTree: tree, actions: [{ id: "resume", enabled: false, reason: "No remaining grant" }] }) as any }),
        ]) {
            const request = command(); await queueWorkspaceCommand(state, request, {}, { ...options, execute: async () => { calls++; } }); expect((await settled(state, request)).status).toBe("failed");
        }
        expect(calls).toBe(0);
    });
    test("post-effect uncertainty is durable and a reconnect never replays it", async () => {
        const state = await scratch(), request = command(); let calls = 0;
        await queueWorkspaceCommand(state, request, {}, deps({ execute: async () => { calls++; throw new Error("Connection ended after submission"); } }));
        expect((await settled(state, request)).status).toBe("uncertain");
        expect((await queueWorkspaceCommand(state, request, {}, deps())).status).toBe("uncertain"); expect(calls).toBe(1);
    });
    test("an already cancelled command is a known failure before execution", async () => {
        const state = await scratch(), request = command(); let calls = 0;
        await queueWorkspaceCommand(state, request, { signal: AbortSignal.abort(new Error("Cancelled")) }, deps({ execute: async () => { calls++; } }));
        expect((await settled(state, request)).status).toBe("failed"); expect(calls).toBe(0);
    });
    test("optional result fields are hashed as the exact retained JSON instead of stranding ownership", async () => {
        const state = await scratch(), request = command();
        await queueWorkspaceCommand(state, request, {}, deps({ execute: async () => ({ optional: undefined, actual: "retained" }) }));
        expect((await settled(state, request)).result).toEqual({ actual: "retained" }); expect(await hasActiveWorkspaceCommand(state)).toBe(false);
    });
    test("different module/server instances cannot overlap effects", async () => {
        const state = await scratch(), request = command(); let finish!: () => void, calls = 0;
        const held = new Promise<void>(r => finish = r);
        const options = deps({ execute: async () => { calls++; await held; return {}; } });
        const other = await import(`../src/commands.ts?server=${crypto.randomUUID()}`);
        await queueWorkspaceCommand(state, request, {}, options);
        await expect(other.queueWorkspaceCommand(state, command(), {}, options)).rejects.toThrow("owns this controller");
        expect((await other.queueWorkspaceCommand(state, request, {}, options)).status).toBe("running");
        finish(); expect((await settled(state, request)).status).toBe("completed"); expect(calls).toBe(1);
    });
    test("credentials are refused before persistence and results are scrubbed before hashing", async () => {
        const state = await scratch(), original = process.env.WRINGER_TEST_COMMAND_SECRET;
        process.env.WRINGER_TEST_COMMAND_SECRET = "fixture-credential-value-314159265";
        try {
            await expect(queueWorkspaceCommand(state, command("request-revision", { by: "Pat", note: process.env.WRINGER_TEST_COMMAND_SECRET }), {}, deps())).rejects.toThrow("detected credential");
            expect(await hasActiveWorkspaceCommand(state)).toBe(false);
            const request = command(); await queueWorkspaceCommand(state, request, {}, deps({ execute: async () => ({ text: process.env.WRINGER_TEST_COMMAND_SECRET }) }));
            const result = await settled(state, request); expect(result.result).toEqual({ text: "[REDACTED]" });
            expect(await readFile(join(state, `.wringer/application/commands/${request.idempotencyKey}/result.json`), "utf8")).not.toContain(process.env.WRINGER_TEST_COMMAND_SECRET!);
        } finally { if (original === undefined) delete process.env.WRINGER_TEST_COMMAND_SECRET; else process.env.WRINGER_TEST_COMMAND_SECRET = original; }
    });
    test("symlinked operation/command paths never write outside the controller", async () => {
        const state = await scratch(), outside = await scratch(); await mkdir(join(state, ".wringer")); await symlink(outside, join(state, ".wringer/application"));
        await expect(queueWorkspaceCommand(state, command(), {}, deps())).rejects.toThrow("symlinks"); expect(await readdir(outside)).toEqual([]);
    });
});

describe("explicit orphan recovery", () => {
    test("a real different controller process excludes overlapping work, then crash recovery observes without replay", async () => {
        const state = await scratch(), request = command(), module = new URL("../src/commands.ts", import.meta.url).href;
        const script = `import { queueWorkspaceCommand } from ${JSON.stringify(module)};
          const state=${JSON.stringify(state)}, command=${JSON.stringify(request)};
          const history={plan:{runtime:{env:[]},acceptance:{criteria:[]}},events:[{sha256:command.expectedRevision}],result:{candidate:{tree:command.expectedCandidateTree}}};
          const deps={readController:async()=>history,controllerStatus:async()=>({revision:command.expectedRevision,candidateTree:command.expectedCandidateTree,actions:[{id:'resume',enabled:true}]}),execute:async()=>await new Promise(()=>{})};
          setInterval(()=>{},1000);
          console.log(JSON.stringify(await queueWorkspaceCommand(state,command,{},deps)));`;
        const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
        try {
            const reader = child.stdout.getReader(), response = await Promise.race([reader.read(), Bun.sleep(3000).then(() => { throw new Error("Child did not reserve its command"); })]);
            expect(new TextDecoder().decode(response.value)).toContain('"running"'); reader.releaseLock();
            await expect(queueWorkspaceCommand(state, command(), {}, deps())).rejects.toThrow("owns this controller");
            child.kill(); await child.exited;
            expect((await readWorkspaceCommand(state, request.idempotencyKey)).status).toBe("uncertain");
            const recoveries = await Promise.allSettled([recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: true }, deps()), recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: true }, deps())]);
            expect(recoveries.filter(r => r.status === "fulfilled" && r.value.recovered)).toHaveLength(1);
            expect((await queueWorkspaceCommand(state, request, {}, deps())).status).toBe("uncertain"); expect(await hasActiveWorkspaceCommand(state)).toBe(false);
        } finally { child.kill(); await child.exited; }
    });
    test("a dead owner remains uncertain until acknowledged; recovery never replays or clears domain reservations", async () => {
        const state = await scratch(), request = command(), owner = await retained(state, request, await deadPid());
        await json(join(state, ".wringer/application/operation.lock"), owner); await json(join(state, "domain-reservations.json"), { reserved: 4 });
        expect((await activeWorkspaceCommand(state))?.status).toBe("uncertain");
        await expect(recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: false } as any, deps())).rejects.toThrow("acknowledgement");
        let calls = 0;
        const recovery = await recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: true }, deps({ execute: async () => { calls++; } }));
        expect(recovery.recovered).toBe(true); expect(await hasActiveWorkspaceCommand(state)).toBe(false); expect((await readWorkspaceCommand(state, request.idempotencyKey)).status).toBe("uncertain");
        expect((await queueWorkspaceCommand(state, request, {}, deps())).status).toBe("uncertain"); expect(calls).toBe(0);
        expect(JSON.parse(await readFile(join(state, "domain-reservations.json"), "utf8"))).toEqual({ reserved: 4 });
        const acknowledgement = JSON.parse(await readFile(join(state, `.wringer/application/recoveries/${owner.token}.json`), "utf8")); expect(acknowledgement.operationToken).toBe(owner.token); expect(acknowledgement.acknowledgement).toContain("orphan runtime");
    });
    test("a live owner, unknown owner or wrong command cannot be recovered", async () => {
        const state = await scratch(), request = command(), owner = await retained(state, request);
        await json(join(state, ".wringer/application/operation.lock"), owner);
        await expect(recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: true }, deps())).rejects.toThrow("provably dead");
        await expect(recoverWorkspaceCommand(state, crypto.randomUUID(), { acknowledgeUncertain: true }, deps())).rejects.toThrow("provably dead");
        await json(join(state, ".wringer/application/operation.lock"), { ...owner, pid: -1 });
        await expect(recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: true }, deps())).rejects.toThrow("unreadable");
    });
    test("a recovery crash has a bounded immutable successor rather than an unrecoverable replacement lock", async () => {
        const state = await scratch(), request = command(), pid = await deadPid(), owner = await retained(state, request, pid), successor = crypto.randomUUID();
        await json(join(state, ".wringer/application/operation.lock"), owner);
        await json(join(state, `.wringer/application/recoveries/${owner.token}.json`), { schema_version: "wringer.workspace-recovery.v1", operationToken: owner.token, predecessor: owner.token, token: successor, pid });
        expect((await recoverWorkspaceCommand(state, request.idempotencyKey, { acknowledgeUncertain: true }, deps())).recovered).toBe(true);
        expect(await readdir(join(state, ".wringer/application/recoveries"))).toHaveLength(2);
    });
});

async function publicationFixture(state: string, forge?: any, recordCommand = true) {
    const publication = { remote: forge ? "https://github.com/acme/example.git" : "/tmp/explicit-fixture-origin.git", sourceBranch: "review/fixture", targetBranch: "main", ...(forge ? { forge } : {}) }, request = command("prepare-delivery", publication), id = `contained-${"c".repeat(24)}`, directory = join(state, "deliveries", id), bundle = join(directory, "bundle"), evidence = "d".repeat(40), code = "e".repeat(40);
    if (recordCommand) await retained(state, request);
    const saved = { schema_version: "wringer.workspace-preparation.v2", publication, requestSha256: hashValue(request), revision, candidateTree: tree, deliveryId: id, evidenceCommit: evidence };
    if (recordCommand) await json(join(state, `.wringer/application/commands/${request.idempotencyKey}/publication.json`), saved);
    const view = { deliveryId: id, name: "Fixture", journalHeadSha256: "9".repeat(64), source: { codeCommit: code, tree }, auditCommand: `wringer-drive audit --bundle .wringer/deliveries/${id}`, falsifyCommand: `wringer-drive falsify --bundle .wringer/deliveries/${id}` };
    await json(join(bundle, "manifest.json"), { schema_version: "wringer.contained-delivery.v2", viewSha256: hashValue(view), journal: { sourceHeadSha256: revision, headSha256: view.journalHeadSha256 }, journeyId: "fixture-journey", planSha256: revision, source: view.source, publication: { sourceBranch: publication.sourceBranch, targetBranch: publication.targetBranch } });
    const prepared = { schema_version: "wringer.contained-publication.v1", status: "prepared", pushed: false, bundleDir: bundle, deliveryId: id, codeCommit: code, evidenceCommit: evidence, sourceBranch: publication.sourceBranch, targetBranch: publication.targetBranch, auditCommand: view.auditCommand, falsify: { status: "available", command: view.falsifyCommand, reason: "fixture" } };
    await json(join(directory, "prepared.json"), { ...prepared, transportSha256: hashValue(publication) });
    const options = deps({ readProjection: async path => { expect(path).toBe(bundle); return view as any; } });
    return { request, prepared, directory, bundle, options, saved, view };
}
describe("publication comes from audited domain evidence", () => {
    test("handover policy keeps sent branches and uncertain hosted outcomes distinct from unsent preparations", () => {
        expect(workspacePublicationBlocksHandover(null)).toBe(false);
        expect(workspacePublicationBlocksHandover({ pushed: false })).toBe(false);
        for (const status of ["prepared", "blocked"]) expect(workspacePublicationBlocksHandover({ pushed: false, forge: { status } as any })).toBe(false);
        for (const status of ["prepared", "blocked", "uncertain", "published", "recovered", "closed", "merged"])
            expect(workspacePublicationBlocksHandover({ pushed: true, forge: { status } as any })).toBe(true);
        for (const status of ["uncertain", "published", "recovered", "closed", "merged"])
            expect(workspacePublicationBlocksHandover({ pushed: false, forge: { status } as any })).toBe(true);
    });
    test("a fresh handover is refused from audited sent evidence, while the retained identical request remains readable", async () => {
        const state = await scratch(), fixture = await publicationFixture(state, undefined, false); let calls = 0;
        await json(join(fixture.directory, `outcomes/${hashValue(fixture.prepared)}.json`), fixture.prepared);
        const options = { ...fixture.options, execute: async () => { calls++; return { prepared: true }; } };
        await queueWorkspaceCommand(state, fixture.request, {}, options);
        expect((await settled(state, fixture.request)).status).toBe("completed");
        const pushed = { ...fixture.prepared, status: "delivered", pushed: true };
        await json(join(fixture.directory, `outcomes/${hashValue(pushed)}.json`), pushed);
        expect((await queueWorkspaceCommand(state, fixture.request, {}, options)).status).toBe("completed");
        for (const request of [command("prepare-delivery", fixture.request.payload), command("publish", { preparedId: fixture.request.idempotencyKey })]) {
            await expect(queueWorkspaceCommand(state, request, {}, options)).rejects.toThrow("already been sent");
            expect(await Bun.file(join(state, `.wringer/application/commands/${request.idempotencyKey}/request.json`)).exists()).toBe(false);
        }
        expect(calls).toBe(1);
    });
    test("publication completing after admission is rechecked under the application lock before dispatch", async () => {
        const state = await scratch(), fixture = await publicationFixture(state, undefined, false); let calls = 0;
        await json(join(fixture.directory, `outcomes/${hashValue(fixture.prepared)}.json`), fixture.prepared);
        const pushed = { ...fixture.prepared, status: "delivered", pushed: true };
        const options = { ...fixture.options, controllerStatus: async () => {
            expect(await hasActiveWorkspaceCommand(state)).toBe(true);
            await json(join(fixture.directory, `outcomes/${hashValue(pushed)}.json`), pushed);
            return fixture.options.controllerStatus(state);
        }, execute: async () => { calls++; return {}; } };
        await queueWorkspaceCommand(state, fixture.request, {}, options);
        const stopped = await settled(state, fixture.request);
        expect(stopped.status).toBe("failed"); expect(stopped.error).toContain("already been sent");
        expect((await queueWorkspaceCommand(state, fixture.request, {}, options)).status).toBe("failed");
        expect(calls).toBe(0);
    });
    test("an earlier candidate's publication cannot block a later candidate with new recorded authority", async () => {
        const state = await scratch(), fixture = await publicationFixture(state, undefined, false), nextRevision = "7".repeat(64), nextTree = "8".repeat(40), nextCommit = "9".repeat(40); let calls = 0;
        const pushed = { ...fixture.prepared, status: "delivered", pushed: true };
        await json(join(fixture.directory, `outcomes/${hashValue(pushed)}.json`), pushed);
        const options = { ...fixture.options, readController: async () => ({ ...await fixture.options.readController(state), events: [{ sha256: nextRevision }], result: { status: "review-ready", candidate: { tree: nextTree, source: { commit: nextCommit } } } }) as any, controllerStatus: async () => ({ revision: nextRevision, candidateTree: nextTree, actions: [{ id: "deliver", enabled: true }] }) as any, execute: async () => { calls++; return {}; } };
        const request = { ...command("prepare-delivery", fixture.request.payload), expectedRevision: nextRevision, expectedCandidateTree: nextTree };
        expect(await latestWorkspacePublication(state, options)).toBeNull();
        await queueWorkspaceCommand(state, request, {}, options);
        expect((await settled(state, request)).status).toBe("completed"); expect(calls).toBe(1);
    });
    test("direct CLI delivery appears without any application command or preparation cache", async () => {
        const state = await scratch(), fixture = await publicationFixture(state, undefined, false);
        expect(await readdir(state)).toEqual(["deliveries"]);
        await json(join(fixture.directory, `outcomes/${hashValue(fixture.prepared)}.json`), fixture.prepared);
        expect((await latestWorkspacePublication(state, fixture.options))?.status).toBe("prepared");
        const pushed = { ...fixture.prepared, status: "delivered", pushed: true }; await json(join(fixture.directory, `outcomes/${hashValue(pushed)}.json`), pushed);
        const result = await latestWorkspacePublication(state, fixture.options);
        expect(result?.pushed).toBe(true); expect(result?.evidenceCommit).toBe(fixture.saved.evidenceCommit); expect(result?.codeCommit).toBe(fixture.view.source.codeCommit);
        expect((result as any).remote).toBeUndefined(); // An opaque transport digest cannot recover a URL.
        expect(await latestWorkspacePublication(state, { ...fixture.options, readController: async () => ({ ...await fixture.options.readController(state), events: [{ sha256: "f".repeat(64) }] }) as any })).toBeNull();
    });
    test("a fabricated completed command cache cannot create a publication", async () => {
        const state = await scratch(), fixture = await publicationFixture(state);
        await json(join(state, `.wringer/application/commands/${fixture.request.idempotencyKey}/result.json`), { status: "completed", result: { ...fixture.prepared, status: "delivered", pushed: true } });
        expect(await latestWorkspacePublication(state, fixture.options)).toBeNull();
        await json(join(fixture.directory, `outcomes/${hashValue(fixture.prepared)}.json`), fixture.prepared);
        expect((await latestWorkspacePublication(state, fixture.options))?.status).toBe("prepared");
        const pushed = { ...fixture.prepared, status: "delivered", pushed: true }; await json(join(fixture.directory, `outcomes/${hashValue(pushed)}.json`), pushed);
        expect((await latestWorkspacePublication(state, fixture.options))?.pushed).toBe(true);
    });
    test("old readiness and changed source/audit/outcome identities cannot claim publication", async () => {
        const state = await scratch(), fixture = await publicationFixture(state);
        await json(join(fixture.directory, `outcomes/${hashValue(fixture.prepared)}.json`), fixture.prepared);
        expect(await latestWorkspacePublication(state, { ...fixture.options, readController: async () => ({ ...await fixture.options.readController(state), state: { stage: "human-hold" } }) as any })).toBeNull();
        await expect(latestWorkspacePublication(state, { ...fixture.options, readProjection: async () => ({ ...fixture.view, source: { ...fixture.view.source, tree: "f".repeat(40) } }) as any })).rejects.toThrow("journal and candidate");
        await json(join(fixture.directory, `outcomes/${hashValue(fixture.prepared)}.json`), { ...fixture.prepared, evidenceCommit: "f".repeat(40) });
        await expect(latestWorkspacePublication(state, fixture.options)).rejects.toThrow("identity was changed");
    });
    test("publication requires an audited matching completed preparation before any effect", async () => {
        const state = await scratch(), request = command("publish", { preparedId: crypto.randomUUID() }); let calls = 0;
        await queueWorkspaceCommand(state, request, {}, deps({ execute: async () => { calls++; } }));
        expect((await settled(state, request)).status).toBe("failed"); expect(calls).toBe(0);
    });
    test("a later closed hosted request stays closed even when an older delivery outcome said published", async () => {
        const state = await scratch(), forge = { kind: "github", endpoint: "https://api.github.com", repo: "acme/example", token_env: "FIXTURE_FORGE_TOKEN" }, fixture = await publicationFixture(state, forge, false), repository = "github.com/acme/example";
        await mkdir(fixture.bundle, { recursive: true }); await writeFile(join(fixture.bundle, "mr.md"), "Fixture body\n");
        const intent = { schema_version: "wringer.forge-intent.v2", delivery_id: fixture.saved.deliveryId, forge, repository, expected_head_commit: fixture.saved.evidenceCommit, source_branch: fixture.saved.publication.sourceBranch, target_branch: "main", title: "Fixture", body_path: `deliveries/${fixture.saved.deliveryId}/bundle/mr.md`, body_sha256: sha256("Fixture body\n") };
        const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}` : JSON.stringify(v);
        await json(join(fixture.directory, "forge/intent.json"), intent);
        const published = { schema_version: "wringer.forge-publication.v2", status: "published", state_directory: join(fixture.directory, "forge"), request_sha256: sha256(stable(intent)), next_move: "fixture", repository, head_commit: fixture.saved.evidenceCommit, hosted_state: "open", url: "https://github.com/acme/example/pull/1" };
        const output = { ...fixture.prepared, status: "delivered", pushed: true, forge: published };
        await json(join(fixture.directory, `outcomes/${hashValue(output)}.json`), output);
        await json(join(fixture.directory, "forge/outcomes/001.json"), { ...published, at: "2026-09-07T01:00:00.000Z" });
        await json(join(fixture.directory, "forge/outcomes/002.json"), { ...published, status: "closed", hosted_state: "closed", at: "2026-09-07T01:00:01.000Z" });
        expect((await latestWorkspacePublication(state, fixture.options))?.forge?.status).toBe("closed");
        await json(join(fixture.directory, "forge/outcomes/003.json"), { ...published, head_commit: "f".repeat(40), at: "2026-09-07T01:00:02.000Z" });
        await expect(latestWorkspacePublication(state, fixture.options)).rejects.toThrow("different repository, commit");
    });
});
