/** A look at the coding agents a trusted-local job would start, before anyone approves it.
 * Each role's adapter is started in a throwaway clone and asked to open a session. No
 * prompt is sent, so nothing is spent; a person's approval is never needed or implied. */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EngineError, Redactor } from "@wringer/engine";
import { preflightAgentRole, prepareRepositorySource, type AgentPreflightResult } from "@wringer/runtime";
import { describeRoleStop } from "@wringer/workflow";
import { isLocalSource, localSourceSiblings, verifyLocalSource } from "./assistant-local-source";
import { assistantId, assistantInventory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readWorkspace } from "./workspaces";

export interface AgentCheckRole { role: "planner" | "worker" | "judge"; adapter: string; ready: boolean; agent: { name: string; version: string | null } | null; detail: string }
export interface AgentCheck {
    schema_version: "wringer.agent-check.v1";
    workspaceId: string;
    profileId: string;
    at: string;
    ready: boolean;
    promptSent: false;
    modelWorkRequested: false;
    roles: AgentCheckRole[];
    limit: string;
}
/** A first run may download the adapter, and a job's own session allowance can be shorter. */
const CHECK_TIMEOUT_MS = 300000;
export const AGENT_CHECK_LIMIT = "No model prompt was sent. Opening a session does not show its sign-in still works: only the first model call can.";
export const agentCheckCommand = (workspaceId: string) => `wring job check --workspace ${workspaceId}`;

export async function checkDelegationAgents(root: string, workspaceId: string, options: { signal?: AbortSignal; preflight?: typeof preflightAgentRole } = {}): Promise<AgentCheck> {
    const workspace = await readWorkspace(root, assistantId(workspaceId));
    if (workspace.mode !== "delegation") throw new EngineError("A verification workspace has no coding agents to check: your own coding app makes the changes there.", 2, "wring setup --help");
    if (workspace.boundary.execution !== "trusted-local") throw new EngineError("This check covers agents started on this computer. A contained workspace measures its roles inside their runtime with wring runtime measure.", 2, "wring runtime --help");
    const profileId = assistantId(workspace.preferences.profileId), profile = await readAssistantRecord<any>(root, `profiles/${profileId}/profile-record.json`), plan = profile.plan;
    const redactor = new Redactor(plan.runtime.env), scratch = await mkdtemp(join(tmpdir(), "wringer-agent-check-")), roles: AgentCheckRole[] = [];
    try {
        let bundlePath: string | undefined;
        if (isLocalSource(plan)) {
            bundlePath = join(scratch, "source.bundle");
            await writeFile(bundlePath, (await verifyLocalSource(plan, localSourceSiblings(join(root, "profiles", profileId, "profile.json")))).bundle, { flag: "wx", mode: 0o600 });
        }
        const source = await prepareRepositorySource({ ...plan.repository, ...(bundlePath ? { bundlePath } : {}) }, { controllerDir: scratch });
        const timeoutMs = Math.min(CHECK_TIMEOUT_MS, plan.budget.session_timeout_seconds * 1000);
        for (const role of ["planner", "worker", "judge"] as const) {
            const agent = plan.agents[role]; if (!agent) continue;
            const adapter = [agent.command, ...(agent.args ?? [])].join(" ");
            try {
                const probe: AgentPreflightResult = await (options.preflight ?? preflightAgentRole)({ role, repo: source, runtime: plan.runtime, agent, budget: { maxTurns: 1, timeoutMs }, ...(role === "worker" ? { scope: { writable: plan.scope.writable, protected: plan.acceptance.protected_paths, writableDirectories: plan.environment.writable_directories } } : {}), signal: options.signal });
                const ready = probe.status === "completed" && probe.authentication.sessionOpened;
                const named = typeof probe.agentInfo?.name === "string" ? { name: probe.agentInfo.name, version: typeof probe.agentInfo.version === "string" ? probe.agentInfo.version : null } : null;
                roles.push({ role, adapter, ready, agent: named, detail: ready ? `Started ${named ? `${named.name}${named.version ? ` ${named.version}` : ""}` : adapter} and opened a session.` : describeRoleStop(role, probe, "run this check again") });
            } catch (error) { roles.push({ role, adapter, ready: false, agent: null, detail: `The ${role}'s coding agent could not be checked: ${error instanceof Error ? error.message : String(error)}` }); }
        }
    } finally { await rm(scratch, { recursive: true, force: true }); }
    const at = new Date().toISOString();
    const value: AgentCheck = redactor.deep({ schema_version: "wringer.agent-check.v1" as const, workspaceId, profileId, at, ready: roles.every(row => row.ready), promptSent: false as const, modelWorkRequested: false as const, roles, limit: AGENT_CHECK_LIMIT });
    await writeAssistantRecord(root, `agent-checks/${workspaceId}/${at.replace(/[:.]/g, "-")}-${crypto.randomUUID()}.json`, value);
    return value;
}
/** The most recent check, by the time in its name. An unreadable record is no check at all. */
export async function latestAgentCheck(root: string, workspaceId: string): Promise<AgentCheck | null> {
    const name = (await assistantInventory(root, `agent-checks/${assistantId(workspaceId)}`)).filter(row => row.endsWith(".json")).at(-1);
    return name ? readAssistantRecord<AgentCheck>(root, `agent-checks/${workspaceId}/${name}`).catch(() => null) : null;
}
