import { mkdir, writeFile, readFile, lstat, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { assertRecordFamily, measuredLoopPlan, hashValue, hashBytes, type ExecutionPlan } from "@wringer/plan";
import { prepareRepositorySource, captureCandidate, runContainedCommands, type PreparedRepositorySource, type RepositorySource, type ContainedCommandResult } from "@wringer/runtime";
import type { ContainedJourneyServices, CandidateVerification } from "@wringer/workflow";
import { readPinnedDesignSnapshot, referenceImages, assertContainedDisplayVisuals, buildRepairPacket, observeAssertionReport, type ContainedDisplayVisuals } from "@wringer/workflow";
import { Redactor, safePath } from "@wringer/engine";
/** timeout(1), failed exec, missing command and signals are not assertion failures. */
export const unavailableExit = (code: number) => code === 124 || code === 125 || code === 126 || code === 127 || code >= 128 || code < 0;
async function optionalRecord(path: string): Promise<any | null> {
    try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
            throw new Error("Verification cache must contain bounded regular files");
        return JSON.parse(await readFile(path, "utf8"));
    }
    catch (error: any) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
}
async function immutableRecord(path: string, value: unknown) {
    const existing = await optionalRecord(path);
    if (existing !== null) {
        if (hashValue(existing) !== hashValue(value))
            throw new Error("Immutable verification record changed; retained evidence was not overwritten");
        return;
    }
    // Publish a complete file by an exclusive hard link: a crash cannot leave a
    // partially written authoritative envelope or replace an existing receipt.
    const pending = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(pending, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    try {
        try {
            await link(pending, path);
        }
        catch (error: any) {
            if (error.code !== "EEXIST" || hashValue(await optionalRecord(path)) !== hashValue(value))
                throw error;
        }
    }
    finally {
        await unlink(pending);
    }
}
export interface ContainedServiceOptions {
    /** Deterministic tests only. The public CLI always uses the actual contained runtime. */
    runCommands?: typeof runContainedCommands;
}
/** Shared controller plumbing. CLI and board use the same observations and effects. */
export function containedServices(controllerDir: string, original: PreparedRepositorySource, options: ContainedServiceOptions = {}): ContainedJourneyServices {
    async function verifyCandidate({ plan, source, phase, effectId, signal }: Parameters<ContainedJourneyServices["verifyCandidate"]>[0], reconcileOnly = false): Promise<CandidateVerification | null> {
            if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(effectId))
                throw new Error("Unsafe verification effect id");
            const directory = await safePath(controllerDir, `verification/${effectId}`);
            await mkdir(directory, { recursive: true, mode: 0o700 });
            if ((await lstat(directory)).isSymbolicLink())
                throw new Error("Verification directory cannot be a symlink");
            const requestIdentity = hashValue({ source: { url: source.url, commit: source.commit }, plan: plan.plan_sha256, phase });
            const recordPath = join(directory, "result.json"), observationPath = join(directory, "observations.json"), envelopePath = join(directory, "observation-record.json");
            const saved = await optionalRecord(recordPath), observed = await optionalRecord(observationPath), envelope = await optionalRecord(envelopePath);
            if (saved && (saved.requestIdentity !== requestIdentity || saved.sha256 !== hashValue(saved.value)))
                throw new Error("Verification effect record changed or names different inputs");
            if (!envelope && (saved || observed))
                throw new Error(`Verification effect ${effectId} has unbound or incomplete legacy observations. Its origin cannot be inferred, so no verifier was replayed. Preserve ${directory} for diagnosis; use wringer-drive status --state '${controllerDir.replaceAll("'", "'\\''")}' to inspect the recorded journey. A new approved plan/state is required if the original identity-bound observation cannot be recovered.`);
            if (!envelope && reconcileOnly)
                return null;
            const setup = plan.environment.setup.map(c => ({ id: `setup/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: c.timeout_seconds * 1000 }));
            const baselines = plan.environment.baseline.map(c => ({ id: `baseline/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: c.timeout_seconds * 1000 }));
            const checks = plan.acceptance.checks.map(c => ({ id: `acceptance/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: c.timeout_seconds * 1000 }));
            const protectedFiles = [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])];
            let measured: ContainedCommandResult;
            if (envelope) {
                if (envelope.schema_version !== "wringer.contained-observation-record.v1" || envelope.requestIdentity !== requestIdentity || envelope.acceptanceSource?.url !== original.url || envelope.acceptanceSource?.commit !== original.commit || !envelope.measured || envelope.sha256 !== hashValue(envelope.measured))
                    throw new Error("Verification observation identity or digest changed; no verifier was replayed");
                measured = envelope.measured;
            }
            else {
                measured = new Redactor(plan.runtime.env).deep(await (options.runCommands ?? runContainedCommands)({ repo: source, runtime: plan.runtime, commands: [...setup, ...baselines, ...checks], acceptanceSource: original, protectedFiles, writableDirectories: plan.environment.writable_directories, timeoutMs: plan.budget.session_timeout_seconds * 1000, signal }));
            }
            const p = measured?.provenance, commands = [...setup, ...baselines, ...checks];
            if (p) assertRecordFamily(plan, "runtime", p.schema_version);
            if (!p || p.role !== "verifier" || p.kind !== plan.runtime.kind || p.image !== plan.runtime.image || p.repository?.url !== source.url || p.repository?.commit !== source.commit || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length || !p.runtimeId || hashValue(p.observed?.writableDirectories ?? []) !== hashValue(plan.environment.writable_directories) || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(measured.sourceTree) || typeof measured.sourceChanged !== "boolean" || !Array.isArray(measured.results) || hashValue(measured.results.map(r => r.id)) !== hashValue(commands.map(c => c.id)) || measured.results.some(r => !Number.isInteger(r.code) || typeof r.stdout !== "string" || typeof r.stderr !== "string"))
                throw new Error("Verifier observations do not establish the exact declared commands in a source-bound contained runtime");
            // Persist the identity and complete observation together first. Both human-
            // readable observations and the summary are then reproducible after a crash.
            await immutableRecord(envelopePath, { schema_version: "wringer.contained-observation-record.v1", requestIdentity, acceptanceSource: { url: original.url, commit: original.commit }, measured, sha256: hashValue(measured) });
            const setupFailed = measured.results.some(r => r.id.startsWith("setup/") && r.code !== 0);
            const baselineFailed = measured.results.some(r => r.id.startsWith("baseline/") && r.code !== 0);
            if (protectedFiles.length && !measured.checkInputsSha256)
                throw new Error("Verifier did not observe the pinned acceptance input identity");
            const rows = plan.acceptance.checks.map(check => {
                const row = measured.results.find(r => r.id === `acceptance/${check.id}`);
                const unavailable = !row || setupFailed || measured.sourceChanged || unavailableExit(row.code);
                return { id: check.id, status: (unavailable ? "unavailable" : row!.code === 0 ? "passed" : "failed") as "passed" | "failed" | "unavailable", exitCode: unavailable ? null : row!.code, checkInputsSha256: hashValue({ argv: check.argv, cwd: check.cwd, files: check.files, protectedInputs: measured.checkInputsSha256 ?? null, image: plan.runtime.image }), outputSha256: hashBytes(row ? row.stdout + row.stderr : "No check result was observed") };
            });
            const checkEvidence = measuredLoopPlan(plan) ? plan.acceptance.checks.filter(c => c.evidence?.kind === "assertions").map(check => {
                const raw = measured.results.find(r => r.id === `acceptance/${check.id}`)!, row = rows.find(r => r.id === check.id)!;
                const observed = observeAssertionReport(check.id, raw.stdout, row.exitCode, check.criteria);
                if (observed.status === "unavailable") { row.status = "unavailable"; row.exitCode = null; }
                return observed;
            }) : undefined;
            const regressions = plan.environment.baseline.map(c => {
                const row = measured.results.find(r => r.id === `baseline/${c.id}`), unavailable = !row || setupFailed || measured.sourceChanged || unavailableExit(row.code);
                return { id: c.id, status: (unavailable ? "unavailable" : row!.code === 0 ? "passed" : "failed") as "passed" | "failed" | "unavailable", exitCode: unavailable ? null : row!.code, outputSha256: hashBytes(row ? row.stdout + row.stderr : "No regression result was observed") };
            });
            const value: CandidateVerification = { schema_version: measuredLoopPlan(plan) ? "wringer.contained-verification.v2" : "wringer.contained-verification.v1", status: setupFailed || measured.sourceChanged || [...rows, ...regressions].some(r => r.status === "unavailable") ? "unavailable" : baselineFailed || rows.some(r => r.status === "failed") ? "failed" : "passed", candidateCommit: source.commit, candidateTree: measured.sourceTree, acceptanceSha256: plan.acceptance_sha256, runtimeId: measured.provenance.runtimeId, image: measured.provenance.image, checks: rows, regressions, evidenceRef: directory, ...(checkEvidence ? { checkEvidence } : {}) };
            if (measuredLoopPlan(plan)) value.repair = buildRepairPacket(plan, value, phase, hashValue(measured), measured.results);
            if (saved && hashValue(saved.value) !== hashValue(value)) throw new Error("Retained verification differs from its recomputed observation evidence");
            await immutableRecord(observationPath, measured);
            await immutableRecord(recordPath, { requestIdentity, value, sha256: hashValue(value) });
            return value;
    }
    return {
        async prepareSource(source) {
            if (source.commit !== original.commit || source.url !== original.url)
                throw new Error("Prepared source does not match the frozen plan");
            return original;
        },
        captureCandidate: (result, base, effectId) => captureCandidate(result, base, { controllerDir, effectId }),
        verifyCandidate: async request => (await verifyCandidate(request))!,
        reconcileVerification: request => verifyCandidate(request, true),
    };
}
export async function prepareContainedSource(plan: ExecutionPlan, controllerDir: string, sourceBundle?: string): Promise<PreparedRepositorySource> {
    return prepareRepositorySource({ ...plan.repository, ...(sourceBundle ? { bundlePath: sourceBundle } : {}) }, { controllerDir });
}
export async function showContainedCandidate(plan: ExecutionPlan, source: RepositorySource, criterionId: string, signal?: AbortSignal, options: ContainedServiceOptions = {}) {
    const criterion = plan.acceptance.criteria.find(c => c.id === criterionId);
    if (!criterion || criterion.kind !== "human")
        throw new Error("Name a declared human acceptance criterion");
    if (!criterion.show)
        throw new Error(`Criterion ${criterionId} has no display command. Add its show declaration to a new plan and authorize that changed plan; no judgement was recorded.`);
    const command = criterion.show;
    const commands = [...plan.environment.setup.map(c => ({ id: `setup/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: c.timeout_seconds * 1000 })), { id: command.id, argv: command.argv, cwd: command.cwd, timeoutMs: command.timeout_seconds * 1000 }];
    const protectedFiles = [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])];
    const review = plan.design?.reviews.find(row => row.criterionId === criterionId), snapshot = review ? await readPinnedDesignSnapshot(plan, (source as PreparedRepositorySource).objectStore) : null;
    const references = snapshot ? referenceImages(plan, criterionId, snapshot) : null;
    const measured = new Redactor(plan.runtime.env).deep(await (options.runCommands ?? runContainedCommands)({ repo: source, runtime: plan.runtime, commands, acceptanceSource: { ...source, commit: plan.repository.commit }, protectedFiles, writableDirectories: plan.environment.writable_directories, ...(review ? { captureArtifacts: review.captures } : {}), timeoutMs: plan.budget.session_timeout_seconds * 1000, signal }));
    const p = measured?.provenance;
    if (p) assertRecordFamily(plan, "runtime", p.schema_version);
    if (!p || p.role !== "verifier" || p.kind !== plan.runtime.kind || p.image !== plan.runtime.image || p.repository?.url !== source.url || p.repository?.commit !== source.commit || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length || hashValue(p.observed?.writableDirectories ?? []) !== hashValue(plan.environment.writable_directories))
        throw new Error("Display runtime did not establish its exact source, image and declared writable directories");
    const success = measured.sourceChanged === false && hashValue(measured.results.map(r => r.id)) === hashValue(commands.map(c => c.id)) && measured.results.every(r => r.code === 0);
    const visuals: ContainedDisplayVisuals | undefined = review && snapshot && references ? { snapshotSha256: snapshot.snapshot_sha256, referenceAssets: references, captures: measured.artifacts ?? [] } : undefined;
    if (success) assertContainedDisplayVisuals({ schema_version: visuals ? "wringer.contained-display.v2" : "wringer.contained-display.v1", criterionId, measured, ...(visuals ? { visuals } : {}) }, plan, snapshot);
    return { measured, success, ...(visuals ? { visuals } : {}) };
}
