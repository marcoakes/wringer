import { randomUUID } from "node:crypto";
import type { ServiceResult } from "./types";
import { now, readJson, readText, stop, WORKFLOW_DIR, writeJson } from "./storage";
export interface WorkerReservation {
    id: string;
    plan_digest: string;
    authority_sha256: string;
    reserved: number;
    charged: number;
    actual: number | null;
    status: "reserved" | "settled" | "unknown" | "exceeded";
    started_at: string;
    finished_at?: string;
}
export interface WorkerBudget {
    schema_version: "wringer.workflow-worker-budget.v1";
    journey_id: string;
    reservations: WorkerReservation[];
}
export const WORKER_BUDGET_PATH = `${WORKFLOW_DIR}/worker-budget.json`;
export const chargedWorkerTurns = (budget: WorkerBudget) => budget.reservations.reduce((total, row) => total + row.charged, 0);
/** Missing historical accounting is not a fresh grant of the journey ceiling. */
export async function loadWorkerBudget(repo: string, journeyId: string, priorBuild: boolean): Promise<WorkerBudget> {
    let budget: WorkerBudget | null;
    try {
        budget = await readJson<WorkerBudget>(repo, WORKER_BUDGET_PATH);
    }
    catch (error) {
        return stop(repo, "worker-budget-unreadable", (error as Error).message, "wring explain");
    }
    if (budget === null) {
        const history = await readText(repo, `${WORKFLOW_DIR}/journeys/${journeyId}/events.jsonl`);
        let hasRecordedBuild = priorBuild;
        if (history) {
            try {
                hasRecordedBuild ||= history.split("\n").filter(Boolean).some(line => ["build-started", "build-finished", "build-reused"].includes(JSON.parse(line).type));
            }
            catch {
                return stop(repo, "worker-budget-unreadable", "Journey history is malformed, so previous worker spending cannot be inferred.", "wring explain");
            }
        }
        if (hasRecordedBuild)
            return stop(repo, "worker-budget-missing", "This journey already started a build but has no cumulative worker-turn accounting. Its previous spend must be established before another worker can be authorized.", "wring explain");
        budget = { schema_version: "wringer.workflow-worker-budget.v1", journey_id: journeyId, reservations: [] };
        await writeJson(repo, WORKER_BUDGET_PATH, budget);
        return budget;
    }
    if (budget.schema_version !== "wringer.workflow-worker-budget.v1" || budget.journey_id !== journeyId || !Array.isArray(budget.reservations))
        return stop(repo, "worker-budget-unreadable", "The worker budget is malformed or belongs to another journey; no new worker turn is authorized.", "wring explain");
    const ids = new Set<string>();
    for (const row of budget.reservations) {
        if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) || !Number.isSafeInteger(row.reserved) || row.reserved < 1 || !Number.isSafeInteger(row.charged) || row.charged < 0 || !["reserved", "settled", "unknown", "exceeded"].includes(row.status) || (row.actual !== null && (!Number.isSafeInteger(row.actual) || row.actual < 0)) || (row.status === "settled" ? row.actual !== row.charged || row.charged > row.reserved : row.status === "exceeded" ? row.actual !== row.charged || row.charged <= row.reserved : row.actual !== null || row.charged !== row.reserved))
            return stop(repo, "worker-budget-unreadable", "The cumulative worker reservation ledger has invalid or contradictory accounting.", "wring explain");
        ids.add(row.id);
    }
    if (!Number.isSafeInteger(chargedWorkerTurns(budget)))
        return stop(repo, "worker-budget-unreadable", "Cumulative worker turn count exceeds the supported integer range.", "wring explain");
    return budget;
}
export async function reserveWorkerTurns(repo: string, budget: WorkerBudget, ceiling: number, planDigest: string, authorityDigest: string): Promise<WorkerReservation> {
    const used = chargedWorkerTurns(budget);
    const remaining = ceiling - used;
    if (!Number.isSafeInteger(ceiling) || ceiling < 1 || remaining < 1)
        return stop(repo, "worker-budget-exhausted", `The whole-journey worker ceiling is exhausted: ${used} turns consumed or conservatively reserved against ${ceiling} authorized. Revising the plan or resuming does not reset it.`, "wringer-drive authority --help", { journey_id: budget.journey_id, ceiling, charged: used });
    const reservation: WorkerReservation = { id: randomUUID(), plan_digest: planDigest, authority_sha256: authorityDigest, reserved: remaining, charged: remaining, actual: null, status: "reserved", started_at: now() };
    budget.reservations.push(reservation);
    // Reserve before crossing into the worker service. A crash from this point
    // onward consumes the reservation unless exact evidence settles it.
    await writeJson(repo, WORKER_BUDGET_PATH, budget);
    return reservation;
}
export async function settleWorkerTurns(repo: string, budget: WorkerBudget, reservation: WorkerReservation, result: ServiceResult): Promise<void> {
    const actual = result.workerTurns;
    const exact = typeof actual === "number" && Number.isSafeInteger(actual) && actual >= 0;
    reservation.actual = exact ? actual : null;
    reservation.charged = exact ? actual : reservation.reserved;
    reservation.status = exact ? actual > reservation.reserved ? "exceeded" : "settled" : "unknown";
    reservation.finished_at = now();
    await writeJson(repo, WORKER_BUDGET_PATH, budget);
    if (reservation.status === "exceeded")
        return stop(repo, "worker-budget-exceeded", `The worker service reports ${actual} turns after receiving a ceiling of ${reservation.reserved}. The overrun is recorded and no further worker turn is authorized.`, "wring explain", { reservation });
}
