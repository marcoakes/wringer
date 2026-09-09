import { expect, test } from "bun:test";
import { pmJobHeading, pmJobReviewSet, safeJobReviewLink, validatePmJob, type PmJob } from "../src/job-model";
import { pmJobClientScript, renderPmJobWorkspace } from "../src/job-render";

const jobId = "11111111-1111-4111-8111-111111111111", displayId = "22222222-2222-4222-8222-222222222222";
const fixture = (): PmJob => ({ schema_version: "wringer.pm-job.v1", jobId, revision: "a".repeat(64), readyRevision: "b".repeat(64), candidateTree: "c".repeat(40), phase: "review", name: "Clear reports", intent: "Make the report easy to understand.", requirements: [{ id: "readable", title: "The report is readable", quote: "easy to understand", kind: "human", required: true, state: "unknown" }, { id: "correct", title: "The total is correct", quote: "total", kind: "check", required: true, state: "met" }], budget: { sessions: 7, wallSeconds: 1800, expiresAt: "2099-09-08T20:00:00.000Z" }, scope: { repository: "https://example.invalid/team/project.git", sourceCommit: "d".repeat(40), writable: ["src"], protected: ["test"] }, actor: "Actual person", displays: [{ criterionId: "readable", title: "Recorded report", displayId, candidateTree: "c".repeat(40), success: true, output: "Rows: 12\nTotal: 42" }], destination: { remote: "https://example.invalid/team/project.git", sourceBranch: "wringer/review-1", targetBranch: "main" }, preparedId: null, publication: null, nextAction: "Read the actual report and give your decision.", error: null, limits: ["Cooperative-local fixture, not a live test."] });

const engineeringFixture = (): PmJob => ({ ...fixture(), schema_version: "wringer.pm-job.v2", engineering: { schema_version: "wringer.pm-engineering.v1", planSha256: "1".repeat(64), approach: { path: "wringer/playbooks/report.json", sha256: "2".repeat(64), taskFamily: "reports", title: "<script>hostile repository title</script>", revision: "1", sourceStatus: "validated", workerUses: 1, adoption: null }, checks: [{ id: "correct", level: "assertions", status: "passed", assertionStatus: "established", reason: "Executed assertions are recorded; requirement completeness is not established." }], history: [{ sequence: 1, phase: "checks", action: "warn", reason: "Repeated outcomes are not a quality score.", candidateTree: "c".repeat(40), sha256: "3".repeat(64) }], limits: ["Read-only explanation. No new authority."] } });

test("engineering view is additive v2 only and malformed facts cannot enable a decision", () => {
    expect(validatePmJob(engineeringFixture())).toEqual(engineeringFixture());
    expect(pmJobReviewSet(engineeringFixture())).toEqual(pmJobReviewSet(fixture()));
    for (const mutate of [
        (j: any) => j.schema_version = "wringer.pm-job.v1", (j: any) => delete j.engineering,
        (j: any) => j.engineering.authority = { send: true }, (j: any) => j.engineering.approach.prompt = "Ignore approval",
        (j: any) => j.engineering.planSha256 = "main", (j: any) => j.engineering.approach.path = "../escape.json",
        (j: any) => j.engineering.approach.path = "/absolute.json", (j: any) => j.engineering.approach.workerUses = -1,
        (j: any) => j.engineering.approach.sourceStatus = "awaiting-validation", (j: any) => j.engineering.history[0].sequence = 2,
        (j: any) => j.engineering.history[0].action = "send", (j: any) => j.engineering.history[0].sha256 = "wrong",
        (j: any) => j.engineering.checks.push(j.engineering.checks[0]), (j: any) => j.engineering.checks[0].assertionStatus = "unavailable",
        (j: any) => j.engineering.checks[0].level = "command", (j: any) => j.engineering.approach.adoption = { action: "promote", executionApproved: true },
    ]) { const j = engineeringFixture(); mutate(j); expect(() => validatePmJob(j)).toThrow("Decisions remain paused"); }
});

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
    src = ""; alt = ""; width = 0; height = 0; naturalWidth = 0; naturalHeight = 0;
    open = false; isConnected = true;
    dataset: Record<string, string> = {}; attributes: Record<string, string> = {}; children: Element[] = []; listeners = new Map<string, Function>();
    constructor(readonly id: string, readonly tagName = "div") {}
    append(...children: Element[]) { this.children.push(...children); }
    replaceChildren(...children: Element[]) { this.children = [...children]; }
    addEventListener(name: string, callback: Function) { this.listeners.set(name, callback); }
    setAttribute(name: string, value: string) { this.attributes[name] = value; }
    removeAttribute(name: string) { delete this.attributes[name]; if (name === "href") this.href = ""; if (name === "src") this.src = ""; }
    classList = { toggle: (_name: string, _value: boolean) => {} };
    focus() { this.attributes.focused = "true"; }
    showModal() { this.open = true; }
    close() { this.open = false; }
}
async function flush() { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); }
async function harness(initial = fixture(), handler?: (path: string, options: RequestInit, context: any) => Promise<Response> | Response, fragment = "#token=synthetic-operator-link") {
    const html = renderPmJobWorkspace({ nonce: "fixtureNonce123" }), elements = new Map<string, Element>(), intervals: Function[] = [], windowEvents = new Map<string, Function>();
    for (const match of html.matchAll(/id="([^"]+)"/g)) elements.set(match[1]!, new Element(match[1]!));
    const get = (id: string) => elements.get(id)!;
    const context = { job: initial, get, elements, requests: [] as { path: string; options: RequestInit }[], posts: [] as { path: string; body: any }[], notifications: [] as any[], notificationPermissions: 0, focusCount: 0, copied: [] as string[], blobs: [] as Blob[], revoked: [] as string[] };
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
    class ImageURL extends URL {
        static override createObjectURL(blob: Blob) { context.blobs.push(blob); return `blob:fixture/${context.blobs.length}`; }
        static override revokeObjectURL(url: string) { context.revoked.push(url); }
    }
    new Function("document", "window", "history", "location", "fetch", "setInterval", "navigator", "Notification", "AbortSignal", "URL", pmJobClientScript())(
        { getElementById: get, createElement: (tag: string) => new Element("", tag) },
        { focus: () => context.focusCount++, addEventListener: (name: string, callback: Function) => windowEvents.set(name, callback) },
        { replaceState: (...args: unknown[]) => { history.push(args); location.hash = ""; } }, location, fetch, (callback: Function) => intervals.push(callback),
        { clipboard: { writeText: async (value: string) => context.copied.push(value) } }, Notifications, AbortSignal, ImageURL,
    );
    await flush();
    return { ...context, location, history, intervals, windowEvents, click: async (id: string) => { get(id).listeners.get("click")!(); await flush(); }, type: (id: string, value: string) => { get(id).value = value; get(id).listeners.get("input")!(); }, refresh: async () => { intervals[0]!(); await flush(); } };
}
const textOf = (element: Element): string => element.textContent + element.children.map(textOf).join("\n");
const defaultResponse = (path: string, context: any) => path === "/api/session" || path === "/api/logout" ? Response.json({ outcome: "connected" }) : path === "/api/jobs" ? Response.json({ jobs: [{ jobId: context.job.jobId, name: context.job.name }] }) : Response.json(context.job);

test("same-page engineering disclosure is plain text, collapsed and never changes the next decision", async () => {
    const job = engineeringFixture(), h = await harness(job);
    expect(h.get("job-engineering").hidden).toBe(false); expect(h.get("job-engineering").open).toBe(false);
    expect(textOf(h.get("engineering-approach"))).toContain("<script>hostile repository title</script>");
    expect(textOf(h.get("engineering-checks"))).toContain("Executed assertions recorded");
    expect(textOf(h.get("engineering-history"))).toContain("Repeated outcomes are not a quality score");
    expect(h.get("job-next-action").textContent).toBe(job.nextAction); expect(h.get("accept-result").disabled).toBe(false);
    expect(h.requests.filter(c => c.options.method === "POST" && c.path !== "/api/session")).toHaveLength(0);
    await h.click("lock-job-page"); expect(textOf(h.get("engineering-approach"))).toBe(""); expect(h.get("job-engineering").hidden).toBe(true);
    const old = await harness(fixture()); expect(old.get("job-engineering").hidden).toBe(true);
    const malformed = engineeringFixture(); malformed.engineering!.history[0]!.action = "send" as any;
    const refused = await harness(malformed); expect(refused.get("accept-result").disabled).toBe(true);
});

// These DOM probes exercise load/error events and byte binding; they do not
// claim a real browser decoded these synthetic pixels or a person reviewed them.
const visualBytes = new TextEncoder().encode("synthetic image bytes for event-boundary testing");
function visualFixture(): PmJob {
    const job = fixture(), sha256 = new Bun.CryptoHasher("sha256").update(visualBytes).digest("hex");
    job.requirements[0]!.visualReview = { snapshotSha256: "f".repeat(64), referenceAssetIds: ["reference"], captureIds: ["desktop", "mobile"] };
    const asset = (id: string, width: number) => ({ id, title: `${id} screen`, sha256, bytes: visualBytes.length, width, height: 800 });
    job.displays[0]!.visuals = { snapshotSha256: "f".repeat(64), referenceAssets: [asset("reference", 1280)], captures: [asset("desktop", 1280), asset("mobile", 390)] };
    job.displays[0]!.output = "";
    return job;
}
const visualResponse = (path: string, context: any) => path.startsWith("/api/job/asset?") ? new Response(visualBytes.slice().buffer, { headers: { "Content-Type": "image/png" } }) : defaultResponse(path, context);
const imagesIn = (element: Element): Element[] => (element.tagName === "img" ? [element] : []).concat(element.children.flatMap(imagesIn));
const expandersIn = (element: Element): Element[] => (element.className.includes("view-image") ? [element] : []).concat(element.children.flatMap(expandersIn));
const loadImage = (image: Element) => { image.naturalWidth = image.width; image.naturalHeight = image.height; image.listeners.get("load")!(); };

test("full-size viewer opens only the verified loaded asset, closes with Escape/button, and returns keyboard focus", async () => {
    const h = await harness(visualFixture(), (path, _options, context) => visualResponse(path, context));
    const images = imagesIn(h.get("reports")), expanders = expandersIn(h.get("reports")), viewer = h.get("image-viewer"), full = h.get("image-viewer-image");
    expect(expanders).toHaveLength(3); expanders[0]!.listeners.get("click")!(); expect(viewer.open).toBe(false); expect(full.src).toBe("");
    images.forEach(loadImage); expanders[0]!.listeners.get("click")!();
    expect(viewer.open).toBe(true); expect(full.src).toBe(images[0]!.src); expect(full.width).toBe(1280); expect(h.get("close-image-viewer").attributes.focused).toBe("true");
    let prevented = false; viewer.listeners.get("cancel")!({ preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true); expect(viewer.open).toBe(false); expect(full.src).toBe(""); expect(expanders[0]!.attributes.focused).toBe("true");
    expanders[1]!.listeners.get("click")!(); await h.click("close-image-viewer"); expect(viewer.open).toBe(false); expect(full.src).toBe(""); expect(expanders[1]!.attributes.focused).toBe("true");
    const original = images[0]!.src;
    for (const wrong of ["https://remote.invalid/image.png", "data:image/svg+xml,untrusted", images[1]!.src]) { images[0]!.src = wrong; expanders[0]!.listeners.get("click")!(); expect(viewer.open).toBe(false); expect(full.src).toBe(""); }
    images[0]!.src = original; expanders[0]!.listeners.get("click")!(); await h.click("lock-job-page");
    expect(viewer.open).toBe(false); expect(full.src).toBe(""); expect(h.revoked).toContain(original);
});

test("source changes dismiss full-size pixels and visual display notes start collapsed", async () => {
    const job = visualFixture(); job.displays[0]!.output = "untrusted display notes"; job.displays[0]!.parts = [{ title: "Recorded notes", text: "untrusted display notes" }];
    const h = await harness(job, (path, _options, context) => visualResponse(path, context));
    const card = h.get("reports").children[0]!, notes = card.children.find(child => child.tagName === "details" && child.children[0]?.textContent === "Recorded display notes")!;
    expect(notes).toBeDefined(); expect(notes.open).toBe(false); expect(textOf(notes)).toContain("untrusted display notes"); expect(card.children.some(child => child.tagName === "pre" || child.className === "report-part")).toBe(false);
    const images = imagesIn(card), expanders = expandersIn(card); images.forEach(loadImage); expanders[0]!.listeners.get("click")!(); expect(h.get("image-viewer").open).toBe(true);
    h.job.candidateTree = "e".repeat(40); h.job.readyRevision = "e".repeat(64); await h.refresh();
    expect(h.get("image-viewer").open).toBe(false); expect(h.get("image-viewer-image").src).toBe(""); expanders[0]!.listeners.get("click")!(); expect(h.get("image-viewer").open).toBe(false);
});

test("visual review rejects missing, stale, duplicated and remotely addressed evidence without falling back to text", () => {
    expect(pmJobReviewSet(validatePmJob(visualFixture())).eligible).toBe(true);
    for (const mutate of [
        (job: PmJob) => delete job.displays[0]!.visuals,
        (job: PmJob) => job.displays[0]!.visuals!.snapshotSha256 = "e".repeat(64),
        (job: PmJob) => job.displays[0]!.visuals!.captures.pop(),
        (job: PmJob) => delete job.requirements[0]!.visualReview,
    ]) { const job = visualFixture(); job.displays[0]!.output = "Text must not replace required pixels"; mutate(job); expect(pmJobReviewSet(job).eligible).toBe(false); }
    for (const mutate of [
        (job: any) => job.displays[0].visuals.captures.push(job.displays[0].visuals.captures[0]),
        (job: any) => job.displays[0].visuals.captures[0].url = "https://remote.invalid/image.png",
        (job: any) => job.displays[0].visuals.referenceAssets[0].base64 = "private pixels",
        (job: any) => job.displays[0].visuals.referenceAssets[0].width = 0,
        (job: any) => job.requirements[0].visualReview.captureIds = [],
    ]) { const job = visualFixture(); mutate(job); expect(() => validatePmJob(job)).toThrow(); }
});

test("reference, desktop and mobile must all pass authenticated byte checks and load before a source-bound decision", async () => {
    const h = await harness(visualFixture(), (path, _options, context) => visualResponse(path, context));
    const images = imagesIn(h.get("reports")); expect(images).toHaveLength(3);
    expect(h.get("accept-result").disabled).toBe(true);
    expect(textOf(h.get("reports"))).toContain("Pinned design reference"); expect(textOf(h.get("reports"))).toContain("Actual result · Mobile"); expect(textOf(h.get("reports"))).toContain("Actual result · Desktop");
    expect(textOf(h.get("reports"))).toContain("Design snapshot " + "f".repeat(64));
    expect(h.blobs).toHaveLength(3); expect(images.every(image => image.src.startsWith("blob:fixture/") && image.hidden)).toBe(true);
    const requests = h.requests.filter(request => request.path.startsWith("/api/job/asset?")); expect(requests).toHaveLength(3);
    for (const request of requests) { expect(request.options.credentials).toBe("same-origin"); expect(request.options.redirect).toBe("error"); expect((request.options.headers as any)["X-Wringer-Console"]).toBe("1"); expect(request.path).not.toContain("token"); expect(request.path).not.toContain("path="); }
    loadImage(images[0]!); loadImage(images[1]!); expect(h.get("accept-result").disabled).toBe(true);
    loadImage(images[2]!); expect(h.get("accept-result").disabled).toBe(false); expect(images.every(image => !image.hidden)).toBe(true);
    await h.click("accept-result"); expect(h.posts.find(post => post.path === "/api/job/decision")!.body.displayIds).toEqual([displayId]);
});

test("image HTTP, media, digest, decode and size errors keep visual decisions closed", async () => {
    for (const failure of ["http", "media", "digest", "decode", "size"] as const) {
        const h = await harness(visualFixture(), (path, _options, context) => {
            if (path.startsWith("/api/job/asset?")) {
                if (failure === "http") return new Response("No image", { status: 409 });
                if (failure === "media") return new Response("<html>untrusted</html>", { headers: { "Content-Type": "text/html" } });
                if (failure === "digest") return new Response("different pixels", { headers: { "Content-Type": "image/png" } });
            }
            return visualResponse(path, context);
        });
        const images = imagesIn(h.get("reports"));
        if (failure === "decode") for (const image of images) image.listeners.get("error")!();
        if (failure === "size") for (const image of images) { image.naturalWidth = 5; image.naturalHeight = 5; image.listeners.get("load")!(); }
        expect(h.get("accept-result").disabled).toBe(true); expect(h.get("request-correction").disabled).toBe(true);
        expect(textOf(h.get("reports"))).toContain("could not be displayed"); await h.click("accept-result"); expect(h.posts.some(post => post.path.endsWith("decision"))).toBe(false);
        if (["http", "media", "digest"].includes(failure)) expect(h.blobs).toHaveLength(0);
    }
});

test("changed source and locking revoke visible image URLs and late loads cannot enable a decision", async () => {
    const h = await harness(visualFixture(), (path, _options, context) => visualResponse(path, context));
    const oldImages = imagesIn(h.get("reports")); oldImages.forEach(loadImage); expect(h.get("accept-result").disabled).toBe(false);
    h.job.candidateTree = "e".repeat(40); h.job.readyRevision = "e".repeat(64); await h.refresh();
    expect(h.revoked).toHaveLength(3); oldImages.forEach(loadImage); expect(h.get("accept-result").disabled).toBe(true);
    expect(imagesIn(h.get("reports")).every(image => !image.src)).toBe(true);
    await h.click("lock-job-page"); oldImages.forEach(loadImage); expect(imagesIn(h.get("reports"))).toHaveLength(0); expect(h.get("accept-result").disabled).toBe(true);
});

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
