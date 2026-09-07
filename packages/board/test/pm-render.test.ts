import { expect, test } from "bun:test";
import { renderPmWorkspace, pmClientScript } from "../src/pm-render";
import { pmOutcome, validatePmWorkspace, type PmWorkspace } from "../src/pm-model";
const fixture = (): PmWorkspace => ({ schema_version: "wringer.pm-workspace.v1", name: "A useful change", intent: "The result should be clear and useful.", journeyId: "journey-1", revision: "a".repeat(64), status: "human-hold", stage: "human", candidate: { commit: "b".repeat(40), tree: "c".repeat(40), changedPaths: ["src/result.ts"] }, criteria: [{ id: "readable", title: "The result is readable", kind: "human", required: true, state: "unknown", checkIds: [], note: null, by: null }, { id: "total", title: "The total is correct", kind: "check", required: true, state: "met", checkIds: ["total-check"], note: "Independent fixture finding", by: null }], checks: [{ id: "total-check", before: { status: "failed", exitCode: 1 }, after: { status: "passed", exitCode: 0 } }], usage: { sessions: 2, ceiling: 8, inputTokens: null, outputTokens: null, costUsd: null }, actions: ["show", "review", "request-revision", "resume", "retry-verification", "retry-judge", "retry-stopped", "retry-uncertain", "prepare-delivery", "publish"].map(id => ({ id, enabled: true, reason: "Allowed by the fixture controller." })), stop: null, updatedAt: "2026-09-07T12:00:00.000Z", limits: ["Synthetic local test, not a live run."] });

test("PM workspace is decision-first, readable, responsive and static mode has no operating controls", () => {
    const html = renderPmWorkspace(fixture(), { live: true, nonce: "fixtureNonce123" });
    expect(html.indexOf('id="decision"')).toBeLessThan(html.indexOf('id="evidence-title"'));
    expect(html).toContain('grid-template-areas:"decision" "evidence" "context"');
    expect(html).toContain("font-size:14px"); expect(html).not.toMatch(/font-size:(?:[0-9]|1[0-3])px/);
    expect(html).toContain(":focus-visible"); expect(html).toContain("prefers-reduced-motion"); expect(html).toContain('role="status"');
    expect(html).toContain("Continuing or retrying work may start agent sessions"); expect(html).not.toContain("No model spend");
    expect(html).toContain("Unknown usage is not free usage"); expect(html).not.toContain("<progress");
    const saved = renderPmWorkspace(fixture(), { live: false });
    expect(saved).not.toContain("<script"); expect(saved).not.toContain("<form"); expect(saved).not.toContain("data-command="); expect(saved).toContain("connect-src 'none'");
});
test("source text, embedded JSON, links and nonces cannot become executable content", () => {
    const state = fixture(); state.name = '</script><script>alert("name")</script>'; state.intent = '<img src=x onerror="alert(1)">'; state.criteria[0]!.note = '</blockquote><iframe src="https://evil.invalid"></iframe>'; state.publication = { status: "published", deliveryId: "fixture", url: "javascript:alert(1)" };
    const html = renderPmWorkspace(state, { live: true, nonce: "fixtureNonce123" });
    expect(html).not.toContain('<script>alert("name")'); expect(html).not.toContain("<img"); expect(html).not.toContain("<iframe"); expect(html).not.toContain('href="javascript:');
    expect(html).toContain("\\u003c/script\\u003e"); expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(() => renderPmWorkspace(state, { live: true, nonce: 'bad"nonce' })).toThrow("nonce");
    expect(() => new Function(pmClientScript())).not.toThrow();
});
test("PM facts do not turn a pushed branch, malformed state or unknown cost into readiness", () => {
    const state = fixture(); state.status = "review-ready"; state.stage = "ready"; state.publication = { status: "delivered", deliveryId: "fixture" };
    expect(pmOutcome(state).label).toBe("Branch delivered"); state.publication.status = "closed";
    expect(pmOutcome(state).label).toBe("Closed");
    expect(() => validatePmWorkspace({ ...state, usage: { ...state.usage, costUsd: 0 } })).toThrow();
    expect(() => validatePmWorkspace({ ...state, actions: [{ id: "resume", enabled: "yes", reason: "" }] })).toThrow();
    expect(() => validatePmWorkspace({ ...state, revision: "" })).toThrow();
});
test("a recorded human review asks for readiness evaluation, not another invented verdict", () => {
    const state = fixture();
    state.criteria[0]!.state = "met";
    expect(pmOutcome(state).label).toBe("Ready to recheck");
    expect(pmOutcome(state).description).toContain("No new human verdict");
    state.status = "running";
    expect(pmOutcome(state).label).toBe("In progress");
    state.stop = { reason: "operation-uncertain", message: "Reconcile the retained command first." };
    expect(pmOutcome(state).description).toBe(state.stop.message);
    expect(pmOutcome(state).label).toBe("Outcome uncertain");
});

class Element {
    textContent = ""; disabled = false; hidden = false; checked = false; value = ""; type = "button"; href = ""; title = ""; className = ""; dataset: Record<string, string> = {}; fields: Record<string, string> = {}; listeners = new Map<string, Function>();
    attributes: Record<string, string> = {};
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    classList = { toggle: (_name: string, _on: boolean) => {} };
    private html = "";
    constructor(readonly id: string) {}
    set innerHTML(value: string) { this.html = value; if (this.id === "criterion") this.value = /<option value="([^"]*)"/.exec(value)?.[1] ?? ""; }
    get innerHTML() { return this.html; }
    addEventListener(name: string, fn: Function) { this.listeners.set(name, fn); }
    closest() { return this.dataset.command ? this : null; }
    matches(selector: string) { return selector === "form[data-action]" && !!this.dataset.action; }
    checkValidity() { return true; }
    querySelector() { return null; }
}
async function clientHarness(handler?: (path: string, options: RequestInit, context: any) => Promise<Response> | Response, initial = fixture()) {
    const state = fixture(), html = renderPmWorkspace(initial, { live: true, nonce: "fixtureNonce123" }), elements = new Map<string, Element>(), commands: Element[] = [], events = new Map<string, Function>(), intervals: Function[] = [], timers: Function[] = [], requests: { path: string; options: RequestInit }[] = [];
    for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1]!, new Element(match[1]!));
    for (const match of html.matchAll(/<button\s+([^>]*data-command="([^"]+)"[^>]*)>/g)) { const el = new Element(match[2]!); el.dataset.command = match[2]!; el.type = /type="([^"]+)"/.exec(match[1]!)?.[1] ?? "button"; commands.push(el); }
    const get = (id: string) => elements.get(id)!;
    get("pm-initial").textContent = JSON.stringify(initial); get("criterion").value = "readable";
    const location = { hash: "#token=fixture-memory-token", pathname: "/", search: "" }, history: unknown[][] = [];
    const context = { state, html, elements, commands, events, intervals, timers, requests, get, location, history, posts: [] as any[] };
    const fetchMock = async (path: string, options: RequestInit = {}) => { requests.push({ path, options }); if (options.method === "POST") context.posts.push(JSON.parse(String(options.body))); if (handler) return handler(path, options, context); return new Response(JSON.stringify(state)); };
    const document = { getElementById: get, querySelectorAll: (selector: string) => selector === "[data-command]" ? commands : [], addEventListener: (name: string, fn: Function) => events.set(name, fn) };
    const FormDataMock = class { constructor(private form: Element) {} get(name: string) { return this.form.fields[name] ?? null; } };
    new Function("document", "window", "history", "location", "fetch", "setTimeout", "setInterval", "crypto", "FormData", "AbortSignal", pmClientScript())(document, { addEventListener: () => {} }, { replaceState: (...args: unknown[]) => { history.push(args); location.hash = ""; } }, location, fetchMock, (fn: Function) => { timers.push(fn); return 1; }, (fn: Function) => { intervals.push(fn); return 1; }, crypto, FormDataMock, AbortSignal);
    await flush();
    return { ...context, click: (action: string) => events.get("click")!({ target: commands.find(c => c.dataset.command === action)! }), submit: (action: string, fields: Record<string, string>) => { const form = new Element("fixture-form"); form.dataset.action = action; form.fields = fields; events.get("submit")!({ target: form, preventDefault() {} }); } };
}
async function flush() { for (let i = 0; i < 4; i++) await new Promise(resolve => setTimeout(resolve, 0)); }
const uuid = "11111111-1111-4111-8111-111111111111";
function preparedResult(context: any) {
    const request = context.posts.at(-1), { remote, sourceBranch, targetBranch } = request.payload, evidenceCommit = "e".repeat(40);
    return { preparedId: request.idempotencyKey, remote, sourceBranch, targetBranch, evidenceCommit, delivery: { status: "prepared", pushed: false, deliveryId: "contained-fixture", codeCommit: context.state.candidate.commit, evidenceCommit, sourceBranch, targetBranch } };
}
test("client removes its token before requests, keeps it out of storage, and disables stale/disconnected controls", async () => {
    let disconnected = false;
    const h = await clientHarness((_path, _options, c) => { if (disconnected) throw new Error("fixture disconnected"); return new Response(JSON.stringify(c.state)); });
    expect(h.history[0]).toEqual([null, "", "/"]); expect(h.location.hash).toBe(""); expect(pmClientScript()).not.toContain("localStorage"); expect(pmClientScript()).not.toContain("sessionStorage");
    expect((h.requests[0]!.options.headers as any).Authorization).toBe("Bearer fixture-memory-token"); expect(h.requests.every(r => r.path === "/api/state")).toBe(true);
    expect(h.commands.find(c => c.dataset.command === "resume")!.disabled).toBe(false);
    disconnected = true; h.intervals[0]!(); await flush();
    expect(h.commands.every(c => c.disabled)).toBe(true); expect(h.get("connection").textContent).toContain("Disconnected");
});
test("show output stays inert; review binds the successful display and exact revision/tree", async () => {
    let action = "";
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") return new Response(JSON.stringify(c.state));
        if (options.method === "POST") { action = JSON.parse(String(options.body)).action; return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 }); }
        return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result: action === "show" ? { receipt: { id: uuid, criterionId: "readable", success: true, candidateTree: c.state.candidate.tree }, output: '<script>alert("display")</script>' } : {} }));
    });
    h.submit("review", { verdict: "met", by: "Fixture person", note: "Not shown" }); await flush(); expect(h.posts).toHaveLength(0);
    h.click("show"); await flush();
    expect(h.get("display-output").textContent).toBe('<script>alert("display")</script>'); expect(h.get("display-output").innerHTML).toBe("");
    expect(h.commands.find(c => c.dataset.command === "review")!.disabled).toBe(false);
    h.submit("review", { verdict: "met", by: "Fixture person", note: "These are my exact words." }); await flush();
    expect(h.posts).toHaveLength(2); expect(h.posts[1].expectedRevision).toBe(h.state.revision); expect(h.posts[1].expectedCandidateTree).toBe(h.state.candidate!.tree);
    expect(h.posts[1].payload).toEqual({ criterionId: "readable", displayId: uuid, verdict: "met", by: "Fixture person", note: "These are my exact words." });
});
test("a changed revision invalidates display judgement and delivery requires a second explicit confirmation", async () => {
    let action = "";
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") return new Response(JSON.stringify(c.state));
        if (options.method === "POST") { action = JSON.parse(String(options.body)).action; return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 }); }
        return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result: action === "show" ? { receipt: { id: uuid, criterionId: "readable", success: true, candidateTree: c.state.candidate.tree }, output: "fixture result" } : action === "prepare-delivery" ? preparedResult(c) : {} }));
    });
    h.click("show"); await flush(); h.state.revision = "d".repeat(64); h.intervals[0]!(); await flush();
    expect(h.commands.find(c => c.dataset.command === "review")!.disabled).toBe(true);
    h.submit("prepare-delivery", { remote: "https://example.invalid/team/project.git", sourceBranch: "review/change", targetBranch: "main" }); await flush();
    expect(h.posts).toHaveLength(2); expect(h.commands.find(c => c.dataset.command === "publish")!.disabled).toBe(true);
    h.get("publication-consent").checked = true; h.get("publication-consent").listeners.get("change")!(); h.click("publish"); await flush();
    expect(h.posts).toHaveLength(3); expect(h.posts[2].payload).toEqual({ preparedId: h.posts[1].idempotencyKey });
});
test("delivery confirmation leads with the chosen destination, evidence and original note, with JSON collapsed", async () => {
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") return new Response(JSON.stringify(c.state));
        if (options.method === "POST") return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 });
        return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result: preparedResult(c) }));
    });
    h.state.criteria[0]!.state = "met"; h.state.criteria[0]!.by = "Fixture person"; h.state.criteria[0]!.note = 'My original note: <script>alert("never execute")</script>';
    h.submit("prepare-delivery", { remote: "https://example.invalid/team/project.git", sourceBranch: "review/change", targetBranch: "main" }); await flush();
    expect(h.get("publication-confirm").hidden).toBe(false);
    expect(h.get("prepared-destination").textContent).toBe("https://example.invalid/team/project.git");
    expect(h.get("prepared-branches").textContent).toBe("review/change → main");
    expect(h.get("prepared-candidate").textContent).toBe(`${h.state.candidate!.commit.slice(0, 12)} · 1 changed file`);
    expect(h.get("prepared-evidence").textContent).toBe("2 of 2 required criteria met. 1 of 1 checks passing; 1 recorded failing before the change.");
    expect(h.get("prepared-notes").textContent).toContain(h.state.criteria[0]!.note!);
    expect(h.get("prepared-notes").textContent).toContain("Fixture person");
    expect(h.get("prepared-notes").innerHTML).toBe("");
    expect(h.html).toContain('<details><summary>Exact delivery record</summary><pre id="prepared-details"></pre></details>');
    expect(JSON.parse(h.get("prepared-details").textContent).delivery.evidenceCommit).toBe("e".repeat(40));
    expect(h.get("publication-consent").checked).toBe(false);
    expect(h.commands.find(c => c.dataset.command === "publish")!.disabled).toBe(true);
});
test("a preparation cannot redirect publication or substitute the reviewed code or evidence identity", async () => {
    const mutations: ((value: ReturnType<typeof preparedResult>) => void)[] = [
        value => { value.remote = "https://elsewhere.invalid/other.git"; },
        value => { value.sourceBranch = "other/source"; }, value => { value.targetBranch = "other-target"; },
        value => { value.delivery.sourceBranch = "other/source"; }, value => { value.delivery.targetBranch = "other-target"; },
        value => { value.delivery.codeCommit = "f".repeat(40); }, value => { value.evidenceCommit = "not-a-commit"; value.delivery.evidenceCommit = value.evidenceCommit; },
        value => { value.delivery.evidenceCommit = "f".repeat(40); }, value => { value.evidenceCommit = value.delivery.evidenceCommit = value.delivery.codeCommit; },
        value => { value.delivery.pushed = true; },
    ];
    for (const mutate of mutations) {
        const h = await clientHarness((path, options, c) => {
            if (path === "/api/state") return new Response(JSON.stringify(c.state));
            if (options.method === "POST") return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 });
            const result = preparedResult(c); mutate(result);
            return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result }));
        });
        h.submit("prepare-delivery", { remote: "https://example.invalid/team/project.git", sourceBranch: "review/change", targetBranch: "main" }); await flush();
        expect(h.get("publication-confirm").hidden).toBe(true);
        expect(h.get("command-message").textContent).toContain("does not match");
        h.get("publication-consent").checked = true; h.get("publication-consent").listeners.get("change")!(); h.click("publish"); await flush();
        expect(h.commands.find(c => c.dataset.command === "publish")!.disabled).toBe(true);
        expect(h.posts).toHaveLength(1);
    }
});
test("a failed display and a malformed preparation response never enable acceptance or publication", async () => {
    let action = "";
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") return new Response(JSON.stringify(c.state));
        if (options.method === "POST") { action = JSON.parse(String(options.body)).action; return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 }); }
        return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result: action === "show" ? { receipt: { id: uuid, criterionId: "readable", success: false, candidateTree: c.state.candidate.tree }, output: "Display failed." } : {} }));
    });
    h.click("show"); await flush(); expect(h.commands.find(c => c.dataset.command === "review")!.disabled).toBe(true); expect(h.get("review-form").hidden).toBe(true);
    h.submit("prepare-delivery", { remote: "https://example.invalid/team/project.git", sourceBranch: "review/change", targetBranch: "main" }); await flush();
    expect(h.commands.find(c => c.dataset.command === "publish")!.disabled).toBe(true); expect(h.get("command-message").textContent).toContain("no durable publication identity");
    expect(h.timers).toHaveLength(0);
});
test("uncertain submission is never automatically reposted; recovery keeps its idempotency key", async () => {
    let first = true;
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") return new Response(JSON.stringify(c.state));
        if (options.method === "POST") { if (first) { first = false; throw new Error("lost response"); } return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 }); }
        return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result: {} }));
    });
    h.click("resume"); await flush(); const original = h.posts[0]; h.intervals[0]!(); await flush();
    expect(h.posts).toHaveLength(1); h.get("recover-command").listeners.get("click")!(); await flush();
    expect(h.posts).toHaveLength(2); expect(h.posts[1]).toEqual(original);
});

test("public bootstrap replaces every identity after authenticated loading without a fake zero budget", async () => {
    const initial: PmWorkspace = { ...fixture(), name: "Loading workspace", journeyId: "connection-pending", revision: "connection-pending", status: "unconnected", stage: "unconnected", candidate: null, criteria: [], checks: [], actions: [], usage: { sessions: 0, ceiling: 0, inputTokens: null, outputTokens: null, costUsd: null } };
    const h = await clientHarness(undefined, initial);
    expect(h.html).toContain('id="usage-sessions">Not loaded');
    expect(h.html).toContain('id="journey-id">No run loaded');
    expect(h.get("journey-id").textContent).toBe(h.state.journeyId);
    expect(h.get("record-revision").textContent).toBe(h.state.revision);
    expect(h.get("usage-sessions").textContent).toBe("2 / 8");
    expect(h.get("decision").attributes["aria-busy"]).toBe("false");
    expect(h.html).toContain('id="review-form" hidden');
});

test("duplicate checks, malformed source and a credential-bearing hosted URL do not become trusted facts", () => {
    const state = fixture();
    expect(() => validatePmWorkspace({ ...state, checks: [state.checks[0], state.checks[0]] })).toThrow("duplicate");
    expect(() => validatePmWorkspace({ ...state, candidate: { ...state.candidate, tree: "not-a-tree" } })).toThrow("source identity");
    expect(() => validatePmWorkspace({ ...state, status: "unconnected" })).toThrow("source identity");
    state.publication = { status: "published", deliveryId: "test", url: "https://credential@example.invalid/review/1" };
    expect(pmOutcome(state).label).not.toBe("Review request open");
    state.publication = { status: "branch-pushed", deliveryId: "test" };
    expect(pmOutcome(state).label).toBe("Branch delivered");
    state.publication.status = "uncertain";
    expect(pmOutcome(state).label).toBe("Publication not established");
});

test("a mismatched command identity leaves all other actions paused and never polls that identity", async () => {
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") return new Response(JSON.stringify(c.state));
        if (options.method === "POST") return new Response(JSON.stringify({ commandId: uuid }), { status: 202 });
        throw Error("An unrelated command must never be polled");
    });
    h.click("resume"); await flush(); h.intervals[0]!(); await flush();
    expect(h.posts).toHaveLength(1);
    expect(h.requests.some(r => r.path.includes("/api/commands/"))).toBe(false);
    expect(h.commands.every(c => c.disabled)).toBe(true);
    expect(h.get("recover-command").disabled).toBe(false);
});

test("show receipt for another criterion and a disconnected terminal result cannot enable review", async () => {
    let completed = false, disconnected = false;
    const h = await clientHarness((path, options, c) => {
        if (path === "/api/state") { if (disconnected) throw Error("Cannot load latest state"); return new Response(JSON.stringify(c.state)); }
        if (options.method === "POST") return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey }), { status: 202 });
        completed = true;
        return new Response(JSON.stringify({ commandId: c.posts.at(-1).idempotencyKey, status: "completed", result: { receipt: { id: uuid, criterionId: "another-criterion", success: true, candidateTree: c.state.candidate.tree }, output: "not this requirement" } }));
    });
    h.click("show"); await flush(); expect(completed).toBe(true);
    expect(h.commands.find(c => c.dataset.command === "review")!.disabled).toBe(true);
    disconnected = true; h.click("show"); await flush();
    expect(h.commands.find(c => c.dataset.command === "review")!.disabled).toBe(true);
    expect(h.get("command-message").textContent).toContain("stale state");
});
