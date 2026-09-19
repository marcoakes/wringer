/**
 * What one `wring verify` actually covered, and what a set of them covers together.
 *
 * A subset run legitimately reports `passed`: the selection passed. Until
 * `wringer.selection.v1` existed, that was the only sentence a consumer got,
 * and "nine required checks never ran" lived in a table row saying `skipped`.
 * Completeness is computed here from the declared configuration, so a gate
 * with no `proves:` still counts — `lint` proves no criterion and its absence
 * still means the verification did not cover what the repository declared.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseConfig, parseYaml } from "./config";
import { fileList, maybeJson, readJson, sha256, validateDigests } from "./io";
import { EngineError, type Gate, type GateResult } from "./types";
export interface SelectionRecord {
    schema_version: "wringer.selection.v1";
    run_id: string;
    head_sha: string | null;
    config_sha256: string;
    declared: string[];
    required: string[];
    selected: string[] | null;
    executed: string[];
    passed: string[];
    failed: string[];
    missing_required: string[];
    complete: boolean;
    reason: string;
    limits: string[];
}
export const SELECTION_LIMITS = [
    "`complete` is about execution and never about outcome: a run in which every required check ran and one of them failed is complete and failed. Read it beside result.status, never instead of it.",
    "Completeness is measured against the .wringer.yaml this bundle carries. A check the repository never declared cannot be missing from it, and a gate declared later does not make this bundle incomplete.",
    "A deliberately narrow run stays exit 0. This record is the only place that says what the pass covered.",
];
/** The one sentence every surface prints. Never recomposed per surface. */
export function completenessSentence(missing: string[], requiredCount: number): string {
    return missing.length
        ? `Incomplete: ${missing.length} required check${missing.length === 1 ? "" : "s"} ${missing.length === 1 ? "was" : "were"} not run (${missing.join(", ")}).`
        : `Complete: all ${requiredCount} required check${requiredCount === 1 ? "" : "s"} ran.`;
}
export function selectionRecord(input: {
    run_id: string;
    head_sha: string | null;
    config_sha256: string;
    gates: Pick<Gate, "id" | "optional">[];
    selected: string[] | null;
    results: Pick<GateResult, "gate_id" | "status">[];
}): SelectionRecord {
    const order = input.gates.map(g => g.id);
    const inOrder = (ids: Iterable<string>) => { const want = new Set(ids); return order.filter(id => want.has(id)); };
    const declared = [...order];
    const required = input.gates.filter(g => !g.optional).map(g => g.id);
    const executed = inOrder(input.results.map(r => r.gate_id));
    const passed = inOrder(input.results.filter(r => r.status === "passed").map(r => r.gate_id));
    const failed = inOrder(input.results.filter(r => r.status === "failed").map(r => r.gate_id));
    const ran = new Set(executed);
    const missing_required = required.filter(id => !ran.has(id));
    return {
        schema_version: "wringer.selection.v1", run_id: input.run_id, head_sha: input.head_sha, config_sha256: input.config_sha256,
        declared, required, selected: input.selected === null ? null : inOrder(input.selected), executed, passed, failed,
        missing_required, complete: missing_required.length === 0,
        reason: completenessSentence(missing_required, required.length), limits: SELECTION_LIMITS,
    };
}
export interface SetBundleRow {
    path: string;
    run_id: string;
    started_at: string;
    status: string;
    executed: string[];
    selection_record: "wringer.selection.v1" | "absent";
}
export interface SetExecution {
    gate_id: string;
    bundle: string;
    status: "passed" | "failed";
    exit_code: number;
    optional: boolean;
}
export interface VerificationSet {
    schema_version: "wringer.verification-set.v1";
    set_id: string;
    at: string;
    head_sha: string | null;
    config_sha256: string;
    declared: string[];
    required: string[];
    bundles: SetBundleRow[];
    executions: SetExecution[];
    passed: string[];
    failed: string[];
    missing_required: string[];
    complete: boolean;
    reason: string;
    limits: string[];
}
export const SET_LIMITS = [
    "`complete` here is stricter than the same word in a single bundle's selection record: a set is complete only when every required declared gate has exactly one PASSED execution. A bundle's `complete` is about execution alone.",
    "This receipt combines recorded results. It runs no check, re-measures nothing, and cannot establish that the checks cover the requirements they are bound to.",
    "The declared-gate population is read from the .wringer.yaml the bundles carry, not from any checkout on the combining machine.",
    "Bundle directories were read from operator-named paths. Nothing inside them was executed.",
    "An owner who can rewrite every bundle and its digests can forge an unsealed story; sealing is tamper-evident, not tamper-proof.",
];
export interface LoadedBundle {
    named: string;
    directory: string;
    manifest: any;
    configBytes: Uint8Array;
    config_sha256: string;
    gates: Pick<Gate, "id" | "optional">[];
    checks: any[];
    results: GateResult[];
    selection: SelectionRecord | null;
    acceptance: any | null;
    execution: any | null;
    spec: any | null;
}
const refuse = (message: string, next: string) => new EngineError(message, 2, next);
const NEXT = "wring audit --set DIR --set DIR --help";
async function loadBundle(named: string, directory: string): Promise<LoadedBundle> {
    const sealed = await validateDigests(directory);
    if (!sealed.ok)
        throw refuse(`Bundle ${named} is damaged and cannot join a set: ${sealed.errors.join("; ")}. Combine the intact bundles, or re-run the checks that produced this one.`, NEXT);
    const manifest = await maybeJson(join(directory, "manifest.json"));
    if (!manifest || manifest.schema_version !== "wringer.evidence.v1" || !manifest.result)
        throw refuse(`Bundle ${named} is not a wringer.evidence.v1 verification bundle; a set combines verification bundles only.`, NEXT);
    if (manifest.result.status === "interrupted")
        throw refuse(`Bundle ${named} records an interrupted run. An interrupted run cannot contribute a completeness claim; re-run its selection.`, NEXT);
    let configBytes: Uint8Array;
    try {
        configBytes = new Uint8Array(await readFile(join(directory, ".wringer.yaml")));
    }
    catch {
        throw refuse(`Bundle ${named} carries no .wringer.yaml, so the checks it declared cannot be read and its results cannot be counted against a population. Only bundles that froze their configuration can be combined.`, NEXT);
    }
    let gates: Pick<Gate, "id" | "optional">[];
    try {
        gates = parseConfig(new TextDecoder().decode(configBytes)).gates.map(g => ({ id: g.id, optional: g.optional }));
    }
    catch (e) {
        throw refuse(`Bundle ${named} carries a .wringer.yaml this version cannot read, so its declared checks are unknown: ${(e as Error).message}`, NEXT);
    }
    const checksRecord = await maybeJson(join(directory, "checks.json"));
    if (!checksRecord || checksRecord.schema_version !== "wringer.checks.v1" || !Array.isArray(checksRecord.checks))
        throw refuse(`Bundle ${named} carries no wringer.checks.v1 check identities, so no reader can establish that its gates are the same checks as another bundle's.`, NEXT);
    const results: GateResult[] = [];
    for (const name of (await fileList(directory)).filter(p => /^gates\/[^/]+\/result\.json$/.test(p))) {
        const row = await readJson(join(directory, name));
        if (typeof row.gate_id !== "string" || typeof row.command !== "string" || !Number.isInteger(row.exit_code) || !["passed", "failed"].includes(row.status))
            throw refuse(`Bundle ${named} has a malformed gate result at ${name}.`, NEXT);
        results.push(row);
    }
    if (!results.length)
        throw refuse(`Bundle ${named} recorded no gate result, so it contributes nothing to a set.`, NEXT);
    const selection = await maybeJson(join(directory, "selection.json"));
    if (selection && selection.schema_version !== "wringer.selection.v1")
        throw refuse(`Bundle ${named} carries an unreadable selection record (${selection.schema_version}); this reader knows wringer.selection.v1 only.`, NEXT);
    let spec: any = null;
    try {
        spec = parseYaml(await readFile(join(directory, "wringer.spec.yaml"), "utf8"), `${named}/wringer.spec.yaml`);
    }
    catch { }
    return {
        named, directory, manifest, configBytes, config_sha256: sha256(configBytes), gates, checks: checksRecord.checks, results, selection, spec,
        acceptance: await maybeJson(join(directory, "acceptance.json")), execution: await maybeJson(join(directory, "execution.json")),
    };
}
const identity = (row: any) => JSON.stringify([row?.run ?? null, row?.run_sha256 ?? null, row?.files ?? null]);
export async function combineSet(named: string[]): Promise<{
    set: VerificationSet;
    bundles: LoadedBundle[];
}> {
    if (!named.length)
        throw refuse("Name at least one sealed verification bundle with --set DIRECTORY. A set of nothing is not a complete verification.", NEXT);
    const seen = new Map<string, string>();
    const loaded: LoadedBundle[] = [];
    for (const one of named) {
        const directory = resolve(one);
        const already = seen.get(directory);
        if (already !== undefined)
            throw refuse(`Bundle ${one} is the same directory as ${already}. Counting one bundle twice would report an execution that happened once as two.`, NEXT);
        seen.set(directory, one);
        loaded.push(await loadBundle(one, directory));
    }
    const first = loaded[0]!;
    for (const one of loaded.slice(1)) {
        if (one.manifest.repo?.head_sha !== first.manifest.repo?.head_sha)
            throw refuse(`Bundle ${one.named} tested ${one.manifest.repo?.head_sha ?? "an unborn tree"} but ${first.named} tested ${first.manifest.repo?.head_sha ?? "an unborn tree"}. Results from two revisions are not one verification.`, NEXT);
        if (one.config_sha256 !== first.config_sha256)
            throw refuse(`Bundle ${one.named} carries a different .wringer.yaml from ${first.named} (${one.config_sha256.slice(0, 12)} against ${first.config_sha256.slice(0, 12)}). Two configurations declare two populations of checks and cannot be added up.`, NEXT);
        for (const row of one.checks) {
            const prior = first.checks.find((c: any) => c.gate_id === row.gate_id);
            if (prior && identity(prior) !== identity(row))
                throw refuse(`Gate ${row.gate_id} is a different check in ${one.named} than in ${first.named}: its command or named files changed. A set cannot combine two definitions of one check.`, NEXT);
        }
    }
    const executions: SetExecution[] = [];
    const owner = new Map<string, string>();
    for (const one of loaded)
        for (const row of one.results) {
            const already = owner.get(row.gate_id);
            if (already !== undefined)
                throw refuse(`Gate ${row.gate_id} has an outcome in both ${already} and ${one.named}. Two outcomes for one gate is a re-run whose order nobody recorded, or two machines disagreeing; this set will not pick one.`, NEXT);
            owner.set(row.gate_id, one.named);
            executions.push({ gate_id: row.gate_id, bundle: one.named, status: row.status, exit_code: row.exit_code, optional: row.optional === true });
        }
    const order = first.gates.map(g => g.id);
    const declaredOrder = (ids: Iterable<string>) => { const want = new Set(ids); return order.filter(id => want.has(id)); };
    const undeclared = [...owner.keys()].filter(id => !order.includes(id));
    if (undeclared.length)
        throw refuse(`Bundle ${owner.get(undeclared[0]!)} records gate ${undeclared[0]} which the carried .wringer.yaml does not declare. The set's denominator and its rows must be the same population.`, NEXT);
    const required = first.gates.filter(g => !g.optional).map(g => g.id);
    const byGate = new Map(executions.map(e => [e.gate_id, e]));
    const passed = required.filter(id => byGate.get(id)?.status === "passed");
    const failed = required.filter(id => byGate.get(id)?.status === "failed");
    const missing_required = required.filter(id => !byGate.has(id));
    const complete = missing_required.length === 0 && failed.length === 0;
    const reason = complete
        ? `Complete: all ${required.length} required check${required.length === 1 ? "" : "s"} passed exactly once across ${loaded.length} bundle${loaded.length === 1 ? "" : "s"}.`
        : [completenessSentence(missing_required, required.length), failed.length ? `Failed: ${failed.length} required check${failed.length === 1 ? "" : "s"} ran and did not pass (${failed.join(", ")}).` : ""].filter(Boolean).join(" ");
    const set: VerificationSet = {
        schema_version: "wringer.verification-set.v1",
        set_id: `${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${crypto.randomUUID().slice(0, 8)}`,
        at: new Date().toISOString(),
        head_sha: first.manifest.repo?.head_sha ?? null,
        config_sha256: first.config_sha256,
        declared: [...order], required,
        bundles: loaded.map(one => ({ path: one.named, run_id: one.manifest.run_id, started_at: one.manifest.started_at, status: one.manifest.result.status, executed: declaredOrder(one.results.map(r => r.gate_id)), selection_record: one.selection ? "wringer.selection.v1" : "absent" })),
        executions: declaredOrder(executions.map(e => e.gate_id)).map(id => byGate.get(id)!),
        passed, failed, missing_required, complete, reason, limits: SET_LIMITS,
    };
    return { set, bundles: loaded };
}
