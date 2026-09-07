import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EngineError, loadConfig, parseConfig, parseYaml, run, verify, doctor, safePath, type EventCallback } from "@wringer/engine";
import { loadBoard, renderHtml } from "@wringer/board";
import type { DriveServices, CompiledPlan, ServiceResult } from "@wringer/workflow";
async function outcome(repo: string, value: any): Promise<ServiceResult> {
    const model = await loadBoard(repo, value.evidence_dir);
    const readable = model.acceptanceCounts !== null && model.facts.checksPassing === true && !model.issues.some(i => !["source-unfrozen", "source-missing", "optional-absent"].includes(i.code));
    return { status: value.status === "passed" && !readable ? "failed" : value.status, runId: value.manifest?.run_id, evidenceDir: value.evidence_dir, ...(!readable ? { reason: "evidence-incomplete", message: "The recorded checks or requirement evidence could not be read completely. The board does not authorize readiness." } : {}), humanPending: model.requirements.filter(r => r.required && r.human && (!r.judgement || r.judgement.stale || r.judgement.verdict !== "met")).map(r => r.id), unproved: model.requirements.filter(r => r.required && !r.human && !r.proved).map(r => r.id), nextMove: model.nextAction.command ?? undefined };
}
export function createServices(signal?: AbortSignal, onEvent?: EventCallback): DriveServices {
    return {
        async preflight(repo) {
            signal?.throwIfAborted();
            const config = await loadConfig(repo);
            if (!config.run)
                return { status: "failed", reason: "No worker is declared in .wringer.yaml.", nextMove: "wring start --help" };
            const report = await doctor(repo);
            return { ...report, status: report.worker_auth?.blocking || report.status === "blocked" ? "failed" : "passed", message: report.worker_auth?.words, nextMove: report.worker_auth && "next_move" in report.worker_auth ? report.worker_auth.next_move : undefined };
        },
        async installGates(repo, plan) {
            signal?.throwIfAborted();
            const path = await safePath(repo, ".wringer.yaml"), raw = parseYaml(await readFile(path, "utf8"));
            const current = await loadConfig(repo), owned = new Set(plan.gates.map(g => g.id));
            for (const gate of current.gates)
                if (owned.has(gate.id)) {
                    const proposed = plan.gates.find(g => g.id === gate.id)!;
                    if (gate.run !== proposed.run || gate.proves.join(",") !== proposed.proves)
                        throw new Error(`Approved gate ${gate.id} conflicts with the repository's existing declaration`);
                }
            // A matching proposal may bind existing evidence, not erase the repository's
            // timeout, stability, optionality, concurrency or artifact policy.
            const gates = [...raw.gates.filter((g: any) => !(g.id === "placeholder" && g.run === "true" && !g.proves && !owned.has(g.id))), ...plan.gates.filter(g => !current.gates.some(existing => existing.id === g.id))];
            const show = { ...raw.show };
            for (const [id, command] of Object.entries(plan.show)) {
                if (show[id] && show[id] !== command)
                    throw new Error(`Display ${id} conflicts with a repository command`);
                show[id] = command;
            }
            const next = { ...raw, gates, ...(Object.keys(show).length ? { show } : {}) };
            parseConfig(next);
            await writeFile(path, JSON.stringify(next, null, 2) + "\n");
        },
        async build(repo, plan, maxWorkerTurns) {
            signal?.throwIfAborted();
            // The aggregate brief keeps all tasks, their dependencies and original words in one bounded worker loop.
            const task = plan.briefPaths.map(p => `Read ${p}; ${plan.plan.tasks.find(t => t.brief === p)?.objective ?? ""}`).join("\n");
            const declared = (await loadConfig(repo)).run;
            if (!declared)
                throw new EngineError("Declare run.worker before building.", 2, "wring start --help");
            if (!Number.isSafeInteger(maxWorkerTurns) || maxWorkerTurns < 1)
                throw new EngineError("The authorized worker-turn ceiling is exhausted.", 3, "wringer-drive authority --help");
            const built = await run(repo, { maxIterations: Math.min(maxWorkerTurns, declared.max_iterations), task, signal, onEvent });
            if (!built.final || (built.status !== "converged" && built.reason !== "checks_passed_acceptance_pending"))
                return { ...built, workerTurns: built.worker_turns, status: built.status === "interrupted" ? "interrupted" : "failed", reason: built.reason, nextMove: built.next_move };
            return { ...await outcome(repo, built.final), workerTurns: built.worker_turns, loopDir: built.loop_dir };
        },
        async verify(repo) { signal?.throwIfAborted(); return outcome(repo, await verify(repo, { signal, onEvent })); },
        async renderBoard(repo, result) {
            const path = await safePath(repo, ".wringer/board/index.html"), { mkdir } = await import("node:fs/promises");
            await mkdir(join(repo, ".wringer/board"), { recursive: true });
            await writeFile(path, renderHtml(await loadBoard(repo, result.evidenceDir)));
            return path;
        },
    };
}
export const services: DriveServices = createServices();
