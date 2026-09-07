/** Provider mappings: https://docs.github.com/en/rest/pulls/pulls and
 * https://docs.gitlab.com/api/merge_requests/. The CLI names no provider fields. */
import { mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Redactor } from "@wringer/engine";
import { digest, inside, stamp } from "./io";
export interface ForgeConfiguration {
    kind: "github" | "gitlab";
    endpoint: string;
    repo: string;
    token_env: string;
}
export interface MergeRequestOptions {
    forge: ForgeConfiguration;
    deliveryId: string;
    bodyPath: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    /** Exact pushed evidence commit and repository; required before any send. */
    expectedHeadCommit?: string;
    publicationRemote?: string;
    /** Mutable publication lifecycle must stay outside the sealed delivery bundle. */
    stateDirectory?: string;
    send?: boolean;
    signal?: AbortSignal;
    transport?: typeof fetch;
    environment?: Record<string, string | undefined>;
    resumeCommand?: string;
}
export interface MergeRequestPublication {
    schema_version: "wringer.forge-publication.v2";
    status: "prepared" | "published" | "recovered" | "closed" | "merged" | "blocked" | "uncertain";
    state_directory: string;
    request_sha256: string;
    url?: string;
    number?: number;
    hosted_state?: "open" | "closed" | "merged";
    head_commit?: string;
    repository?: string;
    reason?: string;
    next_move: string;
}
type Obj = Record<string, any>;
const object = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : object(v) ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${stable(value)}`).join(",")}}` : JSON.stringify(v);
const maxBytes = 2 * 1024 * 1024;
function endpoint(value: string): URL {
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error("Forge URL is malformed");
    }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))))
        throw new Error("Forge endpoint must be credential-free HTTPS (or explicit loopback HTTP), without query or fragment");
    return url;
}
export function parseForgeConfiguration(value: unknown): ForgeConfiguration {
    if (!object(value) || Object.keys(value).some(k => !["kind", "endpoint", "repo", "token_env"].includes(k)) || !["github", "gitlab"].includes(value.kind) || typeof value.endpoint !== "string" || typeof value.token_env !== "string" || typeof value.repo !== "string" || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value.repo) || value.repo.split("/").some(p => [".", ".."].includes(p)) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.token_env))
        throw new Error("Declare forge.kind, endpoint, repo and token_env with no unknown fields");
    if (value.kind === "github" && value.repo.split("/").length !== 2)
        throw new Error("GitHub repository must be owner/name");
    return { kind: value.kind, repo: value.repo, token_env: value.token_env, endpoint: endpoint(value.endpoint).href.replace(/\/$/, "") };
}
/** Bind transport and API identities without contacting either service. */
export function assertForgeRepositoryBinding(remote: string, input: ForgeConfiguration): string {
    const forge = parseForgeConfiguration(input), apiHost = new URL(forge.endpoint).hostname;
    const expectedHost = forge.kind === "github" && apiHost === "api.github.com" ? "github.com" : apiHost;
    let url: URL;
    try {
        const scp = /^git@([A-Za-z0-9.-]+):([^\s]+)$/.exec(remote);
        url = new URL(scp ? `ssh://git@${scp[1]}/${scp[2]}` : remote);
    } catch { throw new Error("Hosted publication requires an explicit HTTPS/SSH repository URL matching the forge"); }
    if (!["https:", "ssh:"].includes(url.protocol) || url.password || url.search || url.hash || url.protocol === "https:" && url.username || url.hostname !== expectedHost)
        throw new Error("Publication remote does not identify the configured forge repository");
    const path = decodeURIComponent(url.pathname).replace(/^\//, "").replace(/\.git$/, "");
    if ((forge.kind === "github" ? path.toLowerCase() : path) !== (forge.kind === "github" ? forge.repo.toLowerCase() : forge.repo))
        throw new Error("Publication remote does not identify the configured forge repository");
    return `${expectedHost}/${forge.kind === "github" ? forge.repo.toLowerCase() : forge.repo}`;
}
function branch(value: string) {
    if (!value || value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value.includes("..") || value.includes("@{") || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) || value.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".lock")))
        throw new Error("A source and target branch must be explicit, safe Git branch names");
}
function api(forge: ForgeConfiguration, options: MergeRequestOptions, body: string) {
    const collection = forge.kind === "github" ? `${forge.endpoint}/repos/${forge.repo.split("/").map(encodeURIComponent).join("/")}/pulls` : `${forge.endpoint}/projects/${encodeURIComponent(forge.repo)}/merge_requests`;
    const payload = forge.kind === "github" ? { title: options.title, head: options.sourceBranch, base: options.targetBranch, body } : { title: options.title, source_branch: options.sourceBranch, target_branch: options.targetBranch, description: body, remove_source_branch: false };
    const lookup = (page: number) => {
        const url = new URL(collection);
        for (const [key, value] of Object.entries(forge.kind === "github" ? { state: "all", head: `${forge.repo.split("/")[0]}:${options.sourceBranch}`, base: options.targetBranch, per_page: "100", page: String(page) } : { scope: "all", state: "all", source_branch: options.sourceBranch, target_branch: options.targetBranch, per_page: "100", page: String(page) }))
            url.searchParams.set(key, value);
        return url.href;
    };
    return { collection, payload, lookup };
}
function publication(row: unknown, forge: ForgeConfiguration, options: MergeRequestOptions, body: string) {
    if (!object(row))
        return null;
    const matching = forge.kind === "github" ? row.head?.ref === options.sourceBranch && row.base?.ref === options.targetBranch && row.head?.repo?.full_name?.toLowerCase() === forge.repo.toLowerCase() && row.base?.repo?.full_name?.toLowerCase() === forge.repo.toLowerCase() : row.source_branch === options.sourceBranch && row.target_branch === options.targetBranch && row.source_project_id === row.target_project_id && Number.isSafeInteger(row.source_project_id);
    if (!matching)
        return null;
    const number = forge.kind === "github" ? row.number : row.iid, link = forge.kind === "github" ? row.html_url : row.web_url;
    if (!Number.isSafeInteger(number) || number <= 0 || typeof link !== "string")
        throw new Error("Forge response has no valid review-request identity");
    const url = endpoint(link), host = new URL(forge.endpoint).hostname, expectedHost = forge.kind === "github" && host === "api.github.com" ? "github.com" : host;
    if (url.hostname !== expectedHost)
        throw new Error("Forge returned a review-request URL on an unexpected host");
    const expectedPath = `/${forge.repo}/${forge.kind === "github" ? "pull" : "-/merge_requests"}/${number}`;
    if (decodeURIComponent(url.pathname).toLowerCase() !== expectedPath.toLowerCase())
        throw new Error("Forge review-request URL does not identify the configured repository and request number");
    if (row.title !== options.title || (forge.kind === "github" ? row.body : row.description) !== body)
        throw new Error("A review request exists for this branch, but its title/body differ from the immutable delivery request; it was not overwritten");
    const head = forge.kind === "github" ? row.head?.sha : row.sha;
    if (!options.expectedHeadCommit || head !== options.expectedHeadCommit)
        throw new Error("Hosted review head does not equal the exact delivered evidence commit");
    const state = forge.kind === "github" ? row.merged === true || typeof row.merged_at === "string" ? "merged" : row.state : row.state === "opened" ? "open" : row.state;
    if (!["open", "closed", "merged"].includes(state))
        throw new Error("Hosted review request has no supported observed state");
    return { number, url: url.href, hosted_state: state as "open" | "closed" | "merged", head_commit: head as string, repository: assertForgeRepositoryBinding(options.publicationRemote!, forge) };
}
async function immutable(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}
async function boundedJson(path: string) {
    if ((await stat(path)).size > maxBytes)
        throw new Error("Publication record exceeds its read limit");
    return JSON.parse(await readFile(path, "utf8"));
}
async function lock(path: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const file = await open(path, "wx", 0o600);
            await file.writeFile(JSON.stringify({ pid: process.pid }));
            await file.close();
            return async () => { await rm(path); };
        }
        catch (error: any) {
            if (error.code !== "EEXIST")
                throw error;
            let owner: any;
            try {
                owner = await boundedJson(path);
            }
            catch {
                throw new Error("Publication is locked by an unreadable owner; inspect its recorded state before recovery");
            }
            if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0)
                throw new Error("Publication has an invalid lock owner; no request was sent");
            try {
                process.kill(owner.pid, 0);
                throw new Error("Another publication invocation is active; no duplicate request was sent");
            }
            catch (alive: any) {
                if (alive.code !== "ESRCH")
                    throw alive;
            }
            await rm(path);
        }
    }
    throw new Error("Publication lock changed while recovering; retry the same invocation");
}
/** Explicit-send outbox. Never mutates mr.md or a sealed delivery bundle. */
export async function publishMergeRequest(repo: string, options: MergeRequestOptions): Promise<MergeRequestPublication> {
    repo = await realpath(repo);
    const forge = parseForgeConfiguration(options.forge);
    const repository = options.publicationRemote ? assertForgeRepositoryBinding(options.publicationRemote, forge) : null;
    if (options.expectedHeadCommit !== undefined && !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(options.expectedHeadCommit))
        throw new Error("Publication requires a full exact evidence commit");
    branch(options.sourceBranch);
    branch(options.targetBranch);
    if (options.sourceBranch === options.targetBranch || !options.title?.trim() || options.title.length > 256 || /[\r\n\x00]/.test(options.title))
        throw new Error("A distinct source branch and one-line title are required");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(options.deliveryId))
        throw new Error("Invalid delivery id");
    const directory = await inside(repo, options.stateDirectory ?? `.wringer/publications/${options.deliveryId}`), bodyPath = await inside(repo, options.bodyPath);
    if (directory === dirname(bodyPath) || directory.startsWith(dirname(bodyPath) + "/"))
        throw new Error("Publication state must remain outside the sealed delivery bundle");
    if ((await stat(bodyPath)).size > maxBytes)
        throw new Error("Merge-request body exceeds the 2 MiB limit");
    let body: string;
    try {
        body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(bodyPath));
    }
    catch {
        throw new Error("Delivery mr.md must be valid UTF-8; no replacement bytes were published");
    }
    if (!body.trim())
        throw new Error("Delivery mr.md is empty");
    const environment = options.environment ?? process.env, redactor = new Redactor([forge.token_env], environment);
    const mapped = api(forge, options, body);
    const intent = { schema_version: "wringer.forge-intent.v2", delivery_id: options.deliveryId, forge, repository, expected_head_commit: options.expectedHeadCommit ?? null, source_branch: options.sourceBranch, target_branch: options.targetBranch, title: options.title, body_path: relative(resolve(repo), bodyPath), body_sha256: digest(body), request: { method: "POST", url: mapped.collection, body: mapped.payload } };
    if (redactor.scrub(JSON.stringify(intent)) !== JSON.stringify(intent))
        throw new Error("Publication request matches a secret value; remove it from the source document/configuration before publishing");
    const requestHash = digest(stable(intent));
    const answer = async (status: MergeRequestPublication["status"], extra: Partial<MergeRequestPublication> = {}): Promise<MergeRequestPublication> => {
        const result: MergeRequestPublication = { schema_version: "wringer.forge-publication.v2", status, state_directory: directory, request_sha256: requestHash, next_move: options.resumeCommand ?? "wring deliver --help", ...extra };
        await immutable(await inside(directory, `outcomes/${stamp()}.json`), redactor.deep({ ...result, at: new Date().toISOString() }));
        return redactor.deep(result) as MergeRequestPublication;
    };
    const parsePublication = (value: unknown) => {
        const result = publication(value, forge, options, body);
        if (result && redactor.scrub(JSON.stringify(result)) !== JSON.stringify(result))
            throw new Error("Forge review-request identity contains a known credential value; it was not published in local records");
        return result;
    };
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await inside(directory, "outcomes");
    const release = await lock(await inside(directory, "publication.lock"));
    try {
        const intentPath = await inside(directory, "intent.json");
        try {
            await immutable(intentPath, intent);
        }
        catch (error: any) {
            if (error.code !== "EEXIST")
                throw error;
            let previous: unknown;
            try {
                previous = await boundedJson(intentPath);
            }
            catch {
                return await answer("blocked", { reason: "The immutable publication request is unreadable; inspect its recorded state before recovery. No network request was sent." });
            }
            if (stable(previous) !== stable(intent))
                return await answer("blocked", { reason: "The immutable publication request changed. Restore the original mr.md/branch/configuration; no network request was sent." });
        }
        if (!options.send)
            return await answer("prepared", { reason: "Review-request bytes are prepared. No network request was made; explicit send is required." });
        if (!repository || !options.expectedHeadCommit)
            return await answer("blocked", { reason: "Publication lacks its exact evidence commit or canonical remote binding. Prepare a bound delivery before sending; no request was made." });
        if (options.signal?.aborted)
            return await answer("blocked", { reason: "Publication was cancelled before any network request." });
        const token = environment[forge.token_env];
        if (!token || /[\r\n]/.test(token))
            return await answer("blocked", { reason: `The declared ${forge.token_env} credential is absent or malformed; no request was sent.` });
        const headers: Record<string, string> = forge.kind === "github" ? { Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2026-03-10", Authorization: `Bearer ${token}` } : { Accept: "application/json", "Content-Type": "application/json", "PRIVATE-TOKEN": token };
        const attempts = await inside(directory, "attempts");
        await mkdir(attempts, { recursive: true, mode: 0o700 });
        let previousUnknownPost = false;
        for (const name of await readdir(attempts)) {
            const attempt = await inside(directory, `attempts/${name}`);
            let request: unknown;
            try {
                request = await boundedJson(await inside(attempt, "request.json"));
            }
            catch {
                return await answer("blocked", { reason: "A prior publication request is unreadable; inspect its recorded state before recovery. No network request was sent." });
            }
            if (!object(request) || request.schema_version !== "wringer.forge-request.v1" || request.intent_sha256 !== requestHash || !["lookup", "create"].includes(request.phase))
                return await answer("blocked", { reason: "A prior publication request is unreadable or disagrees with this intent; no request was sent." });
            if (request.phase === "create") {
                try {
                    const result = await boundedJson(await inside(attempt, "result.json"));
                    if (!["rejected", "not-sent"].includes(result.status))
                        previousUnknownPost = true;
                }
                catch {
                    previousUnknownPost = true;
                }
            }
        }
        const request = async (phase: "lookup" | "create", url: string, payload?: object) => {
            const attempt = await inside(directory, `attempts/${stamp()}`), method = phase === "create" ? "POST" : "GET";
            const record = { schema_version: "wringer.forge-request.v1", at: new Date().toISOString(), intent_sha256: requestHash, phase, method, url, headers: Object.fromEntries(Object.entries(headers).filter(([key]) => !["Authorization", "PRIVATE-TOKEN"].includes(key))), credential_env: forge.token_env, ...(payload ? { body: payload } : {}) };
            await immutable(join(attempt, "request.json"), record);
            if (options.signal?.aborted) {
                await immutable(join(attempt, "result.json"), { status: "not-sent", reason: "cancelled-before-send" });
                return { status: "rejected", reason: "Publication cancelled before request", data: null, complete: false };
            }
            let response: Response;
            try {
                const timeout = AbortSignal.timeout(30000), signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
                response = await (options.transport ?? fetch)(url, { method, headers, ...(payload ? { body: JSON.stringify(payload) } : {}), redirect: "error", signal });
                if (response.redirected || (response.status >= 300 && response.status < 400))
                    throw new Error("Forge redirect refused");
                const reader = response.body?.getReader(), chunks: Uint8Array[] = [];
                let count = 0;
                if (reader)
                    for (;;) {
                        const part = await reader.read();
                        if (part.done)
                            break;
                        count += part.value.byteLength;
                        if (count > maxBytes) {
                            await reader.cancel();
                            throw new Error("Forge response exceeded 2 MiB");
                        }
                        chunks.push(part.value);
                    }
                const text = Buffer.concat(chunks).toString("utf8");
                let data: unknown;
                try {
                    data = JSON.parse(text);
                }
                catch {
                    throw new Error("Forge response is not valid JSON; raw bytes were not logged");
                }
                await immutable(join(attempt, "response.json"), redactor.deep({ schema_version: "wringer.forge-response.v1", at: new Date().toISOString(), status: response.status, body: data }));
                if (!response.ok) {
                    const status = phase === "create" && response.status >= 500 ? "uncertain" : "rejected";
                    await immutable(join(attempt, "result.json"), { status, http_status: response.status });
                    return { status, reason: `Forge ${phase} returned HTTP ${response.status}`, data: null, complete: false };
                }
                if (phase === "create") {
                    const created = parsePublication(data);
                    if (!created)
                        throw new Error("Forge creation response does not identify the requested branch");
                    await immutable(join(attempt, "result.json"), { status: "published", ...created });
                    return { status: "published", created, data, complete: true };
                }
                if (!Array.isArray(data))
                    throw new Error("Forge lookup did not return an array");
                const complete = !/rel="next"/.test(response.headers.get("link") ?? "") && !response.headers.get("x-next-page") && data.length < 100;
                await immutable(join(attempt, "result.json"), { status: "read", count: data.length, complete });
                return { status: "read", data, complete };
            }
            catch (error) {
                const reason = redactor.scrub(error instanceof Error ? error.message : String(error));
                try {
                    await immutable(join(attempt, "result.json"), { status: phase === "create" ? "uncertain" : "failed", reason });
                }
                catch (existing: any) {
                    if (existing.code !== "EEXIST")
                        throw existing;
                }
                return { status: phase === "create" ? "uncertain" : "failed", reason, data: null, complete: false };
            }
        };
        const matches: NonNullable<ReturnType<typeof publication>>[] = [];
        let lookupComplete = false;
        for (let page = 1; page <= 10; page++) {
            const found = await request("lookup", mapped.lookup(page));
            if (found.status !== "read" || !Array.isArray(found.data))
                return await answer(previousUnknownPost ? "uncertain" : "blocked", { reason: found.reason ?? "Forge lookup failed; no create request was sent." });
            try {
                for (const row of found.data) {
                    const match = parsePublication(row);
                    if (match && !matches.some(m => m.number === match.number))
                        matches.push(match);
                }
            }
            catch (error) {
                return await answer("blocked", { reason: redactor.scrub(String(error)) });
            }
            if (found.complete) {
                lookupComplete = true;
                break;
            }
        }
        if (!lookupComplete)
            return await answer("blocked", { reason: "The source-branch recovery query exceeded its ten-page bound; no duplicate creation was attempted." });
        if (matches.length > 1)
            return await answer("blocked", { reason: "More than one review request matches this source/target branch; resolve the duplicate explicitly." });
        if (matches[0])
            return await answer(matches[0].hosted_state === "open" ? "recovered" : matches[0].hosted_state, { ...matches[0], ...(matches[0].hosted_state !== "open" ? { reason: `The exact hosted request is ${matches[0].hosted_state}; it is not an open review-ready request. No duplicate was created.` } : {}) });
        if (previousUnknownPost)
            return await answer("uncertain", { reason: "A prior create may have succeeded, but no matching review request is visible yet. Rerun the same explicit send to query again; no second POST will be sent." });
        const created = await request("create", mapped.collection, mapped.payload);
        return await (created.status === "published" ? answer(created.created!.hosted_state === "open" ? "published" : created.created!.hosted_state, created.created) : answer(created.status === "uncertain" ? "uncertain" : "blocked", { reason: created.reason }));
    }
    finally {
        await release();
    }
}
