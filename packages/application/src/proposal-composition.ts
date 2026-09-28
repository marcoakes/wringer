import { compileDeclaration, hashValue, planVersion, validateExecutionPlan, type AcceptanceCriterion, type ExecutionBudget, type ExecutionPlan } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
export interface AuthorableProposal {
    intent: string; title: string; criteria?: AcceptanceCriterion[];
    /** Select measured check definitions; remap requirement IDs only. A new
     * command/input needs a separately reviewed profile preparation. */
    checks?: { id: string; criteria: string[] }[];
    scope?: { writable: string[] }; ceilings?: Partial<ExecutionBudget>;
    assumptions?: string[]; questions?: string[];
}
export interface ProposalFieldError { field: string; code: string; message: string }
/** Pure data composition. No filesystem, command, allocation, authority, or
 * provider operation. Errors contain field names and safe fixed prose only. */
export function composeAuthorableProposal(profile: ExecutionPlan, input: unknown) {
    validateExecutionPlan(profile);
    const errors: ProposalFieldError[] = [], error = (field: string, message: string, code = "invalid-field") => errors.push({ field, code, message });
    const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    const clean = new Redactor(), text = (value: unknown, max: number) => typeof value === "string" && !!value.trim() && Buffer.byteLength(value) <= max && !/[\u0000]/.test(value) && clean.scrub(value) === value;
    const result = (plan: ExecutionPlan | null, assumptions: string[], questions: string[]) => ({ schema_version: "wringer.proposal-validation.v1", valid: errors.length === 0, approvalEligible: errors.length === 0 && !!plan && questions.length === 0, profileIdentity: profile.plan_sha256, plan: errors.length ? null : plan, canonicalIdentity: errors.length ? null : plan?.plan_sha256 ?? hashValue({ profileIdentity: profile.plan_sha256, proposal: input }), assumptions, questions, errors });
    if (!object(input) || Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) { error("proposal", "Use one bounded proposal object"); return result(null, [], []); }
    const allowed = ["intent", "title", "criteria", "checks", "scope", "ceilings", "assumptions", "questions"];
    for (const key of Object.keys(input)) if (!allowed.includes(key)) error(/^[A-Za-z][A-Za-z0-9_]{0,50}$/.test(key) ? key : "proposal", "Author only mutable proposal fields; runtime, source, roles and protected policy stay pinned", "pinned-field");
    if (!text(input.intent, 16384)) error("intent", "Retain the bounded original request without credentials");
    if (!text(input.title, 200)) error("title", "Supply a short title without credentials");
    const notes = (field: "assumptions" | "questions") => {
        const values = input[field] ?? [];
        if (!Array.isArray(values) || values.length > 32 || values.some(value => !text(value, 4096))) { error(field, "Use at most 32 bounded authored notes without credentials"); return []; }
        return values as string[];
    };
    const assumptions = notes("assumptions"), questions = notes("questions");
    const questionOnly = input.criteria === undefined && input.checks === undefined && questions.length > 0;
    if (!questionOnly && (!Array.isArray(input.criteria) || !input.criteria.length || input.criteria.length > 64)) error("criteria", "Propose actual requirement criteria quoting the original request, or ask a question before approval");
    if (!questionOnly && (!Array.isArray(input.checks) || !input.checks.length || input.checks.length > 64)) error("checks", "Select measured profile checks and map their requirement IDs");
    const writable = input.scope?.writable ?? profile.scope.writable;
    if (input.scope !== undefined && (!object(input.scope) || Object.keys(input.scope).some(key => key !== "writable")) || !Array.isArray(writable) || !writable.length || writable.length > 64 || writable.some(path => typeof path !== "string" || !profile.scope.writable.some(base => path === base || path.startsWith(base + "/")) || profile.acceptance.protected_paths.some(base => path === base || path.startsWith(base + "/")))) error("scope.writable", "Select the pinned write scope or a narrower path outside protected inputs", "scope-increase");
    const budget = { ...profile.budget };
    if (input.ceilings !== undefined && !object(input.ceilings)) error("ceilings", "Supply named finite ceilings at or below the profile");
    else for (const [key, value] of Object.entries(input.ceilings ?? {})) {
        if (!Object.hasOwn(budget, key) || !Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > budget[key as keyof ExecutionBudget]) error(`ceilings.${Object.hasOwn(budget, key) ? key : "unknown"}`, "A ceiling cannot exceed the pinned profile", "ceiling-increase");
        else budget[key as keyof ExecutionBudget] = Number(value);
    }
    if (questionOnly) return result(null, assumptions, questions);
    const checks = [];
    for (const [index, proposed] of (Array.isArray(input.checks) ? input.checks : []).entries()) {
        const pinned = profile.acceptance.checks.find(check => check.id === proposed?.id);
        if (!object(proposed) || Object.keys(proposed).some(key => !["id", "criteria"].includes(key)) || !pinned || !Array.isArray(proposed.criteria) || proposed.criteria.length > 64 || proposed.criteria.some((id: unknown) => !text(id, 64))) { error(`checks.${index}`, "Select a pinned check ID and criterion IDs. New commands or input files need reviewed acceptance preparation", "check-preparation-required"); continue; }
        if (pinned.evidence && hashValue([...pinned.criteria].sort()) !== hashValue([...proposed.criteria].sort())) { error(`checks.${index}.criteria`, "Keep the requirement IDs emitted by the protected assertion runner. Changed mappings need a new reviewed acceptance preparation", "assertion-mapping-pinned"); continue; }
        checks.push({ ...pinned, criteria: proposed.criteria });
    }
    for (const check of profile.acceptance.checks.filter(check => check.evidence)) if (!checks.some(selected => selected.id === check.id)) error("checks", "The profile's assertion evidence minimum cannot be removed", "evidence-downgrade");
    if (errors.length) return result(null, assumptions, questions);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...pinned } = profile;
    try {
        const plan = compileDeclaration({ version: planVersion(profile), ...pinned, name: input.title, intent: input.intent, scope: { writable }, budget, acceptance: { criteria: input.criteria, checks, protected_paths: profile.acceptance.protected_paths } });
        if (clean.scrub(JSON.stringify(plan)) !== JSON.stringify(plan)) { error("criteria", "Proposal content contains a detected credential"); return result(null, assumptions, questions); }
        return result(plan, assumptions, questions);
    } catch { error("criteria", "The composed acceptance contract is invalid. Check verbatim quotes, distinct IDs, check mappings and supported human display commands", "invalid-composed-plan"); return result(null, assumptions, questions); }
}
