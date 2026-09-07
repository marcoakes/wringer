import { canonicalJson, freezeData, hashValue } from "./canonical";
import { compileDeclaration, record, text, validateExecutionPlan } from "./compile";
import type { ExecutionPlan, PlanDeclaration } from "./types";

export interface PlanningRequest extends Omit<PlanDeclaration, "version" | "acceptance"> {
    schema_version: "wringer.planning-request.v1";
    request_sha256: string;
}
export interface PlanningAuthority {
    schema_version: "wringer.planning-authority.v1";
    actor: string;
    request_sha256: string;
    actions: ["plan"];
    granted_at: string;
    expires_at: string;
}
/** Reuse strict policy validation. Synthetic acceptance is never retained or authorized. */
export function compilePlanningRequest(value: unknown): PlanningRequest {
    const input = record(value, "planning request", ["version", "name", "intent", "repository", "runtime", "agents", "environment", "scope", "budget"]);
    const intent = text(input.intent, "planning intent");
    const validated = compileDeclaration({ ...input, acceptance: { criteria: [{ id: "planning-input", title: "Planning input, not acceptance", quote: intent, kind: "check", required: false }], checks: [], protected_paths: [] } });
    if (!validated.agents.planner || validated.budget.max_planner_turns < 1)
        throw new Error("Planning requires an explicit ACP planner and nonzero bounded planner allowance");
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, acceptance, ...data } = validated;
    const request = { schema_version: "wringer.planning-request.v1" as const, ...data };
    return freezeData({ ...request, request_sha256: hashValue(request) });
}
export function validatePlanningRequest(value: unknown): PlanningRequest {
    const input = record(value, "planning request", ["schema_version", "request_sha256", "name", "intent", "repository", "runtime", "agents", "environment", "scope", "budget"]);
    if (input.schema_version !== "wringer.planning-request.v1") throw new Error("Unsupported planning request version");
    const { schema_version, request_sha256, ...data } = input, expected = compilePlanningRequest({ version: 1, ...data });
    if (canonicalJson(expected) !== canonicalJson(value)) throw new Error("Planning request differs from its frozen digest");
    return expected;
}
export function planningRequestFromPlan(template: ExecutionPlan, intent: string): PlanningRequest {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, acceptance, ...data } = validateExecutionPlan(template);
    return compilePlanningRequest({ version: 1, ...data, intent });
}
export function validatePlanningAuthority(value: unknown, request: PlanningRequest, at = new Date()): PlanningAuthority {
    validatePlanningRequest(request);
    const a = record(value, "planning authority", ["schema_version", "actor", "request_sha256", "actions", "granted_at", "expires_at"]);
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()) || a.schema_version !== "wringer.planning-authority.v1" || a.request_sha256 !== request.request_sha256 || canonicalJson(a.actions) !== '["plan"]' || !Number.isFinite(Date.parse(a.granted_at)) || !Number.isFinite(Date.parse(a.expires_at)) || Date.parse(a.granted_at) > at.getTime() || Date.parse(a.expires_at) <= at.getTime() || Date.parse(a.expires_at) <= Date.parse(a.granted_at))
        throw new Error("Planning-only authority is invalid, expired or bound to another request");
    return freezeData({ schema_version: "wringer.planning-authority.v1", actor: text(a.actor, "planning actor"), request_sha256: request.request_sha256, actions: ["plan"], granted_at: a.granted_at, expires_at: a.expires_at });
}
export function createPlanningAuthority(request: PlanningRequest, options: { actor: string; expiresAt: string; at?: Date }): PlanningAuthority {
    const at = options.at ?? new Date();
    return validatePlanningAuthority({ schema_version: "wringer.planning-authority.v1", actor: options.actor, request_sha256: request.request_sha256, actions: ["plan"], granted_at: at.toISOString(), expires_at: options.expiresAt }, request, at);
}
export function compilePlanningProposal(request: PlanningRequest, acceptance: unknown): ExecutionPlan {
    const { schema_version, request_sha256, ...data } = validatePlanningRequest(request);
    return compileDeclaration({ version: 1, ...data, acceptance });
}
