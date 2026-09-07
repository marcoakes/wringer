import { mkdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { Bundle, EngineError, git, loadConfig, newId, now, Redactor, run, runProcess, safePath, snapshot, verify } from "@wringer/engine";
export async function bench(repo: string, options: {
    send?: boolean;
    repeats?: number;
    contenders?: string[];
    signal?: AbortSignal;
} = {}) {
    options.signal?.throwIfAborted();
    repo = resolve(repo);
    const config = await loadConfig(repo), policy = config.bench as any;
    if (!config.run || !policy || !Number.isSafeInteger(policy.contender_wall_clock) || policy.contender_wall_clock < 1 || policy.contenders?.length < 2)
        throw new EngineError("A benchmark needs run ceilings, bench.contender_wall_clock, and at least two declared contenders. Use wring run for one worker.");
    const selected = policy.contenders.filter((c: any) => !options.contenders || options.contenders.includes(c.id));
    if (selected.length < 2 || options.contenders?.some(id => !selected.some((c: any) => c.id === id)))
        throw new Error("Select at least two known contenders; use wring run for a single worker");
    const repeats = options.repeats ?? policy.attempts ?? 1, parallel = policy.parallel ?? 1;
    if (!Number.isInteger(repeats) || repeats < 1 || repeats > (policy.attempts ?? 1))
        throw new Error("--repeats may only tighten the declared bench.attempts ceiling");
    if (!options.send)
        return { status: "prepared", contenders: selected.map((c: any) => c.id), attempts: repeats, parallel, contender_wall_clock: policy.contender_wall_clock, next_move: `wring bench --repo ${quote(repo)} --repeats ${repeats} ${selected.map((c: any) => `--contender ${quote(c.id)}`).join(" ")} --send`, message: "No worker was started. --send authorizes this declared comparison; it does not publish anything." };
    const snap = await snapshot(repo);
    if (!snap.head_sha || snap.dirty)
        throw new EngineError("Benchmark requires a clean committed baseline, including its declared contenders and checks. No commit was invented.", 3, `git -C ${quote(repo)} status --short`);
    const id = newId(), started = now(), root = await safePath(repo, `.wringer/worktrees/bench-${id}`);
    await mkdir(root, { recursive: true });
    const retained: Record<string, string> = {};
    async function worktree(name: string) {
        const path = await safePath(repo, `.wringer/worktrees/bench-${id}/${name}`);
        await git(repo, ["worktree", "add", "--detach", path, snap.head_sha!]);
        retained[name] = path;
        if ((await snapshot(path)).head_sha !== snap.head_sha)
            throw new Error(`Worktree ${name} disagrees with the recorded baseline`);
        if (config.run?.prove_setup) {
            const setup = await runProcess(config.run.prove_setup, { cwd: path, timeout: 120, signal: options.signal });
            if (setup.exit_code || setup.timed_out || setup.interrupted)
                throw new EngineError(`Baseline environment setup failed in ${path}: ${setup.stderr}`, setup.interrupted ? 4 : 2);
        }
        return path;
    }
    const baseline = await worktree("baseline"), red = await verify(baseline, { signal: options.signal });
    if (red.status === "interrupted")
        throw new EngineError("Benchmark baseline verification was interrupted; its evidence and worktree are preserved.", 4, `wring explain --repo ${quote(baseline)}`);
    const failing = red.results.filter(g => !g.optional && g.status === "failed" && !g.timed_out && g.exit_code > 0 && ![126, 127].includes(g.exit_code)).map(g => g.gate_id);
    if (!failing.length)
        throw new EngineError(`No genuine required gate fails at the committed baseline. Commit a failing check before benchmarking. Baseline evidence remains at ${join(baseline, red.evidence_dir)}.`, 1, `wring explain --repo ${quote(baseline)}`);
    const directory = await safePath(repo, `.wringer/benches/${id}`), bundle = await new Bundle(directory, new Redactor(config.evidence.redact.env), "bench.jsonl").prepare();
    await bundle.event("bench.started", { bench_id: id, sha: snap.head_sha, contenders: selected.map((c: any) => c.id), contender_wall_clock: policy.contender_wall_clock });
    await bundle.event("baseline.verified", { status: "failed", failing_gates: failing, run_ref: join(baseline, red.evidence_dir) });
    const jobs = selected.flatMap((c: any) => Array.from({ length: repeats }, (_, i) => ({ contender: c, attempt: i + 1 }))), rows: any[] = Array(jobs.length);
    let cursor = 0;
    async function worker() {
        for (;;) {
            const index = cursor++;
            if (index >= jobs.length)
                return;
            const job = jobs[index]!, before = performance.now();
            if (options.signal?.aborted) {
                rows[index] = { contender: job.contender.id, outcome: "interrupted", reason: "Stopped before this attempt", iterations: 0, wall_clock_ms: 0, loop_ref: "", head_moved: false, ...(repeats > 1 ? { attempt: job.attempt } : {}) };
                continue;
            }
            let path: string | undefined;
            await bundle.event("contender.started", { contender: job.contender.id });
            try {
                path = await worktree(`${job.contender.id}-${job.attempt}`);
                const result = await run(path, { declaredWorker: job.contender.id, wallClock: Math.min(policy.contender_wall_clock, config.run!.wall_clock ?? Infinity), signal: options.signal });
                const row: any = { contender: job.contender.id, outcome: result.status, reason: result.reason, iterations: result.iterations, wall_clock_ms: Math.round(performance.now() - before), loop_ref: join(path, result.loop_dir), head_moved: (await snapshot(path)).head_sha !== snap.head_sha, ...(result.final ? { final_run: join(path, result.final.evidence_dir) } : {}), ...(repeats > 1 ? { attempt: job.attempt } : {}) };
                const usage = join(path, result.loop_dir, "usage.json");
                if (await Bun.file(usage).exists()) {
                    const data = await Bun.file(usage).json();
                    if (data.schema_version === "wringer.usage.v1" && data.totals)
                        row.usage = data.totals;
                }
                rows[index] = row;
            }
            catch (error) {
                rows[index] = { contender: job.contender.id, outcome: options.signal?.aborted ? "interrupted" : "error", reason: String(error), iterations: 0, wall_clock_ms: Math.round(performance.now() - before), loop_ref: "", head_moved: path ? (await snapshot(path)).head_sha !== snap.head_sha : false, ...(repeats > 1 ? { attempt: job.attempt } : {}) };
            }
            // Persist partial completed observations even if a later process is killed.
            await bundle.json(`observations/${index.toString().padStart(3, "0")}.json`, rows[index]);
            // Repeated-attempt identity lives in manifest v2 and observations, not a
            // new key smuggled into the already-frozen event family.
            const { attempt: _, ...event } = rows[index];
            await bundle.event("contender.finished", event);
        }
    }
    await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker));
    const limits = [`${repeats} independent attempt(s) per contender. Agents are stochastic; a difference within noise is noise.`, "Usage and cost are the agent's own report, unverified. Absent means unreported, never zero.", "A green gate proves the gates went green, not that the fix is honest; read the diffs before believing any row.", ...(parallel > 1 ? ["Wall-clock measurements are contended; rows may not be compared on elapsed time."] : [])];
    const manifest = { schema_version: repeats > 1 ? "wringer.bench.v2" : "wringer.bench.v1", bench_id: id, started_at: started, baseline: { sha: snap.head_sha, run_dir: join(baseline, red.evidence_dir), failing_gates: failing }, contender_wall_clock: policy.contender_wall_clock, contenders: rows, limits, ...(repeats > 1 ? { attempts: repeats } : {}), ...(parallel > 1 ? { parallel } : {}) };
    await bundle.event("bench.finished", { rows: rows.length });
    await bundle.json("manifest.json", manifest);
    await bundle.json("retained-worktrees.json", { schema_version: "wringer.native.bench-worktrees.v1", retained });
    await bundle.write("summary.md", `# Benchmark ${id}\n\n| Contender | Outcome | Verification laps | Wall time | Usage |\n|---|---|---|---|---|\n${rows.map(r => `| ${r.contender} | ${r.outcome} | ${r.iterations} | ${r.wall_clock_ms} ms | ${r.usage ? JSON.stringify(r.usage) : "Not reported"} |`).join("\n")}\n\n${limits.map(l => `- ${l}`).join("\n")}\n\n${rows.filter(r => r.final_run).map(r => `Review: wringer-board render --repo ${quote(dirnameOfRun(r.final_run))} --run ${quote(relative(dirnameOfRun(r.final_run), r.final_run))}`).join("\n")}\n\nWorktrees and their evidence are retained: ${JSON.stringify(retained, null, 2)}\n`);
    await bundle.seal();
    return { status: options.signal?.aborted ? "interrupted" : "completed", directory, ...manifest };
}
function dirnameOfRun(path: string) { return path.slice(0, path.lastIndexOf("/.wringer/")); }
import { quote } from "./args";
