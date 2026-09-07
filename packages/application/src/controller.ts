import { mkdir, lstat, readFile, writeFile, link, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createExecutionAuthority, discoverEnvironment, hashValue, validateExecutionAuthority, validateExecutionPlan, type ExecutionPlan, type ExecutionAuthority, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, readValidatedContainedState, recordContainedHumanJudgement, queryContainedJourney, type CandidateHumanJudgement, type ContainedJourneyOptions } from "@wringer/workflow";
import type { PreparedRepositorySource } from "@wringer/runtime";
import { Redactor } from "@wringer/engine";
import { containedServices, prepareContainedSource, showContainedCandidate, type ContainedServiceOptions } from "./services";
import { measureControllerEnvironment } from "./discovery";
import { loadExistingCredentials } from "./credentials";

export async function readControllerFile(path: string): Promise<any> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
        throw new Error("Controller input must be a bounded regular JSON file, not a symlink");
    return JSON.parse(await readFile(path, "utf8"));
}
export async function privateControllerDirectory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Controller state must be a real directory, not a symlink");
}
export async function immutableControllerFile(path: string, value: unknown) {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    const pending = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(pending, bytes, { flag: "wx", mode: 0o600 });
    try {
        try { await link(pending, path); }
        catch (error: any) {
            if (error.code !== "EEXIST") throw error;
            // JSON object order is not authority. Hash the complete semantic
            // record, just as the frozen plan/journal contract does.
            if (hashValue(await readControllerFile(path)) !== hashValue(value)) throw new Error("Immutable controller input differs from the retained approval");
        }
    } finally { await unlink(pending); }
}
export async function readController(state: string, currentAuthority = false, allowStaleView = false) {
    const history = await readValidatedContainedState(resolve(state), { allowStaleView });
    const saved = validateExecutionPlan(await readControllerFile(join(state, "plan.json")));
    if (hashValue(saved) !== hashValue(history.plan) || hashValue(await readControllerFile(join(state, "authority.json"))) !== hashValue(history.authority))
        throw new Error("Saved outer plan or authority differs from the immutable journey approval");
    if (currentAuthority) validateExecutionAuthority(history.authority, history.plan);
    return history;
}
export interface ApplicationOptions extends ContainedServiceOptions {
    signal?: AbortSignal;
    onEvent?: ContainedJourneyOptions["onEvent"];
    retryUncertain?: boolean;
    retryStopped?: boolean;
    retryVerification?: boolean;
    retryJudge?: boolean;
    expectedRevision?: string;
    expectedCandidateTree?: string | null;
    /** Internal deterministic fixtures only; never selectable through an HTTP request. */
    executeRole?: ContainedJourneyOptions["executeRole"];
}
export async function startController(stateDirectory: string, plan: ExecutionPlan, authority: ExecutionAuthority, options: ApplicationOptions = {}) {
    options.signal?.throwIfAborted();
    const state = resolve(stateDirectory);
    validateExecutionAuthority(authority, plan);
    await loadExistingCredentials(Object.values(plan.agents).flatMap(a => a?.env ?? []));
    await privateControllerDirectory(state);
    await immutableControllerFile(join(state, "plan.json"), plan);
    await immutableControllerFile(join(state, "authority.json"), authority);
    let prepared: PreparedRepositorySource, environment: EnvironmentMap;
    const preparedPath = join(state, "prepared-source.json"), environmentPath = join(state, "environment.json");
    if (await Bun.file(preparedPath).exists()) {
        prepared = await readControllerFile(preparedPath);
        if (prepared.url !== plan.repository.url || prepared.commit !== plan.repository.commit) throw new Error("Prepared source record differs from the authorized repository revision");
    } else {
        prepared = await prepareContainedSource(plan, state);
        await immutableControllerFile(preparedPath, prepared);
    }
    if (await Bun.file(environmentPath).exists()) environment = await readControllerFile(environmentPath);
    else {
        const originalMap = await discoverEnvironment(prepared.objectStore, plan);
        const discovered = await measureControllerEnvironment(state, plan, authority, prepared, originalMap, { signal: options.signal, retryUnavailable: options.retryVerification, retryUncertain: options.retryUncertain, runCommands: options.runCommands });
        if (discovered.status !== "measured") throw new Error(`Environment discovery ${discovered.status}: ${discovered.reason}. No model turn started. Retained records: ${state}/.wringer/discovery. Next: wringer-drive resume --state '${state.replaceAll("'", "'\\''")}'${discovered.status === "unavailable" ? " --retry-verification" : discovered.status === "uncertain" ? " --retry-uncertain" : ""}`);
        environment = discovered.environment;
        await immutableControllerFile(environmentPath, environment);
    }
    if (await Bun.file(join(state, "human-judgements.json")).exists()) await validateLegacyHumanCache(state, plan);
    return runContainedJourney({ ...options, controllerDir: state, plan, authority, environment, services: containedServices(state, prepared, options) });
}
export async function resumeController(state: string, options: ApplicationOptions = {}) {
    const plan = validateExecutionPlan(await readControllerFile(join(state, "plan.json")));
    const authority = validateExecutionAuthority(await readControllerFile(join(state, "authority.json")), plan);
    return startController(state, plan, authority, options);
}
export async function controllerStatus(state: string) {
    await readController(state, false, true);
    return queryContainedJourney(state);
}
function assertDisplay(receipt: any, plan: ExecutionPlan, criterionId: string, candidateTree: string, candidateCommit?: string) {
    const criterion = plan.acceptance.criteria.find(c => c.id === criterionId), measured = receipt.measured, p = measured?.provenance;
    const expected = [...plan.environment.setup.map(c => `setup/${c.id}`), criterion?.show?.id];
    if (!criterion || criterion.kind !== "human" || !criterion.show || receipt.schema_version !== "wringer.contained-display.v1" || !measured || measured.sourceChanged !== false || measured.sourceTree !== candidateTree || !Array.isArray(measured.results) || hashValue(measured.results.map((r: any) => r.id)) !== hashValue(expected) || measured.results.some((r: any) => r.code !== 0) || !p || p.role !== "verifier" || p.kind !== plan.runtime.kind || p.image !== plan.runtime.image || p.repository?.url !== plan.repository.url || candidateCommit && p.repository?.commit !== candidateCommit || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length || hashValue(p.observed?.writableDirectories ?? []) !== hashValue(plan.environment.writable_directories))
        throw new Error("Display does not establish the declared setup and human criterion in its contained candidate; no judgement recorded");
}
async function validateLegacyHumanCache(state: string, plan: ExecutionPlan) {
    const rows = await readControllerFile(join(state, "human-judgements.json"));
    if (!Array.isArray(rows)) throw new Error("Human judgement file is malformed");
    for (const row of rows) {
        if (!row || !/^[a-f0-9-]{36}$/.test(row.displayId)) throw new Error("Human judgement has an invalid display receipt id");
        const receipt = await readControllerFile(join(state, "displays", `${row.displayId}.json`)), { sha256, ...body } = receipt;
        if (sha256 !== hashValue(body) || !receipt.success || receipt.criterionId !== row.criterionId || receipt.candidateTree !== row.candidateTree || receipt.acceptanceSha256 !== plan.acceptance_sha256 || row.display?.receiptSha256 !== sha256)
            throw new Error("Human judgement is not backed by an intact successful candidate display");
        assertDisplay(receipt, plan, row.criterionId, row.candidateTree);
    }
}
export interface CandidateGuard { expectedRevision?: string; expectedCandidateTree?: string | null; }
function guardHistory(history: Awaited<ReturnType<typeof readController>>, guard: CandidateGuard) {
    if (guard.expectedRevision !== undefined && history.events.at(-1)?.sha256 !== guard.expectedRevision) throw new Error("The run changed. Refresh before acting.");
    if (guard.expectedCandidateTree !== undefined && (history.result.candidate?.tree ?? null) !== guard.expectedCandidateTree) throw new Error("The candidate changed. Review the current result.");
}
export async function showControllerCandidate(state: string, criterionId: string, options: ApplicationOptions = {}) {
    const history = await readController(state, true), { plan, result: latest } = history;
    guardHistory(history, options);
    if (!plan.acceptance.criteria.some(c => c.id === criterionId && c.kind === "human")) throw new Error("Name a declared human acceptance criterion");
    if (!latest.candidate || !latest.verification || latest.verification.status !== "passed" || latest.verification.candidateTree !== latest.candidate.tree) throw new Error("There is no verified candidate to show or judge");
    const remaining = Math.min(Date.parse(history.authority.expires_at), Date.parse(history.state.startedAt) + history.authority.budget.wall_clock_seconds * 1000) - Date.now();
    if (remaining <= 0) throw new Error("The journey wall-clock authority expired; no display ran");
    const deadline = AbortSignal.timeout(Math.min(remaining, plan.budget.session_timeout_seconds * 1000));
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    const { measured, success } = await showContainedCandidate(plan, latest.candidate.source, criterionId, signal, options);
    if (measured.sourceTree !== latest.candidate.tree) throw new Error("Display runtime measured a different candidate tree");
    const id = crypto.randomUUID(), body = { schema_version: "wringer.contained-display.v1", id, criterionId, candidateTree: latest.candidate.tree, acceptanceSha256: plan.acceptance_sha256, at: new Date().toISOString(), success, measured };
    const receipt = { ...body, sha256: hashValue(body) };
    await privateControllerDirectory(join(state, "displays"));
    await immutableControllerFile(join(state, "displays", `${id}.json`), receipt);
    return { receipt, output: measured.results.map(r => r.stdout + r.stderr).join("\n") };
}
export async function reviewControllerCandidate(state: string, input: CandidateGuard & { criterionId: string; displayId: string; verdict: "met" | "not_met"; by: string; note: string }) {
    const history = await readController(state, true), { plan, result: latest } = history;
    guardHistory(history, input);
    if (!plan.acceptance.criteria.some(c => c.id === input.criterionId && c.kind === "human")) throw new Error("Name a declared human acceptance criterion");
    if (!latest.candidate || latest.verification?.status !== "passed") throw new Error("There is no verified candidate to judge");
    if (!/^[a-f0-9-]{36}$/.test(input.displayId)) throw new Error("Invalid display receipt id");
    if (!["met", "not_met"].includes(input.verdict) || !input.by.trim() || !input.note.trim() || input.note.length > 16384) throw new Error("A named human verdict and bounded original note are required");
    const receipt = await readControllerFile(join(state, "displays", `${input.displayId}.json`)), { sha256, ...body } = receipt;
    if (sha256 !== hashValue(body) || !receipt.success || receipt.candidateTree !== latest.candidate.tree || receipt.acceptanceSha256 !== plan.acceptance_sha256 || receipt.criterionId !== input.criterionId) throw new Error("Display failed, changed or describes another candidate; no judgement recorded");
    assertDisplay(receipt, plan, input.criterionId, latest.candidate.tree, latest.candidate.source.commit);
    const redactor = new Redactor(plan.runtime.env);
    if (redactor.scrub(input.by) !== input.by || redactor.scrub(input.note) !== input.note) throw new Error("The review appears to contain a credential. Remove it before recording; your words were not changed or saved.");
    const judgement: CandidateHumanJudgement & { displayId: string } = { criterionId: input.criterionId, candidateTree: latest.candidate.tree, acceptanceSha256: plan.acceptance_sha256, verdict: input.verdict, by: input.by, note: input.note, displayId: input.displayId, display: { candidateTree: latest.candidate.tree, status: "shown" as const, receiptSha256: sha256 } };
    return recordContainedHumanJudgement(state, judgement, input);
}
