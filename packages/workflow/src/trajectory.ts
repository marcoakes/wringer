/** What a role actually did, as numbered lines a person or a later proposer can cite:
 * a bounded, redacted projection of the ACP updates already retained in an effect's
 * result. Nothing is recorded anew and nothing is inferred: a tool call whose adapter
 * sent no output says so, and the render never synthesises one.
 *
 * Field sources were measured on the pinned adapters (docs/improvement/PHASE_A_MEASUREMENTS.md):
 * Claude's adapter carries output as `content` text or diff items and `rawOutput`;
 * Codex's as `rawOutput.formatted_output`/`exit_code` and `_meta.terminal_*`. */
import { hashValue, type ExecutionPlan } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import type { RoleExecutionRequest, RoleExecutionResult } from "@wringer/runtime";
import type { AgentRole } from "@wringer/plan";
import { readValidatedContainedState } from "./contained";
import { readJson, safePath } from "./storage";
import { lstat } from "node:fs/promises";

export type TrajectoryKind = "HARNESS" | "ACTION" | "OBSERVATION" | "OBSERVATION ERROR" | "ASSISTANT" | "PERMISSION" | "USAGE";
export interface TrajectoryLine { n: number; kind: TrajectoryKind; text: string; }
export interface LoopTrajectory {
    schema_version: "wringer.loop-trajectory.v1";
    planSha256: string;
    journalRevision: string;
    effectId: string;
    role: AgentRole;
    effectStatus: "reserved" | "completed" | "uncertain";
    agent: { name: string | null; version: string | null };
    stopReason: string | null;
    requestSha256: string;
    resultSha256: string | null;
    lines: TrajectoryLine[];
    omitted: { commandListings: number; thoughtChunks: number; otherUpdates: number; truncatedItems: number; truncatedChars: number; droppedLines: number };
    limits: string[];
    sha256: string;
}
/** Per rendered item and per whole trajectory, in characters. */
export const TRAJECTORY_ITEM_LIMIT = 4096, TRAJECTORY_LIMIT = 512 * 1024;
const LIMITS = [
    "A projection of retained ACP updates; it records nothing new and grants no authority.",
    "Redacted when the session was recorded and again when rendered. Each item is cut at 4 KiB and the whole trajectory at 512 KiB; cuts are marked and counted.",
    "A tool call with no output field says so; output is never synthesised. Thought streams were not retained. The agent's own command listing is omitted.",
    "Temporary clone locations are shown as [clone] and home directories as [home].",
];
type Update = Record<string, any>;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);

/** Text an adapter sent for a tool call, in measured preference order; null when it sent none. */
function toolOutput(updates: Update[]): { text: string | null; exit: number | null; diffs: string[] } {
    const content: string[] = [], diffs: string[] = [], raw: string[] = [], terminal: string[] = [];
    let exit: number | null = null;
    for (const update of updates) {
        for (const item of Array.isArray(update.content) ? update.content : []) {
            if (!object(item)) continue;
            if (item.type === "content" && object(item.content) && item.content.type === "text" && typeof item.content.text === "string") content.push(item.content.text);
            else if (item.type === "diff" && typeof item.path === "string") {
                const before = typeof item.oldText === "string" ? item.oldText.split("\n").length : 0, after = typeof item.newText === "string" ? item.newText.split("\n").length : 0;
                diffs.push(`edited ${item.path} (${before ? `${before} → ` : "new, "}${after} lines)`);
            }
        }
        const output = update.rawOutput;
        if (typeof output === "string") raw.push(output);
        else if (Array.isArray(output)) raw.push(output.flatMap(row => object(row) && typeof row.text === "string" ? [row.text] : typeof row === "string" ? [row] : []).join("\n"));
        else if (object(output)) {
            const text = [output.formatted_output, output.output, output.stdout, output.stderr].filter(value => typeof value === "string" && value.length);
            if (text.length) raw.push(text.join("\n"));
            if (Number.isInteger(output.exit_code)) exit = output.exit_code;
        }
        const meta = object(update._meta) ? update._meta : {};
        for (const key of ["terminal_output", "terminal_output_delta"]) if (object(meta[key]) && typeof meta[key].data === "string") terminal.push(meta[key].data);
        if (object(meta.terminal_exit) && Number.isInteger(meta.terminal_exit.exit_code)) exit = meta.terminal_exit.exit_code;
    }
    const pick = [content, raw, terminal].find(rows => rows.some(row => row.length));
    return { text: pick ? pick.join(pick === terminal ? "" : "\n") : null, exit, diffs };
}

export interface TrajectoryInput {
    plan: Pick<ExecutionPlan, "plan_sha256">;
    journalRevision: string;
    effect: { id: string; role: AgentRole; status: "reserved" | "completed" | "uncertain"; requestSha256: string; resultSha256?: string };
    request: Pick<RoleExecutionRequest, "prompt"> | null;
    result: Pick<RoleExecutionResult, "events" | "stopReason" | "agentInfo" | "usage" | "status"> | null;
    /** Declared credential names whose current values are scrubbed again at render. */
    credentialNames?: string[];
}
/** Pure: the same retained effect always renders the same lines. */
export function projectLoopTrajectory(input: TrajectoryInput): LoopTrajectory {
    const redactor = new Redactor(["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*", ...(input.credentialNames ?? [])]);
    const omitted = { commandListings: 0, thoughtChunks: 0, otherUpdates: 0, truncatedItems: 0, truncatedChars: 0, droppedLines: 0 };
    const lines: TrajectoryLine[] = [];
    let total = 0;
    const tidy = (text: string) => redactor.scrub(text)
        .replace(/(?:\/private)?\/(?:var\/folders\/[^\s"'`]+?|tmp\/[^\s"'`]*?|workspace)\/wringer-(?:worker|judge|planner|verifier|role)-[A-Za-z0-9]+\/repo\b/g, "[clone]")
        .replace(/\/(?:Users|home)\/[^/\s"'`]+/g, "[home]");
    const push = (kind: TrajectoryKind, raw: string) => {
        let text = tidy(raw).replace(/\r\n/g, "\n").trimEnd();
        if (text.length > TRAJECTORY_ITEM_LIMIT) { omitted.truncatedItems++; omitted.truncatedChars += text.length - TRAJECTORY_ITEM_LIMIT; text = `${text.slice(0, TRAJECTORY_ITEM_LIMIT)} …(+${text.length - TRAJECTORY_ITEM_LIMIT} chars, render truncation)`; }
        if (total + text.length > TRAJECTORY_LIMIT) { omitted.droppedLines++; return; }
        total += text.length; lines.push({ n: lines.length + 1, kind, text });
    };
    const result = input.result, agentName = typeof result?.agentInfo?.name === "string" ? result.agentInfo.name : null, agentVersion = typeof result?.agentInfo?.version === "string" ? result.agentInfo.version : null;
    push("HARNESS", `${input.effect.role} session ${input.effect.id} · ${agentName ?? "unknown agent"}${agentVersion ? ` ${agentVersion}` : ""} · ${input.effect.status}`);
    if (input.request) push("HARNESS", `Controller prompt: ${input.request.prompt}`);
    if (!result) { push("HARNESS", input.effect.status === "uncertain" ? "No retained result: this session's outcome is uncertain and was never replayed." : "No retained result."); }
    else {
        let assistant = "", usage: { used?: number; size?: number } = {};
        const flush = () => { if (assistant.trim()) push("ASSISTANT", assistant.trim()); assistant = ""; };
        const calls = new Map<string, { first: Update; updates: Update[]; done: boolean }>();
        const finish = (id: string, unfinished = false) => {
            const call = calls.get(id); if (!call || call.done) return;
            call.done = true; flush();
            const latest = [call.first, ...call.updates].reduce<Update>((acc, u) => ({ ...acc, ...Object.fromEntries(Object.entries(u).filter(([, v]) => v !== undefined && v !== null)) }), {});
            const command = object(latest.rawInput) && typeof latest.rawInput.command === "string" ? latest.rawInput.command : Array.isArray(latest.rawInput?.command) ? latest.rawInput.command.join(" ") : null;
            push("ACTION", `${latest.kind ?? "tool"}: ${latest.title ?? "(untitled)"}${command && !String(latest.title ?? "").includes(command) ? ` — $ ${command}` : ""}`);
            const output = toolOutput([call.first, ...call.updates]), failed = latest.status === "failed";
            const head = [...output.diffs, ...(output.exit !== null ? [`exit ${output.exit}`] : [])].join("; ");
            const body = output.text ?? (output.diffs.length ? null : unfinished ? "(no completion was observed for this call)" : "(output not carried by this adapter for this call)");
            push(failed || output.exit !== null && output.exit !== 0 ? "OBSERVATION ERROR" : "OBSERVATION", [head, body].filter(Boolean).join("\n"));
        };
        for (const event of Array.isArray(result.events) ? result.events : []) {
            if (!object(event)) continue;
            if (event.type === "acp.update" && object(event.update)) {
                const update = event.update as Update, kind = update.sessionUpdate;
                if (kind === "agent_message_chunk") { if (object(update.content) && typeof update.content.text === "string") assistant += update.content.text; continue; }
                if (kind === "agent_thought_chunk") { omitted.thoughtChunks++; continue; }
                if (kind === "available_commands_update") { omitted.commandListings++; continue; }
                if (kind === "usage_update") { usage = { used: update.used, size: update.size }; continue; }
                if (kind === "tool_call" && typeof update.toolCallId === "string") {
                    if (!calls.has(update.toolCallId)) calls.set(update.toolCallId, { first: update, updates: [], done: false });
                    else calls.get(update.toolCallId)!.updates.push(update);
                    if (["completed", "failed"].includes(update.status)) finish(update.toolCallId);
                    continue;
                }
                if (kind === "tool_call_update" && typeof update.toolCallId === "string") {
                    const call = calls.get(update.toolCallId) ?? { first: { toolCallId: update.toolCallId }, updates: [], done: false };
                    calls.set(update.toolCallId, call); call.updates.push(update);
                    if (["completed", "failed"].includes(update.status)) finish(update.toolCallId);
                    continue;
                }
                if (kind === "plan" && Array.isArray(update.entries)) { flush(); push("ASSISTANT", `Plan: ${update.entries.map((e: any) => `${e?.content ?? "?"}${e?.status ? ` (${e.status})` : ""}`).join("; ")}`); continue; }
                omitted.otherUpdates++; continue;
            }
            if (event.type === "acp.permission") { flush(); push("PERMISSION", `${event.kind ?? "unknown"} tool${event.toolCallId ? ` ${event.toolCallId}` : ""}: ${event.policy ?? "unknown policy"}${object(event.outcome) && event.outcome.outcome ? ` → ${event.outcome.outcome}` : ""}`); continue; }
            if (event.type === "acp.response.error" && object(event.error)) { flush(); push("HARNESS", `Agent error: ${event.error.message ?? "unknown"}`); continue; }
            if (event.type === "acp.turn.stopped") { flush(); push("HARNESS", `Turn stopped: ${event.reason ?? "unknown"}${event.message ? ` — ${event.message}` : ""}`); continue; }
        }
        for (const id of calls.keys()) finish(id, true);
        flush();
        const tokens = result.usage ? [result.usage.inputTokens !== undefined ? `${result.usage.inputTokens} input` : null, result.usage.outputTokens !== undefined ? `${result.usage.outputTokens} output` : null].filter(Boolean).join(", ") : "";
        if (usage.used !== undefined || tokens) push("USAGE", [usage.used !== undefined ? `context ${usage.used}${usage.size ? ` of ${usage.size}` : ""}` : null, tokens ? `tokens ${tokens}` : null].filter(Boolean).join("; "));
        push("HARNESS", `Turn ended: ${result.status} (${result.stopReason ?? "no stop reason"})`);
    }
    const body = { schema_version: "wringer.loop-trajectory.v1" as const, planSha256: input.plan.plan_sha256, journalRevision: input.journalRevision, effectId: input.effect.id, role: input.effect.role, effectStatus: input.effect.status, agent: { name: agentName, version: agentVersion }, stopReason: result?.stopReason ?? null, requestSha256: input.effect.requestSha256, resultSha256: input.effect.resultSha256 ?? null, lines, omitted, limits: LIMITS };
    return { ...body, sha256: hashValue(body) };
}
/** The text form: one numbered line per item, the citation unit for proposals. */
export function renderLoopTrajectory(trajectory: LoopTrajectory): string {
    return [`# ${trajectory.role} ${trajectory.effectId}`, ...trajectory.lines.map(line => `${String(line.n).padStart(4)} [${line.kind}] ${line.text.replace(/\n/g, "\n       ")}`),
        ...(Object.values(trajectory.omitted).some(Boolean) ? [`     (omitted: ${Object.entries(trajectory.omitted).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ")})`] : [])].join("\n");
}

/** Every role session of one validated journal, or one named session. Reads only
 * records the validated history already checked; a request is re-verified by digest. */
export async function readLoopTrajectories(controller: string, options: { effectId?: string } = {}): Promise<LoopTrajectory[]> {
    const history = await readValidatedContainedState(controller, { allowStaleView: true });
    const effects = options.effectId ? history.state.effects.filter(effect => effect.id === options.effectId) : history.state.effects;
    if (options.effectId && !effects.length) throw new Error("No such role session in this journey");
    const names = [...new Set([...(history.plan.runtime.env ?? []), ...Object.values(history.plan.agents).flatMap(agent => agent?.env ?? [])])];
    const journalRevision = history.events.at(-1)!.sha256, trajectories: LoopTrajectory[] = [];
    for (const effect of effects) {
        const path = `.wringer/contained/effects/${effect.id}/request.json`, info = await lstat(await safePath(controller, path)).catch(() => null);
        const request = info?.isFile() && info.size <= 64 * 1024 * 1024 ? await readJson<RoleExecutionRequest>(controller, path) : null;
        if (request && hashValue(request) !== effect.requestSha256) throw new Error("A retained role request differs from its recorded digest");
        trajectories.push(projectLoopTrajectory({ plan: history.plan, journalRevision, effect, request, result: effect.result ?? null, credentialNames: names }));
    }
    return trajectories;
}
