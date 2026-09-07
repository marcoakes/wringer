import { lstat, mkdir, readFile, writeFile, link, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hashValue, type EnvironmentMap, type EnvironmentObservation, type ExecutionAuthority, type ExecutionPlan } from "@wringer/plan";
import { runContainedCommands, type ContainedCommandResult, type PreparedRepositorySource } from "@wringer/runtime";
import { runContainedDiscovery, type DiscoveryMeasurement } from "@wringer/workflow";
import { Redactor, safePath } from "@wringer/engine";
import { unavailableExit } from "./services";

export interface ControllerDiscoveryOptions {
    retryUnavailable?: boolean;
    retryUncertain?: boolean;
    signal?: AbortSignal;
    /** Deterministic test supervisor only. Public callers use the real contained runtime. */
    runCommands?: typeof runContainedCommands;
}
async function readObservation(path: string): Promise<any | null> {
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!stat) return null;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error("Discovery measurement is not a bounded regular record");
    return JSON.parse(await readFile(path, "utf8"));
}
async function retain(path: string, value: unknown) {
    const existing = await readObservation(path);
    if (existing) { if (hashValue(existing) !== hashValue(value)) throw new Error("Discovery observation changed; prior evidence was retained"); return; }
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    try { try { await link(temp, path); } catch (error: any) { if (error.code !== "EEXIST" || hashValue(await readObservation(path)) !== hashValue(value)) throw error; } }
    finally { await unlink(temp); }
}
/** Execute only the declared probes/setup/baselines in a credential-free verifier clone. */
export async function measureControllerEnvironment(state: string, plan: ExecutionPlan, authority: ExecutionAuthority, prepared: PreparedRepositorySource, originalMap: EnvironmentMap, options: ControllerDiscoveryOptions = {}) {
    if (prepared.url !== plan.repository.url || prepared.commit !== plan.repository.commit) throw new Error("Discovery source differs from the pinned plan");
    const runtime = { ...plan.runtime, env: [], ...(plan.runtime.kind === "gvisor-kubernetes" ? { secretRefs: {} } : {}) };
    const tools = plan.environment.tools.map(t => ({ id: `tool/${t.name}`, argv: t.probe, cwd: ".", timeoutMs: Math.min(30000, authority.budget.session_timeout_seconds * 1000) }));
    const setup = plan.environment.setup.map(c => ({ id: `setup/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: Math.min(c.timeout_seconds, authority.budget.session_timeout_seconds) * 1000 }));
    const baseline = plan.environment.baseline.map(c => ({ id: `baseline/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: Math.min(c.timeout_seconds, authority.budget.session_timeout_seconds) * 1000 }));
    const commands = [...tools, ...setup, ...baseline], requestSha256 = hashValue({ plan: plan.plan_sha256, authority: hashValue(authority), source: plan.repository, runtime, commands, map: originalMap.map_sha256 });
    const observe = async (effectId: string, signal?: AbortSignal, readOnly = false): Promise<DiscoveryMeasurement | null> => {
        if (!/^[a-f0-9-]{36}$/.test(effectId)) throw new Error("Invalid discovery attempt identity");
        // The plan permits no discovery commands. Retain the workflow's source,
        // authority and recovery checks without inventing a runtime observation.
        // This is also safe to reconcile: the empty declaration has no effects.
        if (!commands.length) return { observations: [], preparation: { status: "passed", reason: "No discovery commands were declared; no runtime was allocated and no tool, setup or baseline execution was observed." } };
        const directory = await safePath(state, ".wringer/discovery/runtime"), path = join(directory, `${effectId}.json`);
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const saved = await readObservation(path);
        if (saved && (saved.schema_version !== "wringer.discovery-runtime.v1" || saved.requestSha256 !== requestSha256 || saved.sha256 !== hashValue(saved.measured))) throw new Error("Discovery runtime identity or digest changed");
        if (!saved && readOnly) return null;
        const measured: ContainedCommandResult = saved?.measured ?? new Redactor(plan.runtime.env).deep(await (options.runCommands ?? runContainedCommands)({ repo: prepared, runtime, commands, acceptanceSource: prepared, protectedFiles: [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])], writableDirectories: plan.environment.writable_directories, timeoutMs: authority.budget.session_timeout_seconds * 1000, signal }));
        const p = measured?.provenance;
        if (!p || p.role !== "verifier" || p.kind !== runtime.kind || p.image !== runtime.image || p.repository.url !== prepared.url || p.repository.commit !== prepared.commit || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length || !p.runtimeId || (p.declared.env ?? []).length || p.declared.kind === "gvisor-kubernetes" && Object.keys(p.declared.secretRefs ?? {}).length || hashValue(p.observed.writableDirectories ?? []) !== hashValue(plan.environment.writable_directories) || measured.sourceTree !== originalMap.source_tree || typeof measured.sourceChanged !== "boolean" || !Array.isArray(measured.results) || hashValue(measured.results.map(r => r.id)) !== hashValue(commands.map(c => c.id)) || measured.results.some(r => !Number.isInteger(r.code) || typeof r.stdout !== "string" || typeof r.stderr !== "string" || Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr) > 1024 * 1024))
            throw new Error("Discovery did not establish exact commands, source, image and a credential-free contained verifier");
        await retain(path, { schema_version: "wringer.discovery-runtime.v1", requestSha256, measured, sha256: hashValue(measured) });
        const setupFailed = measured.results.some(r => r.id.startsWith("setup/") && r.code !== 0);
        const observations: EnvironmentObservation[] = [...plan.environment.tools.map(t => ({ kind: "tool" as const, id: t.name, command: t.probe })), ...plan.environment.baseline.map(c => ({ kind: "baseline" as const, id: c.id, command: c }))].map(c => {
            const row = measured.results.find(r => r.id === `${c.kind}/${c.id}`)!;
            const unavailable = measured.sourceChanged || unavailableExit(row.code) || c.kind === "baseline" && setupFailed;
            return { kind: c.kind, id: c.id, status: unavailable ? "unavailable" : row.code === 0 ? "passed" : "failed", exit_code: unavailable ? null : row.code, output: c.kind === "tool" && row.code === 0 && !unavailable ? row.stdout : row.stdout + row.stderr, source_commit: prepared.commit, runtime_id: p.runtimeId, image: p.image, command_sha256: hashValue(c.command) };
        });
        return { observations, preparation: { status: setupFailed || measured.sourceChanged ? "unavailable" : "passed", ...(setupFailed || measured.sourceChanged ? { reason: setupFailed ? "Declared dependency setup failed; no model work may begin" : "Discovery changed the pinned source" } : {}) } };
    };
    return runContainedDiscovery({ controllerDir: state, plan, authority, environment: originalMap, retryUnavailable: options.retryUnavailable, retryUncertain: options.retryUncertain, signal: options.signal, measure: async ({ effectId, signal }) => (await observe(effectId, signal))!, reconcile: ({ effectId }) => observe(effectId, undefined, true) });
}
