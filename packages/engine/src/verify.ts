import { mkdir, readFile, readdir, lstat, rename, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { exists, loadConfig } from "./config";
import { acceptance, checkIdentity, loadSpec } from "./acceptance";
import { snapshot } from "./git";
import { Bundle, VERSION, newId, now, posix, Redactor, safePath, sha256 } from "./io";
import { runProcess } from "./process";
import { prove } from "./prove";
import { preflightContainer, runGateCommand, executionRecord } from "./backend";
import { captureArtifacts } from "./artifacts";
import { EngineError, type Config, type Gate, type GateResult, type VerifyOptions, type VerifyOutcome } from "./types";
const gateDir = (index: number, id: string) => `gates/${String(index + 1).padStart(3, "0")}_${id}`;
async function runGate(repo: string, config: Config, gate: Gate, index: number, bundle: Bundle, options: VerifyOptions) {
    const dir = gateDir(index, gate.id);
    await bundle.event("gate.started", { gate_id: gate.id, command: gate.run });
    const attempts: GateResult[] = [];
    const attemptRows: any[] = [];
    let interrupted = false;
    for (let i = 1; i <= (gate.stability?.attempts ?? 1); i++) {
        const attemptDir = gate.stability ? `${dir}/attempts/${String(i).padStart(3, "0")}` : dir;
        const staging = gate.artifacts ? await mkdtemp(join(tmpdir(), "wringer-native-artifacts-")) : undefined;
        let process;
        try {
            process = await runGateCommand(repo, config, bundle, attemptDir, gate.run, { cwd: repo, timeout: gate.timeout, signal: options.signal, redactor: bundle.redactor, ...(staging ? { env: { ...globalThis.process.env, WRINGER_ARTIFACTS_DIR: staging } } : {}) }, staging);
            if (staging)
                await captureArtifacts(staging, gate, bundle, attemptDir);
        }
        finally {
            if (staging)
                await rm(staging, { recursive: true, force: true });
        }
        const result: GateResult = { gate_id: gate.id, command: gate.run, exit_code: process.exit_code, duration_ms: process.duration_ms, timed_out: process.timed_out, stdout_truncated: process.stdout_truncated, stderr_truncated: process.stderr_truncated, optional: gate.optional, status: process.exit_code === 0 && !process.timed_out ? "passed" : "failed" };
        await bundle.write(`${attemptDir}/stdout.log`, process.stdout);
        await bundle.write(`${attemptDir}/stderr.log`, process.stderr);
        if (process.interrupted) {
            interrupted = true;
            break;
        }
        await bundle.json(`${attemptDir}/result.json`, result);
        attempts.push(result);
        attemptRows.push({ attempt: i, status: result.status, exit_code: result.exit_code, duration_ms: result.duration_ms, timed_out: result.timed_out, result: `${attemptDir}/result.json` });
    }
    if (interrupted)
        return { interrupted: true, result: null, stability: null };
    const statuses = new Set(attempts.map(a => a.status));
    const classification = attempts.length === 0 || attempts.some(a => a.timed_out) ? "unknown" : statuses.size > 1 ? "flaky" : attempts[0]!.status === "passed" ? "stable_pass" : "stable_fail";
    const tolerated = classification === "flaky" && gate.stability?.require_consistent === false;
    const wanted = classification === "stable_pass" || tolerated ? "passed" : "failed";
    const deciding = Math.max(1, attempts.findIndex(a => a.status === wanted) + 1);
    const result = attempts[deciding - 1]!;
    if (gate.stability) {
        const src = `${dir}/attempts/${String(deciding).padStart(3, "0")}`;
        await bundle.write(`${dir}/stdout.log`, await readFile(join(bundle.directory, src, "stdout.log")));
        await bundle.write(`${dir}/stderr.log`, await readFile(join(bundle.directory, src, "stderr.log")));
        await bundle.json(`${dir}/result.json`, result);
    }
    await bundle.event("gate.finished", { gate_id: gate.id, exit_code: result.exit_code, duration_ms: result.duration_ms, ...(result.status === "failed" ? { log: `${dir}/stdout.log` } : {}), ...(result.stdout_truncated || result.stderr_truncated ? { truncated: true } : {}) });
    const stability = gate.stability ? { gate_id: gate.id, optional: gate.optional, attempts_requested: gate.stability.attempts, attempts_run: attempts.length, require_consistent: gate.stability.require_consistent, classification, tolerated, verdict: classification === "stable_pass" || tolerated ? "passed" : classification === "unknown" ? "unresolved" : "failed", routing: classification === "stable_fail" ? "repair" : classification === "stable_pass" ? "none" : "no_repair", reason: classification === "flaky" ? `The same gate produced both passing and failing observations; repair is not attempted against nondeterminism.${tolerated ? " The repository explicitly tolerates this mixture." : ""}` : `Observed ${classification.replaceAll("_", " ")}.`, deciding_attempt: deciding, attempts: attemptRows } : null;
    return { interrupted: false, result, stability };
}
export async function verify(repo: string, options: VerifyOptions = {}): Promise<VerifyOutcome> {
    const snap = await snapshot(repo);
    repo = snap.root;
    const config = await loadConfig(repo);
    const spec = await loadSpec(repo);
    await preflightContainer(repo, config);
    const selected = options.gate === undefined ? null : new Set(Array.isArray(options.gate) ? options.gate : [options.gate]);
    for (const id of selected ?? [])
        if (!config.gates.some(g => g.id === id))
            throw new EngineError(`Unknown gate ${id}`);
    const id = newId(), started_at = now();
    const directory = await safePath(repo, options.output ?? `.wringer/runs/${id}`);
    if (await exists(directory)) {
        if ((await readdir(directory)).length)
            throw new EngineError(`Output directory already contains files: ${directory}. Choose a new output directory.`, 3);
    }
    const bundle = await new Bundle(directory, new Redactor(config.evidence.redact.env), "evidence.jsonl", options.onEvent).prepare();
    const repoRecord = { root: ".", head_sha: snap.head_sha, branch: snap.branch, dirty: snap.dirty };
    await bundle.event("run.started", { run_id: id, wringer_version: VERSION, repo: basename(repo), sha: snap.head_sha });
    await bundle.event("git.status", { dirty: snap.dirty, changed_files: snap.changed_files, ...(snap.untracked.length ? { untracked: snap.untracked } : {}) });
    await bundle.write("diff.patch", snap.diff);
    await bundle.write("status.txt", snap.status);
    await bundle.json("snapshot.json", { schema_version: "wringer.native.snapshot.v1", ...snap, root: "." });
    await bundle.json("untracked.json", { schema_version: "wringer.untracked.v2", algorithm: "sha256", files: snap.untracked_hashes });
    for (const name of ["wringer.spec.yaml", "wringer.sources.yaml", "wringer.rubric.yaml", ".wringer.yaml"]) {
        const path = await safePath(repo, name);
        if (await exists(path))
            await bundle.write(name, await readFile(path));
    }
    const checks = await Promise.all(config.gates.map(g => checkIdentity(repo, g)));
    await bundle.json("checks.json", { schema_version: "wringer.checks.v1", checks, limits: ["Only files explicitly named in a shell command are hashed. A command-only identity cannot detect changes in implicitly discovered checks.", "Identity is captured before execution. A gate that edits a check, executes it and restores it can evade a before/after comparison."] });
    const results: GateResult[] = [];
    const stabilities: any[] = [];
    const concurrent: any[] = [];
    let failed_gate: string | null = null, status: VerifyOutcome["status"] = "passed", groupId = 0;
    for (let i = 0; i < config.gates.length;) {
        const index = i, g = config.gates[i++]!;
        if (selected && !selected.has(g.id))
            continue;
        if (failed_gate && !g.proves.length)
            continue;
        if (options.signal?.aborted) {
            status = "interrupted";
            break;
        }
        const group = [{ gate: g, index }];
        if (!options.serial && g.concurrent) {
            while (i < config.gates.length && config.gates[i]!.concurrent) {
                const next = config.gates[i++]!;
                if ((!selected || selected.has(next.id)) && (!failed_gate || next.proves.length))
                    group.push({ gate: next, index: i - 1 });
            }
        }
        if (group.length > 1) {
            groupId++;
            for (const one of group)
                concurrent.push({ gate_id: one.gate.id, group: groupId, beside: group.filter(x => x !== one).map(x => x.gate.id) });
        }
        const completed = await Promise.all(group.map(({ gate, index }) => runGate(repo, config, gate, index, bundle, options)));
        for (let j = 0; j < completed.length; j++) {
            const one = completed[j]!, gate = group[j]!.gate;
            if (one.interrupted) {
                status = "interrupted";
                continue;
            }
            results.push(one.result!);
            if (one.stability)
                stabilities.push(one.stability);
            if ((one.result!.status === "failed" || one.stability?.verdict === "unresolved") && !gate.optional && !failed_gate)
                failed_gate = gate.id;
        }
        if (status === "interrupted")
            break;
    }
    if (status !== "interrupted")
        status = failed_gate ? "failed" : "passed";
    await bundle.json("execution.json", executionRecord(config, results.map(r => r.gate_id), options.workerExecution));
    if (stabilities.length)
        await bundle.json("stability.json", { schema_version: "wringer.stability.v1", gates: stabilities });
    if (concurrent.length)
        await bundle.json("concurrency.json", { schema_version: "wringer.concurrency.v1", gates: concurrent });
    const vacuity = status !== "interrupted" && (options.prove || config.run?.prove) ? await prove(repo, config, bundle, snap, results, checks, options) : undefined;
    const afterChecks = await Promise.all(config.gates.map(g => checkIdentity(repo, g))), mutated = new Set(config.gates.filter((g, i) => JSON.stringify(checks[i]) !== JSON.stringify(afterChecks[i])).map(g => g.id));
    if (mutated.size) {
        await bundle.json("check-mutations.json", { schema_version: "wringer.native.check-mutations.v1", before: checks, after: afterChecks, refuses: true, reason: "A declared check changed while verification ran." });
        if (status !== "interrupted") {
            status = "failed";
            failed_gate ??= [...mutated][0] ?? null;
        }
    }
    const assessed = await acceptance(repo, config, bundle, results, checks, spec, vacuity, mutated);
    const manifest = { schema_version: "wringer.evidence.v1", run_id: id, started_at, repo: repoRecord, result: { status, failed_gate } };
    await bundle.event("run.finished", { status, ...(failed_gate ? { failed_gate } : {}) });
    await bundle.json("manifest.json", manifest);
    const required = config.gates.filter(g => !g.optional);
    const template_only = required.length > 0 && required.every(g => g.id === "placeholder" && g.run.trim() === "true");
    const summary = [`# Verification ${id}`, "", `Checks ${status}.`, template_only ? "WARNING: the placeholder passed and proved nothing." : "", `Commit: ${snap.head_sha ?? "unborn"}. Branch: ${snap.branch ?? "detached"}. Working tree: ${snap.dirty ? "changed" : "clean"}.`, "", "| Check | Result | Time | Evidence |", "|---|---|---:|---|"];
    for (const [index, g] of config.gates.entries()) {
        const result = results.find(r => r.gate_id === g.id);
        summary.push(`| ${g.id} | ${result?.status ?? (status === "interrupted" ? "not completed" : "skipped")} | ${result ? `${result.duration_ms} ms` : "—"} | ${result ? `[output](${gateDir(index, g.id)}/stdout.log) · [errors](${gateDir(index, g.id)}/stderr.log)` : "—"} |`);
    }
    if (assessed) {
        summary.push("", `Requirements proved: ${assessed.counts.evidenced} of ${assessed.criteria.filter((r: any) => r.state !== "human").length}. Human judgements: ${assessed.criteria.filter((r: any) => r.judgement && !r.judgement.stale && r.judgement.verdict === "met").length} of ${assessed.counts.human}.`, "", ...assessed.criteria.map((r: any) => `- ${r.title}: ${r.state}. ${r.reason}${r.judgement?.note !== undefined ? ` Note: ${r.judgement.note}` : ""}`));
    }
    const rerun = failed_gate ? `wring verify --gate ${failed_gate}` : null;
    if (rerun)
        summary.push("", `Next: \`${rerun}\``);
    await bundle.write("summary.md", summary.filter((line, i) => line || i > 0).join("\n") + "\n");
    await bundle.seal();
    return { status, failed_gate, rerun, evidence_dir: posix(relative(repo, directory)), template_only, exit_code: status === "interrupted" ? 4 : status === "failed" ? 1 : 0, manifest, results, ...(assessed ? { acceptance: assessed } : {}), ...(stabilities.length ? { stability: { gates: stabilities } } : {}), ...(vacuity ? { vacuity } : {}) };
}
