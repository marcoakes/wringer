#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { loadExecutionPlan } from "@wringer/plan";
import { VERSION, Redactor } from "@wringer/engine";
import { ASSISTANT_WARNING, createAssistantService, initializeAssistant, issueAssistantCapability, revokeAssistantCapabilities, recoverAssistantRunner, assistantPath, assistantExists, writeAssistantRecord, readAssistantRecord } from "@wringer/application";
import { ASSISTANT_TOOL_NAMES, runMcpStdio, parseMcpJson } from "@wringer/mcp";
import { parseArgs, flag, required, string, positionals, quote, type Args } from "./args";
import type { Answer } from "./app";
import { createAssistantConsole } from "./assistant-console";
import { createAssistantTransport, readAssistantConnection, parseAssistantConnection, validateAssistantEndpoint, callAssistantConnection, type AssistantConnection } from "./assistant-transport";

type Service = Awaited<ReturnType<typeof createAssistantService>>;
export interface AssistantCliOptions { cwd?: string; signal?: AbortSignal; write?: (text: string) => void }
interface DaemonManifest { schema_version: "wringer.assistant-daemon.v1"; ownerToken: string; pid: number; endpoint: string; operatorUrl: string; adminToken: string; connectionPath: string }

export const ASSISTANT_HELP = `Wringer assistant entry point — ${VERSION}

Keep your AI coding app. Put the work through Wringer.
${ASSISTANT_WARNING}

Operator setup:
  init --root ABS_DIRECTORY --plan ABS_PLAN --cooperative-local [--destination ABS_JSON]
  start --root ABS_DIRECTORY --cooperative-local
  serve --root ABS_DIRECTORY --cooperative-local
  status --root ABS_DIRECTORY [--operator]
  connect --root ABS_DIRECTORY --client codex [--renew]
  stop --root ABS_DIRECTORY
  recover --root ABS_DIRECTORY --acknowledge-uncertain
  reconcile --root ABS_DIRECTORY --job JOB_ID --operation OPERATION_ID --acknowledge-uncertain
  revoke --root ABS_DIRECTORY

Restricted client entry point:
  mcp --connection ABS_CONNECTION_JSON

start launches a separate local owner; serve stays in this terminal. Neither is
a login item or reboot/sleep service. Closing chat does not cancel accepted work.
The MCP entry point never starts the owner. Restart and recovery are explicit.

init imports an inert contained profile; it does not approve a job or run a model.
The operator console records execution approval. Human review and sending need
their own source-bound decisions. The assistant cannot grant either authority.

connect prints a reviewed Codex command/configuration; it does not install or
overwrite client settings. --renew explicitly replaces only the scoped local
connection capability. Existing keys and logins are reused, never shown here.
revoke disables assistant access and requests owner shutdown; evidence is kept.
Session/time limits are not a cash cap. Coding-app usage remains unknown.

Guide: ASSISTANT_START.md
Codex connection reference: https://learn.chatgpt.com/docs/extend/mcp?surface=cli
`;

function parse(argv: string[]): Args {
    const local = new Set(["cooperative-local", "operator", "renew"]), flags = new Set<string>(), rest: string[] = [];
    for (const arg of argv) {
        const key = arg.startsWith("--") ? arg.slice(2).split("=")[0]! : "";
        if (!local.has(key)) { rest.push(arg); continue; }
        if (arg.includes("=") || flags.has(key)) throw new Error(`--${key} takes no value and must be supplied once`);
        flags.add(key);
    }
    const parsed = parseArgs(rest); for (const key of flags) parsed.flags.set(key, true); return parsed;
}
function allowed(a: Args, keys: string[]) {
    positionals(a, 0);
    for (const key of a.flags.keys()) if (!["help", "version", "json", ...keys].includes(key)) throw new Error(`Unknown option --${key} for this assistant command`);
}
function absolute(a: Args, key: string) { const value = required(a, key); if (!isAbsolute(value) || value.includes("\0") || /[\r\n]/.test(value)) throw new Error(`--${key} requires one absolute path`); return resolve(value); }
function cooperative(a: Args) { if (!flag(a, "cooperative-local")) throw new Error("Protected assistant mode is unavailable. An operator must explicitly select --cooperative-local for the labelled engineering preview; no host-security fallback was selected."); }

/** Same command in source and compiled builds; never rely on the coding app's PATH. */
export function assistantExecutableCommand(executable = process.execPath, modulePath = fileURLToPath(import.meta.url)): string[] {
    return modulePath.startsWith("/$bunfs/") || modulePath.startsWith("B:/~BUN/") ? [executable] : [executable, "--no-env-file", "--no-install", "--no-macros", "--config=/dev/null", modulePath];
}

async function installConnection(root: string, value: AssistantConnection): Promise<string> {
    const path = await assistantPath(root, "connection.json");
    if (await assistantExists(root, "connection.json")) await readAssistantConnection(path);
    const temp = await assistantPath(root, `.connection-${crypto.randomUUID()}.pending`), file = await open(temp, "wx", 0o600);
    try {
        await file.writeFile(JSON.stringify(parseAssistantConnection(value), null, 2) + "\n"); await file.sync();
    } finally { await file.close(); }
    try { await rename(temp, path); const directory = await open(root, "r"); try { await directory.sync(); } finally { await directory.close(); } }
    finally { await unlink(temp).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; }); }
    return path;
}

async function manifest(service: Service): Promise<DaemonManifest | null> {
    const state = await service.runner.status(); if (!state.owner) return null;
    const name = `daemons/${state.owner.token}.json`;
    if (!await assistantExists(service.root, name)) return null;
    const value = await readAssistantRecord<DaemonManifest>(service.root, name);
    if (value.schema_version !== "wringer.assistant-daemon.v1" || value.ownerToken !== state.owner.token || value.pid !== state.owner.pid || !/^[a-f0-9]{64}$/.test(value.adminToken)) throw new Error("The private daemon identity does not match retained ownership.");
    validateAssistantEndpoint(value.endpoint);
    const operator = new URL(value.operatorUrl);
    if (operator.protocol !== "http:" || operator.hostname !== "127.0.0.1" || !operator.port || operator.pathname !== "/" || operator.username || operator.password || operator.search || !/^#token=[a-f0-9]{64}$/.test(operator.hash) || value.connectionPath !== join(service.root, "connection.json")) throw new Error("The private operator manifest is invalid.");
    return value;
}
async function reachable(value: DaemonManifest): Promise<boolean> {
    try {
        const response = await fetch(value.endpoint.replace(/\/call$/, "/health"), { redirect: "error", signal: AbortSignal.timeout(1000) });
        const json = await response.json() as any;
        return response.ok && json.schema_version === "wringer.assistant-health.v1" && json.status === "ready" && json.instanceId === value.ownerToken;
    } catch { return false; }
}
async function stopOwner(service: Service) {
    const state = await service.runner.status();
    if (!state.owner) return { outcome: "stopped", note: "No local owner is running. Retained work and reservations were preserved." };
    if (state.ownerState !== "live") throw new Error("The old owner is dead or unknown. Use recover --acknowledge-uncertain; this command will not guess a process to kill.");
    const record = await manifest(service);
    if (!record) throw new Error("The owner has no confirmed local endpoint. Inspect status or foreground serve; no process was guessed or killed.");
    const response = await fetch(record.endpoint.replace(/\/call$/, "/stop"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${record.adminToken}` }, body: "{}", redirect: "error", signal: AbortSignal.timeout(3000) });
    if (response.status !== 202) throw new Error("Local shutdown was not confirmed. Inspect the retained owner; do not assume active work stopped.");
    const deadline = Date.now() + 6500;
    while (Date.now() < deadline) {
        const current = await service.runner.status();
        if (!current.owner || current.owner.token !== record.ownerToken || current.ownerState !== "live") return { outcome: "stopped", note: "Local owner stopped. Active or orphan effects may remain uncertain; no evidence or reservations were deleted." };
        await Bun.sleep(50);
    }
    return { outcome: "stop-requested", note: "Shutdown was requested but the owner has not confirmed stopping. Active effects may remain. Inspect status; do not start another owner." };
}

export async function serveAssistant(root: string, options: AssistantCliOptions = {}): Promise<Answer> {
    const service = await createAssistantService(root);
    let console: Awaited<ReturnType<typeof createAssistantConsole>> | undefined, transport: ReturnType<typeof createAssistantTransport> | undefined;
    let resolveStopped!: () => void, shutdown: Promise<unknown> | undefined, ownedToken: string | null = null, closing = false;
    const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });
    const close = async () => { try { await console?.stop(); } finally { try { await transport?.stop(); } finally { resolveStopped(); } } };
    const stop = () => shutdown ??= (async () => {
        closing = true;
        if (!ownedToken) { await close(); return; }
        const result = await service.runner.stop(5000).catch(() => null);
        if (result && (!result.owner || result.owner.token !== ownedToken)) { await close(); return; }
        options.write?.("Shutdown is requested, not complete. An active or uncertain operation still owns the runner. The local status and cancellation endpoints remain available; no new work will be accepted.\n");
        const check = async () => {
            try { const state = await service.runner.status(); if (!state.owner || state.owner.token !== ownedToken) { await close(); return; } }
            catch { /* An unreadable owner is uncertainty, not proof it stopped. */ }
            setTimeout(() => { void check(); }, 250);
        };
        setTimeout(() => { void check(); }, 250);
    })();
    const abort = () => { void stop(); };
    try {
        options.signal?.throwIfAborted();
        const owner = (await service.runner.start()).owner;
        if (!owner) throw new Error("The local runner did not acquire ownership.");
        ownedToken = owner.token;
        console = await createAssistantConsole(service, { isStopping: () => closing });
        transport = createAssistantTransport(service, { instanceId: owner.token, onStop: stop, isStopping: () => closing });
        let token: string;
        if (await assistantExists(service.root, "connection.json")) token = (await readAssistantConnection(join(service.root, "connection.json"))).token;
        else token = (await issueAssistantCapability(service.root, new Date(Date.now() + 7 * 86400000).toISOString())).token;
        const connectionPath = await installConnection(service.root, { schema_version: "wringer.assistant-connection.v1", endpoint: transport.endpoint, token });
        const current: DaemonManifest = { schema_version: "wringer.assistant-daemon.v1", ownerToken: owner.token, pid: process.pid, endpoint: transport.endpoint, operatorUrl: console.url, adminToken: transport.adminToken, connectionPath };
        await writeAssistantRecord(service.root, `daemons/${owner.token}.json`, current);
        options.write?.(`${ASSISTANT_WARNING}\nLocal owner is ready.\nPrivate operator link (keep it out of assistant chat): ${console.url}\nScoped client connection: ${connectionPath}\nNo job was approved and no new execution allowance was created.\n`);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
        await stopped;
        return { text: "Local owner stopped. Retained evidence and uncertain effects were preserved.", value: { outcome: "stopped" } };
    } catch (error) { await stop(); throw error; }
    finally { options.signal?.removeEventListener("abort", abort); }
}

export async function readCodexConnection(configPath: string, command: string[]): Promise<{ state: "absent" | "matching" | "different" | "unreadable"; note: string }> {
    try {
        const stat = await lstat(configPath);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return { state: "unreadable", note: "The client configuration is not a bounded regular file. Nothing was changed." };
        const config = Bun.TOML.parse(await readFile(configPath, "utf8")) as any, entry = config.mcp_servers?.wringer;
        if (!entry) return { state: "absent", note: "No named Wringer entry was found. The printed add command changes only that entry if you choose to run it." };
        const same = entry.command === command[0] && JSON.stringify(entry.args ?? []) === JSON.stringify(command.slice(1));
        return same && entry.enabled !== false ? { state: "matching", note: "The named Wringer command already matches. No duplicate entry or configuration change is needed." } : { state: "different", note: "A named Wringer entry already exists but differs or is disabled. Inspect only that entry before any change; do not run add over it blindly." };
    } catch (e: any) { return e.code === "ENOENT" ? { state: "absent", note: "No user configuration file was found. The printed command is optional; no configuration was created." } : { state: "unreadable", note: "Client configuration could not be read safely. Nothing was changed; inspect the existing configuration before adding anything." }; }
}

export function codexConnectionRecipe(connectionPath: string, command = assistantExecutableCommand()) {
    const argv = [...command, "mcp", "--connection", connectionPath];
    return {
        argv,
        addCommand: `codex mcp add wringer -- ${argv.map(quote).join(" ")}`,
        inspectCommand: "codex mcp list",
        config: `[mcp_servers.wringer]\ncommand = ${JSON.stringify(argv[0])}\nargs = ${JSON.stringify(argv.slice(1))}\nenv_vars = []\nenabled_tools = ${JSON.stringify(ASSISTANT_TOOL_NAMES)}\nstartup_timeout_sec = 10\ntool_timeout_sec = 20\n# Optional: approve routine calls for this restricted server only.\n# Do not change global shell or browser permissions.\ndefault_tools_approval_mode = "auto"\n`,
        disconnectCommand: "codex mcp remove wringer",
    };
}

async function codexVersion(): Promise<string | null> {
    const binary = Bun.which("codex"); if (!binary) return null;
    const child = Bun.spawn([binary, "--version"], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const timeout = setTimeout(() => child.kill(), 2000);
    try {
        const reader = child.stdout.getReader(); let bytes = 0, text = "";
        while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 4096) { child.kill(); return null; } text += new TextDecoder().decode(part.value); }
        if (await child.exited !== 0) return null;
        const value = text.trim(); return /^[A-Za-z0-9 ._+()/-]{1,200}$/.test(value) ? value : null;
    } catch { return null; } finally { clearTimeout(timeout); }
}

export async function assistantCommand(argv: string[], options: AssistantCliOptions = {}): Promise<Answer> {
    const a = parse(argv);
    if (flag(a, "version")) return { text: `Wringer assistant ${VERSION} (Bun ${Bun.version})` };
    if (!a.command || flag(a, "help")) return { text: ASSISTANT_HELP };
    options.signal?.throwIfAborted();
    if (a.command === "mcp") {
        allowed(a, ["connection"]); const path = absolute(a, "connection"); await readAssistantConnection(path);
        await runMcpStdio({ version: VERSION, call: (name, args) => callAssistantConnection(path, name, args) });
        return {};
    }
    if (a.command === "init") {
        allowed(a, ["root", "plan", "cooperative-local", "destination"]); cooperative(a);
        const root = absolute(a, "root"), plan = await loadExecutionPlan(absolute(a, "plan"));
        let destination: any;
        if (a.flags.has("destination")) {
            const path = absolute(a, "destination"), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
            try { const stat = await file.stat(); if (!stat.isFile() || stat.size > 65536) throw new Error("Destination must be a bounded JSON file."); destination = parseMcpJson(await file.readFile("utf8")); } finally { await file.close(); }
        }
        const value = await initializeAssistant(root, { plan, cooperativeLocal: true, ...(destination ? { destination } : {}) });
        return { value: { created: value.created, workspaceId: value.workspace.id, boundary: value.workspace.boundary }, text: `${value.created ? "Workspace profile recorded" : "Existing workspace profile verified"}. No plan was approved and no agent ran.\n${ASSISTANT_WARNING}\nNext: ${assistantExecutableCommand().map(quote).join(" ")} start --root ${quote(root)} --cooperative-local` };
    }
    if (a.command === "serve") { allowed(a, ["root", "cooperative-local"]); cooperative(a); return serveAssistant(absolute(a, "root"), options); }
    if (a.command === "start") {
        allowed(a, ["root", "cooperative-local"]); cooperative(a);
        const root = absolute(a, "root"), service = await createAssistantService(root), before = await service.runner.status();
        if (before.recoveryRequired) throw new Error("Dead or uncertain ownership is retained. Run recover --acknowledge-uncertain first; no automatic recovery or paid retry was attempted.");
        if (!before.owner) {
            const command = assistantExecutableCommand(), child = spawn(command[0]!, [...command.slice(1), "serve", "--root", root, "--cooperative-local"], { cwd: options.cwd ?? process.cwd(), detached: true, stdio: "ignore", env: process.env });
            child.unref();
            await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", () => reject(new Error("The independent local owner could not be launched. Use serve to inspect the startup failure."))); });
        }
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            options.signal?.throwIfAborted();
            const current = await manifest(service);
            if (current && await reachable(current)) return { value: { outcome: "ready", alreadyRunning: !!before.owner, connectionPath: current.connectionPath, boundary: "cooperative-local" }, text: `${ASSISTANT_WARNING}\n${before.owner ? "Existing" : "Independent"} local owner is ready.\nPrivate operator link (keep it out of assistant chat): ${current.operatorUrl}\nScoped client connection: ${current.connectionPath}\nNext: ${assistantExecutableCommand().map(quote).join(" ")} connect --root ${quote(root)} --client codex` };
            await Bun.sleep(50);
        }
        throw new Error(`Owner startup was not confirmed. No second owner or paid retry was attempted. Inspect status, or run foreground serve --root ${quote(root)} --cooperative-local for the exact local stop.`);
    }
    if (a.command === "status") {
        allowed(a, ["root", "operator"]); const service = await createAssistantService(absolute(a, "root")), runner = await service.runner.status(), jobs = await service.list();
        const current = flag(a, "operator") ? await manifest(service) : null;
        const value = { outcome: runner.ownerState, recoveryRequired: runner.recoveryRequired, jobs, ...(flag(a, "operator") && current ? { operatorUrl: current.operatorUrl } : {}) };
        return { value, text: `Local owner: ${runner.ownerState}. ${runner.recoveryRequired ? "Explicit recovery is required; no effect was replayed." : "Status does not start or continue any work."}\n${jobs.map(job => `${job.jobId}: ${job.outcome} — ${job.nextAction}`).join("\n") || "No proposed jobs."}${current ? `\nPrivate operator link (keep it out of assistant chat): ${current.operatorUrl}` : ""}` };
    }
    if (a.command === "connect") {
        allowed(a, ["root", "client", "renew"]);
        if (required(a, "client") !== "codex") throw new Error("Only the Codex connection recipe is currently provided; no other client has been measured as compatible.");
        const root = absolute(a, "root"), service = await createAssistantService(root), current = await manifest(service);
        if (!current || !await reachable(current)) throw new Error("Start the independent owner first with --cooperative-local. Connecting the client never starts or recovers it automatically.");
        if (flag(a, "renew")) {
            const capability = await issueAssistantCapability(root, new Date(Date.now() + 7 * 86400000).toISOString());
            await installConnection(root, { schema_version: "wringer.assistant-connection.v1", endpoint: current.endpoint, token: capability.token });
        }
        const connection = await readAssistantConnection(current.connectionPath), inspection = await service.call(connection.token, "wringer.inspect_setup", {});
        if (inspection.outcome === "refused") throw new Error("The scoped connection is revoked or expired. An operator can explicitly renew it with connect --root ABS_DIRECTORY --client codex --renew. No execution approval is renewed.");
        const recipe = codexConnectionRecipe(current.connectionPath), configPath = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
        const userEntry = await readCodexConnection(configPath, recipe.argv), projectEntry = await readCodexConnection(join(options.cwd ?? process.cwd(), ".codex", "config.toml"), recipe.argv), version = await codexVersion();
        const entries = [userEntry, projectEntry], entry = entries.find(e => e.state === "different" || e.state === "unreadable") ?? entries.find(e => e.state === "matching") ?? userEntry;
        return { value: { client: "codex", clientVersion: version, compatibility: "connection-recipe-only; complete PM journey unmeasured", entry, inspected: { userEntry, currentDirectoryEntry: projectEntry }, connectionPath: current.connectionPath, ...recipe }, text: `${ASSISTANT_WARNING}\nCodex version: ${version ?? "not available; install the official client before using its add command"}.\n${entry.note}\nThe user and current-directory configuration were inspected; other trusted project layers may also apply.\nNo Codex configuration, login or provider key was changed.${flag(a, "renew") ? " Only the scoped local connection capability was renewed; execution approval was not renewed." : ""} A complete Codex PM journey remains unmeasured.\n\nInspect configured servers:\n${recipe.inspectCommand}\n\n${entry.state === "absent" ? "Add only after reviewing this exact command:" : "Reference command only — do not overwrite an existing or unreadable entry:"}\n${recipe.addCommand}\n\nOptional named-entry configuration (review before applying; leave unrelated settings alone):\n${recipe.config}\nDisconnect only the named client entry:\n${recipe.disconnectCommand}\nRetained Wringer jobs are not deleted by disconnection.\nOfficial connection reference: https://learn.chatgpt.com/docs/extend/mcp?surface=cli` };
    }
    if (a.command === "stop") { allowed(a, ["root"]); const value = await stopOwner(await createAssistantService(absolute(a, "root"))); return { value, text: value.note }; }
    if (a.command === "recover") {
        allowed(a, ["root", "acknowledge-uncertain"]);
        if (!flag(a, "acknowledge-uncertain")) throw new Error("Recovery requires --acknowledge-uncertain: orphan effects and charges may remain; nothing will be replayed.");
        const root = absolute(a, "root"), service = await createAssistantService(root), before = await service.runner.status();
        if (!before.owner) return { value: { recovered: false }, text: "No retained owner needs recovery. No work was replayed." };
        const value = await recoverAssistantRunner(join(root, "runner"), { ownerToken: before.owner.token, acknowledgeUncertain: true });
        return { value, text: `${value.message}\nRestart is separate: start --root ${quote(root)} --cooperative-local` };
    }
    if (a.command === "reconcile") {
        allowed(a, ["root", "job", "operation", "acknowledge-uncertain"]);
        if (!flag(a, "acknowledge-uncertain")) throw new Error("Reconciliation requires --acknowledge-uncertain and never authorizes another paid attempt.");
        const service = await createAssistantService(absolute(a, "root"));
        const value = await service.reconcile(required(a, "job"), required(a, "operation"), true);
        return { value, text: "The existing operation was inspected against domain evidence. No model call or new grant was made. Read status for the recorded outcome." };
    }
    if (a.command === "revoke") {
        allowed(a, ["root"]); const root = absolute(a, "root"), service = await createAssistantService(root);
        let stop: Awaited<ReturnType<typeof stopOwner>>;
        try { stop = await stopOwner(service); } catch { stop = { outcome: "unconfirmed", note: "Owner shutdown could not be confirmed. Inspect status and explicit recovery; active effects may remain." }; }
        await revokeAssistantCapabilities(root);
        return { value: { revoked: true, shutdown: stop }, text: `Assistant connections were revoked. Existing keys, grants and evidence were preserved.\n${stop.note}\nA new scoped connection requires explicit connect --renew after the owner is running.` };
    }
    throw new Error("Unknown assistant command. Run wringer-assistant --help.");
}

export async function assistantMain(argv = process.argv.slice(2)) {
    const controller = new AbortController(), stop = () => controller.abort(new Error("Local shutdown requested"));
    process.once("SIGTERM", stop); process.once("SIGINT", stop);
    try {
        const answer = await assistantCommand(argv, { signal: controller.signal, write: text => process.stdout.write(text) });
        if (answer.text !== undefined || answer.value !== undefined) process.stdout.write(argv.includes("--json") ? JSON.stringify(answer.value ?? { message: answer.text }) + "\n" : (answer.text ?? JSON.stringify(answer.value)) + "\n");
        process.exitCode = answer.exit ?? 0;
    } catch (error) {
        // Error output never echoes scoped/worker credentials or a private URL.
        const text = new Redactor().scrub(error instanceof Error ? error.message : "Assistant command could not be completed").replace(/http:\/\/127\.0\.0\.1:[0-9]+\/[^\s]*#token=[a-f0-9]+/g, "[private operator link]");
        process.stderr.write(`Wringer assistant stopped: ${text}\n`); process.exitCode = 3;
    } finally { process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop); }
}

if (import.meta.main) await assistantMain();
