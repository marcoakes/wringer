import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { hashBytes, hashValue } from "@wringer/plan";
import { git, Redactor, runProcess } from "@wringer/engine";
import { assistantPath, assistantExists, assistantInventory, createAssistantDirectory, readAssistantRecord, writeAssistantRecord, assistantId } from "@wringer/application";
import { parseMcpJson, delegationContract, verificationContract } from "@wringer/mcp";
import workflow from "../../../integrations/wringer/SKILL.md" with { type: "text" };

export interface ClientSelection {
    client: "codex" | "claude-code"; scope: "project" | "user";
    repo: string; home?: string; workspaceId: string; launcher: string[];
    mode: "verification" | "delegation"; remove?: boolean; replace?: boolean; autoApprove?: boolean;
}
type Entry = Record<string, unknown>;
const redactor = new Redactor();
const identity = (text: string | null) => text === null ? null : hashBytes(Buffer.from(text));
function parsed(client: ClientSelection["client"], text: string): any {
    const value = client === "codex" ? Bun.TOML.parse(text) : parseMcpJson(text || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Client configuration must be an object");
    return value;
}
function serverMap(client: ClientSelection["client"], config: any) {
    const key = client === "codex" ? "mcp_servers" : "mcpServers", map = config[key];
    if (map !== undefined && (!map || typeof map !== "object" || Array.isArray(map))) throw new Error("The MCP server table is not an object");
    return { key, map: map ?? {} };
}
/** Edit the one named server. Parse and compare all other semantic values after
 * the textual TOML edit; unfamiliar layouts refuse rather than delete settings. */
export function editClientConfiguration(client: ClientSelection["client"], source: string, entry: Entry | null): string {
    const original = parsed(client, source), { key, map } = serverMap(client, original), expected = structuredClone(original);
    expected[key] = { ...map }; delete expected[key].wringer;
    if (entry) expected[key].wringer = entry;
    if (client === "claude-code") return JSON.stringify(expected, null, 2) + "\n";
    const lines = source.split(/(?<=\n)/), kept: string[] = []; let discard = false, found = false;
    for (const line of lines) {
        const header = /^\s*\[([^\[\]\r\n]+)\]\s*(?:#.*)?(?:\r?\n)?$/.exec(line);
        if (header) {
            const name = header[1]!.replace(/\s/g, "");
            discard = /^(?:mcp_servers|"mcp_servers"|'mcp_servers')\.(?:wringer|"wringer"|'wringer')(?:\.|$)/.test(name);
            if (discard) found = true;
        }
        if (!discard) kept.push(line);
    }
    if (map.wringer !== undefined && !found) throw new Error("The named Codex entry uses an inline/dotted layout. Move it to [mcp_servers.wringer] before applying this scoped edit");
    let result = kept.join("");
    if (entry) result += (result && !result.endsWith("\n") ? "\n" : "") + "\n[mcp_servers.wringer]\n" + Object.entries(entry).map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join("\n") + "\n";
    const observed = parsed(client, result); observed[key] ??= {};
    if (hashValue(observed) !== hashValue(expected)) throw new Error("The scoped TOML edit would change another setting; no configuration was written");
    return result;
}
async function boundedFile(path: string): Promise<string | null> {
    await assistantPath(dirname(path), path);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!file) return null;
    try {
        const info = await file.stat();
        if (!info.isFile() || info.nlink !== 1 || info.size > 2 * 1024 ** 2) throw new Error("Client configuration must be a bounded regular file without aliases");
        return await file.readFile("utf8");
    } finally { await file.close(); }
}
function paths(selection: ClientSelection) {
    if (!["codex", "claude-code"].includes(selection.client) || !["project", "user"].includes(selection.scope) || !["verification", "delegation"].includes(selection.mode)) throw new Error("Choose a supported client, scope and operating mode explicitly");
    assistantId(selection.workspaceId);
    const variable = selection.client === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR", custom = process.env[variable];
    if (custom && resolve(custom) !== join(homedir(), selection.client === "codex" ? ".codex" : ".claude")) throw new Error(`${variable} selects a custom configuration root. This adapter has not measured that layout; no default files were selected. Use the displayed generic STDIO recipe in your chosen client configuration.`);
    const home = selection.home ?? homedir(), root = selection.scope === "project" ? selection.repo : home;
    if (!isAbsolute(root) || !isAbsolute(selection.repo) || !selection.launcher.length || !isAbsolute(selection.launcher[0]!) || selection.launcher.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Use absolute selected roots and a bounded installed launcher");
    if (selection.launcher.length > 16 || selection.launcher.some(arg => arg.length > 4096) || redactor.scrub(JSON.stringify(selection.launcher)) !== JSON.stringify(selection.launcher)) throw new Error("Invalid launcher arguments");
    if (selection.autoApprove && selection.client !== "codex") throw new Error("Routine auto-approval is not supported by this Claude adapter; use its normal client approval UI");
    return { config: join(root, selection.client === "codex" ? ".codex/config.toml" : selection.scope === "project" ? ".mcp.json" : ".claude.json"), skill: join(root, selection.client === "codex" ? ".agents/skills/wringer/SKILL.md" : ".claude/skills/wringer/SKILL.md") };
}
/** A project configuration with nothing left in it after the named server went. */
function emptyConfiguration(client: ClientSelection["client"], text: string) {
    if (client === "codex") return text.trim() === "";
    const value = parsed(client, text);
    return Object.keys(value).every(key => key === "mcpServers") && !Object.keys(value.mcpServers ?? {}).length;
}
/** The folders connect makes for its files, deepest first. A user's ~/.claude and ~/.codex, and
 * the project's own folder, are never among them; each is removed only when empty. */
function connectDirectories(selection: ClientSelection & { home: string }, locations: { config: string; skill: string }) {
    const root = selection.scope === "project" ? selection.repo : selection.home, skill = dirname(locations.skill), skills = dirname(skill), top = dirname(skills);
    const rows = [skill, skills, ...(selection.client === "codex" || selection.scope === "project" ? [top] : []), ...(selection.client === "codex" && selection.scope === "project" ? [dirname(locations.config)] : [])];
    return rows.filter(path => path.startsWith(root + "/"));
}
async function removeEmptyDirectory(path: string) {
    try { const info = await lstat(path); if (info.isDirectory() && !info.isSymbolicLink()) await rmdir(path); }
    catch (error: any) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
}
/** W2 (alpha.44): a project connection writes files into the repository that hold absolute paths
 * to this computer's install and owner. Say not to commit them and, when nothing ignores them,
 * add them to the clone's own .git/info/exclude, which is never committed or shared. */
const excludeMark = (client: ClientSelection["client"]) => `# Added by wring connect --client ${client}: this computer's paths, not for commit`;
async function repositoryFiles(selection: ClientSelection & { home: string }, locations: { config: string; skill: string }) {
    if (selection.scope !== "project") return null;
    const shown = await git(selection.repo, ["rev-parse", "--show-toplevel"], true);
    if (shown.exit_code !== 0) return null;
    const top = await realpath(shown.stdout.trim()), rows = [] as { path: string; pattern: string; probe: string; tracked: boolean; ignored: boolean }[];
    for (const [path, directory] of [[locations.config, false], [dirname(locations.skill), true]] as const) {
        const rel = relative(top, path);
        if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
        const probe = directory ? relative(top, locations.skill) : rel;
        const tracked = (await git(top, ["ls-files", "-z", "--", rel], true)).stdout.length > 0;
        const ignored = (await git(top, ["check-ignore", "-q", "--no-index", "--", probe], true)).exit_code === 0;
        rows.push({ path: directory ? `${rel}/` : rel, pattern: directory ? `/${rel}/` : `/${rel}`, probe, tracked, ignored });
    }
    const excludePath = resolve(top, (await git(top, ["rev-parse", "--git-path", "info/exclude"])).stdout.trim());
    const before = await boundedFile(excludePath), mark = excludeMark(selection.client), lines = (before ?? "").split("\n");
    let after = before;
    if (selection.remove) {
        // Only the block this client's connect added goes; any other rule stays.
        const at = lines.indexOf(mark);
        if (at >= 0) { let end = at + 1; while (end < lines.length && rows.some(row => row.pattern === lines[end])) end++; after = [...lines.slice(0, at), ...lines.slice(end)].join("\n"); }
    } else {
        const missing = rows.filter(row => !row.tracked && !row.ignored).map(row => row.pattern);
        if (missing.length) after = `${before ?? ""}${before && !before.endsWith("\n") ? "\n" : ""}${mark}\n${missing.join("\n")}\n`;
    }
    const names = rows.map(row => row.path).join(" and "), tracked = rows.filter(row => row.tracked).map(row => row.path), excluded = after !== before && !selection.remove;
    const advice = selection.remove
        ? (after !== before ? `The lines connect added to ${relative(top, excludePath)} for ${names} are removed with them.` : `Nothing in ${relative(top, excludePath)} needs removing.`)
        : `Do not commit ${names}: they hold absolute paths to this computer's Wringer install and its owner. ${tracked.length ? `${tracked.join(" and ")} ${tracked.length > 1 ? "are" : "is"} already tracked here, so leave this edit out of your commits. ` : ""}${excluded ? `Applying adds them to ${relative(top, excludePath)}, which only this clone reads, so git status will not list them.` : tracked.length === rows.length ? "" : "An ignore rule here already covers them."}`.trim();
    return { top, excludePath, before, after, value: { files: rows.map(({ path, tracked, ignored }) => ({ path, tracked, ignored })), exclude: { path: relative(top, excludePath), add: excluded ? rows.filter(row => !row.tracked && !row.ignored).map(row => row.pattern) : [], remove: !!selection.remove && after !== before }, commit: "do-not-commit", advice } };
}
async function binding(root: string, id: string) {
    const names = (await assistantInventory(root, `client-bindings/${id}`)).filter(name => /^\d{8}\.json$/.test(name));
    let previous: any = null;
    for (const name of names) {
        const row = await readAssistantRecord<any>(root, `client-bindings/${id}/${name}`);
        if (row.schema_version !== "wringer.client-binding.v1" || row.sequence !== (previous?.sequence ?? 0) + 1 || row.previous !== (previous ? hashValue(previous) : null) || row.id !== id) throw new Error("Client ownership history is inconsistent");
        previous = row;
    }
    return previous;
}
async function proposal(root: string, input: ClientSelection) {
    const selected = { ...input, home: input.home ?? homedir() }, locations = paths(selected), id = hashValue(locations);
    const previous = await binding(root, id), before = await boundedFile(locations.config), skillBefore = await boundedFile(locations.skill);
    const current = serverMap(selected.client, parsed(selected.client, before ?? "")).map.wringer ?? null;
    const owned = !!previous && previous.action === "install" && previous.entryIdentity === hashValue(current);
    if (selected.remove && (!owned || previous.workspaceId !== selected.workspaceId)) throw new Error("Removal requires this workspace's unchanged owned named entry");
    if (!selected.remove && current && !owned && !selected.replace) throw new Error("A different named Wringer entry exists. Inspect it, then select --replace with a fresh exact preview");
    if (skillBefore !== null && identity(skillBefore) !== previous?.skillIdentity && skillBefore !== workflow) throw new Error("The Wringer skill is not owned or has changed; preserve it and choose a separate installation");
    const tools = (selected.mode === "delegation" ? delegationContract : verificationContract).tools().map(row => row.name);
    const argv = [...selected.launcher, "mcp", "--connection", join(root, "owners", selected.workspaceId, "connection.json")];
    // Measured on Codex 0.153.4 (beta gate run 1, 2026-11-04): under "auto" Codex still asks
    // before each write tool, and codex exec's never-ask policy refuses the call; only
    // "approve" lets it record a proposal. The value applies to this server only.
    const entry = selected.remove ? null : selected.client === "claude-code" ? { type: "stdio", command: argv[0], args: argv.slice(1) } : { command: argv[0], args: argv.slice(1), env_vars: [], enabled_tools: tools, startup_timeout_sec: 10, tool_timeout_sec: 40, ...(selected.autoApprove ? { default_tools_approval_mode: "approve" } : {}) };
    const codexApproval = selected.client !== "codex" || selected.remove ? ""
        : selected.autoApprove ? " Codex will run Wringer's tools without asking (default_tools_approval_mode = \"approve\", this server only); approving the job, reviewing it and Send stay on the person's page."
        : " Codex asks before each Wringer tool that records something. Interactive Codex shows that question; codex exec cannot answer it and refuses the call, so connect with --auto-approve to use codex exec.";
    const after = editClientConfiguration(selected.client, before ?? "", entry), skillAfter = selected.remove ? null : workflow;
    // Measured on Codex 0.153.4 (2026-10-01): a user-level server named wringer is the one
    // Codex uses, and a project's .codex/config.toml is read only for a trusted folder,
    // which Codex records in the user's own configuration. A project entry that Codex
    // will not use is refused or flagged here rather than reported as connected.
    const warnings: string[] = []; let refusal: string | null = null;
    if (selected.client === "codex" && selected.scope === "project" && !selected.remove) {
        const userPath = join(selected.home, ".codex/config.toml"), user = parsed("codex", await boundedFile(userPath) ?? ""), userEntry = serverMap("codex", user).map.wringer;
        if (userEntry !== undefined && hashValue(userEntry) !== hashValue(entry)) {
            refusal = `Your Codex user configuration (${userPath}) already has a server named wringer, and Codex uses that one instead of this project's entry. It runs: ${redactor.scrub([userEntry.command, ...(Array.isArray(userEntry.args) ? userEntry.args : [])].join(" ")).slice(0, 600)}. Inspect it; then remove it with codex mcp remove wringer, or connect with --scope user --replace instead. Nothing was written.`;
            warnings.push(refusal);
        }
        // Measured in beta gate run 2 (Codex 0.153.4, 2026-11-05): ~/Claude was trusted and a
        // repository inside it was not, so Codex ignored that repository's .codex/config.toml.
        // Only an entry for the repository's own folder counts (F13).
        const trusted = Object.entries(user.projects ?? {}).some(([path, row]: [string, any]) => row?.trust_level === "trusted" && resolve(path) === resolve(selected.repo));
        if (!trusted) warnings.push(`Codex has not recorded ${selected.repo} as a trusted folder in ${userPath}, and it reads a project's .codex/config.toml only in a folder it trusts; a trusted folder above this one does not count. Open codex in ${selected.repo} once and trust it, or connect with --scope user instead.`);
    }
    // Beta gate run 2 (F14): a removal left a project .codex/config.toml holding one newline, and
    // the empty folders connect had made. A project configuration left with nothing in it goes, and
    // those folders go only when empty. A user's own configuration file always stays.
    const configAfter = selected.remove && selected.scope === "project" && emptyConfiguration(selected.client, after) ? null : after;
    const directories = selected.remove ? connectDirectories(selected, locations) : [], repository = await repositoryFiles(selected, locations);
    const files = [{ path: locations.config, before, after: configAfter }, { path: locations.skill, before: skillBefore, after: skillAfter }, ...(repository && repository.after !== repository.before ? [{ path: repository.excludePath, before: repository.before, after: repository.after }] : [])];
    const next = { schema_version: "wringer.client-binding.v1", id, sequence: (previous?.sequence ?? 0) + 1, previous: previous ? hashValue(previous) : null, workspaceId: selected.workspaceId, client: selected.client, scope: selected.scope, action: selected.remove ? "remove" : "install", entryIdentity: hashValue(entry), skillIdentity: identity(skillAfter), locations };
    const publicValue = { schema_version: "wringer.client-change.v1", coordination: { kind: "client", id }, selection: selected, ownership: owned ? "owned" : current ? "different" : "absent", existingEntry: redactor.deep(current), proposedEntry: entry, ...(warnings.length ? { warnings } : {}), changes: files.map(file => ({ path: file.path, before: identity(file.before), after: identity(file.after), action: file.after === null ? "remove" : file.before === null ? "create" : "update" })), ...(directories.length ? { emptyDirectories: directories } : {}), ...(repository ? { repositoryFiles: repository.value } : {}), authority: "none", clientCompatibility: "not-measured", note: selected.remove
        ? `Only the named server and workflow skill are selected for removal${directories.length ? ", with each listed folder that is empty afterwards" : ""}. Jobs, evidence and operator authority remain in the application directory, and the operator owner is unchanged. Reload the client afterwards.`
        : `Only the named server and workflow skill are selected. Jobs and operator authority remain in the application directory. Start its owner with wring job open --workspace ${selected.workspaceId}: connecting starts nothing. Client trust/reload may still be required.${codexApproval}${repository ? ` ${repository.value.advice}` : ""}` };
    return { input: selected, files, directories, next, refusal, publicValue: { ...publicValue, identity: hashValue({ ...publicValue, previous: next.previous }) } };
}
export async function previewClientConnection(root: string, input: ClientSelection) { return (await proposal(root, input)).publicValue; }
/** Private resumable transaction. Backups stay outside project/client config and
 * are excluded from diagnostics. A restart accepts only exact before/after bytes. */
export async function applyClientConnection(root: string, input: ClientSelection, expected: string) {
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error("Supply the exact reviewed preview identity");
    await createAssistantDirectory(root);
    const selected = { ...input, home: input.home ?? homedir() }, locations = paths(selected), id = hashValue(locations);
    const lockPath = await assistantPath(root, `client-transactions/${id}.lock`); await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    const lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Client setup has an owner or an interrupted transaction; inspect it before recovery"); });
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, expected })); await lock.sync();
        const record = `client-transactions/${expected}.json`;
        let plan: Awaited<ReturnType<typeof proposal>>;
        if (await assistantExists(root, record)) {
            plan = await readAssistantRecord(root, record);
            if (hashValue(plan.input) !== hashValue(selected) || plan.next.id !== id || plan.publicValue.identity !== expected) throw new Error("The reviewed transaction names different client selections");
        } else {
            plan = await proposal(root, selected);
            if (plan.publicValue.identity !== expected) throw new Error("Client configuration changed since preview; inspect a fresh change before applying");
            if (plan.refusal) throw new Error(plan.refusal);
            await writeAssistantRecord(root, record, plan);
        }
        const latest = await binding(root, id);
        if ((latest ? hashValue(latest) : null) !== plan.next.previous && hashValue(latest) !== hashValue(plan.next)) throw new Error("Client ownership advanced after this transaction; inspect a fresh preview");
        // The only other file a transaction may touch is this clone's own .git/info/exclude (W2).
        const exclude = (await repositoryFiles(selected, locations))?.excludePath;
        for (const file of plan.files) {
            if (![locations.config, locations.skill, ...(exclude ? [exclude] : [])].includes(file.path)) throw new Error("Client transaction escapes its selected paths");
            const current = await boundedFile(file.path);
            if (current === file.after) continue;
            if (current !== file.before) throw new Error("Client configuration changed during the transaction; retained backups were not overwritten");
            if (file.after === null) { if (current !== null) await unlink(file.path); }
            else {
                await mkdir(dirname(file.path), { recursive: true, mode: 0o700 });
                await assistantPath(dirname(file.path), file.path);
                const temporary = file.path + `.wringer-${crypto.randomUUID()}.pending`, handle = await open(temporary, "wx", 0o600);
                try { await handle.writeFile(file.after); await handle.sync(); } finally { await handle.close(); }
                try { if (await boundedFile(file.path) !== current) throw new Error("Client configuration changed before replacement"); await rename(temporary, file.path); }
                finally { await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; }); }
            }
            const directory = await open(dirname(file.path), "r"); try { await directory.sync(); } finally { await directory.close(); }
        }
        // A transaction retained by an earlier release names no folders.
        const folders = plan.directories ?? [], allowedFolders = selected.remove ? connectDirectories(selected, locations) : [];
        if (folders.some(path => !allowedFolders.includes(path))) throw new Error("Client transaction escapes its selected paths");
        for (const path of folders) await removeEmptyDirectory(path);
        await writeAssistantRecord(root, `client-bindings/${id}/${String(plan.next.sequence).padStart(8, "0")}.json`, plan.next);
        return { ...plan.publicValue, applied: true, verified: "exact-config-and-skill-bytes", compatibility: "client-discovery-and-live-job-not-yet-measured" };
    } finally { await lock.close(); await unlink(lockPath); }
}
export async function detectClient(client: ClientSelection["client"]) {
    const executable = Bun.which(client === "codex" ? "codex" : "claude");
    if (!executable) return { executable: null, version: null, installed: false, compatibility: "unmeasured" };
    const measured = await runProcess([executable, "--version"], { cwd: dirname(executable), timeout: 3, maxBytes: 4096, redactor });
    return { executable, version: measured.exit_code === 0 && !measured.stdout_truncated ? measured.stdout.trim() : null, installed: true, compatibility: "unmeasured" };
}
/** Exercises our installed STDIO bridge, not a model/client chat. Only protocol
 * initialization, tool discovery and read-only setup observation are sent. */
export async function probeRestrictedConnection(launcher: string[], connectionPath: string, mode: ClientSelection["mode"]) {
    if (!launcher.length || !isAbsolute(launcher[0]!) || !isAbsolute(connectionPath) || !["verification", "delegation"].includes(mode)) throw new Error("Select an absolute installed launcher and connection");
    const process = Bun.spawn([...launcher, "mcp", "--connection", connectionPath], { cwd: dirname(connectionPath), env: { PATH: globalThis.process.env.PATH ?? "", TMPDIR: globalThis.process.env.TMPDIR ?? "/tmp" }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const waiting = new Map<number, ReturnType<typeof Promise.withResolvers<any>>>();
    let failure: Error | undefined;
    const fail = (error: Error) => { failure = error; for (const pending of waiting.values()) pending.reject(error); waiting.clear(); process.kill(); };
    const timeout = setTimeout(() => fail(new Error("Restricted connection probe timed out; no work was retried")), 10000);
    const stdout = (async () => {
        const decoder = new TextDecoder(); let buffer = "", bytes = 0;
        const reader = process.stdout.getReader();
        while (true) {
            const { value: chunk, done } = await reader.read(); if (done) break;
            bytes += chunk.length; if (bytes > 1024 * 1024) throw new Error("MCP discovery exceeded its output bound");
            buffer += decoder.decode(chunk, { stream: true }); let end;
            while ((end = buffer.indexOf("\n")) >= 0) {
                const message = parseMcpJson(buffer.slice(0, end)) as any; buffer = buffer.slice(end + 1);
                const pending = waiting.get(message.id);
                if (pending) { waiting.delete(message.id); if (message.error) pending.reject(new Error("MCP refused connection discovery")); else pending.resolve(message.result); }
            }
        }
        if (buffer || waiting.size) throw new Error("MCP discovery ended before its complete responses");
    })().catch(error => fail(error instanceof Error ? error : new Error("MCP output unreadable")));
    const stderr = (async () => { let bytes = 0; const reader = process.stderr.getReader(); while (true) { const { value: chunk, done } = await reader.read(); if (done) break; bytes += chunk.length; if (bytes > 8192) throw new Error("MCP diagnostics exceeded their bound"); } })().catch(error => fail(error));
    async function request(id: number, method: string, params: object = {}) {
        if (failure) throw failure;
        const pending = Promise.withResolvers<any>(); waiting.set(id, pending);
        process.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); await process.stdin.flush(); return pending.promise;
    }
    try {
        const initialized = await request(0, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "wringer-no-model-connection-probe", version: "1" } });
        if (!initialized?.protocolVersion || !initialized.capabilities?.tools) throw new Error("The server did not advertise the restricted tool protocol");
        process.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"); await process.stdin.flush();
        const listed = await request(1, "tools/list"), expected = (mode === "delegation" ? delegationContract : verificationContract).tools();
        if (hashValue(listed.tools) !== hashValue(expected)) throw new Error("The discovered tool contract differs from this mode's exact advertised schema");
        const setup = await request(2, "tools/call", { name: "wringer.inspect_setup", arguments: {} });
        if (setup.isError || setup.structuredContent?.mode !== mode) throw new Error("The live owner did not confirm the selected mode");
        return { schema_version: "wringer.connection-measurement.v1", mode, tools: expected.map(row => row.name), transport: "stdio", modelCalls: 0, measured: "protocol-and-read-only-owner-setup", namedClientDiscovery: "unmeasured", liveJob: "unmeasured" };
    } finally {
        clearTimeout(timeout); process.stdin.end();
        const teardown = setTimeout(() => process.kill("SIGKILL"), 1000);
        try { await process.exited; await Promise.allSettled([stdout, stderr]); } finally { clearTimeout(teardown); }
    }
}
