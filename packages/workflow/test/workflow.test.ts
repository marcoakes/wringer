import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthority, answerQuestion, decideAssumption, approveSpec, compilePlan, loadNativePlan, planDigest, savePlan, validateAuthority, WorkflowError } from "../src";
import { draftSpec } from "./legacy/draft";
import { runDrive } from "./legacy/drive";
import type { DraftRequest, DriveServices, Section } from "../src";
import { digest, locked, parseObject } from "../src/storage";
const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(() => {
    for (const server of servers.splice(0))
        server.stop(true);
});
async function fixture(source = "Return the total as 5.") {
    const repo = await mkdtemp(join(tmpdir(), "wringer-workflow-"));
    await writeFile(join(repo, "PRD.md"), source);
    return repo;
}
type ReplyHook = (section: Section, count: number, input: any, normal: any) => unknown;
function model(options: {
    human?: boolean;
    question?: boolean;
    assumption?: boolean;
    hook?: ReplyHook;
    usage?: boolean;
} = {}) {
    const calls: {
        section: Section;
        request: DraftRequest;
        data: any;
    }[] = [];
    const counts = { requirements: 0, decisions: 0, tasks: 0 };
    const respond = async (request: DraftRequest) => {
        const section = request.messages[0]!.content.match(/Wringer (requirements|decisions|tasks) section/)![1] as Section;
        const data = JSON.parse(request.messages[1]!.content);
        const input = data.input;
        counts[section]++;
        calls.push({ section, request, data });
        let normal: any;
        if (section === "requirements")
            normal = { title: "A measured total", requirements: input.spans.map((s: any, index: number) => ({ semantic_key: `requirement-${index}`, source_id: s.id, quote: s.quote, title: s.quote, required: true, human: !!options.human && index > 0 })), source_coverage: input.spans.map((s: any) => ({ source_id: s.id, classification: "requirement", reason: "Explicit obligation in the original PRD." })) };
        if (section === "decisions")
            normal = { questions: options.question ? [{ semantic_key: "separator", requirement_ids: [input.requirements[0].id], question: "Which separator should the display use?", required: true, human: false, suggested_answer: "Use a comma." }] : [], assumptions: options.assumption ? [{ semantic_key: "preserve-api", requirement_ids: [input.requirements[0].id], statement: "Preserve the existing function signature.", human: false }] : [] };
        if (section === "tasks")
            normal = { tasks: [{ id: "build-total", objective: `Implement the specified total. ${input.questions.map((q: any) => q.answer ?? "").join(" ")} ${input.assumptions.filter((a: any) => a.status === "overruled").map((a: any) => a.note).join(" ")}`, requirement_ids: input.requirements.map((r: any) => r.id) }], gates: input.requirements.filter((r: any) => !r.human).map((r: any, index: number) => ({ id: `criterion-${index}`, run: "bun test", proves: r.id })), show: Object.fromEntries(input.requirements.filter((r: any) => r.human).map((r: any) => [r.id, "bun run demo"])) };
        const response = options.hook?.(section, counts[section], input, normal) ?? normal;
        return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(response) } }], ...(options.usage === false ? {} : { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) };
    };
    if (process.env.WRINGER_WORKFLOW_TEST_TRANSPORT === "direct")
        return { endpoint: "http://127.0.0.1:1/v1/chat/completions", model: "fixture-model", calls, counts, transport: respond };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) { return Response.json(await respond(await req.json() as DraftRequest)); } });
    servers.push(server);
    return { endpoint: `http://127.0.0.1:${server.port}/v1/chat/completions`, model: "fixture-model", calls, counts, transport: undefined };
}
async function reason(run: Promise<unknown>) {
    try {
        await run;
        throw new Error("Expected a workflow stop");
    }
    catch (error) {
        expect(error).toBeInstanceOf(WorkflowError);
        return (error as WorkflowError).stop;
    }
}
const settings = (repo: string, remote: ReturnType<typeof model>) => ({ repo, prdPath: "PRD.md", endpoint: remote.endpoint, model: remote.model, send: true, transport: remote.transport });
describe("sectioned drafting and evidence", () => {
    test("all workflow YAML readers reject duplicate keys and unknown tags", () => {
        expect(() => parseObject("actor: first\nactor: second\n", "authority")).toThrow("unique");
        expect(() => parseObject("actor: !unknown second\n", "authority")).toThrow();
        expect(() => parseObject('{"actor":"first","actor":"second"}', "authority")).toThrow();
    });
    test("three requests, original quotes, durable receipts and zero-spend reuse", async () => {
        const repo = await fixture();
        const remote = model();
        const first = await draftSpec(settings(repo, remote));
        expect(first.calls).toBe(3);
        expect(first.totalCalls).toBe(3);
        expect(first.tokens.total).toBe(45);
        expect(first.plan!.intent).toBe("Return the total as 5.");
        const spec = JSON.parse(await readFile(join(repo, "wringer.spec.yaml"), "utf8"));
        expect(spec.approved).toBe(false);
        expect(spec.criteria).toHaveLength(1);
        for (const request of first.requestPaths) {
            const receipt = JSON.parse(await readFile(join(repo, request.replace("request.json", "receipt.json")), "utf8"));
            expect(receipt.status).toBe("complete");
            expect(receipt.request_sha256).toHaveLength(64);
            expect(receipt.response_sha256).toHaveLength(64);
        }
        const second = await draftSpec(settings(repo, remote));
        expect(second.calls).toBe(0);
        expect(second.reused).toEqual(["requirements", "decisions", "tasks"]);
        expect(remote.calls).toHaveLength(3);
    });
    test("dry run writes request but opens no socket", async () => {
        const repo = await fixture();
        const remote = model();
        const result = await draftSpec({ ...settings(repo, remote), send: false });
        expect(result.status).toBe("dry-run");
        expect(result.calls).toBe(0);
        expect(remote.calls).toHaveLength(0);
        expect(result.requestPaths).toHaveLength(1);
    });
    test("invalid human assumption gets validation feedback and section-only repair", async () => {
        const repo = await fixture("Return the total as 5.\n\nA person must judge the visual display.");
        const remote = model({ human: true, hook: (section, count, input, normal) => section === "decisions" && count === 1 ? { questions: [], assumptions: [{ semantic_key: "human-layout", requirement_ids: [input.requirements[1].id], statement: "Use the hidden default layout.", human: true }] } : normal });
        const result = await draftSpec(settings(repo, remote));
        expect(result.calls).toBe(4);
        expect(remote.counts).toEqual({ requirements: 1, decisions: 2, tasks: 1 });
        expect(remote.calls[2]!.data.validation_feedback).toContain("turn it into an explicit question");
        expect(result.plan!.assumptions).toHaveLength(0);
    });
    test("unknown cost is absent, not zero", async () => {
        const repo = await fixture();
        const remote = model({ usage: false });
        const result = await draftSpec(settings(repo, remote));
        expect(result.tokens).toEqual({ prompt: null, completion: null, total: null });
    });
    test("missing original obligation and fabricated quote are refused", async () => {
        const repo = await fixture("Return the total as 5.\n\nKeep compatibility.");
        const remote = model({ hook: (_section, _count, _input, normal) => normal.requirements ? { ...normal, requirements: [{ ...normal.requirements[0], quote: "The model made this up." }] } : normal });
        const stopped = await reason(draftSpec({ ...settings(repo, remote), maxRepairAttempts: 0 }));
        expect(stopped.reason).toBe("draft-invalid");
        expect(stopped.message).toContain("not verbatim");
        expect(stopped.next_move).toContain("source.md");
        expect(stopped.cwd).toBe(repo);
        expect(remote.calls).toHaveLength(1);
    });
    test("budget survives resumes and exhaustion does not send a request", async () => {
        const repo = await fixture();
        const remote = model({ hook: (section, _count, _input, normal) => section === "decisions" ? { bad: "wrong shape" } : normal });
        const opts = { ...settings(repo, remote), maxCalls: 2, maxRepairAttempts: 2 };
        const first = await reason(draftSpec(opts));
        expect(first.reason).toBe("draft-budget-exhausted");
        expect(remote.calls).toHaveLength(2);
        const second = await reason(draftSpec(opts));
        expect(second.reason).toBe("draft-budget-exhausted");
        expect(remote.calls).toHaveLength(2);
    });
    test("uncertain transport is not replayed by resume", async () => {
        const repo = await fixture();
        const remote = model();
        let count = 0;
        const opts = { ...settings(repo, remote), transport: async () => { count++; throw new Error("connection lost after request"); } };
        expect((await reason(draftSpec(opts))).reason).toBe("draft-spend-uncertain");
        const second = await reason(draftSpec(opts));
        expect(second.reason).toBe("draft-spend-uncertain");
        expect(second.next_move).toContain("--retry-uncertain");
        expect(count).toBe(1);
    });
    test("response tampering fails closed instead of reusing a plausible altered reply", async () => {
        const repo = await fixture();
        const remote = model();
        const first = await draftSpec(settings(repo, remote));
        const path = join(repo, first.requestPaths[2]!.replace("request.json", "response.json"));
        const response = JSON.parse(await readFile(path, "utf8"));
        response.choices[0].message.content = response.choices[0].message.content.replace("bun test", "true");
        await writeFile(path, JSON.stringify(response));
        expect((await reason(draftSpec(settings(repo, remote)))).reason).toBe("draft-response-changed");
        expect(remote.calls).toHaveLength(3);
    });
    test("overlapping credential prefixes cannot separate captured, hashed and sent requests", async () => {
        const repo = await fixture(), remote = model();
        const previous = process.env.WRINGER_AUTH_BEARER;
        process.env.WRINGER_AUTH_BEARER = "explicitly-overlapping-fixture-credential-91283";
        try {
            const result = await draftSpec({ ...settings(repo, remote), apiKeyEnv: "WRINGER_AUTH_BEARER", context: "The operator explicitly requires original obligations to remain visible." });
            expect(result.calls).toBe(3);
            let redactedPrompt = false;
            for (let i = 0; i < result.requestPaths.length; i++) {
                const storedText = await readFile(join(repo, result.requestPaths[i]!), "utf8");
                const stored = JSON.parse(storedText);
                const receipt = JSON.parse(await readFile(join(repo, result.requestPaths[i]!.replace("request.json", "receipt.json")), "utf8"));
                expect(stored).toEqual(remote.calls[i]!.request);
                expect(storedText).toBe(JSON.stringify(remote.calls[i]!.request, null, 2) + "\n");
                expect(receipt.request_sha256).toBe(digest(stored));
                redactedPrompt ||= storedText.includes("[REDACTED]");
            }
            expect(redactedPrompt).toBe(true);
            expect((await draftSpec({ ...settings(repo, remote), apiKeyEnv: "WRINGER_AUTH_BEARER", context: "The operator explicitly requires original obligations to remain visible." })).calls).toBe(0);
        }
        finally {
            if (previous === undefined)
                delete process.env.WRINGER_AUTH_BEARER;
            else
                process.env.WRINGER_AUTH_BEARER = previous;
        }
    });
    test("a changed recorded request cannot silently reuse a paid response", async () => {
        const repo = await fixture(), remote = model();
        const result = await draftSpec(settings(repo, remote));
        const path = join(repo, result.requestPaths[1]!);
        const request = JSON.parse(await readFile(path, "utf8"));
        request.messages[0].content += " Changed instruction.";
        await writeFile(path, JSON.stringify(request));
        expect((await reason(draftSpec(settings(repo, remote)))).reason).toBe("draft-request-changed");
        expect(remote.calls).toHaveLength(3);
    });
    test("a key under an arbitrary variable name cannot leak through context, parsed plan, events or files", async () => {
        const repo = await fixture();
        const secret = "credential-material-unique-70129-abcdefgh";
        process.env.WRINGER_AUTH_BEARER = secret;
        const events: unknown[] = [];
        try {
            const remote = model({ hook: (section, _count, _input, normal) => section === "tasks" ? { ...normal, tasks: normal.tasks.map((t: any) => ({ ...t, objective: `Implement the total; echoed ${secret} and ${secret.slice(-8)}.` })) } : normal });
            const result = await draftSpec({ ...settings(repo, remote), apiKeyEnv: "WRINGER_AUTH_BEARER", context: `Context accidentally includes ${secret}`, onEvent: event => { events.push(event); } });
            const output = JSON.stringify({ result, events });
            expect(output).not.toContain(secret);
            expect(output).not.toContain(secret.slice(-8));
            expect(output).toContain("[REDACTED]");
            for (const call of remote.calls)
                expect(JSON.stringify(call.request)).not.toContain(secret);
            async function inspect(directory: string) {
                for (const entry of await readdir(directory, { withFileTypes: true })) {
                    const path = join(directory, entry.name);
                    if (entry.isDirectory())
                        await inspect(path);
                    else {
                        const text = await readFile(path, "utf8");
                        expect(text).not.toContain(secret);
                        expect(text).not.toContain(secret.slice(-8));
                    }
                }
            }
            await inspect(repo);
            const reused = await draftSpec({ ...settings(repo, remote), apiKeyEnv: "WRINGER_AUTH_BEARER", context: `Context accidentally includes ${secret}` });
            expect(reused.calls).toBe(0);
        }
        finally {
            delete process.env.WRINGER_AUTH_BEARER;
        }
    });
    test("an original PRD containing the declared key refuses before source persistence", async () => {
        const secret = "credential-in-original-source-41972-abcdefgh";
        const repo = await fixture(`Build the feature. Accidental credential: ${secret}`);
        process.env.WRINGER_AUTH_BEARER = secret;
        try {
            const remote = model();
            const stopped = await reason(draftSpec({ ...settings(repo, remote), apiKeyEnv: "WRINGER_AUTH_BEARER" }));
            expect(stopped.reason).toBe("secret-in-prd");
            expect(remote.calls).toHaveLength(0);
            expect(await Bun.file(join(repo, ".wringer/workflow/source.md")).exists()).toBe(false);
            expect(await readFile(join(repo, "PRD.md"), "utf8")).toContain(secret);
            expect(await readFile(join(repo, ".wringer/workflow/stop.json"), "utf8")).not.toContain(secret);
        }
        finally {
            delete process.env.WRINGER_AUTH_BEARER;
        }
    });
});
describe("process-owned durable locks", () => {
    test("a proven dead owner is recovered with a receipt, then the lock is released", async () => {
        const repo = await fixture();
        const child = Bun.spawn([process.execPath, "-e", "process.exit(0)"], { stdout: "ignore", stderr: "ignore" });
        await child.exited;
        const path = join(repo, ".wringer/workflow/draft.lock");
        await Bun.write(path, JSON.stringify({ pid: child.pid, started_at: new Date().toISOString() }));
        let called = 0;
        expect(await locked(repo, "draft", async () => { called++; return "recovered"; })).toBe("recovered");
        expect(called).toBe(1);
        expect(await Bun.file(path).exists()).toBe(false);
        const receipts = await readdir(join(repo, ".wringer/workflow/lock-recoveries"));
        expect(receipts).toHaveLength(1);
        expect(JSON.parse(await readFile(join(repo, ".wringer/workflow/lock-recoveries", receipts[0]!), "utf8")).evidence).toBe("process-no-longer-exists");
    });
    test("a live or reused PID is never unlinked and no protected work runs", async () => {
        const repo = await fixture();
        const path = join(repo, ".wringer/workflow/drive.lock");
        const content = JSON.stringify({ pid: process.pid, started_at: "2020-01-01T00:00:00.000Z" });
        await Bun.write(path, content);
        let called = 0;
        const stopped = await reason(locked(repo, "drive", async () => { called++; }));
        expect(stopped.reason).toBe("workflow-busy");
        expect(called).toBe(0);
        expect(await readFile(path, "utf8")).toBe(content);
    });
});
describe("operator decisions and plan approval", () => {
    test("answers round-trip, invalidate approval, refresh only tasks, and reach brief", async () => {
        const repo = await fixture();
        const remote = model({ question: true });
        const first = await draftSpec(settings(repo, remote));
        const id = first.plan!.questions[0]!.id;
        expect((await reason(approveSpec(repo, { actor: "PM" }))).reason).toBe("question-unanswered");
        const answer = "yes: # choice\nfalse and 123 remain words";
        await answerQuestion(repo, id, answer);
        expect((await reason(approveSpec(repo, { actor: "PM" }))).reason).toBe("revision-required");
        const refreshed = await draftSpec(settings(repo, remote));
        expect(refreshed.calls).toBe(1);
        expect(refreshed.plan!.questions[0]!.id).toBe(id);
        expect(refreshed.plan!.questions[0]!.answer).toBe(answer);
        await approveSpec(repo, { actor: "PM" });
        const compiled = await compilePlan(repo);
        expect(await readFile(join(repo, compiled.briefPaths[0]!), "utf8")).toContain(answer);
        await answerQuestion(repo, id, "Use a slash.");
        expect(JSON.parse(await readFile(join(repo, "wringer.spec.yaml"), "utf8")).approved).toBe(false);
    });
    test("overruling changes task section and invalidates the exact approval", async () => {
        const repo = await fixture();
        const remote = model({ assumption: true });
        const first = await draftSpec(settings(repo, remote));
        const id = first.plan!.assumptions[0]!.id;
        await decideAssumption(repo, id, "accept");
        await approveSpec(repo, { actor: "PM" });
        const old = planDigest((await loadNativePlan(repo))!);
        await decideAssumption(repo, id, "overrule", "Introduce a new explicit interface.");
        expect((await reason(compilePlan(repo))).reason).toBe("revision-required");
        const revised = await draftSpec(settings(repo, remote));
        expect(revised.calls).toBe(1);
        expect(revised.plan!.tasks[0]!.objective).toContain("Introduce a new explicit interface.");
        expect((await reason(approveSpec(repo, { actor: "PM", expectedDigest: old }))).reason).toBe("approval-stale");
    });
    test("ledger tamper and external spec edits cannot be silently repaired", async () => {
        const repo = await fixture();
        const remote = model();
        const result = await draftSpec(settings(repo, remote));
        const path = join(repo, ".wringer/workflow/requirements", `${result.plan!.source_sha256}.json`);
        const ledger = JSON.parse(await readFile(path, "utf8"));
        ledger.requirements[0].quote = "Different source";
        await writeFile(path, JSON.stringify(ledger));
        expect((await reason(loadNativePlan(repo))).reason).toBe("plan-unreadable");
        const other = await fixture();
        await draftSpec(settings(other, remote));
        await writeFile(join(other, "wringer.spec.yaml"), "approved: true\n");
        expect((await reason(draftSpec(settings(other, remote)))).reason).toBe("spec-edited-outside-workflow");
    });
});
describe("headless durable PM drive", () => {
    function services(human = false) {
        const count = { install: 0, build: 0, verify: 0 };
        const services: DriveServices = { preflight: async () => ({ status: "declared-unverified", message: "A key is present; no worker turn has tested it." }), installGates: async () => { count.install++; }, build: async () => { count.build++; return { status: "passed", runId: "fixture-run" }; }, verify: async () => { count.verify++; return { status: "passed", humanPending: human ? ["r-human"] : [], unproved: [] }; } };
        return { services, count };
    }
    test("one authority reaches human hold, routine interview done, resume spends nothing", async () => {
        const repo = await fixture("Return the total as 5.\n\nA person must judge the display.");
        const remote = model({ human: true, assumption: true, question: true });
        const grant = await createAuthority(repo, { actor: "Test PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 3 } });
        const engine = services(true);
        const options = { repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services };
        const first = await runDrive(options);
        expect(first.status).toBe("stopped");
        expect(first.stop!.reason).toBe("human-judgement");
        expect(first.stop!.next_move).toContain("wringer-board judge");
        expect(remote.calls).toHaveLength(4);
        expect(engine.count).toEqual({ install: 1, build: 1, verify: 1 });
        const second = await runDrive({ repo, headless: true, services: engine.services });
        expect(second.stop!.reason).toBe("human-judgement");
        expect(remote.calls).toHaveLength(4);
        expect(engine.count).toEqual({ install: 1, build: 1, verify: 2 });
        expect(await Bun.file(join(repo, "wringer.judgements.yaml")).exists()).toBe(false);
    });
    test("worker ceiling is cumulative across revised plans and repeated resumes", async () => {
        const repo = await fixture(), remote = model(), engine = services();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 3 } });
        const allowances: number[] = [];
        engine.services.build = async (_repo, _plan, maximum) => {
            const budget = JSON.parse(await readFile(join(repo, ".wringer/workflow/worker-budget.json"), "utf8"));
            const reservation = budget.reservations.at(-1);
            expect(reservation.status).toBe("reserved");
            expect(reservation.charged).toBe(maximum);
            allowances.push(maximum);
            return { status: "passed", workerTurns: 1 };
        };
        const options = { repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services };
        expect((await runDrive(options)).status).toBe("ready");
        expect((await runDrive({ repo, headless: true, services: engine.services })).status).toBe("ready");
        expect(allowances).toEqual([3]);
        for (let revision = 1; revision <= 3; revision++) {
            const plan = (await loadNativePlan(repo))!;
            plan.tasks[0]!.objective += ` Revision ${revision}.`;
            await savePlan(repo, plan);
            const result = await runDrive({ repo, headless: true, services: engine.services });
            expect(revision < 3 ? result.status : result.stop?.reason).toBe(revision < 3 ? "ready" : "worker-budget-exhausted");
        }
        expect(allowances).toEqual([3, 2, 1]);
        const budget = JSON.parse(await readFile(join(repo, ".wringer/workflow/worker-budget.json"), "utf8"));
        expect(budget.reservations.map((r: any) => r.actual)).toEqual([1, 1, 1]);
        expect(budget.reservations.reduce((n: number, r: any) => n + r.charged, 0)).toBe(3);
        expect((await runDrive({ repo, headless: true, services: engine.services })).stop?.reason).toBe("worker-budget-exhausted");
        expect(allowances).toEqual([3, 2, 1]);
    });
    test("unknown worker counts consume the full reservation, not an invented zero", async () => {
        const repo = await fixture(), remote = model(), engine = services();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 4 } });
        expect((await runDrive({ repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services })).status).toBe("ready");
        const plan = (await loadNativePlan(repo))!;
        plan.tasks[0]!.objective += " Revised task.";
        await savePlan(repo, plan);
        const result = await runDrive({ repo, headless: true, services: engine.services });
        expect(result.stop?.reason).toBe("worker-budget-exhausted");
        expect(engine.count.build).toBe(1);
        const budget = JSON.parse(await readFile(join(repo, ".wringer/workflow/worker-budget.json"), "utf8"));
        expect(budget.reservations[0].actual).toBeNull();
        expect(budget.reservations[0].charged).toBe(4);
        expect(budget.reservations[0].status).toBe("unknown");
    });
    test("an old journey with a build but no budget cannot reset its allowance", async () => {
        const repo = await fixture(), remote = model(), engine = services();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 2 } });
        await runDrive({ repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services });
        await unlink(join(repo, ".wringer/workflow/worker-budget.json"));
        const result = await runDrive({ repo, headless: true, services: engine.services });
        expect(result.stop?.reason).toBe("worker-budget-missing");
        expect(engine.count.build).toBe(1);
    });
    test("worker overrun is recorded as reported and never clamped to the ceiling", async () => {
        const repo = await fixture(), remote = model(), engine = services();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 2 } });
        engine.services.build = async () => ({ status: "passed", workerTurns: 3 });
        const result = await runDrive({ repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services });
        expect(result.stop?.reason).toBe("worker-budget-exceeded");
        const budget = JSON.parse(await readFile(join(repo, ".wringer/workflow/worker-budget.json"), "utf8"));
        expect(budget.reservations[0].actual).toBe(3);
        expect(budget.reservations[0].charged).toBe(3);
        expect(budget.reservations[0].status).toBe("exceeded");
    });
    test("no authority means no paid or executing stage", async () => {
        const repo = await fixture();
        const remote = model();
        const engine = services();
        const result = await runDrive({ repo, prdPath: "PRD.md", headless: true, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services });
        expect(result.stop!.reason).toBe("headless-authority-missing");
        expect(remote.calls).toHaveLength(0);
        expect(engine.count.build).toBe(0);
    });
    test("displaced auth stops before any drafting spend", async () => {
        const repo = await fixture();
        const remote = model();
        const engine = services();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 2 } });
        engine.services.preflight = async () => ({ status: "displaced", message: "The set key displaces the stored login.", nextMove: "wring doctor" });
        const result = await runDrive({ repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services });
        expect(result.stop!.reason).toBe("preflight-refused");
        expect(remote.calls).toHaveLength(0);
    });
    test("ready is separate from delivery, unproved is not success", async () => {
        const repo = await fixture();
        const remote = model();
        const engine = services();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 9, max_repair_attempts: 2, max_worker_turns: 2 } });
        engine.services.verify = async () => ({ status: "passed", unproved: ["r-unchecked"] });
        const result = await runDrive({ repo, prdPath: "PRD.md", headless: true, authorityPath: grant.path, draft: { endpoint: remote.endpoint, model: remote.model, transport: remote.transport }, services: engine.services });
        expect(result.stop!.reason).toBe("requirements-unproved");
        expect(result.stop!.next_move).toContain("wring verify --prove");
    });
    test("authority cannot grant a human verdict or another repository", async () => {
        const repo = await fixture();
        const grant = await createAuthority(repo, { actor: "PM", budget: { max_draft_calls: 3, max_repair_attempts: 0, max_worker_turns: 1 } });
        expect(() => validateAuthority({ ...grant.authority, actions: ["human-judgement"] }, repo)).toThrow("Human judgements");
        expect(() => validateAuthority(grant.authority, repo + "-other")).toThrow("this repository");
        expect(() => validateAuthority({ ...grant.authority, expires_at: "2020-01-01T00:00:00Z" }, repo)).toThrow("expired");
    });
});
