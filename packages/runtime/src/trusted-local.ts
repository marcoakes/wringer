/** The trusted-local runtime (R-1, ruled 2026-10-01): roles and checks run as ordinary
 * processes on this computer, under the operator's own account. Nothing is contained,
 * the operator chose it explicitly, and every record it writes says so.
 *
 * Each role and each check gets a fresh clone of its exact source commit in its own
 * temporary directory, removed afterwards, so the operator's own checkout is never
 * edited in place. The approved change scope is enforced when the controller reviews
 * the captured patch, not while the agent runs: an agent here can read and write
 * anything its account can. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { probeAcpSession, runAcpTurn } from "@wringer/acp";
import { inspectPng } from "@wringer/design";
import { processDriver } from "./driver";
import { parseWritableDirectories, TRUSTED_LOCAL_PROVENANCE, TRUSTED_LOCAL_SENTENCE, validateRepository } from "./policy";
import { runtimeDeepRedact } from "./redact";
import { RuntimeError, type ContainedCommandRequest, type ContainedCommandResult, type RepositorySource, type RoleExecutionRequest, type RoleExecutionResult, type RuntimeDriver, type TrustedLocalPolicy, type TrustedLocalRuntimeProvenance } from "./types";
import { createHash } from "node:crypto";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const TRUSTED_LOCAL_LIMITS = [
    TRUSTED_LOCAL_SENTENCE,
    "Network, files and credentials were limited only by the operator's own account; no boundary was established.",
    "The approved change scope is enforced when the controller reviews the captured patch, not while the agent runs.",
    "An agent descendant that left its process group could outlive the session; none is inspected.",
];
/** What a host process may inherit: the account's own identity and locale, never shell or Git control. */
const BASE_ENVIRONMENT = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR"];
const GIT_ENVIRONMENT = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const GIT = ["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.file.allow=always", "-c", "protocol.ext.allow=never"];

function hostEnvironment(names: string[], extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const name of BASE_ENVIRONMENT) if (process.env[name] !== undefined) env[name] = process.env[name];
    for (const name of names) {
        if (!process.env[name]) throw new RuntimeError(`Declared runtime environment ${name} is not available; no login or keychain mutation was attempted`, "credential-unavailable");
        env[name] = process.env[name];
    }
    return { ...env, ...extra };
}
interface HostResult { code: number; stdout: string; stderr: string; timedOut: boolean }
/** One bounded host process in its own process group. A deadline ends the whole group and
 * reports exit 124, as timeout(1) does; an operator interrupt is refused, not reported. */
export function runHost(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; input?: string | Uint8Array; signal?: AbortSignal; limit?: number }): Promise<HostResult> {
    if (!argv.length || argv.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new RuntimeError("Invalid host argv");
    const limit = options.limit ?? 64 * 1024 * 1024;
    return new Promise((resolve, reject) => {
        const child = spawn(argv[0]!, argv.slice(1), { cwd: options.cwd, env: options.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
        let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false, timedOut = false, aborted = false, settled = false;
        const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already gone */ } };
        const stop = () => { kill("SIGTERM"); setTimeout(() => kill("SIGKILL"), 2000).unref(); };
        const take = (which: "out" | "err", chunk: Buffer) => {
            if (stdout.length + stderr.length + chunk.length > limit) { overflow = true; stop(); return; }
            if (which === "out") stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
        };
        child.stdout.on("data", chunk => take("out", chunk));
        child.stderr.on("data", chunk => take("err", chunk));
        child.stdin.on("error", () => { });
        child.stdin.end(options.input);
        const timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs);
        const abort = () => { aborted = true; stop(); };
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        const finish = (code: number | null) => {
            if (settled) return; settled = true;
            clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
            kill("SIGKILL");
            if (aborted) return reject(new RuntimeError("Host command was interrupted", "cancelled"));
            if (overflow) return reject(new RuntimeError("Host command output exceeded 64 MiB; partial output refused", "capture-limit"));
            resolve({ code: timedOut ? 124 : code ?? 143, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut });
        };
        child.once("error", error => { stderr = Buffer.concat([stderr, Buffer.from(error.message)]); finish(127); });
        child.once("close", code => finish(code));
    });
}
async function git(cwd: string, args: string[], timeoutMs = 120000, input?: string) {
    const result = await runHost([...GIT, ...args], { cwd, env: hostEnvironment([], GIT_ENVIRONMENT), timeoutMs, input });
    if (result.code !== 0) throw new RuntimeError(`Workspace Git operation failed: ${(result.stderr || result.stdout).slice(0, 2000)}`, "workspace-git-failed");
    return result.stdout;
}
/** A fresh clone of one exact commit, from its prepared bundle or its hosted URL. */
async function cloneSource(source: RepositorySource, destination: string, scratch: string) {
    validateRepository(source);
    let origin = source.url;
    if (source.bundlePath) {
        const info = await lstat(source.bundlePath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new RuntimeError("Git bundle must be a regular non-symlink file no larger than 64 MiB");
        origin = source.bundlePath;
    }
    await git(scratch, ["clone", "--no-checkout", "--no-hardlinks", "--quiet", "--", origin, destination]);
    await git(destination, ["checkout", "--quiet", "--detach", source.commit]);
    if ((await git(destination, ["rev-parse", "HEAD"])).trim() !== source.commit) throw new RuntimeError("Workspace clone resolved a different commit");
    // Agents and checks run Git themselves: no hook in this clone may run.
    await git(destination, ["config", "core.hooksPath", "/dev/null"]);
}
async function openWorkspace(role: string) {
    const root = await realpath(await mkdtemp(join(tmpdir(), `wringer-${role}-`)));
    return { root, repo: join(root, "repo"), close: () => rm(root, { recursive: true, force: true }) };
}
function provenance(role: TrustedLocalRuntimeProvenance["role"], repo: RepositorySource, policy: TrustedLocalPolicy, access: "read-only" | "read-write", observed: Record<string, unknown>): TrustedLocalRuntimeProvenance {
    return { schema_version: TRUSTED_LOCAL_PROVENANCE, runtimeId: `wringer-${role}-${randomUUID()}`, role, kind: "trusted-local", boundary: "trusted-local", established: "none", repository: { url: repo.url, commit: repo.commit }, workspace: "fresh-temporary-clone", repositoryAccess: access, declared: { kind: "trusted-local", network: { policy: "unenforced" }, env: [...(policy.env ?? [])] }, observed: { host: { platform: platform(), arch: arch() }, workspace: "a temporary clone, removed after use", ...observed }, limits: [...TRUSTED_LOCAL_LIMITS] };
}

/** One ACP role on this computer: a fresh clone, the agent as an ordinary process there,
 * and the worker's change captured with the same Git route a contained role uses. */
export async function executeTrustedLocalRole(request: RoleExecutionRequest, policy: TrustedLocalPolicy, input: { probeOnly: boolean; model?: string; redact: (text: string) => string; started: number; driver?: RuntimeDriver }): Promise<RoleExecutionResult> {
    if (request.design) throw new RuntimeError("Design references need a contained runtime; the trusted-local runtime serves no design tools", "design-needs-containment");
    const workspace = await openWorkspace(request.role);
    try {
        await cloneSource(request.repo, workspace.repo, workspace.root);
        const access = request.role === "worker" ? "read-write" as const : "read-only" as const;
        const record = provenance(request.role, request.repo, policy, access, { agent: { command: request.agent.command, args: request.agent.args ?? [] }, ...(request.scope ? { scope: request.scope, scopeEnforcement: "at candidate review" } : {}) });
        const onEvent = request.onEvent ? async (event: Record<string, unknown>) => request.onEvent!(runtimeDeepRedact(event, input.redact)) : undefined;
        await onEvent?.({ type: "runtime.prepared", provenance: record });
        const remaining = () => Math.max(1, request.budget.timeoutMs - (Date.now() - input.started));
        const transport = await (input.driver ?? processDriver).connect([request.agent.command, ...(request.agent.args ?? [])], { env: hostEnvironment(request.agent.env ?? []), cwd: workspace.repo, signal: request.signal, timeoutMs: remaining() });
        const acpOptions = { ...(input.model ? { model: input.model } : {}), role: request.role, cwd: workspace.repo, timeoutMs: remaining(), signal: request.signal, authMethod: request.agent.authMethod, mode: request.agent.mode, credentialNames: request.agent.env ?? [], redact: input.redact, onEvent };
        const turn = runtimeDeepRedact(await (input.probeOnly ? probeAcpSession(transport, acpOptions) : runAcpTurn(transport, { ...acpOptions, prompt: request.prompt, allowedToolKinds: request.allowedToolKinds })), input.redact);
        const result: RoleExecutionResult = { ...turn, provenance: record };
        if (!input.probeOnly && request.role === "worker" && turn.status === "completed" && turn.authentication.sessionOpened) {
            // The turn has ended the agent's process group. Capture exactly what the worker
            // left in its clone: tracked edits, deletions and new untracked files.
            const excluded = (request.scope?.writableDirectories ?? []).map(path => `:(exclude,literal)${path}`);
            await git(workspace.repo, ["add", "-u", "--", ".", ...excluded]);
            const paths = await git(workspace.repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ".", ...excluded]);
            if (paths) await git(workspace.repo, ["--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"], 120000, paths);
            const patch = await git(workspace.repo, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", request.repo.commit, "--"]);
            if (input.redact(patch) !== patch) throw new RuntimeError("Worker patch contains a credential; publication refused instead of silently changing product bytes", "secret-in-change");
            result.change = { baseCommit: request.repo.commit, patch, sha256: digest(patch) };
        }
        return result;
    }
    finally {
        await workspace.close();
    }
}

/** Setup, baseline and acceptance commands on this computer, in a fresh clone of the
 * candidate. Pinned check inputs must be the acceptance source's exact blobs; any
 * change a command makes to the source is observed and makes the result unavailable. */
export async function runTrustedLocalCommands(request: ContainedCommandRequest, policy: TrustedLocalPolicy, redact: (text: string) => string): Promise<ContainedCommandResult> {
    const writableDirectories = parseWritableDirectories(request.writableDirectories ?? [], request.protectedFiles ?? []);
    const captures = request.captureArtifacts ?? [];
    for (const row of captures)
        if (!writableDirectories.some(path => row.path.startsWith(path + "/"))) throw new RuntimeError("Visual captures must name PNG files inside approved writable output directories", "visual-capture-refused");
    const workspace = await openWorkspace("verifier"), deadline = Date.now() + request.timeoutMs;
    try {
        await cloneSource(request.repo, workspace.repo, workspace.root);
        const sourceTree = (await git(workspace.repo, ["rev-parse", "HEAD^{tree}"])).trim();
        for (const directory of writableDirectories) {
            let prefix = workspace.repo;
            for (const segment of directory.split("/")) {
                prefix = join(prefix, segment);
                const info = await lstat(prefix).catch(() => null);
                if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new RuntimeError("Verifier writable directories must be real directories", "writable-directory-invalid");
            }
            if (await git(workspace.repo, ["--literal-pathspecs", "ls-files", "-z", "--", directory])) throw new RuntimeError("Verifier writable directories cannot contain tracked repository files", "writable-directory-tracked");
            await mkdir(join(workspace.repo, directory), { recursive: true });
        }
        let checkInputsSha256: string | undefined;
        if (request.acceptanceSource) {
            const paths = request.protectedFiles ?? [];
            if (!paths.length) throw new RuntimeError("Independent acceptance source needs complete explicit protected check inputs");
            const acceptance = join(workspace.root, "acceptance");
            await cloneSource(request.acceptanceSource, acceptance, workspace.root);
            const authority = await git(acceptance, ["--literal-pathspecs", "ls-tree", "-r", "-z", request.acceptanceSource.commit, "--", ...paths]);
            if (!authority) throw new RuntimeError("Pinned acceptance inputs did not resolve");
            const records = authority.split("\0").filter(Boolean);
            for (const record of records) if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(record)) throw new RuntimeError("Acceptance inputs must be regular tracked files; symlinks and submodules are refused");
            const names = records.map(record => record.slice(record.indexOf("\t") + 1));
            for (const path of paths) if (path !== "." && !names.some(name => name === path || name.startsWith(path + "/"))) throw new RuntimeError(`Pinned acceptance input ${path} did not resolve`);
            checkInputsSha256 = digest(authority);
            const candidate = await git(workspace.repo, ["--literal-pathspecs", "ls-tree", "-r", "-z", request.repo.commit, "--", ...paths]);
            if (candidate !== authority) throw new RuntimeError("Candidate changed the pinned acceptance inputs", "acceptance-inputs-changed");
        }
        const status = () => git(workspace.repo, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
        const before = await status(), results: ContainedCommandResult["results"] = [];
        for (const row of request.commands) {
            const cwd = row.cwd ? join(workspace.repo, row.cwd) : workspace.repo;
            if (row.cwd && (row.cwd.startsWith("/") || row.cwd.split("/").some(part => part === "..")) || !(await lstat(cwd).catch(() => null))?.isDirectory()) {
                results.push({ id: row.id, code: 126, stdout: "", stderr: "Check working directory is not a directory in the repository", durationMs: 0 });
                continue;
            }
            const start = Date.now(), remaining = deadline - start;
            if (remaining <= 0) throw new RuntimeError("The verifier deadline expired; remaining checks were not observed", "timeout");
            const output = await runHost(row.argv ?? ["/bin/sh", "-c", row.command!], { cwd, env: hostEnvironment([]), timeoutMs: Math.min(row.timeoutMs, remaining), signal: request.signal });
            const result = { id: row.id, code: output.code, stdout: redact(output.stdout), stderr: redact(output.stderr), durationMs: Date.now() - start };
            results.push(result);
            await request.onEvent?.({ type: "runtime.check.finished", ...result });
        }
        const after = await status();
        // Only new untracked descendants of declared directories are outputs; anything else is a source change.
        const sourceStatus = (value: string) => {
            const rows = value.split("\0"), kept: string[] = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!;
                if (!row) continue;
                if ((row.startsWith("?? ") || row.startsWith("!! ")) && writableDirectories.some(directory => row.slice(3).startsWith(directory + "/"))) continue;
                kept.push(row);
                if (/[RC]/.test(row.slice(0, 2))) kept.push(rows[++i] ?? "MISSING-RENAME-SOURCE");
            }
            return kept.join("\0");
        };
        const changed = sourceStatus(before) !== sourceStatus(after);
        const artifacts: NonNullable<ContainedCommandResult["artifacts"]> = [];
        if (captures.length && !changed && results.every(row => row.code === 0)) {
            let total = 0;
            for (const row of captures) {
                const path = join(workspace.repo, row.path), info = await lstat(path).catch(() => null);
                if (!info || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4194304 || await realpath(path) !== path) throw new RuntimeError("A declared visual capture is missing, linked or too large", "visual-capture-refused");
                const base64 = (await readFile(path)).toString("base64"), image = inspectPng(base64);
                if (row.width !== undefined && image.width !== row.width || row.height !== undefined && image.height !== row.height || (total += image.bytes) > 8388608) throw new RuntimeError("Visual capture dimensions or total image bytes exceed their declaration", "visual-capture-refused");
                artifacts.push({ id: row.id, path: row.path, mimeType: "image/png", base64, ...image });
            }
        }
        const record = provenance("verifier", request.repo, policy, "read-only", { writableDirectories });
        return { provenance: record, results, sourceChanged: changed, sourceTree, ...(checkInputsSha256 ? { checkInputsSha256 } : {}), ...(captures.length ? { artifacts } : {}) };
    }
    finally {
        await workspace.close();
    }
}
