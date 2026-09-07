import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseForgeConfiguration, publishMergeRequest, type MergeRequestOptions } from "../src/forge";
const scratch = await mkdtemp(join(tmpdir(), "wringer-forge-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));
const secret = "fixture-credential-do-not-record-12345";
const body = "# Delivery\n\nA person's exact note: clear, useful & ready.\n\n```sh\nwring audit --delivery 'delivery-1' --repo .\nwring verify --falsify --delivery 'delivery-1' --repo .\n```\n";
let serial = 0;
async function fixture(kind: "github" | "gitlab" = "github") {
    const repo = join(scratch, String(++serial));
    await mkdir(join(repo, ".wringer/deliveries/delivery-1"), { recursive: true });
    await Bun.write(join(repo, ".wringer/deliveries/delivery-1/mr.md"), body);
    const options: MergeRequestOptions = { forge: { kind, endpoint: kind === "github" ? "https://api.github.com" : "https://gitlab.example/api/v4", repo: kind === "github" ? "owner/project" : "group/subgroup/project", token_env: "FIXTURE_FORGE_TOKEN" }, deliveryId: "delivery-1", bodyPath: ".wringer/deliveries/delivery-1/mr.md", sourceBranch: "wringer/change-1", targetBranch: "main", title: "A checked change", expectedHeadCommit: "a".repeat(40), publicationRemote: kind === "github" ? "https://github.com/owner/project.git" : "ssh://git@gitlab.example/group/subgroup/project.git", environment: { FIXTURE_FORGE_TOKEN: secret } };
    const row = (patch = {}) => kind === "github" ? { number: 42, html_url: "https://github.com/owner/project/pull/42", title: options.title, body, state: "open", head: { ref: options.sourceBranch, sha: options.expectedHeadCommit, repo: { full_name: options.forge.repo } }, base: { ref: options.targetBranch, repo: { full_name: options.forge.repo } }, ...patch } : { iid: 42, web_url: "https://gitlab.example/group/subgroup/project/-/merge_requests/42", title: options.title, description: body, state: "opened", sha: options.expectedHeadCommit, source_branch: options.sourceBranch, target_branch: options.targetBranch, source_project_id: 100, target_project_id: 100, ...patch };
    return { repo, options, row };
}
const reply = (data: unknown, status = 200, headers?: Record<string, string>) => new Response(JSON.stringify(data), { status, headers });
function transport(call: (url: URL, init: RequestInit) => Promise<Response> | Response): typeof fetch { return ((input: string | URL | Request, init: RequestInit = {}) => call(new URL(String(input)), init)) as typeof fetch; }
async function contents(root: string): Promise<string> {
    let result = "";
    for (const entry of await readdir(root, { withFileTypes: true }))
        result += entry.isDirectory() ? await contents(join(root, entry.name)) : await readFile(join(root, entry.name), "utf8");
    return result;
}
test("preparation preserves mr.md and creates no network request or secret receipt", async () => {
    const f = await fixture();
    let calls = 0;
    const result = await publishMergeRequest(f.repo, { ...f.options, transport: transport(() => { calls++; return reply([]); }) });
    expect(result.status).toBe("prepared");
    expect(calls).toBe(0);
    const intent = await Bun.file(join(result.state_directory, "intent.json")).json();
    expect(intent.request.body.body).toBe(body);
    expect(intent.body_path).toBe(f.options.bodyPath);
    expect(await Bun.file(join(f.repo, f.options.bodyPath)).text()).toBe(body);
    expect(await contents(result.state_directory)).not.toContain(secret);
});
test("unknown forge input is strictly parsed before use", async () => {
    const f = await fixture();
    expect(parseForgeConfiguration({ ...f.options.forge, endpoint: "https://api.github.com/" }).endpoint).toBe("https://api.github.com");
    for (const value of [null, [], {}, { ...f.options.forge, endpoint: 42 }, { ...f.options.forge, token_env: ["TOKEN"] }, { ...f.options.forge, surprise: true }, { ...f.options.forge, repo: "owner/../project" }]) {
        expect(() => parseForgeConfiguration(value)).toThrow();
    }
});
for (const kind of ["github", "gitlab"] as const)
    test(`${kind} publishes only after exact-branch lookup and immutable pre-request recording`, async () => {
        const f = await fixture(kind);
        const methods: string[] = [];
        const result = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport(async (url, init) => {
                methods.push(init.method!);
                expect(init.redirect).toBe("error");
                expect(init.signal).toBeDefined();
                const directory = join(f.repo, ".wringer/publications/delivery-1");
                expect(await Bun.file(join(directory, "intent.json")).exists()).toBe(true);
                const attempts = await readdir(join(directory, "attempts"));
                const requests = await Promise.all(attempts.map(a => Bun.file(join(directory, "attempts", a, "request.json")).json()));
                expect(requests.some(r => r.method === init.method && r.url === url.href)).toBe(true);
                expect(JSON.stringify(requests)).not.toContain(secret);
                if (init.method === "GET") {
                    expect(url.searchParams.get("state")).toBe("all");
                    expect(url.searchParams.get(kind === "github" ? "head" : "source_branch")).toBe(kind === "github" ? "owner:wringer/change-1" : "wringer/change-1");
                    return reply([]);
                }
                const payload = JSON.parse(String(init.body));
                expect(payload[kind === "github" ? "body" : "description"]).toBe(body);
                expect((init.headers as Record<string, string>)[kind === "github" ? "Authorization" : "PRIVATE-TOKEN"]).toBe(kind === "github" ? `Bearer ${secret}` : secret);
                if (kind === "gitlab")
                    expect(url.pathname).toContain("group%2Fsubgroup%2Fproject");
                return reply(f.row(), 201);
            }) });
        expect(methods).toEqual(["GET", "POST"]);
        expect(result.status).toBe("published");
        expect(result.number).toBe(42);
        expect(await contents(result.state_directory)).not.toContain(secret);
        expect(await readdir(join(f.repo, ".wringer/deliveries/delivery-1"))).toEqual(["mr.md"]);
    });
test("an uncertain POST is recovered by same-branch query without a duplicate POST", async () => {
    const f = await fixture();
    let posts = 0;
    const first = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { if (init.method === "GET")
            return reply([]); posts++; throw new Error(`connection dropped ${secret}`); }) });
    expect(first.status).toBe("uncertain");
    const second = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { if (init.method === "POST")
            posts++; return reply([f.row()]); }) });
    expect(second.status).toBe("recovered");
    expect(second.number).toBe(42);
    expect(posts).toBe(1);
    expect(await contents(first.state_directory)).not.toContain(secret);
});
test("unknown POST plus empty or failed lookup stays uncertain and never retries create", async () => {
    const f = await fixture();
    let posts = 0;
    await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { if (init.method === "GET")
            return reply([]); posts++; return reply({ message: "backend failure" }, 503); }) });
    for (const status of [200, 503]) {
        const result = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { if (init.method === "POST")
                posts++; return reply(status === 200 ? [] : { message: "unavailable" }, status); }) });
        expect(result.status).toBe("uncertain");
    }
    expect(posts).toBe(1);
});
test("changed immutable intent and existing different MR content are not silently overwritten", async () => {
    const f = await fixture();
    await publishMergeRequest(f.repo, f.options);
    let calls = 0;
    const changed = await publishMergeRequest(f.repo, { ...f.options, title: "New title", send: true, transport: transport(() => { calls++; return reply([]); }) });
    expect(changed.status).toBe("blocked");
    expect(calls).toBe(0);
    const mismatch = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { expect(init.method).toBe("GET"); return reply([f.row({ body: "Different handover" })]); }) });
    expect(mismatch.status).toBe("blocked");
    expect(mismatch.reason).toContain("not overwritten");
});
for (const kind of ["github", "gitlab"] as const) {
    test(`${kind} distinguishes closed/merged requests without duplicate creation`, async () => {
        for (const state of ["closed", "merged"] as const) {
            const f = await fixture(kind);
            const result = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => {
                expect(init.method).toBe("GET");
                return reply([f.row(kind === "github" && state === "merged" ? { state: "closed", merged_at: "2026-01-01T00:00:00Z" } : { state })]);
            }) });
            expect(result.status).toBe(state);
            expect(result.hosted_state).toBe(state);
            expect(result.head_commit).toBe(f.options.expectedHeadCommit);
        }
    });
    test(`${kind} refuses a same-branch request pointing at another commit`, async () => {
        const f = await fixture(kind), wrong = f.row();
        if (kind === "github") (wrong as any).head.sha = "b".repeat(40); else (wrong as any).sha = "b".repeat(40);
        const result = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { expect(init.method).toBe("GET"); return reply([wrong]); }) });
        expect(result.status).toBe("blocked");
        expect(result.reason).toContain("exact delivered evidence commit");
    });
}
test("different Git/forge repositories and missing commit bindings cannot send", async () => {
    const f = await fixture(); let calls = 0;
    const t = transport(() => { calls++; return reply([]); });
    await expect(publishMergeRequest(f.repo, { ...f.options, send: true, publicationRemote: "https://github.com/other/project.git", transport: t })).rejects.toThrow("configured forge repository");
    const result = await publishMergeRequest(f.repo, { ...f.options, expectedHeadCommit: undefined, send: true, transport: t });
    expect(result.status).toBe("blocked");
    expect(calls).toBe(0);
});
test("missing credential, cancellation and malformed declarations make no request", async () => {
    const f = await fixture();
    let calls = 0;
    const t = transport(() => { calls++; return reply([]); });
    expect((await publishMergeRequest(f.repo, { ...f.options, send: true, environment: {}, transport: t })).status).toBe("blocked");
    expect((await publishMergeRequest(f.repo, { ...f.options, send: true, signal: AbortSignal.abort(), transport: t })).status).toBe("blocked");
    await expect(publishMergeRequest(f.repo, { ...f.options, forge: { ...f.options.forge, endpoint: `https://user:${secret}@forge.example` }, send: true, transport: t })).rejects.toThrow("credential-free");
    await expect(publishMergeRequest(f.repo, { ...f.options, stateDirectory: ".wringer/deliveries/delivery-1/publication" })).rejects.toThrow("outside the sealed");
    expect(calls).toBe(0);
});
test("redirects, oversized responses and ambiguous matches refuse before creation", async () => {
    for (const scenario of ["redirect", "oversized", "duplicate"]) {
        const f = await fixture();
        let posts = 0;
        const result = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => { if (init.method === "POST")
                posts++; if (scenario === "redirect")
                return new Response(null, { status: 302, headers: { location: "https://untrusted.example" } }); if (scenario === "oversized")
                return new Response("x".repeat(2 * 1024 * 1024 + 1)); return reply([f.row(), f.row({ number: 43, html_url: "https://github.com/owner/project/pull/43" })]); }) });
        expect(result.status).toBe("blocked");
        expect(posts).toBe(0);
    }
});
test("same-state concurrent invocations cannot race two POSTs", async () => {
    const f = await fixture();
    let unlock!: () => void;
    const pending = new Promise<void>(resolve => { unlock = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    let posts = 0;
    const first = publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport(async (_url, init) => { if (init.method === "GET") {
            entered();
            await pending;
            return reply([]);
        } posts++; return reply(f.row(), 201); }) });
    await started;
    await expect(publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport(() => { posts++; return reply([]); }) })).rejects.toThrow("active");
    unlock();
    expect((await first).status).toBe("published");
    expect(posts).toBe(1);
});
test("JSON-escaped credential echoes are redacted in persisted responses", async () => {
    const f = await fixture();
    const encoded = secret.replaceAll("-", "\\u002d");
    const result = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport(() => new Response(`{"error":"${encoded}"}`, { status: 403 })) });
    expect(result.status).toBe("blocked");
    const log = await contents(result.state_directory);
    expect(log).not.toContain(secret);
    expect(log).not.toContain(encoded);
    expect(log).toContain("[REDACTED]");
});
test("publication cannot write through a pre-existing outcomes symlink", async () => {
    const f = await fixture(), outside = join(scratch, `outside-${++serial}`), state = join(f.repo, ".wringer/publications/delivery-1");
    await mkdir(outside);
    await mkdir(state, { recursive: true });
    await symlink(outside, join(state, "outcomes"));
    let calls = 0;
    await expect(publishMergeRequest(f.repo, { ...f.options, transport: transport(() => { calls++; return reply([]); }) })).rejects.toThrow("Symlinks");
    expect(calls).toBe(0);
    expect(await readdir(outside)).toEqual([]);
});
test("cancellation during POST records uncertainty and resume only reconciles", async () => {
    const f = await fixture(), controller = new AbortController();
    let posts = 0;
    const first = await publishMergeRequest(f.repo, { ...f.options, send: true, signal: controller.signal, transport: transport((_url, init) => {
            if (init.method === "GET")
                return reply([]);
            posts++;
            return new Promise<Response>((_resolve, reject) => {
                init.signal!.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
                controller.abort();
            });
        }) });
    expect(first.status).toBe("uncertain");
    const resumed = await publishMergeRequest(f.repo, { ...f.options, send: true, transport: transport((_url, init) => {
            if (init.method === "POST")
                posts++;
            return reply([f.row()]);
        }) });
    expect(resumed.status).toBe("recovered");
    expect(posts).toBe(1);
});
