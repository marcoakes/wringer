/** Replicate sets: one approved plan run k times under one separate finite grant, every
 * attempt kept, and a divergence report that says where the attempts disagreed. It
 * says where, never why: the projection is pure, calls no model and makes no claim
 * about a cause or an improvement. A sibling of an experiment, not an arm of one. */
import { mkdir } from "node:fs/promises";
import { hashValue, validateExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { readValidatedContainedState, type ValidatedContainedState } from "@wringer/workflow";
import { Redactor } from "@wringer/engine";
import { atomicJson, boundedText, exclusiveJson, experimentLock, experimentPath, hash, id, integer, optionalJson, privateExperimentRoot, records, shape, stamped, verifyStamp } from "./experiment-store";
import { classifyJourneyEvent, type JourneyFailureKind } from "./journey-patterns";
import { runFreshJourney } from "./experiment-collect";

export const REPLICATE_ACTOR_PREFIX = "Replicate set:";
const TREE = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const FORBIDDEN_CREDENTIALS = /(?:GITHUB|GH_TOKEN|GITLAB|FORGE|PUBLICATION|DEPLOY|WRINGER_.*(?:TOKEN|KEY))/i;

export interface ReplicateSetInput { id: string; taskFamily: string; plan: ExecutionPlan; k: number; sourceTree: string; wallClockSeconds: number; }
export interface ReplicateSet extends ReplicateSetInput {
    schema_version: "wringer.replicate-set.v1";
    repository: string;
    limits: { replicates: number; maxRoleSessions: number; wallClockSeconds: number };
    prediction: null;
    dataScope: "this-repository-only";
    accounting: "all-planned-replicates-including-failures";
    stoppingRule: "fixed-k-no-extension";
    registeredAt: string;
    sha256: string;
}
export interface ReplicateSlot { id: string; index: number; planSha256: string; reservedSessions: number; }
export interface ReplicateGrant {
    schema_version: "wringer.replicate-grant.v1";
    replicateSetSha256: string;
    actor: string;
    grantedAt: string;
    expiresAt: string;
    limits: ReplicateSet["limits"];
    credentialNames: string[];
    dataScope: "this-repository-only";
    actions: ["collect-replicates"];
    noProductionPublication: true;
    sha256: string;
}
interface ReplicateCollection {
    schema_version: "wringer.replicate-collection.v1";
    replicateSetSha256: string;
    grant: ReplicateGrant;
    startedAt: string;
    deadline: string;
    evidenceKind: "live" | "deterministic-fixture";
    /** All k slots reserved before any source, runtime, credential or model activity; never released. */
    reservations: ReplicateSlot[];
    slots: { id: string; status: "reserved" | "dispatched" | "recorded"; dispatchedAt: string | null }[];
    sha256: string;
}
export interface ReplicateRecord {
    schema_version: "wringer.replicate.v1";
    replicateSetSha256: string;
    slot: ReplicateSlot;
    startedAt: string;
    finishedAt: string;
    evidenceKind: "live" | "deterministic-fixture";
    runtimeKind: string;
    outcome: "completed" | "human-hold" | "stopped" | "infrastructure-failed" | "uncertain" | "not-started";
    journeyRevision: string | null;
    candidateCommit: string | null;
    candidateTree: string | null;
    workerAttempts: number | null;
    roleSessions: number | null;
    checks: { id: string; status: "passed" | "failed" | "unavailable" | "not-run" }[];
    judge: { id: string; met: boolean | null }[];
    runtimeIds: string[];
    stopReason: string | null;
    sha256: string;
}
export interface ReplicateIdentity {
    schema_version: "wringer.replicate-identity.v1";
    replicateSetSha256: string;
    collectionSha256: string;
    reserved: number;
    recorded: number;
    notStarted: number;
    status: "consistent" | "violated";
    reasons: string[];
    sha256: string;
}
type Agreement = "agree" | "diverge" | "incomplete";
export interface DivergenceReport {
    schema_version: "wringer.divergence-report.v1";
    replicateSetSha256: string;
    planSha256: string;
    k: number;
    recorded: number;
    evidenceKinds: ("live" | "deterministic-fixture")[];
    replicates: { index: number; outcome: ReplicateRecord["outcome"]; candidateTree: string | null; workerAttempts: number | null; firstFailure: { attempt: number; kind: JourneyFailureKind; requirementIds: string[] } | null }[];
    checks: { id: string; outcomes: (ReplicateRecord["checks"][number]["status"] | null)[]; agreement: Agreement }[];
    judge: { id: string; outcomes: (boolean | null)[]; agreement: Agreement }[];
    loopDecisions: { sequences: (string[] | null)[]; agreement: Agreement };
    candidates: { distinctTrees: number; agreement: Agreement };
    firstFailure: { agreement: Agreement };
    diverging: string[];
    limits: string[];
    sha256: string;
}

export function createReplicateSet(input: ReplicateSetInput, registeredAt = new Date().toISOString()): ReplicateSet {
    shape(input, ["id", "taskFamily", "plan", "k", "sourceTree", "wallClockSeconds"], "Replicate set");
    id(input.id); id(input.taskFamily);
    const plan = validateExecutionPlan(input.plan, { credentialEnvironment: {} });
    integer(input.k, "Replicates", 2, 5); integer(input.wallClockSeconds, "Replicate wall clock", 1, 604800);
    if (!TREE.test(input.sourceTree)) throw new Error("A replicate set pins the observed Git source tree before any attempt");
    const names = [...new Set([...(plan.runtime.env ?? []), ...Object.values(plan.agents).flatMap(agent => agent?.env ?? [])])];
    if (names.some(name => FORBIDDEN_CREDENTIALS.test(name))) throw new Error("Replicate role environments cannot contain forge, controller or publication credential names");
    if (plan.playbook && plan.playbook.taskFamily !== input.taskFamily) throw new Error("A selected playbook must belong to the replicate set's task family");
    if (!Number.isFinite(Date.parse(registeredAt))) throw new Error("Replicate registration time is invalid");
    return stamped({ schema_version: "wringer.replicate-set.v1" as const, ...structuredClone(input), plan, repository: plan.repository.url, limits: { replicates: input.k, maxRoleSessions: input.k * plan.budget.max_sessions, wallClockSeconds: input.wallClockSeconds }, prediction: null, dataScope: "this-repository-only" as const, accounting: "all-planned-replicates-including-failures" as const, stoppingRule: "fixed-k-no-extension" as const, registeredAt });
}
export function validateReplicateSet(value: ReplicateSet): ReplicateSet {
    verifyStamp(value);
    if (value.schema_version !== "wringer.replicate-set.v1") throw new Error("Unsupported replicate set version");
    const { schema_version, sha256, repository, limits, prediction, dataScope, accounting, stoppingRule, registeredAt, ...input } = value;
    if (createReplicateSet(input, registeredAt).sha256 !== sha256) throw new Error("Replicate set is not canonical");
    return value;
}
export function replicateSchedule(set: ReplicateSet): ReplicateSlot[] {
    return Array.from({ length: set.k }, (_, i) => ({ id: `replicate-${String(i + 1).padStart(2, "0")}`, index: i + 1, planSha256: set.plan.plan_sha256, reservedSessions: set.plan.budget.max_sessions }));
}
export async function registerReplicateSet(root: string, input: ReplicateSetInput): Promise<ReplicateSet> {
    return experimentLock(root, async () => {
        for (const name of ["replicate-set.json", "registration.json", "replicate-collection.json", "collection.json"]) if (await optionalJson(root, name)) throw new Error("Use a fresh private directory: a replicate set is registered before any attempt, never beside another study");
        if ((await records(root, "replicates", 8)).length) throw new Error("Use a fresh private directory: replicate records predate this registration");
        const set = createReplicateSet(input);
        await exclusiveJson(root, "replicate-set.json", set); return set;
    });
}
export function createReplicateGrant(set: ReplicateSet, options: { actor: string; expiresAt: string; credentialNames: string[]; at?: Date }): ReplicateGrant {
    validateReplicateSet(set); boundedText(options.actor, "Replicate authorising actor", 200);
    const at = options.at ?? new Date();
    if (!Number.isFinite(at.getTime()) || !Number.isFinite(Date.parse(options.expiresAt)) || Date.parse(options.expiresAt) <= at.getTime()) throw new Error("A replicate allowance must have a finite future expiry");
    const expected = [...new Set(set.plan.runtime.env ?? [])].sort();
    if (!Array.isArray(options.credentialNames) || hashValue([...options.credentialNames].sort()) !== hashValue(expected)) throw new Error("The replicate grant must name exactly its pinned runtime credential variables; no values are read");
    return stamped({ schema_version: "wringer.replicate-grant.v1" as const, replicateSetSha256: set.sha256, actor: options.actor, grantedAt: at.toISOString(), expiresAt: options.expiresAt, limits: set.limits, credentialNames: expected, dataScope: "this-repository-only" as const, actions: ["collect-replicates"] as ["collect-replicates"], noProductionPublication: true as const });
}
export function validateReplicateGrant(grant: ReplicateGrant, set: ReplicateSet, at = new Date()): ReplicateGrant {
    verifyStamp(grant);
    if (grant.schema_version !== "wringer.replicate-grant.v1" || grant.replicateSetSha256 !== set.sha256 || grant.noProductionPublication !== true || hashValue(grant.actions) !== hashValue(["collect-replicates"]) || hashValue(grant.limits) !== hashValue(set.limits)) throw new Error("This is not the exact separate allowance for this replicate set");
    if (createReplicateGrant(set, { actor: grant.actor, expiresAt: grant.expiresAt, credentialNames: grant.credentialNames, at: new Date(grant.grantedAt) }).sha256 !== grant.sha256 || Date.parse(grant.grantedAt) > at.getTime() || Date.parse(grant.expiresAt) <= at.getTime()) throw new Error("The replicate allowance is altered, future-dated or expired");
    return grant;
}
export async function readReplicateSet(root: string) {
    await privateExperimentRoot(root);
    const set = await optionalJson<ReplicateSet>(root, "replicate-set.json");
    if (!set) throw new Error("No replicate set is registered here");
    validateReplicateSet(set);
    const collection = await optionalJson<ReplicateCollection>(root, "replicate-collection.json"), replicates = await records<ReplicateRecord>(root, "replicates", 8), identity = await optionalJson<ReplicateIdentity>(root, "replicate-identity.json");
    if (collection) verifyStamp(collection);
    const schedule = replicateSchedule(set);
    for (const record of replicates) {
        const slot = schedule.find(s => s.id === record.slot?.id);
        if (record.schema_version !== "wringer.replicate.v1" || record.replicateSetSha256 !== set.sha256 || !slot || hashValue(slot) !== hashValue(record.slot) || !["completed", "human-hold", "stopped", "infrastructure-failed", "uncertain", "not-started"].includes(record.outcome)) throw new Error("A replicate record does not belong to this registered set");
    }
    if (identity) verifyStamp(identity);
    return { set, collection, replicates, identity };
}

/** The budget identity, asserted after collection: every reservation is one record,
 * nothing appears twice, nothing appears without its durable dispatch marker. A
 * violation is recorded and refused, never repaired. */
export function replicateIdentity(set: ReplicateSet, collection: ReplicateCollection, replicates: ReplicateRecord[]): ReplicateIdentity {
    const reasons: string[] = [], ids = replicates.map(r => r.slot.id), reserved = collection.reservations.map(s => s.id);
    if (hashValue(collection.reservations) !== hashValue(replicateSchedule(set))) reasons.push("Reservations differ from the registered schedule");
    for (const slot of reserved) if (!ids.includes(slot)) reasons.push(`${slot}: reserved but never recorded`);
    for (const slot of ids) if (!reserved.includes(slot)) reasons.push(`${slot}: recorded without a reservation`);
    for (const slot of new Set(ids)) if (ids.filter(i => i === slot).length > 1) reasons.push(`${slot}: recorded twice`);
    for (const record of replicates) {
        const row = collection.slots.find(s => s.id === record.slot.id);
        if (!row || row.dispatchedAt === null || row.status !== "recorded") reasons.push(`${record.slot.id}: recorded without a durable dispatch marker`);
    }
    return stamped({ schema_version: "wringer.replicate-identity.v1" as const, replicateSetSha256: set.sha256, collectionSha256: collection.sha256, reserved: reserved.length, recorded: replicates.length, notStarted: replicates.filter(r => r.outcome === "not-started").length, status: reasons.length ? "violated" as const : "consistent" as const, reasons });
}

function terminalRecord(set: ReplicateSet, slot: ReplicateSlot, startedAt: string, outcome: ReplicateRecord["outcome"], reason: string, fixture: boolean): ReplicateRecord {
    return stamped({ schema_version: "wringer.replicate.v1" as const, replicateSetSha256: set.sha256, slot, startedAt, finishedAt: new Date().toISOString(), evidenceKind: fixture ? "deterministic-fixture" as const : "live" as const, runtimeKind: set.plan.runtime.kind, outcome, journeyRevision: null, candidateCommit: null, candidateTree: null, workerAttempts: null, roleSessions: null, checks: [], judge: [], runtimeIds: [], stopReason: new Redactor().scrub(reason).slice(0, 3500) || "No observation retained" });
}
function measuredRecord(set: ReplicateSet, slot: ReplicateSlot, startedAt: string, validated: ValidatedContainedState, fixture: boolean): ReplicateRecord {
    if (validated.plan.plan_sha256 !== set.plan.plan_sha256) throw new Error("A replicate journey ran a different plan");
    if (!validated.authority.actor.startsWith(REPLICATE_ACTOR_PREFIX)) throw new Error("A replicate journey ran under another authority");
    const result = validated.result, effects = validated.state.effects;
    const runtimeIds = [...new Set([...validated.state.runtimeIds, ...effects.flatMap(e => e.result?.provenance.runtimeId ? [e.result.provenance.runtimeId] : [])])];
    return stamped({ schema_version: "wringer.replicate.v1" as const, replicateSetSha256: set.sha256, slot, startedAt, finishedAt: new Date().toISOString(), evidenceKind: fixture ? "deterministic-fixture" as const : "live" as const, runtimeKind: set.plan.runtime.kind,
        outcome: result.status === "review-ready" ? "completed" as const : result.status === "human-hold" ? "human-hold" as const : "stopped" as const,
        journeyRevision: validated.events.at(-1)?.sha256 ?? null, candidateCommit: result.candidate?.source.commit ?? null, candidateTree: result.candidate?.tree ?? null,
        workerAttempts: effects.filter(e => e.role === "worker").length, roleSessions: effects.length,
        checks: set.plan.acceptance.checks.map(check => ({ id: check.id, status: (result.verification?.checks.find(c => c.id === check.id)?.status ?? "not-run") as ReplicateRecord["checks"][number]["status"] })),
        judge: set.plan.acceptance.criteria.filter(c => c.kind === "check").map(c => ({ id: c.id, met: result.judge?.criteria.find(row => row.id === c.id)?.met ?? null })),
        runtimeIds, stopReason: result.stop?.reason ?? null });
}
export interface ReplicateCollectionOptions {
    signal?: AbortSignal;
    /** Engineering tests only; its presence labels every record a fixture. No CLI option exposes it. */
    fixture?: { run: (plan: ExecutionPlan, state: string, slot: ReplicateSlot, signal: AbortSignal) => Promise<{ validated: ValidatedContainedState }> };
}
/** Reserve all k slots, then run each once. An interrupted slot is reconciled from what
 * was retained, never replayed; the set then stops rather than extending. */
export async function collectReplicateSet(root: string, grant: ReplicateGrant, options: ReplicateCollectionOptions = {}) {
    return experimentLock(root, async () => {
        const current = await readReplicateSet(root), set = current.set, fixture = !!options.fixture;
        validateReplicateGrant(grant, set);
        let collection = current.collection;
        if (collection && collection.evidenceKind !== (fixture ? "deterministic-fixture" : "live")) throw new Error("Fixture and live collection cannot change on resume; a fixture is never relabelled as live");
        if (!collection) {
            if (current.replicates.length) throw new Error("Replicate records predate the collection grant");
            const startedAt = new Date().toISOString(), schedule = replicateSchedule(set);
            const deadline = new Date(Math.min(Date.parse(grant.expiresAt), Date.parse(startedAt) + set.limits.wallClockSeconds * 1000)).toISOString();
            collection = stamped({ schema_version: "wringer.replicate-collection.v1" as const, replicateSetSha256: set.sha256, grant, startedAt, deadline, evidenceKind: fixture ? "deterministic-fixture" as const : "live" as const, reservations: schedule, slots: schedule.map(s => ({ id: s.id, status: "reserved" as const, dispatchedAt: null })) });
            await exclusiveJson(root, "replicate-collection.json", collection);
        } else if (collection.replicateSetSha256 !== set.sha256 || collection.grant.sha256 !== grant.sha256 || hashValue(collection.reservations) !== hashValue(replicateSchedule(set)) || Date.parse(collection.startedAt) < Date.parse(set.registeredAt)) throw new Error("Replicate reservations are corrupt or a new allowance tried to replace spent authority");
        const save = async () => { const { sha256, ...data } = collection!; collection = stamped(data); await atomicJson(root, "replicate-collection.json", collection); };
        const abort = new AbortController(), timer = setTimeout(() => abort.abort("replicate deadline"), Math.max(1, Date.parse(collection.deadline) - Date.now()));
        const onAbort = () => abort.abort(options.signal?.reason); options.signal?.addEventListener("abort", onAbort, { once: true }); if (options.signal?.aborted) onAbort();
        let halt: string | null = null;
        try {
            for (const slot of collection.reservations) {
                const row = collection.slots.find(s => s.id === slot.id)!;
                const prior = (await readReplicateSet(root)).replicates.find(r => r.slot.id === slot.id);
                if (prior) {
                    if (row.status === "reserved") throw new Error("A replicate appeared without a prior durable dispatch reservation");
                    if (row.status !== "recorded") { row.status = "recorded"; await save(); }
                    continue;
                }
                if (row.status === "recorded") throw new Error("A recorded replicate is missing; the denominator cannot be regenerated");
                const state = await experimentPath(root, `journeys/${slot.id}`), startedAt = row.dispatchedAt ?? new Date().toISOString();
                let record: ReplicateRecord;
                if (row.status === "dispatched") {
                    // Reconcile retained effects only; an uncertain session is never replayed.
                    try { record = measuredRecord(set, slot, startedAt, await readValidatedContainedState(state), fixture); }
                    catch { record = terminalRecord(set, slot, startedAt, "uncertain", "Interrupted replicate has no complete validated observation; its reserved sessions remain charged and nothing was replayed", fixture); }
                    halt = "An interrupted replicate was reconciled. The set stops instead of silently extending or replaying uncertain spend.";
                } else {
                    row.status = "dispatched"; row.dispatchedAt = startedAt; await save();
                    if (halt || abort.signal.aborted || Date.now() >= Date.parse(collection.deadline)) record = terminalRecord(set, slot, startedAt, "not-started", halt ?? "The replicate deadline or operator cancellation stopped collection; this planned replicate remains in the denominator", fixture);
                    else {
                        validateReplicateGrant(grant, set);
                        await mkdir(state, { mode: 0o700, recursive: true }); await experimentPath(root, `journeys/${slot.id}`);
                        try {
                            const measured = options.fixture
                                ? await options.fixture.run(set.plan, state, slot, abort.signal)
                                : await runFreshJourney(set.plan, state, { actor: `${REPLICATE_ACTOR_PREFIX} ${grant.actor}`, expiresAt: collection.deadline }, abort.signal, set.sourceTree);
                            record = measuredRecord(set, slot, startedAt, measured.validated, fixture);
                        } catch (error) {
                            record = terminalRecord(set, slot, startedAt, "infrastructure-failed", (error as Error).message, fixture);
                            halt = "Collection stopped at unavailable or invalid infrastructure; the remaining planned replicates are retained as not-started.";
                        }
                    }
                }
                const already = await optionalJson<ReplicateRecord>(root, `replicates/${slot.id}.json`);
                if (!already) await exclusiveJson(root, `replicates/${slot.id}.json`, record);
                else if (already.sha256 !== record.sha256) throw new Error("A retained replicate cannot be replaced by another measurement");
                row.status = "recorded"; await save();
            }
        } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", onAbort); }
        const after = await readReplicateSet(root), identity = replicateIdentity(set, collection, after.replicates);
        if (!after.identity) await exclusiveJson(root, "replicate-identity.json", identity);
        else if (after.identity.sha256 !== identity.sha256) throw new Error("The retained budget identity differs from the records; nothing was repaired");
        if (identity.status === "violated") throw new Error(`Replicate budget identity violated: ${identity.reasons.join("; ")}`);
        const report = projectDivergence(set, await histories(root, after.replicates));
        const retained = await optionalJson<DivergenceReport>(root, "divergence-report.json");
        if (!retained) await exclusiveJson(root, "divergence-report.json", report);
        else if (retained.sha256 !== report.sha256) throw new Error("The retained divergence report differs from the records");
        return { ...await readReplicateSet(root), divergence: report };
    });
}
async function histories(root: string, replicates: ReplicateRecord[]) {
    const rows: { replicate: ReplicateRecord; history: ValidatedContainedState | null }[] = [];
    for (const replicate of [...replicates].sort((a, b) => a.slot.index - b.slot.index)) {
        let history: ValidatedContainedState | null = null;
        if (replicate.journeyRevision) {
            history = await readValidatedContainedState(await experimentPath(root, `journeys/${replicate.slot.id}`), { allowStaleView: true });
            if (history.events.at(-1)?.sha256 !== replicate.journeyRevision) throw new Error(`${replicate.slot.id}: its journal changed after it was recorded`);
        }
        rows.push({ replicate, history });
    }
    return rows;
}
const agreement = <T>(values: (T | null)[]): Agreement => {
    const present = values.filter(v => v !== null).map(v => JSON.stringify(v));
    if (new Set(present).size > 1) return "diverge";
    return present.length === values.length ? "agree" : "incomplete";
};
/** Pure. Where the attempts disagreed, from records and validated journals only. */
export function projectDivergence(set: ReplicateSet, rows: { replicate: ReplicateRecord; history: ValidatedContainedState | null }[]): DivergenceReport {
    validateReplicateSet(set);
    const ordered = replicateSchedule(set).map(slot => rows.find(r => r.replicate.slot.id === slot.id) ?? null);
    const replicates = ordered.flatMap(row => {
        if (!row) return [];
        const { replicate, history } = row;
        if (history && (history.plan.plan_sha256 !== set.plan.plan_sha256 || history.events.at(-1)?.sha256 !== replicate.journeyRevision)) throw new Error(`${replicate.slot.id}: its history is not the recorded journal`);
        let firstFailure: DivergenceReport["replicates"][number]["firstFailure"] = null, attempt = 0;
        for (const event of history?.events ?? []) {
            attempt = event.state.effects.filter(e => e.role === "worker").length;
            const found = classifyJourneyEvent(history!.plan, event)[0];
            if (found) { firstFailure = { attempt, kind: found.kind, requirementIds: [...new Set(found.requirementIds)].sort() }; break; }
        }
        if (!firstFailure && ["infrastructure-failed", "uncertain"].includes(replicate.outcome)) firstFailure = { attempt: 0, kind: "environment", requirementIds: [] };
        return [{ index: replicate.slot.index, outcome: replicate.outcome, candidateTree: replicate.candidateTree, workerAttempts: replicate.workerAttempts, firstFailure }];
    });
    const by = (index: number) => ordered[index - 1]?.replicate ?? null, indices = replicateSchedule(set).map(s => s.index);
    const checks = set.plan.acceptance.checks.map(check => { const outcomes = indices.map(i => by(i)?.checks.find(c => c.id === check.id)?.status ?? null); return { id: check.id, outcomes, agreement: agreement(outcomes) }; });
    const judge = set.plan.acceptance.criteria.filter(c => c.kind === "check").map(c => { const outcomes = indices.map(i => { const row = by(i)?.judge.find(j => j.id === c.id); return row ? row.met : null; }); return { id: c.id, outcomes, agreement: agreement(outcomes) }; });
    const sequences = indices.map(i => { const history = ordered[i - 1]?.history; return history ? history.events.filter(e => e.type === "loop-decision-recorded").map(e => String((e.details as any)?.loopDecision?.action ?? "unknown")) : null; });
    const trees = indices.map(i => by(i)?.candidateTree ?? null), first = indices.map(i => { const row = replicates.find(r => r.index === i); return row ? row.firstFailure && { attempt: row.firstFailure.attempt, kind: row.firstFailure.kind, requirementIds: row.firstFailure.requirementIds } : null; });
    const firstAgreement = replicates.length === set.k ? agreement(first.map(f => f ?? { none: true })) : "incomplete";
    const loopAgreement = agreement(sequences), treeAgreement = agreement(trees);
    const diverging = [...checks.filter(c => c.agreement === "diverge").map(c => `check ${c.id}`), ...judge.filter(j => j.agreement === "diverge").map(j => `judge ${j.id}`), ...(loopAgreement === "diverge" ? ["loop decisions"] : []), ...(treeAgreement === "diverge" ? ["candidate trees"] : []), ...(firstAgreement === "diverge" ? ["first failure"] : [])];
    return stamped({ schema_version: "wringer.divergence-report.v1" as const, replicateSetSha256: set.sha256, planSha256: set.plan.plan_sha256, k: set.k, recorded: replicates.length, evidenceKinds: [...new Set(ordered.flatMap(r => r ? [r.replicate.evidenceKind] : []))].sort(),
        replicates, checks, judge, loopDecisions: { sequences, agreement: loopAgreement }, candidates: { distinctTrees: new Set(trees.filter(Boolean)).size, agreement: treeAgreement }, firstFailure: { agreement: firstAgreement }, diverging,
        limits: ["Where the attempts disagreed, from retained records and validated journals only. No model was consulted and no cause is claimed.", "Candidate trees can differ while every check agrees; that is a different change, not a different result.", "Fixture replicates test the mechanism; only live replicates describe an agent's variance, and k of at most 5 is a small sample."] });
}
export async function replicateDivergence(root: string): Promise<DivergenceReport> {
    const current = await readReplicateSet(root);
    return projectDivergence(current.set, await histories(root, current.replicates));
}
export function validateDivergenceReport(report: DivergenceReport): DivergenceReport {
    verifyStamp(report); hash(report.replicateSetSha256); hash(report.planSha256);
    if (report.schema_version !== "wringer.divergence-report.v1") throw new Error("Unsupported divergence report");
    return report;
}
