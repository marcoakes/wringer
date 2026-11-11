import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { hashValue } from "@wringer/plan";
import { git, init, Redactor, snapshot } from "@wringer/engine";
import { assertForgeRepositoryBinding, forgeRequestName, parseForgeConfiguration, type ForgeConfiguration } from "@wringer/delivery";
import { assistantId, assistantInventory, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";

export type OperatingMode = "verification" | "delegation";
/** A destination with a forge opens a pull or merge request at Send (alpha.47); it is recorded as a
 * `wringer.workspace.v3` sibling, so every workspace without one keeps its v2 bytes. */
export interface WorkspaceDestination { remote: string; base: string; forge?: ForgeConfiguration }
export interface RegisteredWorkspace {
    schema_version: "wringer.workspace.v2" | "wringer.workspace.v3";
    id: string; mode: OperatingMode; repo: string;
    client: "claude-code" | "codex" | "generic";
    preferences: { destination: WorkspaceDestination | null; profileId: string | null; credentialReferences: string[] };
    boundary: { approval: "cooperative-local"; execution: "trusted-local" | "contained" };
    createdAt: string;
}
export function applicationDirectory(override = process.env.WRINGER_HOME) {
    if (override) { if (!override.startsWith(sep)) throw new Error("WRINGER_HOME must be an absolute application directory"); return resolve(override); }
    return process.platform === "darwin" ? join(homedir(), "Library/Application Support/Wringer") : join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "wringer");
}
export async function inspectWorkspaceSetup(repo: string, mode: OperatingMode | undefined, client: RegisteredWorkspace["client"]) {
    if (!["claude-code", "codex", "generic"].includes(client)) throw new Error("Select claude-code, codex, or generic explicitly");
    if (mode !== undefined && !["verification", "delegation"].includes(mode)) throw new Error("Select verification or delegation; there is no fallback between modes");
    const directory = await realpath(resolve(repo));
    const checks = await init(directory, { dryRun: true });
    return { schema_version: "wringer.setup-proposal.v1", repo: directory, mode: mode ?? null, client, checks, execution: mode === "delegation" ? "contained" : mode === "verification" ? "trusted-local" : "not-selected", authority: "none", nextAction: mode ? "Review proposed changes before applying setup. A job needs its own execution approval." : "Choose verification to check existing agent work, or delegation for a contained managed job.", limits: ["Inspection reads manifests as data. It executes no repository commands, retrieves no keys, and grants no work or sending.", "Check proposals are not a translation of CI conditions, services, secrets, matrices, or working directories."] };
}
const forgeHost = (forge: ForgeConfiguration) => { const host = new URL(forge.endpoint).hostname; return forge.kind === "github" && host === "api.github.com" ? "github.com" : host; };
/** Setup checks that the remote's URL names the forge repository, so a mismatch is found before any
 * work, not at Send. Reads Git configuration only; no network, no token. */
export async function inspectWorkspaceDestination(repo: string, mode: OperatingMode | undefined, input: WorkspaceDestination) {
    if (!/^[A-Za-z0-9_.-]+$/.test(input.remote) || input.remote.startsWith("-") || !/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/.test(input.base) || input.base.includes("..")) throw new Error("Use an existing Git remote name and a reviewed base branch");
    if (!input.forge) return { remote: input.remote, base: input.base };
    if (mode !== "delegation") throw new Error("A verification workspace sends a branch only. A pull or merge request is opened by a delegation workspace's Send: drop --forge, or choose --mode delegation.");
    const forge = parseForgeConfiguration(input.forge), host = forgeHost(forge), request = forgeRequestName(forge.kind);
    const read = await git(await realpath(resolve(repo)), ["remote", "get-url", input.remote], true), url = read.stdout.trim();
    if (read.exit_code !== 0 || !url) throw new Error(`Remote ${input.remote} is not configured in ${repo}. Add the remote for ${forge.repo} on ${host}, or name the one you push it to.`);
    if (new Redactor().scrub(url) !== url || /^https:\/\/[^/]*@/i.test(url)) throw new Error(`Remote ${input.remote}'s URL holds a user name or credential. Send authenticates with ${forge.token_env}; set the remote to the plain https://${host}/${forge.repo} URL (or an SSH URL) and repeat setup.`);
    try { assertForgeRepositoryBinding(url, forge); }
    catch { throw new Error(`Remote ${input.remote} is ${url}, which is not ${forge.repo} on ${host}. The ${request} is opened on the repository the branch is pushed to: name the remote for ${forge.repo}, or give the --forge-repo that ${input.remote} names.`); }
    return { remote: input.remote, base: input.base, forge, remoteUrl: url, opens: request };
}
export async function registerWorkspace(root: string, input: { repo: string; mode: OperatingMode; client: RegisteredWorkspace["client"]; /** A delegation workspace whose profile runs trusted-local. */ execution?: "trusted-local"; applyChecks?: boolean; destination?: RegisteredWorkspace["preferences"]["destination"]; profileId?: string; credentialReferences?: string[] }) {
    const preview = await inspectWorkspaceSetup(input.repo, input.mode, input.client), canonical = resolve(root), inside = relative(preview.repo, canonical);
    if (!inside || inside !== ".." && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep)) throw new Error("Application state must live outside the target repository");
    const references = input.credentialReferences ?? [];
    if (references.length > 32 || references.some(name => !/^[A-Z_][A-Z0-9_]{0,127}$/.test(name))) throw new Error("Use credential reference names only");
    const checked = input.destination ? await inspectWorkspaceDestination(preview.repo, input.mode, input.destination) : null;
    if (new Redactor().scrub(preview.repo) !== preview.repo) throw new Error("Repository path contains a detected credential");
    const destination: WorkspaceDestination | null = checked ? { remote: checked.remote, base: checked.base, ...("forge" in checked ? { forge: checked.forge } : {}) } : null;
    const preferences = { destination, profileId: input.profileId ?? null, credentialReferences: references };
    await createAssistantDirectory(canonical);
    for (const name of await assistantInventory(canonical, "workspaces")) {
        if (!name.endsWith(".json")) continue;
        const existing = await readWorkspace(canonical, name.slice(0, -5));
        if (existing.repo === preview.repo && existing.mode === input.mode && existing.client === input.client && hashValue(existing.preferences) === hashValue(preferences)) return existing;
    }
    if (input.applyChecks && preview.checks.status === "proposed") await init(preview.repo);
    const workspace: RegisteredWorkspace = { schema_version: destination?.forge ? "wringer.workspace.v3" : "wringer.workspace.v2", id: crypto.randomUUID(), repo: preview.repo, mode: input.mode, client: input.client, preferences, boundary: { approval: "cooperative-local", execution: input.mode === "verification" || input.execution === "trusted-local" ? "trusted-local" : "contained" }, createdAt: new Date().toISOString() };
    await writeAssistantRecord(canonical, `workspaces/${workspace.id}.json`, workspace);
    return workspace;
}
export async function readWorkspace(root: string, id: string) {
    const workspace = await readAssistantRecord<RegisteredWorkspace>(root, `workspaces/${assistantId(id)}.json`);
    if (workspace.schema_version === "wringer.workspace.v3") { if (workspace.mode !== "delegation" || !workspace.preferences.destination?.forge) throw new Error("Unsupported or inconsistent workspace record"); parseForgeConfiguration(workspace.preferences.destination.forge); }
    else if (workspace.preferences.destination && "forge" in workspace.preferences.destination) throw new Error("Unsupported or inconsistent workspace record");
    if (!["wringer.workspace.v2", "wringer.workspace.v3"].includes(workspace.schema_version) || workspace.id !== id || !["verification", "delegation"].includes(workspace.mode) || (workspace.mode === "verification" ? workspace.boundary.execution !== "trusted-local" : !["contained", "trusted-local"].includes(workspace.boundary.execution))) throw new Error("Unsupported or inconsistent workspace record");
    return workspace;
}
export async function listWorkspaces(root: string, cursor = 0, limit = 50) {
    if (!Number.isInteger(cursor) || cursor < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Use a bounded workspace page");
    const ids = (await assistantInventory(root, "workspaces")).filter(name => name.endsWith(".json"));
    return { workspaces: await Promise.all(ids.slice(cursor, cursor + limit).map(name => readWorkspace(root, name.slice(0, -5)))), nextCursor: cursor + limit < ids.length ? cursor + limit : null };
}
/** Metadata-only preflight before Git status could execute clean/process filters. */
export async function safeWorkspaceSnapshot(repo: string) {
    const filters = await git(repo, ["config", "--includes", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process)$"], true);
    if (filters.timed_out || ![0, 1].includes(filters.exit_code)) throw new Error("Git content filter configuration could not be inspected safely");
    const entries = await git(repo, ["ls-files", "--stage", "-z"]);
    if (entries.stdout.split("\0").some(row => row.startsWith("160000 "))) throw new Error("Submodule source identities require separate preparation; no nested repository was inspected");
    if (filters.stdout.trim()) {
        // Installed filter drivers (for example Git LFS) are inert until an
        // attribute selects one. Resolve attributes as metadata, including
        // index fallback and global attributes, before status/diff can run it.
        const paths = await git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
        if (paths.stdout) {
            const attributes = await git(repo, ["check-attr", "-z", "--stdin", "filter"], false, paths.stdout);
            const fields = attributes.stdout.split("\0");
            if (fields.pop() !== "" || fields.length !== paths.stdout.split("\0").length * 3 - 3 || fields.some((value, index) => index % 3 === 1 && value !== "filter")) throw new Error("Git content filter attributes could not be inspected safely");
            if (fields.some((value, index) => index % 3 === 2 && value !== "unspecified" && value !== "unset")) throw new Error("Git content filters need a separate reviewed source-preparation route; no filter was executed");
        }
    }
    return snapshot(repo);
}
