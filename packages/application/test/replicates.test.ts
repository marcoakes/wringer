/** Replicate sets: the same approved plan k times under one separate grant, every
 * attempt kept, and a pure report of where the attempts disagreed. Real journals and
 * validation; scripted roles and checks (fixture-labelled); no model. */
import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashValue } from "@wringer/plan";
import { readValidatedContainedState } from "@wringer/workflow";
import { assertResearchPublication } from "../../delivery/src/research-purpose";
import { openReader } from "../../records/src/read";
import { collectReplicateSet, createReplicateGrant, projectDivergence, readReplicateSet, registerReplicateSet, replicateDivergence, replicateIdentity, replicateSchedule, REPLICATE_ACTOR_PREFIX, type ReplicateSlot } from "../src/replicates";
import { projectJourneyFailurePatterns, failurePatternsFromJourneys } from "../src/journey-patterns";
import { readExperimentJson, stamped } from "../src/experiment-store";
import { fixturePlan, runFixtureJourney } from "./support/journey-fixture";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const reader = await openReader(new URL("../../../schema", import.meta.url).pathname);
async function privateRoot() { const root = await mkdtemp(join(tmpdir(), "wringer-replicates-")); roots.push(root); await chmod(root, 0o700); return root; }
const actor = `${REPLICATE_ACTOR_PREFIX} Fixture operator`;
async function registered(k = 3) {
    const root = await privateRoot(), plan = fixturePlan(2);
    const set = await registerReplicateSet(root, { id: "value-replicates", taskFamily: "reports", plan, k, sourceTree: "a".repeat(40), wallClockSeconds: 600 });
    const grant = createReplicateGrant(set, { actor: "Fixture operator", expiresAt: new Date(Date.now() + 600000).toISOString(), credentialNames: plan.runtime.env ?? [] });
    return { root, plan, set, grant };
}
/** Failures before passing, by replicate index; 2 failures exhaust two worker turns. */
const runner = (failures: number[], calls: number[] = []) => ({ run: async (plan: any, state: string, slot: ReplicateSlot) => { calls.push(slot.index); return runFixtureJourney(plan, state, { actor, failures: failures[slot.index - 1]! }); } });

test("k attempts of one plan, all reserved first, every outcome kept, and where they disagreed", async () => {
    const { root, set, grant } = await registered(3), calls: number[] = [];
    const reservedFirst: boolean[] = [];
    const collected = await collectReplicateSet(root, grant, { fixture: { run: async (plan, state, slot) => {
        const ledger = await readExperimentJson<any>(join(root, "replicate-collection.json"));
        reservedFirst.push(ledger.reservations.length === 3 && ledger.slots.find((s: any) => s.id === slot.id).status === "dispatched");
        return runner([0, 1, 2], calls).run(plan, state, slot);
    } } });
    expect(reservedFirst).toEqual([true, true, true]); expect(calls).toEqual([1, 2, 3]);
    expect(collected.replicates.map(r => [r.slot.index, r.outcome, r.workerAttempts, r.checks[0]!.status])).toEqual([[1, "completed", 1, "passed"], [2, "completed", 2, "passed"], [3, "stopped", 2, "failed"]]);
    expect(collected.replicates.every(r => r.evidenceKind === "deterministic-fixture")).toBe(true);
    expect(collected.identity).toMatchObject({ status: "consistent", reserved: 3, recorded: 3, notStarted: 0 });
    const report = collected.divergence;
    expect(report.checks).toEqual([{ id: "total-check", outcomes: ["passed", "passed", "failed"], agreement: "diverge" }]);
    expect(report.replicates.map(r => r.firstFailure)).toEqual([null, { attempt: 1, kind: "product-check", requirementIds: ["total"] }, { attempt: 1, kind: "product-check", requirementIds: ["total"] }]);
    expect(report.firstFailure.agreement).toBe("diverge"); expect(report.candidates.agreement).toBe("diverge");
    // A version-1 plan records no loop decisions, so those agree (all empty).
    expect(report.loopDecisions).toEqual({ sequences: [[], [], []], agreement: "agree" });
    expect(report.diverging).toEqual(["check total-check", "candidate trees", "first failure"]);
    // The retained report is exactly the pure projection of the retained records.
    expect(await replicateDivergence(root)).toEqual(report);
    expect(await readExperimentJson<typeof report>(join(root, "divergence-report.json"))).toEqual(report);
    for (const [record, name] of [[collected.set, "replicate-set-v1"], [grant, "replicate-grant-v1"], [collected.collection, "replicate-collection-v1"], [collected.replicates[0], "replicate-v1"], [collected.identity, "replicate-identity-v1"], [report, "divergence-report-v1"]] as const)
        expect((await reader.validate(record, `${name}.schema.json`)).ok).toBe(true);
    // Resume runs nothing again.
    let more = 0; await collectReplicateSet(root, grant, { fixture: { run: async () => { more++; throw new Error("must not replay"); } } }); expect(more).toBe(0);
});

test("identical attempts agree everywhere; the projection is pure and calls nothing", async () => {
    const { root, grant, set } = await registered(3), calls: number[] = [];
    const collected = await collectReplicateSet(root, grant, { fixture: runner([0, 0, 0], calls) });
    expect(calls).toEqual([1, 2, 3]);
    expect(collected.divergence.diverging).toEqual([]);
    expect(collected.divergence.checks[0]!.agreement).toBe("agree"); expect(collected.divergence.firstFailure.agreement).toBe("agree");
    const rows = await Promise.all(collected.replicates.map(async replicate => ({ replicate, history: await readValidatedContainedState(join(root, "journeys", replicate.slot.id)) })));
    expect(projectDivergence(set, rows)).toEqual(collected.divergence); expect(calls).toEqual([1, 2, 3]);
});

test("measured-loop decisions are compared as sequences across attempts", async () => {
    const { root, grant, set } = await registered(3);
    const collected = await collectReplicateSet(root, grant, { fixture: runner([0, 0, 0]) });
    const rows = await Promise.all(collected.replicates.map(async replicate => {
        const history = await readValidatedContainedState(join(root, "journeys", replicate.slot.id)), last = history.events.at(-1)!;
        const decisions = (replicate.slot.index === 3 ? ["continue", "stop"] : ["continue"]).map(action => ({ ...last, type: "loop-decision-recorded", details: { loopDecision: { action } } }));
        return { replicate, history: { ...history, events: [...history.events.slice(0, -1), ...decisions, last] } as any };
    }));
    const report = projectDivergence(set, rows);
    expect(report.loopDecisions).toEqual({ sequences: [["continue"], ["continue"], ["continue", "stop"]], agreement: "diverge" });
    expect(report.diverging).toEqual(["loop decisions"]);
    // A history that is not the recorded journal is refused.
    const events = rows[0]!.history.events;
    expect(() => projectDivergence(set, [{ ...rows[0]!, history: { ...rows[0]!.history, events: [...events.slice(0, -1), { ...events.at(-1), sha256: "0".repeat(64) }] } }])).toThrow("not the recorded journal");
});

test("unavailable infrastructure stops the set: the failed replicate is environment, the rest stay as not-started", async () => {
    const { root, grant } = await registered(3), calls: number[] = [];
    const collected = await collectReplicateSet(root, grant, { fixture: { run: async (plan, state, slot) => { calls.push(slot.index); if (slot.index === 2) throw new Error("Scripted unavailable runtime"); return runFixtureJourney(plan, state, { actor, failures: 0 }); } } });
    expect(calls).toEqual([1, 2]);
    expect(collected.replicates.map(r => r.outcome)).toEqual(["completed", "infrastructure-failed", "not-started"]);
    expect(collected.identity).toMatchObject({ status: "consistent", reserved: 3, recorded: 3, notStarted: 1 });
    expect(collected.divergence.replicates.map(r => r.firstFailure?.kind ?? null)).toEqual([null, "environment", null]);
});

test("an interrupted slot is reconciled from what was retained, never replayed, and the set stops", async () => {
    for (const journeyRetained of [true, false]) {
        const { root, grant } = await registered(3);
        await collectReplicateSet(root, grant, { fixture: runner([0, 0, 0]) });
        // Recreate a crash after slot 2's durable dispatch marker and before its record.
        for (const name of ["replicates/replicate-02.json", "replicates/replicate-03.json", "replicate-identity.json", "divergence-report.json"]) await rm(join(root, name));
        if (!journeyRetained) await rm(join(root, "journeys", "replicate-02"), { recursive: true, force: true });
        const { sha256, ...ledger } = await readExperimentJson<any>(join(root, "replicate-collection.json"));
        ledger.slots = ledger.slots.map((s: any) => s.id === "replicate-02" ? { ...s, status: "dispatched" } : s.id === "replicate-03" ? { ...s, status: "reserved", dispatchedAt: null } : s);
        await writeFile(join(root, "replicate-collection.json"), JSON.stringify(stamped(ledger), null, 2));
        let calls = 0;
        const resumed = await collectReplicateSet(root, grant, { fixture: { run: async () => { calls++; throw new Error("must not replay"); } } });
        expect(calls).toBe(0);
        expect(resumed.replicates.map(r => r.outcome)).toEqual(["completed", journeyRetained ? "completed" : "uncertain", "not-started"]);
        expect(resumed.replicates[2]!.stopReason).toContain("interrupted replicate was reconciled");
        expect(resumed.identity?.status).toBe("consistent");
    }
});

test("the budget identity names every inconsistency and repairs none", async () => {
    const { root, grant, set } = await registered(3);
    const collected = await collectReplicateSet(root, grant, { fixture: runner([0, 0, 0]) });
    const collection = collected.collection!;
    expect(replicateIdentity(set, collection, collected.replicates).status).toBe("consistent");
    expect(replicateIdentity(set, collection, collected.replicates.slice(0, 2)).reasons).toEqual(["replicate-03: reserved but never recorded"]);
    const undispatched = { ...collection, slots: collection.slots.map(s => s.id === "replicate-02" ? { ...s, dispatchedAt: null } : s) };
    expect(replicateIdentity(set, undispatched as any, collected.replicates).reasons).toEqual(["replicate-02: recorded without a durable dispatch marker"]);
    expect(replicateIdentity(set, collection, [...collected.replicates, collected.replicates[0]!]).reasons).toEqual(["replicate-01: recorded twice"]);
});

test("allowances, sizes and fresh directories are exact; fixtures are never relabelled live", async () => {
    const { root, set, grant } = await registered(3);
    expect(() => createReplicateGrant(set, { actor: "Fixture operator", expiresAt: new Date(Date.now() + 60000).toISOString(), credentialNames: ["EXTRA_KEY"] })).toThrow("exactly its pinned runtime credential");
    expect(() => createReplicateGrant(set, { actor: "Fixture operator", expiresAt: new Date(Date.now() - 1000).toISOString(), credentialNames: set.plan.runtime.env ?? [] })).toThrow("finite future expiry");
    await expect(registerReplicateSet(root, { id: "again", taskFamily: "reports", plan: set.plan, k: 3, sourceTree: "a".repeat(40), wallClockSeconds: 600 })).rejects.toThrow("fresh private directory");
    for (const k of [1, 6]) await expect(registerReplicateSet(await privateRoot(), { id: "size", taskFamily: "reports", plan: set.plan, k, sourceTree: "a".repeat(40), wallClockSeconds: 600 })).rejects.toThrow("Replicates must be between 2 and 5");
    await collectReplicateSet(root, grant, { fixture: { run: async () => { throw new Error("Scripted unavailable runtime"); } } });
    await expect(collectReplicateSet(root, grant)).rejects.toThrow("never relabelled as live");
    expect(replicateSchedule(set).map(s => s.id)).toEqual(["replicate-01", "replicate-02", "replicate-03"]);
});

test("a replicate journey cannot enter ordinary failure patterns or be delivered", async () => {
    const { root, grant } = await registered(2);
    await collectReplicateSet(root, grant, { fixture: runner([1, 0]) });
    const history = await readValidatedContainedState(join(root, "journeys", "replicate-01"));
    expect(() => projectJourneyFailurePatterns([history], "reports")).toThrow("replicate-set journey cannot enter ordinary-job development patterns");
    // Two separate fences: the directory marker refuses before reading; the authority refuses any moved copy.
    await expect(failurePatternsFromJourneys([join(root, "journeys", "replicate-01")], "reports")).rejects.toThrow("Research/experiment/proposal histories cannot enter");
    await expect(assertResearchPublication(join(root, "journeys", "replicate-01"), history.plan, history.authority.actor, { remote: "/tmp/origin.git", sourceBranch: "wringer/x", targetBranch: "main" } as any)).rejects.toThrow("never delivered");
});
