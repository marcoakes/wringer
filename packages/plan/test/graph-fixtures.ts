/** Shared contained-graph declarations for compiler and kernel tests. */
import { compileDeclaration, compileExecutionPlan } from "../src";

const template = await Bun.file(new URL("../examples/contained.yaml", import.meta.url)).text();
function leaf() {
    const parsed = compileExecutionPlan(template, { format: "yaml" });
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = parsed;
    return compileDeclaration({ version: 3, ...raw, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === "check") } });
}
export function graphFixture() {
    const plan = leaf();
    return { version: 1, id: "serial-repair", repository: plan.repository, entry: "scope", required: ["build", "verify", "review", "ship"],
        budget: { maxRoleSessions: plan.budget.max_sessions, maxVerificationAttempts: plan.budget.max_sessions + 2, wallClockSeconds: 600 },
        nodes: { scope: { kind: "human-hold", input: "root", prompt: "Review this exact scope before work.", then: "build" },
            build: { kind: "loop", input: "root", plan, then: "verify" },
            verify: { kind: "check", input: "build", then: "route" },
            route: { kind: "router", input: "verify", routes: [{ outcome: "passed", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "verify", prompt: "Inspect the exact candidate and evidence.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: "https://example.test/repository.git", sourceBranch: "wringer/serial-repair", targetBranch: "main" }, then: "done" } } };
}
export function parallelFixture() {
    const plan = leaf(), sessions = plan.budget.max_sessions;
    return { version: 2, id: "parallel-repair", repository: plan.repository, entry: "split", required: ["build-a", "build-b", "merge", "review", "ship"], parallelism: 2,
        budget: { maxRoleSessions: 2 * sessions, maxVerificationAttempts: 2 * (sessions + 1) + 2, wallClockSeconds: 600 },
        nodes: { split: { kind: "fork", input: "root", branches: ["build-a", "build-b"], join: "merge" },
            "build-a": { kind: "loop", input: "split", plan, then: "merge" },
            "build-b": { kind: "loop", input: "split", plan, then: "merge" },
            merge: { kind: "join", fork: "split", then: "review" },
            review: { kind: "human-hold", input: "merge", prompt: "Inspect the integrated candidate.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: "https://example.test/repository.git", sourceBranch: "wringer/parallel", targetBranch: "main" }, then: "done" } } };
}
/** A prosecutor may write only its one challenge file. */
export function prosecutorPlan(commit?: string) {
    const parsed = compileExecutionPlan(template, { format: "yaml" });
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = parsed;
    return compileDeclaration({ version: 3, ...raw, repository: { ...raw.repository, commit: commit ?? raw.repository.commit }, scope: { ...raw.scope, writable: ["wringer/challenges.json"] }, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === "check") } });
}
export function tournamentFixture() {
    const plan = leaf(), sessions = plan.budget.max_sessions;
    return { version: 3, id: "tournament-repair", repository: plan.repository, entry: "split", required: ["pick", "review", "ship"], parallelism: 3,
        budget: { maxRoleSessions: 3 * sessions + 1, maxVerificationAttempts: 3 * (sessions + 1) + 1 + 2 * 3, wallClockSeconds: 600 },
        nodes: { split: { kind: "fork", input: "root", branches: ["build-a", "build-b", "build-c"], join: "pick" },
            "build-a": { kind: "loop", input: "split", plan, then: "pick" },
            "build-b": { kind: "loop", input: "split", plan, then: "pick" },
            "build-c": { kind: "loop", input: "split", plan, then: "pick" },
            pick: { kind: "tournament", fork: "split", prosecutor: { plan: prosecutorPlan(), maxChallenges: 4 }, controls: [{ id: "reference", commit: "a".repeat(40) }],
                evaluator: [{ id: "hidden", argv: ["sh", "evaluator/hidden.sh"], cwd: ".", timeout_seconds: 30, files: [{ path: "evaluator/hidden.sh", content: "exit 0\n" }] }], tie: "tree-order", then: "review" },
            review: { kind: "human-hold", input: "pick", prompt: "Inspect the selected candidate and the tournament record.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: "https://example.test/repository.git", sourceBranch: "wringer/tournament", targetBranch: "main" }, then: "done" } } };
}
export function delegateFixture() {
    const plan = leaf();
    return { version: 4, id: "external-repair", repository: plan.repository, entry: "ask", required: ["ask", "verify", "review", "ship"], parallelism: 1,
        budget: { maxRoleSessions: 1, maxVerificationAttempts: 1, wallClockSeconds: 600 },
        nodes: { ask: { kind: "delegate", input: "root", peer: { url: "https://agents.example.test/a2a", cardSha256: "c".repeat(64), skill: "repair" }, instruction: "Repair the total.", verify: plan, timeoutSeconds: 600, then: "verify" },
            verify: { kind: "check", input: "ask", then: "route" },
            route: { kind: "router", input: "verify", routes: [{ outcome: "passed", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "verify", prompt: "Inspect the externally returned candidate.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: "https://example.test/repository.git", sourceBranch: "wringer/external", targetBranch: "main" }, then: "done" } } };
}
