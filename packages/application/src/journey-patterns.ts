import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { hashValue } from "@wringer/plan";
import { readValidatedContainedState, type ValidatedContainedState } from "@wringer/workflow";
import type { FailurePatternReport } from "./experiment-types";
import { validateFailurePatternReport } from "./experiments";
import { id, stamped } from "./experiment-store";

/** Pure projection of already-validated histories; exported for deterministic boundary tests. */
export function projectJourneyFailurePatterns(histories: ValidatedContainedState[], taskFamily: string): FailurePatternReport {
    id(taskFamily);
    if (!Array.isArray(histories) || histories.length < 1 || histories.length > 32 || new Set(histories.map(h => h.state.id)).size !== histories.length) throw new Error("Choose 1-32 distinct ordinary journey histories");
    const repository = histories[0]!.plan.repository.url, groups = new Map<string, FailurePatternReport["groups"][number]>();
    let eventCount = 0;
    for (const history of histories) {
        const { plan, environment, state, events } = history;
        if (history.authority.actor?.startsWith("Experiment:")) throw new Error("Experiment authority cannot enter ordinary-job development patterns, even outside its original research directory; use the experiment split-aware route");
        if (plan.repository.url !== repository || plan.playbook && plan.playbook.taskFamily !== taskFamily) throw new Error("Ordinary journey patterns cannot cross repository or selected playbook task-family boundaries");
        if (!events.length || (eventCount += events.length) > 32768) throw new Error("Selected journey histories exceed the bounded observation corpus");
        const comparisonKey = hashValue({ repository, taskFamily, source: plan.repository.commit, sourceTree: environment.source_tree, intent: plan.intent_sha256, acceptance: plan.acceptance_sha256, runtime: plan.runtime, agents: plan.agents, environment: plan.environment, tools: environment.tools.map(t => ({ name: t.name, version: t.version, status: t.observation?.status ?? null })), baseline: environment.baseline.map(b => ({ id: b.declaration.id, status: b.observation?.status ?? null })) });
        const seen = new Set<string>();
        const add = (kind: FailurePatternReport["groups"][number]["kind"], requirementIds: string[], facts: unknown) => {
            const ids = [...new Set(requirementIds)].sort(), observation = hashValue({ journeyId: state.id, comparisonKey, kind, requirementIds: ids, facts });
            if (seen.has(observation)) return;
            seen.add(observation);
            const key = hashValue({ comparisonKey, kind, requirementIds: ids }), row = groups.get(key) ?? { comparisonKey, kind, requirementIds: ids, count: 0, observations: [] };
            row.count++; row.observations.push(observation); groups.set(key, row);
            if (groups.size > 4096 || row.count > 4096) throw new Error("Selected failure observations exceed the bounded report; select fewer journeys");
        };
        for (const event of events) {
            // Iterate durable observations, not only the final green state. The
            // ordinary baseline's expected red is not a failed worker attempt.
            for (const phase of ["baseline", "candidate"] as const) {
                const verification = phase === "baseline" ? event.state.baseline : event.state.verification;
                if (!verification) continue;
                const unavailable = verification.checks.filter(c => c.status === "unavailable"), failed = phase === "candidate" ? verification.checks.filter(c => c.status === "failed") : [];
                const requirements = (checks: typeof verification.checks) => checks.flatMap(c => plan.acceptance.checks.find(r => r.id === c.id)?.criteria ?? []);
                const identity = { phase, candidateCommit: verification.candidateCommit, candidateTree: verification.candidateTree, runtimeId: verification.runtimeId };
                if (unavailable.length || verification.regressions?.some(c => c.status === "unavailable")) add("environment", requirements(unavailable), { ...identity, unavailable: [...unavailable, ...(verification.regressions ?? []).filter(c => c.status === "unavailable")].map(c => c.id).sort() });
                if (failed.length || phase === "candidate" && verification.regressions?.some(c => c.status === "failed")) add("product-check", requirements(failed), { ...identity, failed: [...failed, ...(verification.regressions ?? []).filter(c => c.status === "failed")].map(c => c.id).sort() });
            }
            const judge = event.state.judge;
            if (judge) {
                const outcomes = judge.criteria.filter(c => c.met !== true).map(c => ({ id: c.id, met: c.met })).sort((a, b) => a.id.localeCompare(b.id));
                if (outcomes.length) add("agent-finding", outcomes.map(c => c.id), { candidateTree: event.state.candidate?.tree ?? null, runtimeId: judge.runtimeId, outcomes });
            }
            for (const human of event.state.humanJudgements ?? []) if (human.verdict === "not_met") add("human-preference", [human.criterionId], { candidateTree: human.candidateTree, acceptanceSha256: human.acceptanceSha256, displaySha256: human.display.receiptSha256, verdict: human.verdict });
            for (const effect of event.state.effects) if (effect.status === "uncertain") add("environment", [], { effectId: effect.id, role: effect.role, status: "uncertain" });
            for (const attempt of event.state.verificationAttempts ?? []) if (attempt.status === "uncertain") add("environment", [], { attemptId: attempt.id, phase: attempt.phase, status: "uncertain" });
            if (event.type === "journey-stopped") {
                const reason = (event.details as { reason?: unknown })?.reason;
                // Keep broad execution/authority stops visible without copying
                // raw exceptions or asserting a causal diagnosis from wording.
                if (typeof reason === "string" && !["human-judgement", "human-said-no", "judge-unsettled", "repeated-candidate", "verification-unavailable", "baseline-unavailable", "effect-uncertain", "verification-uncertain"].includes(reason)) add("environment", [], { stage: event.state.stage, reasonSha256: hashValue(reason), effects: event.state.effects.length, candidateTree: event.state.candidate?.tree ?? null });
            }
        }
    }
    const sources = histories.map(h => h.events.at(-1)!.sha256).sort();
    return validateFailurePatternReport(stamped({ schema_version: "wringer.failure-pattern-report.v1" as const, repository, taskFamily, sources, groups: [...groups.values()].map(row => ({ ...row, observations: row.observations.sort() })).sort((a, b) => b.count - a.count || a.comparisonKey.localeCompare(b.comparisonKey) || a.kind.localeCompare(b.kind) || a.requirementIds.join(",").localeCompare(b.requirementIds.join(","))), limits: [
        "Explicitly selected ordinary job histories only. This is development evidence, never a held-out comparison or performance claim.",
        "Sources are exact retained journal revision digests. Observations contain only structured identities and outcomes; no prompts, output, human notes, actor names, timestamps or controller paths are copied.",
        "All observed candidate failures remain, including those repaired before final success. Expected baseline-red is not counted as a worker failure. Repeated snapshots of one observation are counted once.",
        "Agent findings include negative or not-established requirements; an unknown judgement is not an observed product defect. Environment groups include execution and authority stops, not a causal diagnosis.",
        "A missing human decision is not dislike. Only an explicit source-bound negative verdict enters human-preference groups; private review words do not enter the report.",
        "Task-family assignment and excluding copied research/held-out material remain operator responsibilities. Known experiment/proposal markers, controller ancestors and experiment authority are refused, including moved controllers; this is not a secrecy proof against the controller owner.",
        "Projection calls no provider, agent runtime, credential store, publication or approval action. Pinned-source Git reads may be required to validate selected playbook history; current credential values are not consulted.",
    ] }));
}

async function ordinaryPrivateState(input: string): Promise<string> {
    if (typeof input !== "string" || !input || input.length > 4096 || input.includes("\0")) throw new Error("Choose an explicit bounded ordinary controller path");
    const selected = resolve(input), stat = await lstat(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error("Ordinary history selection requires an operator-owned private 0700 controller directory, not a symlink");
    const actual = await realpath(selected);
    for (let path = actual; ; path = dirname(path)) {
        for (const name of ["registration.json", "collection.json", "proposal-request.json", "proposal-reservation.json", "experiment-purpose.json"]) {
            try { await lstat(join(path, name)); throw new Error("Research/experiment/proposal histories cannot enter ordinary-job development patterns; use the experiment split-aware route"); }
            catch (error: any) { if (error.code !== "ENOENT") throw error; }
        }
        if (path === dirname(path)) break;
    }
    return actual;
}

/** Explicit read-only operator selection; no discovery of unrelated jobs or research data. */
export async function failurePatternsFromJourneys(stateDirs: string[], taskFamily: string): Promise<FailurePatternReport> {
    id(taskFamily);
    if (!Array.isArray(stateDirs) || !stateDirs.length || stateDirs.length > 32) throw new Error("Choose 1-32 explicit ordinary controller paths");
    const paths = await Promise.all(stateDirs.map(ordinaryPrivateState));
    if (new Set(paths).size !== paths.length) throw new Error("The same controller cannot enter the corpus twice");
    const histories: ValidatedContainedState[] = [];
    for (const path of paths) histories.push(await readValidatedContainedState(path, { allowStaleView: true, credentialEnvironment: {} }));
    return projectJourneyFailurePatterns(histories, taskFamily);
}
