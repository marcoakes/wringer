import { mkdir, readFile, realpath } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { Bundle, EngineError, Redactor, git, loadConfig, newId, now, run, safePath, sha256, snapshot, validateDigests, type EventCallback, type RunOutcome } from "@wringer/engine";
import { boundedSignal, integer, isObject, keys, ledger, slug, type Obj } from "./shared";
export interface FleetTask {
    id: string;
    brief: string;
    dir?: string;
    depends_on?: string[];
}
export interface FleetConfig {
    concurrency: number;
    deadline: number;
    progress_window: number;
    retries: number;
    on_exhausted: "park" | "fail";
    join: string;
    worktree: boolean;
    child: {
        max_iterations?: number;
        worker_timeout?: number;
        wall_clock?: number;
    };
}
export interface FleetOptions {
    resume?: string;
    signal?: AbortSignal;
    onEvent?: EventCallback;
    worktree?: boolean;
}
export interface FleetRow {
    id: string;
    status: "succeeded" | "failed" | "parked";
    reason: string;
    attempts: number;
    loops: string[];
}
export interface FleetOutcome {
    fleet_id: string;
    fleet_dir: string;
    exit_code: number;
    succeeded: number;
    failed: number;
    parked: number;
    join_satisfied: boolean;
    tasks: FleetRow[];
    next_move: string;
}
export function parseFleetConfig(value: unknown): FleetConfig {
    if (!isObject(value))
        throw new EngineError("Declare fleet bounds in .wringer.yaml before starting parallel workers.");
    keys(value, ["concurrency", "deadline", "progress_window", "retries", "on_exhausted", "join", "child", "worktree", "worker_fallbacks", "scope"], "fleet");
    if (value.worker_fallbacks !== undefined && (!Array.isArray(value.worker_fallbacks) || value.worker_fallbacks.length))
        throw new EngineError("Worker fallback commands are not implemented in this native scheduler. Use a declared worker in each task's own configuration.");
    if (value.scope !== undefined)
        throw new EngineError("Explicit fleet scope files are not implemented in this native scheduler; task repositories each run their own complete declared check set.");
    const concurrency = integer(value.concurrency ?? 1, "fleet.concurrency", 1, 64), deadline = integer(value.deadline, "fleet.deadline"), progress_window = integer(value.progress_window ?? 1200, "fleet.progress_window"), retries = integer(value.retries ?? 0, "fleet.retries", 0, 20);
    const on_exhausted = value.on_exhausted ?? "park";
    if (!["park", "fail"].includes(on_exhausted))
        throw new EngineError("fleet.on_exhausted must be park or fail.");
    const join = value.join ?? "all";
    if (!["all", "first_pass"].includes(join) && !/^quorum:(?:0\.\d+|1(?:\.0+)?)$/.test(join))
        throw new EngineError("fleet.join must be all, first_pass, or quorum:0.8.");
    if (join.startsWith("quorum:") && Number(join.slice(7)) <= 0)
        throw new EngineError("A fleet quorum must be greater than zero.");
    if (value.worktree !== undefined && typeof value.worktree !== "boolean")
        throw new EngineError("fleet.worktree must be true or false.");
    const child = value.child ?? {};
    if (!isObject(child))
        throw new EngineError("fleet.child must be a budget mapping.");
    keys(child, ["max_iterations", "worker_timeout", "wall_clock"], "fleet.child");
    for (const [name, bound] of Object.entries(child))
        integer(bound, `fleet.child.${name}`);
    return { concurrency, deadline, progress_window, retries, on_exhausted, join, child, worktree: value.worktree ?? false };
}
export function validateTasks(value: unknown): FleetTask[] {
    if (!Array.isArray(value) || !value.length)
        throw new EngineError("A fleet needs at least one task.");
    if (value.length > 1000)
        throw new EngineError("A fleet is limited to 1,000 declared tasks.");
    const ids = new Set<string>();
    for (const task of value) {
        if (!isObject(task))
            throw new EngineError("Each task must be an object.");
        keys(task, ["id", "brief", "dir", "depends_on"], "task");
        slug(task.id, "task.id");
        if (ids.has(task.id))
            throw new EngineError(`Duplicate task '${task.id}'.`);
        ids.add(task.id);
        if (typeof task.brief !== "string" || !task.brief)
            throw new EngineError(`Task ${task.id} needs a brief file path.`);
        if (task.dir !== undefined && typeof task.dir !== "string")
            throw new EngineError(`Task ${task.id} dir must be a path.`);
        if (task.depends_on !== undefined && (!Array.isArray(task.depends_on) || task.depends_on.some((v: unknown) => typeof v !== "string")))
            throw new EngineError(`Task ${task.id} depends_on must list task ids.`);
    }
    for (const task of value)
        for (const dependency of task.depends_on ?? [])
            if (!ids.has(dependency) || dependency === task.id)
                throw new EngineError(`Task ${task.id} has unknown or self dependency ${dependency}.`);
    const tasks = value as FleetTask[];
    const done = new Set<string>(), active = new Set<string>();
    function visit(id: string) {
        if (active.has(id))
            throw new EngineError(`Task dependency cycle reaches ${id}.`);
        if (done.has(id))
            return;
        active.add(id);
        for (const dep of tasks.find(t => t.id === id)!.depends_on ?? [])
            visit(dep);
        active.delete(id);
        done.add(id);
    }
    for (const id of ids)
        visit(id);
    return tasks;
}
export async function loadTasks(path: string): Promise<FleetTask[]> {
    const lines = (await readFile(path, "utf8")).split("\n"), tasks: unknown[] = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (!line)
            continue;
        try {
            tasks.push(JSON.parse(line));
        }
        catch {
            throw new EngineError(`Task file line ${i + 1} is not valid JSON.`);
        }
    }
    return validateTasks(tasks);
}
function joined(config: FleetConfig, rows: FleetRow[]) { const succeeded = rows.filter(r => r.status === "succeeded").length; return config.join === "all" ? succeeded === rows.length : config.join === "first_pass" ? succeeded > 0 : succeeded / rows.length >= Number(config.join.slice(7)); }
function failureSignature(outcome: RunOutcome) { return sha256(JSON.stringify([outcome.reason, outcome.final?.failed_gate, outcome.final?.results.filter(g => g.status === "failed").map(g => [g.gate_id, g.command, g.exit_code, g.timed_out])])); }
export async function runFleet(repo: string, input: string | FleetTask[], options: FleetOptions = {}): Promise<FleetOutcome> {
    repo = await realpath(repo);
    const parent = await loadConfig(repo);
    let config = parseFleetConfig(parent.fleet);
    if (options.worktree !== undefined)
        config.worktree = options.worktree;
    const directory = await safePath(repo, options.resume ?? `.wringer/fleets/${newId()}`), fleet_id = basename(directory);
    const previous = options.resume ? await ledger(directory, "fleet.jsonl") : [];
    if (options.resume) {
        const seal = await validateDigests(directory);
        if (!seal.ok)
            throw new EngineError(`Fleet evidence changed: ${seal.errors.join("; ")}`, 3);
        config = parseFleetConfig(JSON.parse(await readFile(join(directory, "settings.json"), "utf8")));
    }
    const tasks = options.resume ? validateTasks(JSON.parse(await readFile(join(directory, "tasks.resolved.json"), "utf8"))) : typeof input === "string" ? await loadTasks(await safePath(repo, input)) : validateTasks(input);
    const rows: FleetRow[] = tasks.map(t => ({ id: t.id, status: "parked", reason: "not-started", attempts: 0, loops: [] }));
    const completed = new Set<string>(), signatures = new Map<string, Set<string>>(), taskDirs = new Map<string, string>();
    for (const event of previous) {
        const row = rows.find(r => r.id === event.task);
        if (!row)
            continue;
        if (event.type === "task.started")
            row.attempts = Math.max(row.attempts, event.attempt);
        if (event.type === "task.worktree")
            taskDirs.set(row.id, event.path);
        if (event.type === "task.finished" && event.status) {
            row.status = event.status;
            row.reason = event.reason ?? "";
            if (event.loop)
                row.loops.push(event.loop);
            if (row.status === "succeeded")
                completed.add(row.id);
            if (event.failure_signature) {
                const seen = signatures.get(row.id) ?? new Set<string>();
                seen.add(event.failure_signature);
                signatures.set(row.id, seen);
            }
        }
    }
    const bundle = await new Bundle(directory, new Redactor(parent.evidence.redact.env), "fleet.jsonl", options.onEvent).prepare();
    const startedAt = previous.find(e => e.type === "fleet.started")?.ts ?? now(), deadline = Date.parse(startedAt) + config.deadline * 1000;
    if (!options.resume) {
        await bundle.json("tasks.resolved.json", tasks);
        await bundle.json("settings.json", config);
        await bundle.event("fleet.started", { fleet_id, tasks: tasks.length, concurrency: config.concurrency, deadline: config.deadline });
    }
    const parentTree = config.worktree ? await snapshot(repo) : null;
    if (config.worktree && (!parentTree?.head_sha || parentTree.dirty))
        throw new EngineError("Fleet worktrees start from a committed clean baseline. Commit the approved configuration and task inputs first; the scheduler will not invent a commit.", 3);
    // Resolve all explicit directories before starting any worker; sharing a Git root would race its index and evidence.
    if (!config.worktree) {
        const roots = new Set<string>();
        for (const task of tasks) {
            if (!task.dir)
                throw new EngineError(`Task ${task.id} must declare dir, or enable fleet.worktree.`);
            const path = await safePath(repo, task.dir);
            const root = await realpath((await git(path, ["rev-parse", "--show-toplevel"])).stdout.trim());
            if (roots.has(root))
                throw new EngineError(`Parallel tasks share the Git working tree ${root}. Use separate repositories or fleet.worktree.`, 3);
            roots.add(root);
            taskDirs.set(task.id, root);
        }
    }
    const running = new Map<string, Promise<void>>(), pending = new Set(tasks.filter(t => !completed.has(t.id)).map(t => t.id));
    const park = async (row: FleetRow, reason: string, why: "deadline" | "worktree_failed" | "missing_dir" | "deterministic" | "exhausted" = "exhausted") => { row.status = config.on_exhausted === "fail" && why === "exhausted" ? "failed" : "parked"; row.reason = reason; await bundle.event(row.status === "failed" ? "task.finished" : "task.parked", { task: row.id, why }); completed.add(row.id); };
    async function attempt(task: FleetTask) {
        const row = rows.find(r => r.id === task.id)!;
        if (row.attempts >= config.retries + 1) {
            await park(row, "The declared attempt budget was already spent.");
            return;
        }
        let taskRepo = taskDirs.get(task.id);
        if (config.worktree && !taskRepo) {
            taskRepo = await safePath(repo, `.wringer/worktrees/${fleet_id}/${task.id}`);
            await mkdir(join(repo, ".wringer/worktrees", fleet_id), { recursive: true });
            try {
                await git(repo, ["worktree", "add", "--detach", taskRepo, parentTree!.head_sha!]);
                taskDirs.set(task.id, taskRepo);
                await bundle.event("task.worktree", { task: task.id, path: taskRepo });
            }
            catch (error) {
                await park(row, `Could not create task worktree: ${(error as Error).message}`, "worktree_failed");
                return;
            }
        }
        const briefPath = await safePath(repo, task.brief);
        const taskText = await readFile(briefPath, "utf8");
        if (taskText.length > 256 * 1024) {
            await park(row, "Task brief exceeds the 256 KiB input limit.", "missing_dir");
            return;
        }
        while (row.attempts <= config.retries) {
            if (options.signal?.aborted || Date.now() >= deadline) {
                await park(row, "Fleet deadline or interruption stopped this task.", "deadline");
                return;
            }
            const childConfig = await loadConfig(taskRepo!);
            if (!childConfig.run) {
                await park(row, "Task repository has no declared worker.", "missing_dir");
                return;
            }
            const remaining = (deadline - Date.now()) / 1000;
            const timeout = boundedSignal(Math.min(config.child.wall_clock ?? Infinity, remaining), options.signal);
            let lastProgress = Date.now(), silent = false;
            const silence = new AbortController();
            const monitor = setInterval(() => {
                if (Date.now() - lastProgress > config.progress_window * 1000) {
                    silent = true;
                    silence.abort();
                }
            }, Math.min(1000, config.progress_window * 250));
            row.attempts++;
            await bundle.event("task.started", { task: task.id, attempt: row.attempts, dir: taskRepo! });
            let outcome: RunOutcome;
            try {
                outcome = await run(taskRepo!, { maxIterations: Math.min(config.child.max_iterations ?? childConfig.run.max_iterations, childConfig.run.max_iterations), workerTimeout: Math.min(config.child.worker_timeout ?? childConfig.run.worker_timeout, childConfig.run.worker_timeout), wallClock: Math.min(config.child.wall_clock ?? Infinity, childConfig.run.wall_clock ?? Infinity, remaining), task: taskText, signal: AbortSignal.any([timeout.signal, silence.signal]), onEvent: event => { lastProgress = Date.now(); options.onEvent?.({ ...event, task: task.id }); } });
            }
            catch (error) {
                row.status = "failed";
                row.reason = (error as Error).message;
                await bundle.event("task.finished", { task: task.id, status: "failed", reason: row.reason, loop: null });
                completed.add(task.id);
                return;
            }
            finally {
                clearInterval(monitor);
                timeout.dispose();
            }
            const loop = join(taskRepo!, outcome.loop_dir);
            row.loops.push(loop);
            if (silent) {
                await bundle.event("task.reaped", { task: task.id });
                await park(row, "The child produced no ledger progress within its declared progress window.", "deterministic");
                return;
            }
            if (outcome.status === "converged" && !outcome.final?.acceptance?.criteria.some((r: any) => r.refuses)) {
                row.status = "succeeded";
                row.reason = "";
                await bundle.event("task.finished", { task: task.id, status: "succeeded", loop });
                completed.add(task.id);
                return;
            }
            const signature = failureSignature(outcome), seen = signatures.get(task.id) ?? new Set<string>();
            row.status = "failed";
            row.reason = outcome.reason;
            await bundle.event("task.finished", { task: task.id, status: "failed", reason: row.reason, loop, failure_signature: signature });
            if (seen.has(signature) || ["no_progress", "authority_moved", "checks_passed_acceptance_pending"].includes(outcome.reason)) {
                await park(row, "Identical or non-repairable input will not be retried.", "deterministic");
                return;
            }
            seen.add(signature);
            signatures.set(task.id, seen);
            if (row.attempts > config.retries) {
                await park(row, "The declared attempt ceiling was reached.");
                return;
            }
            await bundle.event("task.retried", { task: task.id, after: signature });
        }
    }
    while (pending.size || running.size) {
        let launched = false;
        for (const id of [...pending]) {
            if (running.size >= config.concurrency)
                break;
            const task = tasks.find(t => t.id === id)!, row = rows.find(r => r.id === id)!;
            if (options.signal?.aborted || Date.now() >= deadline) {
                pending.delete(id);
                await park(row, "Fleet stopped before this task started.", "deadline");
                continue;
            }
            const dependencies = (task.depends_on ?? []).map(dep => rows.find(r => r.id === dep)!);
            if (dependencies.some(r => completed.has(r.id) && r.status !== "succeeded")) {
                pending.delete(id);
                await park(row, "A prerequisite task did not succeed.");
                continue;
            }
            if (dependencies.some(r => !completed.has(r.id)))
                continue;
            pending.delete(id);
            const work = attempt(task).catch(async (error) => { await park(row, (error as Error).message, "missing_dir"); }).finally(() => running.delete(id));
            running.set(id, work);
            launched = true;
        }
        if (running.size)
            await Promise.race(running.values());
        else if (pending.size && !launched) {
            for (const id of pending)
                await park(rows.find(r => r.id === id)!, "No runnable prerequisites remain.");
            pending.clear();
        }
    }
    const counts = { succeeded: rows.filter(r => r.status === "succeeded").length, failed: rows.filter(r => r.status === "failed").length, parked: rows.filter(r => r.status === "parked").length, join_satisfied: joined(config, rows) };
    await bundle.event("fleet.finished", counts);
    await bundle.json("manifest.json", { schema_version: "wringer.fleet.v1", fleet_id, started_at: startedAt, config: { concurrency: config.concurrency, deadline: config.deadline, retries: config.retries, join: config.join }, result: counts, tasks: rows });
    await bundle.json("worktrees.json", { schema_version: "wringer.native.fleet-worktrees.v1", retained: true, reason: "Worker changes and evidence remain available; the scheduler never deletes their only copy or merges independent work.", tasks: Object.fromEntries(taskDirs) });
    const next_move = counts.join_satisfied ? `Review .wringer/fleets/${fleet_id}/summary.md and the retained task worktrees.` : `wring resume ${relative(repo, directory)}`;
    await bundle.write("summary.md", `# Fleet ${fleet_id}\n\n${counts.succeeded} succeeded · ${counts.failed} failed · ${counts.parked} parked. Join ${counts.join_satisfied ? "satisfied" : "not satisfied"}.\n\n${rows.map(r => `- ${r.id}: ${r.status}, ${r.attempts} attempt(s). ${r.reason}`).join("\n")}\n\nEach task ran in a separate Git working tree. Dependency order does not merge predecessor changes. Worktrees and their original evidence are retained in worktrees.json.\n\nNext: ${next_move}\n`);
    await bundle.seal();
    return { fleet_id, fleet_dir: relative(repo, directory), exit_code: options.signal?.aborted ? 4 : counts.join_satisfied ? 0 : 1, ...counts, tasks: rows, next_move };
}
