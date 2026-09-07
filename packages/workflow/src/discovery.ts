import { randomUUID } from "node:crypto";
import { mkdir, readdir, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { hashValue, validateExecutionPlan, validateExecutionAuthority, ingestEnvironmentObservations, environmentReadiness } from "@wringer/plan";
import type { ExecutionPlan, ExecutionAuthority, EnvironmentMap, EnvironmentObservation } from "@wringer/plan";
import { atomicWrite, immutableJson, locked, now, readJson, safePath, scrubValue, withSecrets } from "./storage";

const ROOT = ".wringer/discovery";
interface Origin { schema_version: "wringer.discovery-origin.v1"; planSha256: string; authoritySha256: string; environment: EnvironmentMap; startedAt: string; sha256: string }
interface Reservation { schema_version: "wringer.discovery-reservation.v1"; id: string; sequence: number; originSha256: string; at: string; sha256: string }
interface ObservationRecord { schema_version: "wringer.discovery-observations.v1"; reservationSha256: string; observations: EnvironmentObservation[]; preparation?: DiscoveryMeasurement["preparation"]; sha256: string }
export interface DiscoveryMeasurement {
    observations: EnvironmentObservation[];
    preparation: { status: "passed" | "unavailable"; reason?: string };
}
export interface ContainedDiscoveryOptions {
    controllerDir: string;
    plan: ExecutionPlan;
    authority: ExecutionAuthority;
    environment: EnvironmentMap;
    measure: (request: { effectId: string; signal: AbortSignal }) => Promise<EnvironmentObservation[] | DiscoveryMeasurement>;
    /** Reads supervisor-carried observations only; must never execute a command. */
    reconcile?: (request: { effectId: string }) => Promise<EnvironmentObservation[] | DiscoveryMeasurement | null>;
    retryUnavailable?: boolean;
    retryUncertain?: boolean;
    signal?: AbortSignal;
}
export interface ContainedDiscoveryResult {
    schema_version: "wringer.contained-discovery.v1";
    status: "measured" | "unavailable" | "uncertain" | "stopped";
    environment: EnvironmentMap;
    startedAt: string;
    attempts: number;
    reason: string | null;
}
async function record<T>(controller: string, path: string): Promise<T | null> {
    const target = await safePath(controller, path), stat = await lstat(target).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error("Discovery record must be a bounded regular file");
    return readJson<T>(controller, path);
}
function digestRecord(value: { sha256: string }) { const { sha256, ...data } = value; if (sha256 !== hashValue(data)) throw new Error("Discovery record digest changed"); }
/** The build clock includes preparation and its downtime, not a fresh budget after discovery. */
export async function containedDiscoveryStartedAt(controller: string, plan: ExecutionPlan, authority: ExecutionAuthority): Promise<string | null> {
    const origin = await record<Origin>(controller, `${ROOT}/origin.json`);
    if (!origin) return null;
    digestRecord(origin);
    if (origin.schema_version !== "wringer.discovery-origin.v1" || origin.planSha256 !== plan.plan_sha256 || origin.authoritySha256 !== hashValue(authority) || !Number.isFinite(Date.parse(origin.startedAt)) || Date.parse(origin.startedAt) > Date.now()) throw new Error("Discovery origin differs from the frozen plan/authority/time");
    validateExecutionAuthority(authority, plan, new Date(origin.startedAt));
    return origin.startedAt;
}
/** No-model discovery still reserves finite runtime attempts before execution. */
export async function runContainedDiscovery(options: ContainedDiscoveryOptions): Promise<ContainedDiscoveryResult> {
    const controller = resolve(options.controllerDir), plan = validateExecutionPlan(options.plan), authority = validateExecutionAuthority(options.authority, plan);
    if (!authority.actions.includes("verify")) throw new Error("Contained discovery requires the existing verify authority");
    const environment = ingestEnvironmentObservations(options.environment, plan, []);
    await mkdir(controller, { recursive: true, mode: 0o700 });
    return withSecrets((plan.runtime.env ?? []).map(name => process.env[name]), () => locked(controller, "contained-discovery", async () => {
        let origin = await record<Origin>(controller, `${ROOT}/origin.json`);
        if (!origin) {
            const data = { schema_version: "wringer.discovery-origin.v1" as const, planSha256: plan.plan_sha256, authoritySha256: hashValue(authority), environment, startedAt: now() };
            origin = { ...data, sha256: hashValue(data) };
            await immutableJson(controller, `${ROOT}/origin.json`, origin);
        }
        await containedDiscoveryStartedAt(controller, plan, authority);
        if (origin.environment.map_sha256 !== environment.map_sha256) throw new Error("Discovery cannot silently switch its source-linked input map");
        const names = await readdir(await safePath(controller, `${ROOT}/attempts`)).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
        if (names.length > authority.budget.max_sessions) throw new Error("Discovery exceeded its independently reserved attempt ceiling");
        const normalize = (value: EnvironmentObservation[] | DiscoveryMeasurement): DiscoveryMeasurement => {
            const measured = Array.isArray(value) ? { observations: value, preparation: { status: plan.environment.setup.length ? "unavailable" as const : "passed" as const, ...(plan.environment.setup.length ? { reason: "Declared setup has no preparation observation" } : {}) } } : value;
            if (!measured || !["passed", "unavailable"].includes(measured.preparation?.status) || measured.preparation.reason !== undefined && (typeof measured.preparation.reason !== "string" || measured.preparation.reason.length > 2000)) throw new Error("Discovery preparation observation is malformed");
            return measured;
        };
        let last: Reservation | null = null, carried: DiscoveryMeasurement | null = null;
        for (const [index, name] of names.sort().entries()) {
            const reservation = await record<Reservation>(controller, `${ROOT}/attempts/${name}/reservation.json`);
            if (!reservation || name !== String(index + 1).padStart(6, "0")) throw new Error("Discovery reservation history is incomplete");
            digestRecord(reservation);
            if (reservation.schema_version !== "wringer.discovery-reservation.v1" || reservation.sequence !== index + 1 || reservation.originSha256 !== origin.sha256 || !/^[a-f0-9-]{36}$/.test(reservation.id)) throw new Error("Discovery reservation lost its source-bound identity");
            validateExecutionAuthority(authority, plan, new Date(reservation.at));
            if (Date.parse(reservation.at) < Date.parse(origin.startedAt) || Date.parse(reservation.at) - Date.parse(origin.startedAt) >= authority.budget.wall_clock_seconds * 1000) throw new Error("Discovery reservation exceeds its original whole-journey time");
            const observed = await record<ObservationRecord>(controller, `${ROOT}/attempts/${name}/observations.json`);
            if (observed) {
                digestRecord(observed);
                if (observed.schema_version !== "wringer.discovery-observations.v1" || observed.reservationSha256 !== reservation.sha256) throw new Error("Discovery observations lost their pre-execution reservation");
                ingestEnvironmentObservations(environment, plan, observed.observations);
            }
            last = reservation;
            carried = observed ? normalize(observed.preparation ? { observations: observed.observations, preparation: observed.preparation } : observed.observations) : null;
        }
        const finish = async (status: ContainedDiscoveryResult["status"], measurement: DiscoveryMeasurement | null, reason: string | null) => {
            const value: ContainedDiscoveryResult = scrubValue({ schema_version: "wringer.contained-discovery.v1", status, environment: measurement ? ingestEnvironmentObservations(environment, plan, measurement.observations) : environment, startedAt: origin!.startedAt, attempts: last?.sequence ?? 0, reason });
            await atomicWrite(controller, `${ROOT}/result.json`, JSON.stringify(value, null, 2) + "\n");
            return value;
        };
        const observe = async (measurement: EnvironmentObservation[] | DiscoveryMeasurement) => {
            const { observations, preparation } = scrubValue(normalize(measurement));
            const mapped = ingestEnvironmentObservations(environment, plan, observations);
            const data = { schema_version: "wringer.discovery-observations.v1" as const, reservationSha256: last!.sha256, observations, preparation };
            await immutableJson(controller, `${ROOT}/attempts/${String(last!.sequence).padStart(6, "0")}/observations.json`, { ...data, sha256: hashValue(data) });
            const readiness = environmentReadiness(mapped, plan);
            const ready = readiness.ready && preparation.status === "passed";
            return finish(ready ? "measured" : "unavailable", { observations, preparation }, ready ? null : preparation.status !== "passed" ? preparation.reason ?? "Declared setup failed or was not measured" : "Declared tool versions are unmeasured, unavailable or mismatched; inspect the carried observations before explicit retry");
        };
        if (last && !carried) {
            const reconciled = await options.reconcile?.({ effectId: last.id });
            if (reconciled) return observe(reconciled);
            if (!options.retryUncertain) return finish("uncertain", null, "Discovery may have executed. Ordinary resume will not replay it; reconcile or explicitly retry uncertainty within the same ceiling");
        }
        if (carried) {
            const ready = carried.preparation.status === "passed" && environmentReadiness(ingestEnvironmentObservations(environment, plan, carried.observations), plan).ready;
            if (ready || !options.retryUnavailable) return finish(ready ? "measured" : "unavailable", carried, ready ? null : "A known unavailable discovery requires explicit retryUnavailable");
        }
        const authorizedUntil = Math.min(Date.parse(authority.expires_at), Date.parse(origin.startedAt) + authority.budget.wall_clock_seconds * 1000);
        const remaining = authorizedUntil - Date.now();
        if (options.signal?.aborted || remaining <= 0 || names.length >= authority.budget.max_sessions) return finish("stopped", carried, "Discovery whole-journey time or attempt ceiling is exhausted, or execution was cancelled");
        validateExecutionAuthority(authority, plan);
        const reservation = { schema_version: "wringer.discovery-reservation.v1" as const, id: randomUUID(), sequence: names.length + 1, originSha256: origin.sha256, at: now() };
        last = { ...reservation, sha256: hashValue(reservation) };
        await immutableJson(controller, `${ROOT}/attempts/${String(last.sequence).padStart(6, "0")}/reservation.json`, last);
        try {
            validateExecutionAuthority(authority, plan);
            const deadline = AbortSignal.timeout(Math.max(1, Math.min(authorizedUntil - Date.now(), authority.budget.session_timeout_seconds * 1000)));
            const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
            signal.throwIfAborted();
            return await observe(await options.measure({ effectId: last.id, signal }));
        } catch (error) {
            return finish("uncertain", null, `Discovery did not produce validated durable observations: ${String(error)}. Reservation remains charged`);
        }
    }));
}
