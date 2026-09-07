import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { exists, loadConfig } from "./config";
import { loadSpec } from "./acceptance";
import { snapshot } from "./git";
import { Bundle, VERSION, maybeJson, newId, now, posix, Redactor, safePath, sha256, validateDigests } from "./io";
import { runProcess } from "./process";
import { verify } from "./verify";
import { explain, workerAuth } from "./diagnostics";
import { preflightContainer, runContainedWorker } from "./backend";
import { EngineError, type RunOptions, type RunOutcome, type VerifyOutcome } from "./types";
async function authority(repo: string) {
    const documents: Record<string, string | null> = {};
    for (const name of ["wringer.spec.yaml", "wringer.rubric.yaml", ".wringer.yaml"]) {
        const path = await safePath(repo, name);
        documents[name] = await exists(path) ? sha256(await readFile(path)) : null;
    }
    return documents;
}
async function acquireLock(repo: string) {
    const parent = await safePath(repo, ".wringer");
    await mkdir(parent, { recursive: true });
    const path = await safePath(parent, "run.lock");
    try {
        await mkdir(path);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST")
            throw e;
        const owner = await maybeJson(join(path, "owner.json"));
        if (owner?.pid && Number.isInteger(owner.pid)) {
            try {
                process.kill(owner.pid, 0);
                throw new EngineError(`A build is already running as process ${owner.pid}. Its evidence is in .wringer/loops.`, 3);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ESRCH")
                    throw e;
            }
        }
        else
            throw new EngineError(`Build lock has no readable owner: ${path}. Inspect it before starting another worker.`, 3);
        await rename(path, `${path}.stale-${newId()}`);
        await mkdir(path);
    }
    await writeFile(join(path, "owner.json"), JSON.stringify({ pid: process.pid, at: now() }));
    return async () => { await rm(join(path, "owner.json")); await (await import("node:fs/promises")).rmdir(path); };
}
export async function run(repo: string, options: RunOptions = {}): Promise<RunOutcome> {
    const initial = await snapshot(repo);
    repo = initial.root;
    let config = await loadConfig(repo);
    if (!config.run)
        throw new EngineError("No run.worker is declared. Add your coding agent's shell command to .wringer.yaml.");
    const selectedWorker = options.declaredWorker ? (config.bench as any)?.contenders?.find((c: any) => c.id === options.declaredWorker)?.worker : undefined;
    if (options.declaredWorker && !selectedWorker)
        throw new EngineError(`No bench contender ${options.declaredWorker} is declared. A worker command cannot be supplied by a benchmark flag.`);
    if (selectedWorker)
        config.run.worker = selectedWorker;
    const spec = await loadSpec(repo);
    if (spec && !spec.approved)
        throw new EngineError("The plan is not approved. Review and approve it before starting a coding worker.", 3, "wring plan");
    if (spec?.open_questions?.some((q: any) => q.required !== false && !q.answer?.trim()))
        throw new EngineError("The approved plan still has unanswered required questions. Record those decisions before starting a coding worker.", 3, "wring plan");
    await preflightContainer(repo, config);
    const auth = await workerAuth(repo, config);
    options.onEvent?.({ type: "worker.auth", ...auth });
    if (auth.blocking)
        throw new EngineError(auth.words, 2, auth.next_move);
    let max = options.maxIterations ?? config.run.max_iterations;
    if (!Number.isInteger(max) || max < 1 || max > config.run.max_iterations)
        throw new EngineError(`maxIterations may tighten the declared ceiling of ${config.run.max_iterations}, never expand it`);
    if (options.workerTimeout !== undefined && (!Number.isFinite(options.workerTimeout) || options.workerTimeout <= 0 || options.workerTimeout > config.run.worker_timeout))
        throw new EngineError(`workerTimeout may tighten the declared ceiling of ${config.run.worker_timeout}, never expand it`);
    if (options.wallClock !== undefined && (!Number.isFinite(options.wallClock) || options.wallClock <= 0 || (config.run.wall_clock !== undefined && options.wallClock > config.run.wall_clock)))
        throw new EngineError("wallClock may tighten a declared wall-clock ceiling, never expand it");
    const release = await acquireLock(repo);
    try {
        const directory = await safePath(repo, options.resume ?? `.wringer/loops/${newId()}`);
        const previous = options.resume ? await maybeJson(join(directory, "manifest.json")) : null;
        if (options.resume && (!previous || !["wringer.loop.v1", "wringer.loop.v2"].includes(previous.schema_version)))
            throw new EngineError(`Not a resumable loop: ${directory}`);
        if (previous) {
            const integrity = await validateDigests(directory);
            if (!integrity.ok)
                throw new EngineError(`Cannot resume altered loop: ${integrity.errors.join("; ")}`, 3);
            max = Math.min(max, previous.config.max_iterations);
        }
        const loop_id = previous?.loop_id ?? basename(directory), started_at = previous?.started_at ?? now();
        const bundle = await new Bundle(directory, new Redactor(config.evidence.redact.env), "loop.jsonl", options.onEvent).prepare();
        const documents = previous ? (await maybeJson(join(directory, "briefed.json")))?.documents : await authority(repo);
        if (!documents)
            throw new EngineError("Resumed loop has no authority record; it cannot safely guess which plan was approved", 3);
        if (!previous)
            await bundle.json("briefed.json", { schema_version: "wringer.briefed.v1", captured_at: now(), documents });
        const checkpoint = previous ? await maybeJson(join(directory, "checkpoint.json")) : null;
        if (previous && (!checkpoint || checkpoint.schema_version !== "wringer.native.loop-checkpoint.v1" || !Number.isSafeInteger(checkpoint.workers) || checkpoint.workers < 0 || !Number.isSafeInteger(checkpoint.iterations) || checkpoint.iterations < 0))
            throw new EngineError("This loop has no valid native worker-count checkpoint. Its remaining spending authority cannot be inferred; no worker was started.", 3, "wring explain");
        let workers = checkpoint?.workers ?? 0, iterations = checkpoint?.iterations ?? 0;
        let final: VerifyOutcome | null = null;
        let reason = "max_iterations", status: RunOutcome["status"] = "stopped";
        if (previous)
            await bundle.event("loop.resumed", { iterations_done: iterations, reaped_pgids: [] });
        else
            await bundle.event("loop.started", { loop_id, wringer_version: VERSION, repo: basename(repo), sha: initial.head_sha, max_iterations: max });
        const sessionStart = Date.now(), elapsedBefore = checkpoint?.elapsed_ms ?? 0, wallCeiling = Math.min(options.wallClock ?? config.run.wall_clock ?? 86400, checkpoint?.wall_clock ?? 86400), deadline = sessionStart + wallCeiling * 1000 - elapsedBefore;
        let established: unknown;
        const checkpointValue = () => ({ schema_version: "wringer.native.loop-checkpoint.v1", workers, iterations, final_run: final?.evidence_dir ?? checkpoint?.final_run ?? null, at: now(), elapsed_ms: elapsedBefore + Date.now() - sessionStart, wall_clock: wallCeiling });
        while (true) {
            if (options.signal?.aborted) {
                reason = "interrupted";
                status = "interrupted";
                break;
            }
            const currentAuthority = await authority(repo);
            if (["wringer.spec.yaml", "wringer.rubric.yaml", ".wringer.yaml"].some(n => documents[n] !== currentAuthority[n])) {
                reason = "authority_moved";
                break;
            }
            if (Date.now() >= deadline) {
                reason = "wall_clock";
                break;
            }
            iterations++;
            await bundle.event("iteration.started", { iteration: iterations });
            const verifyController = new AbortController(), abortVerify = () => verifyController.abort();
            options.signal?.addEventListener("abort", abortVerify, { once: true });
            if (options.signal?.aborted)
                abortVerify();
            const verifyDeadline = setTimeout(abortVerify, Math.max(1, deadline - Date.now()));
            try {
                final = await verify(repo, { gate: options.gate, serial: options.serial, signal: verifyController.signal, onEvent: options.onEvent, workerExecution: established });
            }
            finally {
                clearTimeout(verifyDeadline);
                options.signal?.removeEventListener("abort", abortVerify);
            }
            await bundle.event("verify.finished", { iteration: iterations, status: final.status, evidence_dir: final.evidence_dir, ...(final.failed_gate ? { failed_gate: final.failed_gate } : {}) });
            await bundle.json("checkpoint.json", checkpointValue());
            if (final.status === "interrupted") {
                const exhausted = Date.now() >= deadline && !options.signal?.aborted;
                status = exhausted ? "stopped" : "interrupted";
                reason = exhausted ? "wall_clock" : "interrupted";
                break;
            }
            if ((await maybeJson(join(repo, final.evidence_dir, "check-mutations.json")))?.refuses) {
                reason = "check_mutated";
                break;
            }
            if (final.stability?.gates?.some((g: any) => g.routing === "no_repair" && !g.optional)) {
                reason = "flaky_gate";
                break;
            }
            if (final.vacuity && ["gates_vacuous", "inconclusive"].includes(final.vacuity.verdict)) {
                reason = final.vacuity.verdict;
                break;
            }
            if (final.status === "passed") {
                status = "converged";
                reason = final.acceptance?.criteria.some((r: any) => r.refuses) ? "checks_passed_acceptance_pending" : "converged";
                break;
            }
            if (workers >= max) {
                reason = "max_iterations";
                break;
            }
            config = await loadConfig(repo);
            if (!config.run)
                throw new EngineError("Worker declaration was removed during the loop");
            if (selectedWorker)
                config.run.worker = selectedWorker;
            const before = await snapshot(repo);
            const iterationDir = `iterations/${String(iterations).padStart(3, "0")}`;
            const diagnosis = await explain(repo, final.evidence_dir);
            const task = options.task ?? spec?.intent ?? "Make the required checks pass without weakening their assertions.";
            const brief = [`# Repair iteration ${iterations}`, "", task, "", "## Evidence", JSON.stringify({ status: final.status, failed_gate: final.failed_gate, evidence_dir: final.evidence_dir, rerun: final.rerun }, null, 2), "", "## Failing check", `Command: ${diagnosis.command}`, "Standard output:", diagnosis.stdout, "Standard error:", diagnosis.stderr, "", "Implement the approved requirement. Do not weaken checks, change the approved plan, or edit .wringer/. Re-check using the command printed above. Your exit code is recorded; verification decides the result.", "", spec ? `Approved plan:\n${JSON.stringify(spec, null, 2)}` : ""].join("\n");
            await bundle.write(`${iterationDir}/brief.md`, brief);
            const replacements: Record<string, string> = { brief: posix(relative(repo, join(directory, iterationDir, "brief.md"))), evidence_dir: final.evidence_dir, iteration: String(iterations) };
            // Generated relative paths contain only safe slugs, avoiding quote-context injection in existing worker recipes.
            for (const value of Object.values(replacements))
                if (!/^[A-Za-z0-9_./-]+$/.test(value))
                    throw new EngineError("Worker evidence paths contain characters unsafe for placeholder substitution", 3);
            const command = config.run.worker.replace(/(?<!\$)\{(brief|evidence_dir|iteration)\}/g, (_, name) => replacements[name]!);
            await bundle.event("worker.started", { iteration: iterations, command });
            workers++;
            await bundle.json("checkpoint.json", checkpointValue());
            const workerOptions = { cwd: repo, timeout: Math.max(0.001, Math.min(options.workerTimeout ?? config.run.worker_timeout, config.run.worker_timeout, (deadline - Date.now()) / 1000)), signal: options.signal, redactor: bundle.redactor };
            const contained = config.run.containment ? await runContainedWorker(repo, config, bundle, iterationDir, command, workerOptions) : null;
            const work = contained?.result ?? await runProcess(command, workerOptions);
            if (contained)
                established = contained.established;
            await bundle.write(`${iterationDir}/worker.stdout.log`, work.stdout);
            await bundle.write(`${iterationDir}/worker.stderr.log`, work.stderr);
            if (work.interrupted) {
                status = "interrupted";
                reason = "interrupted";
                break;
            }
            await bundle.event("worker.finished", { iteration: iterations, exit_code: work.exit_code, duration_ms: work.duration_ms, ...(work.timed_out ? { timed_out: true } : {}) });
            if (Date.now() >= deadline) {
                reason = "wall_clock";
                break;
            }
            if ((await snapshot(repo)).fingerprint === before.fingerprint) {
                reason = "no_progress";
                await bundle.json("worker-diagnosis.json", { schema_version: "wringer.native.worker-diagnosis.v1", exit_code: work.exit_code, timed_out: work.timed_out, stdout_tail: work.stdout.split("\n").slice(-20).join("\n"), stderr_tail: work.stderr.split("\n").slice(-20).join("\n"), reason: "The worker changed no tracked or untracked work. Both output streams are included so a causal error cannot be hidden by a harmless final stderr line." });
                break;
            }
        }
        const next_move = status === "converged" ? (reason === "checks_passed_acceptance_pending" ? "wringer-board" : "wring deliver") : `wring resume ${posix(relative(repo, directory))}`;
        const outcome: RunOutcome = { status, reason, iterations, worker_turns: workers, loop_dir: posix(relative(repo, directory)), final, exit_code: status === "converged" ? 0 : status === "interrupted" ? 4 : 1, next_move };
        await bundle.event("loop.finished", { status, reason, iterations });
        await bundle.json("manifest.json", { schema_version: "wringer.loop.v2", loop_id, started_at, repo: { root: ".", head_sha: initial.head_sha, branch: initial.branch, dirty: initial.dirty }, config: { max_iterations: max, worker: config.run!.worker }, result: { status, reason, iterations, final_run: final?.evidence_dir ?? checkpoint?.final_run ?? null } });
        await bundle.write("summary.md", `# Build ${loop_id}\n\n${status}: ${reason}.\n\nWorker turns: ${workers} of ${max}. Verification records: ${iterations}.\n\n${final ? `Last verification: [${final.manifest.run_id}](../../${final.evidence_dir.replace(/^\.wringer\//, "")}/summary.md).` : "No verification completed."}\n\nNext: \`${next_move}\`\n`);
        await bundle.json("checkpoint.json", checkpointValue());
        await bundle.seal();
        return outcome;
    }
    finally {
        await release();
    }
}
