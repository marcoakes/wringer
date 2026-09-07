import { createHash } from "node:crypto";
import { posix } from "node:path";
import { runAcpTurn, probeAcpSession, type AgentDeclaration } from "@wringer/acp";
import { openSandbox, REPO } from "./adapters";
import { processDriver } from "./driver";
import { parseRuntimePolicy, parseWritableDirectories, quote, validateRepository } from "./policy";
import { runtimeRedactor, runtimeDeepRedact } from "./redact";
import { parseWorkerScope, repositoryPermissionsScript } from "./filesystem";
import { RuntimeError, type RuntimeDriver, type RoleExecutionRequest, type RoleExecutionResult, type RoleExecutor, type ContainedCommandRequest, type ContainedCommandResult, type AgentPreflightResult } from "./types";
export const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function validateAgent(agent: AgentDeclaration) {
    if (!agent || agent.protocol !== "acp" || typeof agent.command !== "string" || !agent.command || agent.command.startsWith("-") || /[\0\s]/.test(agent.command) || agent.args !== undefined && (!Array.isArray(agent.args) || agent.args.some(arg => typeof arg !== "string" || arg.includes("\0"))))
        throw new RuntimeError("Declare an ACP executable and argv; a shell worker command is not a production agent wire");
    if (Object.keys(agent).some(key => !["protocol", "command", "args", "env", "authMethod", "mode"].includes(key)))
        throw new RuntimeError("Unknown ACP agent declaration field");
    if (agent.env !== undefined && (!Array.isArray(agent.env) || agent.env.some(name => typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))))
        throw new RuntimeError("Agent env must name declared variables only");
    for (const key of ["authMethod", "mode"] as const)
        if (agent[key] !== undefined && (typeof agent[key] !== "string" || !agent[key]))
            throw new RuntimeError(`Agent ${key} must be a nonempty string`);
}
export async function executeAgentRole(request: RoleExecutionRequest, options: {
    driver?: RuntimeDriver;
} = {}): Promise<RoleExecutionResult> {
    return executeRole(request, options, false);
}
/** Allocate the real role boundary and negotiate ACP without sending any model/task prompt. */
export async function preflightAgentRole(request: Omit<RoleExecutionRequest, "prompt">, options: { driver?: RuntimeDriver } = {}): Promise<AgentPreflightResult> {
    const result = await executeRole({ ...request, prompt: "Protocol preflight only; this string is never sent to the agent." }, options, true);
    const opened = result.authentication.sessionOpened, returned = result.events.some(event => event.type === "acp.auth-method-returned");
    const names = [...(request.agent.env ?? [])];
    const authLine = `${request.role} ACP preflight: ${result.status === "completed" && opened ? "session opened" : `not ready (${result.stopReason})`}. ${returned ? "Declared noninteractive authentication method returned successfully." : "No successful explicit authentication method was observed."} ${names.length ? `Declared role credential/environment names: ${names.join(", ")}.` : "No role credential/environment variables were forwarded."} Provider-key validity and effective credential are not attested by ACP session creation. No model prompt sent; usage is not inferred.`;
    return { ...result, promptSent: false, modelWorkRequested: false, providerCredentialValidated: false, effectiveCredential: "not-attested", credentialNames: names, authMethodReturned: returned, authLine };
}
async function executeRole(request: RoleExecutionRequest, options: { driver?: RuntimeDriver }, probeOnly: boolean): Promise<RoleExecutionResult> {
    const policy = parseRuntimePolicy(request.runtime);
    validateRepository(request.repo);
    validateAgent(request.agent);
    if (!["planner", "worker", "judge"].includes(request.role) || typeof request.prompt !== "string" || !request.prompt.trim())
        throw new RuntimeError("A declared agent role and nonempty prompt are required");
    if (!Number.isInteger(request.budget.maxTurns) || request.budget.maxTurns < 1 || !Number.isFinite(request.budget.timeoutMs) || request.budget.timeoutMs < 1)
        throw new RuntimeError("A positive role turn/deadline budget is required");
    for (const name of request.agent.env ?? [])
        if (!policy.env?.includes(name))
            throw new RuntimeError(`Agent environment ${name} is not in the runtime's declared allowlist`);
    const permitted = request.role === "worker" ? ["read", "search", "edit", "execute"] : ["read", "search"];
    if (request.allowedToolKinds?.some(kind => !permitted.includes(kind)))
        throw new RuntimeError("Requested agent effects exceed its role authority");
    const scope = request.role === "worker" ? parseWorkerScope(request.scope) : undefined;
    // A shared runtime policy declares the envelope; only this role's selected names cross.
    const rolePolicy = { ...policy, env: request.agent.env ?? [], ...(policy.kind === "gvisor-kubernetes" ? { secretRefs: Object.fromEntries(Object.entries(policy.secretRefs ?? {}).filter(([name]) => request.agent.env?.includes(name))) } : {}) };
    const redact = runtimeRedactor(policy.env), started = Date.now();
    const sandbox = await openSandbox({ role: request.role, repo: request.repo, policy: rolePolicy, timeoutMs: request.budget.timeoutMs, signal: request.signal, driver: options.driver ?? processDriver, redact, scope });
    try {
        const onEvent = request.onEvent ? async (event: Record<string, unknown>) => request.onEvent!(runtimeDeepRedact(event, redact)) : undefined;
        await onEvent?.({ type: "runtime.prepared", provenance: sandbox.provenance });
        const transport = await sandbox.connect(request.agent);
        const acpOptions = { role: request.role, cwd: REPO, timeoutMs: Math.max(1, request.budget.timeoutMs - (Date.now() - started)), signal: request.signal, authMethod: request.agent.authMethod, mode: request.agent.mode, credentialNames: request.agent.env ?? [], redact, onEvent };
        const turn = runtimeDeepRedact(await (probeOnly ? probeAcpSession(transport, acpOptions) : runAcpTurn(transport, { ...acpOptions, prompt: request.prompt, allowedToolKinds: request.allowedToolKinds })), redact);
        const result: RoleExecutionResult = { ...turn, provenance: sandbox.provenance };
        if (!probeOnly && request.role === "worker" && turn.status === "completed" && turn.authentication.sessionOpened) {
            // This transports agent-authored bytes. The controller never turns prose into a patch.
            // Stop all agent descendants before snapshotting. Open write descriptors survive chmod.
            const stopped = await sandbox.exec(["/bin/sh", "-c", "set -eu; for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do pkill -KILL -u 1000 || test $? = 1; live=0; agent_pids=$(pgrep -u 1000) || { test $? = 1; agent_pids=; }; for agent_pid in $agent_pids; do state=$(awk '/^State:/ { print $2 }' /proc/$agent_pid/status 2>/dev/null) || { test ! -d /proc/$agent_pid || exit 74; continue; }; case $state in Z|X) ;; *) live=1 ;; esac; done; test $live = 0 && exit 0; sleep 0.05; done; exit 74"]);
            if (stopped.code !== 0) throw new RuntimeError("Worker descendants could not be confirmed stopped before capture", "change-capture-failed");
            const locked = await sandbox.exec(["/bin/sh", "-c", repositoryPermissionsScript(REPO)]);
            if (locked.code !== 0) throw new RuntimeError("Worker source could not be locked before capture", "change-capture-failed");
            const excludeOutputs = (scope?.writableDirectories ?? []).map(path => quote(`:(exclude,literal)${path}`)).join(" ");
            const exported = await sandbox.exec(["env", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "/bin/sh", "-c", `set -eu; cd ${quote(REPO)}; git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false fsck --no-reflogs >/dev/null; git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false add -A -- . ${excludeOutputs}; git --no-replace-objects -c core.hooksPath=/dev/null -c core.fsmonitor=false diff --cached --no-ext-diff --no-textconv --binary --full-index ${quote(request.repo.commit)} --`]);
            if (exported.code !== 0)
                throw new RuntimeError(`Worker change capture failed: ${redact(exported.stderr)}`, "change-capture-failed");
            if (redact(exported.stdout) !== exported.stdout)
                throw new RuntimeError("Worker patch contains a credential; publication refused instead of silently changing product bytes", "secret-in-change");
            result.change = { baseCommit: request.repo.commit, patch: exported.stdout, sha256: digest(exported.stdout) };
        }
        return result;
    }
    finally {
        await sandbox.close();
    }
}
export const createRoleExecutor = (options: {
    driver?: RuntimeDriver;
} = {}): RoleExecutor => request => executeAgentRole(request, options);
export async function runContainedCommands(request: ContainedCommandRequest, options: {
    driver?: RuntimeDriver;
} = {}): Promise<ContainedCommandResult> {
    const policy = parseRuntimePolicy(request.runtime);
    validateRepository(request.repo);
    if (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0 || !Array.isArray(request.commands) || !request.commands.length)
        throw new RuntimeError("A verifier needs a bounded command list");
    const ids = new Set<string>();
    for (const row of request.commands) {
        if (typeof row.id !== "string" || !row.id || ids.has(row.id) || !Number.isFinite(row.timeoutMs) || row.timeoutMs <= 0 || Boolean(row.command) === Boolean(row.argv?.length) || row.argv?.some(arg => typeof arg !== "string" || arg.includes("\0")) || row.command?.includes("\0"))
            throw new RuntimeError("Verifier commands need unique ids, one explicit command/argv and positive deadlines");
        ids.add(row.id);
        if (row.cwd !== undefined && (row.cwd.startsWith("/") || row.cwd.split("/").some(part => part === "..") || row.cwd.includes("\0")))
            throw new RuntimeError("Check cwd must stay in the contained repository");
    }
    if (request.protectedFiles?.length && !request.acceptanceSource)
        throw new RuntimeError("Protected check files require their independently pinned acceptance source");
    for (const path of request.protectedFiles ?? [])
        if (!path || path.startsWith("/") || path.split("/").some(part => part === ".." || part === ".git") || /[\0\n\r]/.test(path))
            throw new RuntimeError("Protected check input path is unsafe");
    const writableDirectories = parseWritableDirectories(request.writableDirectories ?? [], request.protectedFiles ?? []);
    const redact = runtimeRedactor(policy.env), sandbox = await openSandbox({ role: "verifier", repo: request.repo, policy: { ...policy, env: [], ...(policy.kind === "gvisor-kubernetes" ? { secretRefs: {} } : {}) }, timeoutMs: request.timeoutMs, signal: request.signal, driver: options.driver ?? processDriver, redact });
    const must = async (argv: string[], input?: string) => {
        const result = await sandbox.exec(argv, { input });
        if (result.code !== 0)
            throw new RuntimeError(`Verifier preparation failed: ${redact(result.stderr || result.stdout)}`);
        return result.stdout;
    };
    try {
        const sourceTree = (await must(["git", "-c", `safe.directory=${REPO}`, "-C", REPO, "rev-parse", "HEAD^{tree}"])).trim();
        // Prepare only named empty/untracked output directories. Parent directories stay locked
        // wherever acceptance needs them; making REPO writable would permit unlinking a check.
        const outputGuards: string[] = [];
        for (const directory of writableDirectories) {
            let prefix = REPO;
            for (const segment of directory.split("/")) {
                prefix += "/" + segment;
                outputGuards.push(`test ! -L ${quote(prefix)}`);
            }
            await must(["/bin/sh", "-c", `set -eu; ${outputGuards.join("; ")}; test ! -e ${quote(`${REPO}/${directory}`)} || test -d ${quote(`${REPO}/${directory}`)}`]);
            const tracked = await must(["git", "--literal-pathspecs", "-c", `safe.directory=${REPO}`, "-C", REPO, "ls-files", "-z", "--", directory]);
            if (tracked)
                throw new RuntimeError("Verifier writable directories cannot contain tracked repository files", "writable-directory-tracked");
            await must(["/bin/sh", "-c", `set -eu; mkdir -p -- ${quote(`${REPO}/${directory}`)}; chown 1000:1000 ${quote(`${REPO}/${directory}`)}; chmod u+rwx ${quote(`${REPO}/${directory}`)}`]);
        }
        sandbox.provenance.observed.writableDirectories = writableDirectories;
        let checkInputsSha256: string | undefined;
        if (request.acceptanceSource) {
            await sandbox.importSource(request.acceptanceSource, "/workspace/acceptance");
            const paths = request.protectedFiles ?? [];
            if (!paths.length)
                throw new RuntimeError("Independent acceptance source needs complete explicit protected check inputs");
            const authority = await must(["git", "--literal-pathspecs", "-C", "/workspace/acceptance", "ls-tree", "-r", "-z", request.acceptanceSource.commit, "--", ...paths]);
            if (!authority)
                throw new RuntimeError("Pinned acceptance inputs did not resolve");
            const records = authority.split("\0").filter(Boolean);
            for (const record of records)
                if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(record))
                    throw new RuntimeError("Acceptance inputs must be regular tracked files; symlinks and submodules are refused");
            const names = records.map(record => record.slice(record.indexOf("\t") + 1));
            for (const path of paths)
                if (path !== "." && !names.some(name => name === path || name.startsWith(path + "/")))
                    throw new RuntimeError(`Pinned acceptance input ${path} did not resolve`);
            checkInputsSha256 = digest(authority);
            // Compare every original check blob to candidate BEFORE replacement; changed checks are not silently rehabilitated.
            const candidate = await must(["git", "--literal-pathspecs", "-c", `safe.directory=${REPO}`, "-C", REPO, "ls-tree", "-r", "-z", request.repo.commit, "--", ...paths]);
            if (candidate !== authority)
                throw new RuntimeError("Candidate changed the pinned acceptance inputs", "acceptance-inputs-changed");
            // Immutable parents prevent unlink/replacement, not just writes to the existing inode.
            const protectedPaths = new Set<string>([`${REPO}/.git`]);
            for (const record of records) {
                let path = record.slice(record.indexOf("\t") + 1);
                protectedPaths.add(`${REPO}/${path}`);
                while (path !== ".") {
                    path = posix.dirname(path);
                    protectedPaths.add(path === "." ? REPO : `${REPO}/${path}`);
                }
            }
            for (const path of protectedPaths)
                await must(["/bin/sh", "-c", `chown ${path.endsWith("/.git") ? "-R " : ""}0:0 ${quote(path)}; chmod ${path.endsWith("/.git") ? "-R " : ""}a-w ${quote(path)}`]);
        }
        const statusCommand = ["git", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"];
        const before = await sandbox.run(statusCommand);
        const results: ContainedCommandResult["results"] = [];
        for (const row of request.commands) {
            const start = Date.now();
            const argv = row.argv ?? ["/bin/sh", "-c", row.command!];
            const actual = row.cwd ? ["/bin/sh", "-c", `cd ${quote(row.cwd)} || exit 126; test "$(pwd -P)" = ${quote(row.cwd === "." ? REPO : `${REPO}/${row.cwd}`)} || exit 126; exec "$@"`, "wringer-check", ...argv] : argv;
            let output;
            try {
                output = await sandbox.run(["timeout", "--signal=TERM", "--kill-after=2s", `${row.timeoutMs / 1000}s`, ...actual], { timeoutMs: row.timeoutMs + 5000 });
            }
            catch (error) {
                if (error instanceof RuntimeError && error.code === "timeout")
                    throw new RuntimeError("The runtime transport missed the check deadline; remaining checks were not observed and the entire sandbox is being destroyed", "timeout");
                else
                    throw error;
            }
            const result = { id: row.id, code: output.code, stdout: redact(output.stdout), stderr: redact(output.stderr), durationMs: Date.now() - start };
            results.push(result);
            await request.onEvent?.({ type: "runtime.check.finished", ...result, runtimeId: sandbox.provenance.runtimeId });
        }
        const after = await sandbox.run(statusCommand);
        // Only new untracked descendants of declared directories are outputs. A tracked edit,
        // renamed directory or an extra file outside those directories remains a source change.
        const sourceStatus = (value: string) => {
            const rows = value.split("\0"), kept: string[] = [];
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!;
                if (!row)
                    continue;
                if ((row.startsWith("?? ") || row.startsWith("!! ")) && writableDirectories.some(directory => row.slice(3).startsWith(directory + "/")))
                    continue;
                kept.push(row);
                if (/[RC]/.test(row.slice(0, 2)))
                    kept.push(rows[++i] ?? "MISSING-RENAME-SOURCE");
            }
            return kept.join("\0");
        };
        if (writableDirectories.length)
            await must(["/bin/sh", "-c", `set -eu; ${outputGuards.join("; ")}; ${writableDirectories.map(directory => `test -d ${quote(`${REPO}/${directory}`)}`).join("; ")}`]);
        const changed = before.code !== 0 || after.code !== 0 || sourceStatus(before.stdout) !== sourceStatus(after.stdout);
        return { provenance: sandbox.provenance, results, sourceChanged: changed, sourceTree, ...(checkInputsSha256 ? { checkInputsSha256 } : {}) };
    }
    finally {
        await sandbox.close();
    }
}
