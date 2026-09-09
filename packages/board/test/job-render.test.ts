import { expect, test } from "bun:test";
import { pmJobHeading, pmJobReviewSet, safeJobReviewLink, validatePmJob, type PmJob } from "../src/job-model";
import { pmJobClientScript, renderPmJobWorkspace } from "../src/job-render";

const jobId = "11111111-1111-4111-8111-111111111111", displayId = "22222222-2222-4222-8222-222222222222";
const fixture = (): PmJob => ({ schema_version: "wringer.pm-job.v1", jobId, revision: "a".repeat(64), readyRevision: "b".repeat(64), candidateTree: "c".repeat(40), phase: "review", name: "Clear reports", intent: "Make the report easy to understand.", requirements: [{ id: "readable", title: "The report is readable", quote: "easy to understand", kind: "human", required: true, state: "unknown" }, { id: "correct", title: "The total is correct", quote: "total", kind: "check", required: true, state: "met" }], budget: { sessions: 7, wallSeconds: 1800, expiresAt: "2099-09-08T20:00:00.000Z" }, scope: { repository: "https://example.invalid/team/project.git", sourceCommit: "d".repeat(40), writable: ["src"], protected: ["test"] }, actor: "Actual person", displays: [{ criterionId: "readable", title: "Recorded report", displayId, candidateTree: "c".repeat(40), success: true, output: "Rows: 12\nTotal: 42" }], destination: { remote: "https://example.invalid/team/project.git", sourceBranch: "wringer/review-1", targetBranch: "main" }, preparedId: null, publication: null, nextAction: "Read the actual report and give your decision.", error: null, limits: ["Cooperative-local fixture, not a live test."] });

test("job DTO rejects malformed identities, duplicate/oversized displays and incomplete approval scope", () => {
    expect(validatePmJob(fixture())).toEqual(fixture());
    for (const mutate of [
        (j: any) => j.readyRevision = "not-a-revision", (j: any) => j.candidateTree = "wrong", (j: any) => j.jobId = "../../other",
        (j: any) => j.displays.push(j.displays[0]), (j: any) => j.requirements.push(j.requirements[0]),
        (j: any) => j.displays[0].success = "yes", (j: any) => j.displays[0].output = "x".repeat(524289),
        (j: any) => j.budget.wallSeconds = -1, (j: any) => j.budget.expiresAt = "forever", (j: any) => delete j.scope,
        (j: any) => j.scope.sourceCommit = "main", (j: any) => j.questions = "none", (j: any) => j.retryable = "true",
        (j: any) => { j.retryable = true; delete j.retryLabel; },
    ]) { const job = fixture(); mutate(job); expect(() => validatePmJob(job)).toThrow(); }
});

test("one combined review covers exactly successful current-source displays for required unreviewed human requirements", () => {
    const job = fixture();
    expect(pmJobReviewSet(job)).toEqual({ eligible: true, displayIds: [displayId], reason: "" });
    job.requirements.push({ id: "optional", title: "Optional item", quote: "", kind: "human", required: false, state: "unknown" });
    expect(pmJobReviewSet(job).displayIds).toEqual([displayId]);
    job.requirements.push({ id: "second", title: "Another required report", quote: "", kind: "human", required: true, state: "unknown" });
    expect(pmJobReviewSet(job).eligible).toBe(false);
    job.displays.push({ ...job.displays[0]!, criterionId: "second", displayId: "33333333-3333-4333-8333-333333333333" });
    expect(pmJobReviewSet(job).eligible).toBe(true);
    for (const mutate of [(j: PmJob) => j.displays[0]!.success = false, (j: PmJob) => j.displays[0]!.candidateTree = "f".repeat(40), (j: PmJob) => j.displays[0]!.output = " \n", (j: PmJob) => j.actor = null, (j: PmJob) => j.questions = ["What should the total include?"], (j: PmJob) => j.phase = "working"]) {
        const changed = fixture(); mutate(changed); expect(pmJobReviewSet(changed).eligible).toBe(false);
    }
    const alreadyReviewed = fixture(); alreadyReviewed.requirements[0]!.state = "met"; expect(pmJobReviewSet(alreadyReviewed).eligible).toBe(false);
});

test("shell is a single private-session page with no embedded job, default verdict, expiry picker or destination re-entry", () => {
    const html = renderPmJobWorkspace({ nonce: "fixtureNonce123" });
    expect(html).toContain('id="job-workspace" tabindex="-1" hidden'); expect(html).toContain('id="approve-job" type="button" disabled');
    expect(html).toContain('id="accept-result" type="button" disabled>Yes, this is right'); expect(html).toContain('id="send-job" type="button" disabled');
    expect(html).toContain('id="approval-source"'); expect(html).toContain('id="approval-scope"');
    expect(html.indexOf('id="send-panel"')).toBeLessThan(html.indexOf('id="report-review-layout"'));
    expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('type="datetime-local"'); expect(html).not.toContain('id="delivery-remote"');
    expect(html).not.toContain(jobId); expect(html).not.toContain("Rows: 12"); expect(html).not.toContain("unsafe-inline");
    expect(html).toContain('id="job-evidence"><summary>'); expect(html).toContain("No notification inside your coding app is claimed");
    expect(html).toContain("@media(max-width:800px)"); expect(html).toContain(":focus-visible");
    expect(() => renderPmJobWorkspace({ nonce: '\" onclick=alert(1)' })).toThrow("nonce");
    expect(() => new Function(pmJobClientScript())).not.toThrow(); expect(pmJobClientScript()).not.toContain("innerHTML"); expect(pmJobClientScript()).not.toContain("localStorage"); expect(pmJobClientScript()).not.toContain("sessionStorage");
    expect(safeJobReviewLink("https://user:secret@example.invalid/1")).toBeNull(); expect(safeJobReviewLink("javascript:alert(1)")).toBeNull(); expect(safeJobReviewLink("http://127.0.0.1:1234/#token=private")).toBeNull();
    expect(safeJobReviewLink("https://example.invalid/review/1")).toBe("https://example.invalid/review/1");
    expect(pmJobHeading(fixture())).toBe("Is this the result you wanted?");
    const showing = fixture(); showing.phase = "preparing";
    expect(pmJobHeading(showing)).toBe("Preparing the next step.");
    expect(pmJobHeading(showing)).not.toContain("review is recorded");
});

class Element {
    value = ""; textContent = ""; disabled = false; hidden = false; href = ""; className = ""; tabIndex = 0;
    dataset: Record<string, string> = {}; attributes: Record<string, string> = {}; children: Element[] = []; listeners = new Map<string, Function>();
    constructor(readonly id: string, readonly tagName = "div") {}
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = [...children]; }
    addEventListener(name: string, callback: Function) { this.listeners.set(name, callback); }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    removeAttribute(name: string) { delete this.attributes[name]; if (name === "href") this.href = ""; }
    classList = { toggle: (_name: string, _value: boolean) => {} };
    focus() { this.attributes.focused = "true"; }
}
async function flush() { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); }
async function harness(initial = fixture(), handler?: (path: string, options: RequestInit, context: any) => Promise<Response> | Response, fragment = "#token=synthetic-operator-link") {
    const html = renderPmJobWorkspace({ nonce: "fixtureNonce123" }), elements = new Map<string, Element>(), intervals: Function[] = [], windowEvents = new Map<string, Function>();
    for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1]!, new Element(match[1]!));
    const get = (id: string) => elements.get(id)!;
    const context = { job: initial, get, elements, requests: [] as { path: string; options: RequestInit }[], posts: [] as { path: string; body: any }[], notifications: [] as any[], notificationPermissions: 0, focusCount: 0, copied: [] as string[] };
    const location = { hash: fragment, pathname: "/", search: `?jobId=${jobId}` }, history: unknown[][] = [];
    const fetch = async (path: string, options: RequestInit = {}) => {
        context.requests.push({ path, options }); if (options.method === "POST") context.posts.push({ path, body: JSON.parse(String(options.body)) });
        if (handler) return handler(path, options, context);
        if (path === "/api/session" || path === "/api/logout") return Response.json({ outcome: "connected" });
        if (path === "/api/jobs") return Response.json({ jobs: [{ jobId: context.job.jobId, name: context.job.name, phase: context.job.phase, nextAction: context.job.nextAction }] });
        return Response.json(context.job);
    };
    class Notifications {
        static permission = "default";
        static async requestPermission() { context.notificationPermissions++; this.permission = "granted"; return "granted"; }
        onclick: Function | null = null;
        constructor(title: string, options: unknown) { context.notifications.push({ title, options, instance: this }); }
        close() {}
    }
    new Function("document", "window", "history", "location", "fetch", "setInterval", "navigator", "Notification", "AbortSignal", pmJobClientScript())(
        { getElementById: get, createElement: (tag: string) => new Element("", tag) },
        { focus: () => context.focusCount++, addEventListener: (name: string, callback: Function) => windowEvents.set(name, callback) },
        { replaceState: (...args: unknown[]) => { history.push(args); location.hash = ""; } }, location, fetch, (callback: Function) => intervals.push(callback),
        { clipboard: { writeText: async (value: string) => context.copied.push(value) } }, Notifications, AbortSignal,
    );
    await flush();
    return { ...context, location, history, intervals, windowEvents, click: async (id: string) => { get(id).listeners.get("click")!(); await flush(); }, type: (id: string, value: string) => { get(id).value = value; get(id).listeners.get("input")!(); }, refresh: async () => { intervals[0]!(); await flush(); } };
}
const textOf = (element: Element): string => element.textContent + element.children.map(textOf).join("\n");
const defaultResponse = (path: string, context: any) => path === "/api/session" || path === "/api/logout" ? Response.json({ outcome: "connected" }) : path === "/api/jobs" ? Response.json({ jobs: [{ jobId: context.job.jobId, name: context.job.name }] }) : Response.json(context.job);

test("report cards deduplicate identical titles while preserving distinct and multipart labels and original output", async () => {
    const job = fixture(), title = job.requirements[0]!.title;
    job.displays[0]!.title = title; job.displays[0]!.parts = [{ title, text: "Actual part text" }];
    const h = await harness(job);
    expect(textOf(h.get("reports")).split(title)).toHaveLength(2);
    expect(textOf(h.get("reports"))).toContain("Actual part text"); expect(textOf(h.get("reports"))).toContain(job.displays[0]!.output);
    h.job.displays[0]!.parts![0]!.title = "Distinct section title"; await h.refresh();
    expect(textOf(h.get("reports"))).toContain("Distinct section title");
    h.job.displays[0]!.parts = [{ title, text: "First part" }, { title: "Second section", text: "Second part" }]; await h.refresh();
    expect(textOf(h.get("reports")).split(title)).toHaveLength(3); expect(textOf(h.get("reports"))).toContain("Second section");
    h.job.displays[0]!.title = "A different report title"; await h.refresh();
    expect(textOf(h.get("reports"))).toContain("A different report title"); expect(textOf(h.get("reports"))).toContain(title);
});

test("reports stay inert, approval scope is visible and optional comments are omitted rather than invented", async () => {
    const job = fixture(); job.displays[0]!.output = '<script>untrusted report</script>'; job.requirements[0]!.quote = "<img onerror=bad>";
    const h = await harness(job, (path, options, c) => {
        if (path === "/api/job/decision") { c.job.phase = "preparing"; c.job.requirements[0].state = "met"; c.job.readyRevision = "f".repeat(64); return Response.json({ outcome: "recorded" }); }
        return defaultResponse(path, c);
    });
    expect(textOf(h.get("reports"))).toContain('<script>untrusted report</script>'); expect(h.get("reports").children[0]!.dataset.displayId).toBe(displayId);
    expect(textOf(h.get("approval-source"))).toContain(job.scope.sourceCommit); expect(h.get("approval-scope").textContent).toContain("src");
    expect(h.get("review-note").value).toBe(""); expect(h.get("accept-result").disabled).toBe(false);
    await h.click("accept-result");
    const request = h.posts.find(p => p.path === "/api/job/decision")!.body;
    expect(request).toEqual({ jobId, expectedRevision: "b".repeat(64), expectedCandidateTree: "c".repeat(40), verdict: "met", displayIds: [displayId] }); expect(request).not.toHaveProperty("note"); expect(request).not.toHaveProperty("actor");
    expect(h.get("progress-panel").hidden).toBe(false); expect(h.get("review-panel").hidden).toBe(true); expect(h.posts.filter(p => !p.path.endsWith("session"))).toHaveLength(1);
});

test("a correction requires actual authored words and sends that exact note once", async () => {
    const h = await harness(fixture(), (path, _options, c) => {
        if (path === "/api/job/correction") { c.job.phase = "working"; c.job.readyRevision = "f".repeat(64); return Response.json({ outcome: "recorded" }); }
        return defaultResponse(path, c);
    });
    await h.click("request-correction"); expect(h.get("correction-panel").hidden).toBe(false); expect(h.get("submit-correction").disabled).toBe(true);
    expect(h.posts.filter(p => p.path.startsWith("/api/job/"))).toHaveLength(0);
    const note = " The dates still need labels.\nKeep my wording. "; h.type("correction-note", note); await h.click("submit-correction");
    expect(h.posts.filter(p => p.path.startsWith("/api/job/"))).toEqual([{ path: "/api/job/correction", body: { jobId, expectedRevision: "b".repeat(64), expectedCandidateTree: "c".repeat(40), note } }]);
    expect(h.get("correction-note").value).toBe(""); expect(h.get("progress-panel").hidden).toBe(false);
    expect(h.get("correction-panel").hidden).toBe(true); await h.click("submit-correction");
    expect(h.posts.filter(p => p.path.startsWith("/api/job/"))).toHaveLength(1);
});

test("an existing review comment requests correction in one action without a separate No or continuation submission", async () => {
    const h = await harness(fixture(), (path, _options, c) => {
        if (path === "/api/job/correction") { c.job.phase = "working"; c.job.readyRevision = "f".repeat(64); return Response.json({ outcome: "recorded" }); }
        return defaultResponse(path, c);
    });
    const note = " Please show the dates as day/month/year. "; h.type("review-note", note); await h.click("request-correction");
    expect(h.posts.filter(p => p.path.startsWith("/api/job/"))).toEqual([{ path: "/api/job/correction", body: { jobId, expectedRevision: "b".repeat(64), expectedCandidateTree: "c".repeat(40), note } }]);
    expect(h.get("correction-panel").hidden).toBe(true); expect(h.get("progress-panel").hidden).toBe(false);
    expect(h.get("review-note").value).toBe(""); await h.click("request-correction");
    expect(h.posts.filter(p => p.path.startsWith("/api/job/"))).toHaveLength(1);
});

test("stale/failed/unseen reports never enable acceptance and semantic changes clear drafted observations", async () => {
    const h = await harness(); h.type("review-note", "Draft for the previous result");
    h.job.candidateTree = "d".repeat(40); h.job.readyRevision = "e".repeat(64); await h.refresh();
    expect(h.get("review-note").value).toBe(""); expect(h.get("accept-result").disabled).toBe(true); await h.click("accept-result"); expect(h.posts.filter(p => p.path.includes("decision"))).toHaveLength(0);
    expect(textOf(h.get("reports"))).toContain("does not establish");
    h.job.displays[0]!.candidateTree = h.job.candidateTree!; h.job.displays[0]!.success = false; h.job.displays[0]!.error = "The display failed."; await h.refresh();
    expect(textOf(h.get("reports"))).toContain("The display failed."); expect(h.get("accept-result").disabled).toBe(true);
});

test("approval binds the shown source and finite limits without a manual expiry or automatic decision", async () => {
    const job = fixture(); job.phase = "approval"; job.actor = null; job.candidateTree = null; job.displays = []; job.budget.expiresAt = null;
    const h = await harness(job, (path, _options, c) => {
        if (path === "/api/job/approve") { c.job.phase = "working"; c.job.readyRevision = "f".repeat(64); return Response.json({ outcome: "approved" }); }
        return defaultResponse(path, c);
    });
    expect(h.get("approve-job").disabled).toBe(true); expect(h.get("approval-actor").value).toBe("");
    expect(h.get("approval-budget").textContent).toContain("7 agent sessions and 30 minutes"); expect(textOf(h.get("approval-requirements"))).toContain("report is readable");
    h.type("approval-actor", "Person's exact name"); await h.click("approve-job");
    expect(h.posts.find(p => p.path === "/api/job/approve")!.body).toEqual({ jobId, expectedRevision: "b".repeat(64), actor: "Person's exact name" });
    expect(h.posts.filter(p => p.path.includes("decision") || p.path.includes("send"))).toHaveLength(0);
});

test("Send is a separate exact prepared-source action and the reviewer receives only recorded public instructions", async () => {
    const job = fixture(); job.phase = "send"; job.requirements[0]!.state = "met"; job.preparedId = "44444444-4444-4444-8444-444444444444";
    const h = await harness(job, (path, _options, c) => {
        if (path === "/api/job/send") { c.job.phase = "sent"; c.job.readyRevision = "f".repeat(64); c.job.publication = { status: "branch-pushed", deliveryId: "contained-fixture", url: "https://example.invalid/review/1", cloneCommand: "git clone the-recorded-remote", auditCommand: "wringer-drive audit --bundle recorded-bundle" }; return Response.json({ outcome: "sent" }); }
        return defaultResponse(path, c);
    });
    expect(h.get("send-panel").hidden).toBe(false); expect(textOf(h.get("send-destination"))).toContain(job.destination!.remote); expect(h.posts.filter(p => p.path.endsWith("send"))).toHaveLength(0);
    await h.click("send-job"); expect(h.posts.find(p => p.path === "/api/job/send")!.body).toEqual({ jobId, expectedRevision: "b".repeat(64), expectedCandidateTree: "c".repeat(40), preparedId: "44444444-4444-4444-8444-444444444444" });
    expect(h.get("handover-panel").hidden).toBe(false); expect(h.get("review-request-link").href).toBe("https://example.invalid/review/1"); expect(h.get("audit-command").textContent).toBe("wringer-drive audit --bundle recorded-bundle");
    await h.click("copy-audit"); expect(h.copied).toEqual(["git clone the-recorded-remote\n\nwringer-drive audit --bundle recorded-bundle"]);
});

test("lost action responses pause further decisions without automatic repost or inferred acceptance", async () => {
    const h = await harness(fixture(), (path, _options, c) => { if (path === "/api/job/decision") throw new Error("Synthetic lost response"); return defaultResponse(path, c); });
    await h.click("accept-result"); await h.refresh(); await h.click("accept-result");
    expect(h.posts.filter(p => p.path === "/api/job/decision")).toHaveLength(1); expect(h.get("accept-result").disabled).toBe(true); expect(h.get("review-panel").hidden).toBe(false); expect(h.get("job-message").textContent).toContain("not repeated");
    h.job.phase = "preparing"; h.job.readyRevision = "f".repeat(64); await h.refresh(); expect(h.get("progress-panel").hidden).toBe(false);
});

test("notification is opt-in, readiness-deduplicated and carries neither project content nor private capabilities", async () => {
    const job = fixture(); job.phase = "working";
    const h = await harness(job); expect(h.notifications).toHaveLength(0); await h.click("notify-ready");
    h.job.phase = "review"; h.job.readyRevision = "e".repeat(64); await h.refresh(); await h.refresh();
    expect(h.notifications).toHaveLength(1); expect(h.notifications[0].title).toBe("Your result is ready"); expect(JSON.stringify(h.notifications[0].options)).not.toContain("token"); expect(JSON.stringify(h.notifications[0].options)).not.toContain(job.name); expect(JSON.stringify(h.notifications[0].options)).not.toContain(job.intent);
    h.notifications[0].instance.onclick(); expect(h.get("notification-note").textContent).toContain("while this page is open");
    h.job.phase = "send"; h.job.readyRevision = "f".repeat(64); await h.refresh(); expect(h.notifications).toHaveLength(2);
});

test("browser continuity exchanges one bearer, then reads with cookies; locking stops polling and decisions", async () => {
    const h = await harness(); expect(h.location.hash).toBe(""); expect(h.history[0]).toEqual([null, "", `/?jobId=${jobId}`]);
    expect(h.requests[0]!.path).toBe("/api/session"); expect((h.requests[0]!.options.headers as any).Authorization).toBe("Bearer synthetic-operator-link");
    for (const request of h.requests.slice(1)) { expect(request.options.credentials).toBe("same-origin"); expect((request.options.headers as any).Authorization).toBeUndefined(); expect((request.options.headers as any)["X-Wringer-Console"]).toBe("1"); }
    const reopened = await harness(fixture(), undefined, ""); expect(reopened.requests.some(r => r.path === "/api/session")).toBe(false); expect(reopened.get("accept-result").disabled).toBe(false);
    await h.click("lock-job-page"); expect(h.get("job-workspace").hidden).toBe(true); expect(h.get("accept-result").disabled).toBe(true); const count = h.requests.length; await h.refresh(); expect(h.requests).toHaveLength(count);
});

test("an in-flight authenticated read cannot restore private content after the page is locked", async () => {
    let holdRead = false, finishRead: ((response: Response) => void) | undefined;
    const h = await harness(fixture(), (path, _options, c) => {
        if (holdRead && path.startsWith("/api/job?")) return new Promise<Response>(resolve => { finishRead = resolve; });
        return defaultResponse(path, c);
    });
    await h.click("notify-ready"); holdRead = true; h.intervals[0]!(); await flush();
    expect(finishRead).toBeDefined(); await h.click("lock-job-page");
    finishRead!(Response.json(fixture())); await flush();
    expect(h.get("job-workspace").hidden).toBe(true); expect(h.get("accept-result").disabled).toBe(true);
    expect(h.get("job-empty").textContent).toContain("locked"); expect(h.notifications).toHaveLength(0);
    await h.click("accept-result"); expect(h.posts.filter(p => p.path.endsWith("decision"))).toHaveLength(0);
});

test("only a recorded retryable failed local step exposes explicit retry, never ordinary blocked work", async () => {
    const job = fixture(); job.phase = "blocked"; job.retryable = false;
    const h = await harness(job, (path, _options, c) => { if (path === "/api/job/retry") { c.job.phase = "preparing"; c.job.readyRevision = "e".repeat(64); return Response.json({ outcome: "retry-recorded" }); } return defaultResponse(path, c); });
    expect(h.get("retry-job").hidden).toBe(true); await h.click("retry-job"); expect(h.posts.filter(p => p.path.endsWith("retry"))).toHaveLength(0);
    h.job.retryable = true; h.job.retryLabel = "Try showing the result again"; await h.refresh(); expect(h.get("retry-job").textContent).toBe("Try showing the result again"); await h.click("retry-job");
    expect(h.posts.find(p => p.path === "/api/job/retry")!.body).toEqual({ jobId, expectedRevision: "b".repeat(64), expectedCandidateTree: "c".repeat(40) });
});
