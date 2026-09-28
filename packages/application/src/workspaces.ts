import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { hashValue } from "@wringer/plan";
import { git, init, Redactor, snapshot } from "@wringer/engine";
import { assistantId, assistantInventory, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";

export type OperatingMode = "verification" | "delegation";
export interface RegisteredWorkspace {
    schema_version: "wringer.workspace.v2";
    id: string; mode: OperatingMode; repo: string;
    client: "claude-code" | "codex" | "generic";
    preferences: { destination: { remote: string; base: string } | null; profileId: string | null; credentialReferences: string[] };
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
export async function registerWorkspace(root: string, input: { repo: string; mode: OperatingMode; client: RegisteredWorkspace["client"]; applyChecks?: boolean; destination?: RegisteredWorkspace["preferences"]["destination"]; profileId?: string; credentialReferences?: string[] }) {
    const preview = await inspectWorkspaceSetup(input.repo, input.mode, input.client), canonical = resolve(root), inside = relative(preview.repo, canonical);
    if (!inside || inside !== ".." && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep)) throw new Error("Application state must live outside the target repository");
    const references = input.credentialReferences ?? [];
    if (references.length > 32 || references.some(name => !/^[A-Z_][A-Z0-9_]{0,127}$/.test(name))) throw new Error("Use credential reference names only");
    if (input.destination && (!/^[A-Za-z0-9_.-]+$/.test(input.destination.remote) || input.destination.remote.startsWith("-") || !/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,199}$/.test(input.destination.base) || input.destination.base.includes(".."))) throw new Error("Use an existing Git remote name and a reviewed base branch");
    if (new Redactor().scrub(preview.repo) !== preview.repo) throw new Error("Repository path contains a detected credential");
    const preferences = { destination: input.destination ?? null, profileId: input.profileId ?? null, credentialReferences: references };
    await createAssistantDirectory(canonical);
    for (const name of await assistantInventory(canonical, "workspaces")) {
        if (!name.endsWith(".json")) continue;
        const existing = await readWorkspace(canonical, name.slice(0, -5));
        if (existing.repo === preview.repo && existing.mode === input.mode && existing.client === input.client && hashValue(existing.preferences) === hashValue(preferences)) return existing;
    }
    if (input.applyChecks && preview.checks.status === "proposed") await init(preview.repo);
    const workspace: RegisteredWorkspace = { schema_version: "wringer.workspace.v2", id: crypto.randomUUID(), repo: preview.repo, mode: input.mode, client: input.client, preferences, boundary: { approval: "cooperative-local", execution: input.mode === "verification" ? "trusted-local" : "contained" }, createdAt: new Date().toISOString() };
    await writeAssistantRecord(canonical, `workspaces/${workspace.id}.json`, workspace);
    return workspace;
}
export async function readWorkspace(root: string, id: string) {
    const workspace = await readAssistantRecord<RegisteredWorkspace>(root, `workspaces/${assistantId(id)}.json`);
    if (workspace.schema_version !== "wringer.workspace.v2" || workspace.id !== id || !["verification", "delegation"].includes(workspace.mode) || workspace.boundary.execution !== (workspace.mode === "verification" ? "trusted-local" : "contained")) throw new Error("Unsupported or inconsistent workspace record");
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
    if (![0, 1].includes(filters.exit_code) || filters.stdout.trim()) throw new Error("Git content filters need a separate reviewed source-preparation route; no filter was executed");
    const entries = await git(repo, ["ls-files", "--stage", "-z"]);
    if (entries.stdout.split("\0").some(row => row.startsWith("160000 "))) throw new Error("Submodule source identities require separate preparation; no nested repository was inspected");
    return snapshot(repo);
}
