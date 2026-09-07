/** Forge-specific paths and auth stay here; the CLI never guesses a vendor. */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Bundle, Redactor, loadConfig, newId, runProcess, safePath, sha256 } from "@wringer/engine";
export function safeURL(value: string): URL {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash)
        throw new Error("URLs must not contain credentials, a query, or a fragment");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))
        throw new Error("Use HTTPS, or loopback HTTP for a declared local transport");
    return url;
}
export async function getRepository(url: string, directory: string, options: {
    signal?: AbortSignal;
} = {}) {
    options.signal?.throwIfAborted();
    if (!url || !directory || url.startsWith("-"))
        throw new Error("wring get requires a repository URL and a new destination directory");
    if (!/^git@[^:\s]+:[^\s]+$/.test(url)) {
        const parsed = new URL(url);
        if (!["https:", "ssh:", "file:"].includes(parsed.protocol) || parsed.password || parsed.search || parsed.hash || (parsed.username && !(parsed.protocol === "ssh:" && parsed.username === "git")))
            throw new Error("Clone URL must be credential-free HTTPS, SSH or file://");
    }
    try {
        if ((await readdir(directory)).length)
            throw new Error("Clone destination is not empty");
    }
    catch (e: any) {
        if (e.code !== "ENOENT")
            throw e;
    }
    await mkdir(dirname(directory), { recursive: true });
    const clone = await runProcess(["git", "clone", "--", url, directory], { cwd: dirname(directory), timeout: 120, signal: options.signal, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    if (clone.exit_code !== 0 || clone.timed_out || clone.interrupted)
        throw new Error(`Clone ${clone.interrupted ? "interrupted" : "failed"}; partial files, if any, remain at ${directory}: ${clone.stderr}`);
    const head = await runProcess(["git", "rev-parse", "HEAD"], { cwd: directory }), branch = await runProcess(["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: directory });
    const record = { schema_version: "wringer.acquired.v1", acquired_at: new Date().toISOString(), origin: url, directory: resolve(directory), head_sha: head.exit_code ? null : head.stdout.trim(), default_branch: branch.exit_code ? null : branch.stdout.trim().replace(/^origin\//, "") };
    const bundle = await new Bundle(await safePath(directory, `.wringer/acquired/${newId()}`)).prepare();
    await bundle.json("manifest.json", record);
    await bundle.seal();
    return { ...record, next_move: `wring init --repo ${quote(directory)}` };
}
interface Forge {
    kind: "github" | "gitlab";
    endpoint: string;
    repo: string;
    token_env: string;
}
function forgeConfig(value: any): Forge {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Declare forge.kind, endpoint, repo and token_env in .wringer.yaml");
    for (const key of Object.keys(value))
        if (!["kind", "endpoint", "repo", "token_env"].includes(key))
            throw new Error(`Unknown forge setting ${key}`);
    if (!["github", "gitlab"].includes(value.kind) || typeof value.repo !== "string" || !value.repo.includes("/") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.token_env))
        throw new Error("Malformed forge declaration");
    safeURL(value.endpoint);
    return value;
}
export async function issue(repo: string, id: string, options: {
    output?: string;
    transport?: typeof fetch;
    signal?: AbortSignal;
} = {}) {
    options.signal?.throwIfAborted();
    if (!/^[1-9]\d*$/.test(id))
        throw new Error("Issue id must be a positive integer");
    const config = await loadConfig(repo), forge = forgeConfig(config.forge), endpoint = forge.endpoint.replace(/\/$/, "");
    const encoded = forge.repo.split("/").map(encodeURIComponent).join("/");
    const url = forge.kind === "github" ? `${endpoint}/repos/${encoded}/issues/${id}` : `${endpoint}/projects/${encodeURIComponent(forge.repo)}/issues/${id}`;
    const token = process.env[forge.token_env], headers: Record<string, string> = { Accept: "application/json" };
    if (forge.kind === "github") {
        headers["X-GitHub-Api-Version"] = "2022-11-28";
        if (token)
            headers.Authorization = `Bearer ${token}`;
    }
    else if (token)
        headers["PRIVATE-TOKEN"] = token;
    const response = await (options.transport ?? fetch)(url, { headers, redirect: "error", signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok)
        throw new Error(`Issue read returned HTTP ${response.status}`);
    const raw: any = await response.json();
    if (typeof raw.title !== "string")
        throw new Error("Issue response has no title");
    const path = await safePath(repo, options.output ?? `${config.deliver?.issues_dir ?? "issues"}/${id}.md`);
    const marker = `<!-- Wringer issue ${forge.kind} ${forge.repo}#${id} -->`;
    if (await Bun.file(path).exists() && !(await Bun.file(path).text()).startsWith(marker + "\n"))
        throw new Error("Refusing to overwrite a document not owned by this issue importer");
    const content = new Redactor([...config.evidence.redact.env, forge.token_env]).scrub(`${marker}\n# ${raw.title}\n\n${forge.kind === "github" ? raw.body ?? "" : raw.description ?? ""}\n`);
    options.signal?.throwIfAborted();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    return { path, sha256: sha256(content), next_move: "wringer-drive plan --help", note: `Imported intent is at ${path}; include its exact words in a contained execution plan. No retired drafting call was made.` };
}
import { quote } from "./args";
