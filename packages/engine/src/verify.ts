import { mkdir, readFile, readdir, lstat, rename, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { exists, loadConfig } from "./config";
import { acceptance, checkIdentity, loadSpec } from "./acceptance";
import { snapshot } from "./git";
import { Bundle, VERSION, newId, now, posix, Redactor, safePath, sha256 } from "./io";
import { runProcess } from "./process";
import { prove } from "./prove";
import { selectionRecord } from "./selection";
import { observeGateAssertions, GATE_ASSERTION_LIMITS, type GateAssertionOptions, type GateAssertionRow } from "./gate-evidence";
import { probeRequirement, type ReadinessRow } from "./readiness";
import { preflightContainer, runGateCommand, executionRecord } from "./backend";
import { captureArtifacts } from "./artifacts";
import { EngineError, type Config, type Gate, type GateResult, type VerifyOptions, type VerifyOutcome } from "./types";
const gateDir = (index: number, id: string) => `gates/${String(index + 1).padStart(3, "0")}_${id}`;
async function runGate(repo: string, config: Config, gate: Gate, index: number, bundle: Bundle, options: VerifyOptions, evidence: GateAssertionOptions) {
    const dir = gateDir(index, gate.id);
    await bundle.event("gate.started", { gate_id: gate.id, command: gate.run });
    const attempts: GateResult[] = [];
    const attemptRows: any[] = [];
    const assertionRows: GateAssertionRow[] = [];
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
        await bundle.write(`${attemptDir}/stdout.log`, process.stdout);
        await bundle.write(`${attemptDir}/stderr.log`, process.stderr);
        if (process.interrupted) {
            interrupted = true;
            break;
        }
        // Zero executed assertions cannot pass. A gate that declares structured evidence is
        // answered by its runner's report as well as its exit code.
        const observed = gate.evidence ? await observeGateAssertions(repo, gate, bundle, attemptDir, process, evidence) : null;
        if (observed)
            assertionRows.push(observed.row);
        // The gate result stays derivable from what the process did — the board enforces that, and
        // it is right to. An observation that established nothing fails the RUN instead, exactly as
        // a check that mutated itself does, and the sibling record says which gate and why.
        const result: GateResult = { gate_id: gate.id, command: gate.run, exit_code: process.exit_code, duration_ms: process.duration_ms, timed_out: process.timed_out, stdout_truncated: process.stdout_truncated, stderr_truncated: process.stderr_truncated, optional: gate.optional, status: process.exit_code === 0 && !process.timed_out ? "passed" : "failed" };
        await bundle.json(`${attemptDir}/result.json`, result);
        attempts.push(result);
        attemptRows.push({ attempt: i, status: result.status, exit_code: result.exit_code, duration_ms: result.duration_ms, timed_out: result.timed_out, result: `${attemptDir}/result.json` });
    }
    if (interrupted)
        return { interrupted: true, result: null, stability: null, assertions: assertionRows };
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
    return { interrupted: false, result, stability, assertions: assertionRows };
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
    const assertionRows: GateAssertionRow[] = [];
    // One bounded launch probe per run, measured only if a playwright gate actually needs it.
    let browserProbe: Promise<ReadinessRow | null> | undefined;
    const evidenceOptions: GateAssertionOptions = { browserProbe: () => {
            const declared = config.requires.find(r => r.kind === "browser");
            browserProbe ??= declared ? probeRequirement(repo, declared, { signal: options.signal }) : Promise.resolve(null);
            return browserProbe;
        } };
    let failed_gate: string | null = null, status: VerifyOutcome["status"] = "passed", groupId = 0;
    for (let i = 0; i < config.gates.length;) {
        const index = i, g = config.gates[i++]!;
        if (selected && !selected.has(g.id))
            continue;
        if (failed_gate && !g.proves.length && !g.corroborates.length)
            continue;
        if (options.signal?.aborted) {
            status = "interrupted";
            break;
        }
        const group = [{ gate: g, index }];
        if (!options.serial && g.concurrent) {
            while (i < config.gates.length && config.gates[i]!.concurrent) {
                const next = config.gates[i++]!;
                if ((!selected || selected.has(next.id)) && (!failed_gate || next.proves.length || next.corroborates.length))
                    group.push({ gate: next, index: i - 1 });
            }
        }
        if (group.length > 1) {
            groupId++;
            for (const one of group)
                concurrent.push({ gate_id: one.gate.id, group: groupId, beside: group.filter(x => x !== one).map(x => x.gate.id) });
        }
        const completed = await Promise.all(group.map(({ gate, index }) => runGate(repo, config, gate, index, bundle, options, evidenceOptions)));
        for (let j = 0; j < completed.length; j++) {
            const one = completed[j]!, gate = group[j]!.gate;
            if (one.interrupted) {
                status = "interrupted";
                continue;
            }
            results.push(one.result!);
            assertionRows.push(...one.assertions);
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
    if (assertionRows.length)
        await bundle.json("gate-assertions.json", { schema_version: "wringer.gate-assertions.v1", gates: assertionRows, limits: GATE_ASSERTION_LIMITS });
    const vacuity = status !== "interrupted" && (options.prove || config.run?.prove) ? await prove(repo, config, bundle, snap, results, checks, options) : undefined;
    // Zero executed assertions cannot pass. A gate whose declared evidence established nothing
    // cannot carry a green run, and its result cannot establish proof for a requirement.
    const unestablished = new Set(assertionRows.filter(row => row.status === "unavailable").map(row => row.gate_id).filter(id => !config.gates.find(g => g.id === id)?.optional));
    if (unestablished.size && status !== "interrupted") {
        status = "failed";
        failed_gate ??= [...unestablished][0] ?? null;
    }
    const afterChecks = await Promise.all(config.gates.map(g => checkIdentity(repo, g))), mutated = new Set(config.gates.filter((g, i) => JSON.stringify(checks[i]) !== JSON.stringify(afterChecks[i])).map(g => g.id));
    if (mutated.size) {
        await bundle.json("check-mutations.json", { schema_version: "wringer.native.check-mutations.v1", before: checks, after: afterChecks, refuses: true, reason: "A declared check changed while verification ran." });
        if (status !== "interrupted") {
            status = "failed";
            failed_gate ??= [...mutated][0] ?? null;
        }
    }
    const assessed = await acceptance(repo, config, bundle, results, checks, spec, vacuity, mutated, assertionRows);
    const manifest = { schema_version: "wringer.evidence.v1", run_id: id, started_at, repo: repoRecord, result: { status, failed_gate } };
    await bundle.event("run.finished", { status, ...(failed_gate ? { failed_gate } : {}) });
    await bundle.json("manifest.json", manifest);
    // A subset run legitimately says `passed`. This sibling is the only thing that says what the pass covered.
    const selection = selectionRecord({ run_id: id, head_sha: snap.head_sha, config_sha256: sha256(await readFile(await safePath(repo, ".wringer.yaml"))), gates: config.gates, selected: selected ? [...selected] : null, results });
    await bundle.json("selection.json", selection);
    const required = config.gates.filter(g => !g.optional);
    const template_only = required.length > 0 && required.every(g => g.id === "placeholder" && g.run.trim() === "true");
    const summary = [`# Verification ${id}`, "", `Checks ${status}.`, selection.reason, ...(unestablished.size ? [`Assertion evidence established nothing for ${[...unestablished].join(", ")}; see gate-assertions.json.`] : []), template_only ? "WARNING: the placeholder passed and proved nothing." : "", `Commit: ${snap.head_sha ?? "unborn"}. Branch: ${snap.branch ?? "detached"}. Working tree: ${snap.dirty ? "changed" : "clean"}.`, "", "| Check | Result | Time | Evidence |", "|---|---|---:|---|"];
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
    return { status, failed_gate, rerun, evidence_dir: posix(relative(repo, directory)), template_only, exit_code: status === "interrupted" ? 4 : status === "failed" ? 1 : 0, manifest, selection, results, ...(assessed ? { acceptance: assessed } : {}), ...(stabilities.length ? { stability: { gates: stabilities } } : {}), ...(vacuity ? { vacuity } : {}) };
}
