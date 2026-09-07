import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { EngineError, parseConfig } from "@wringer/engine";
import { openReader, readSchema, type Reader } from "@wringer/records";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
export const HEALTH_MIN_HISTORY = 10;
export const HEALTH_WINDOW = 25;
type Obj = Record<string, any>;
export interface HealthGate {
    gate_id: string;
    command: string;
    verdict: "alive" | "zombie" | "untested" | "retired";
    qualifying_runs: number;
    optional: boolean;
    last_failure: string | null;
    last_sensitive: string | null;
    drift: {
        duration_trend: number | null;
        slow: boolean;
        timeouts: number;
        truncations: number;
    };
    receipts: string[];
}
export interface HealthReport {
    schema_version: "wringer.health.v1";
    coverage: {
        roots: string[];
        read: number;
        counts: {
            run: number;
            loop: number;
            bench: number;
        };
        skipped: {
            receipt: string;
            reason: string;
        }[];
        duplicates: {
            receipt: string;
            already_read_as: string;
        }[];
        discovered: number;
    };
    gates: HealthGate[];
    retired: HealthGate[];
    limits: string[];
}
export interface HealthOptions {
    from?: string[];
}
interface Root {
    path: string;
    label: string;
    extra: boolean;
}
interface Bundle {
    path: string;
    receipt: string;
    kind: "run" | "loop" | "bench";
    id: string;
    stamp: number;
    qualifying: boolean;
    root: Root;
}
interface Observation {
    gate: string;
    command: string;
    receipt: string;
    qualifying: boolean;
    status: string;
    exit: number;
    timeout: boolean;
    optional: boolean;
    duration: number;
    truncated: boolean;
    sensitive: boolean;
    flaky: boolean;
    classification: string | null;
    concurrent: boolean;
}
const SCHEMAS = new URL("../../../schema/", import.meta.url).pathname;
const KINDS: Record<string, Bundle["kind"]> = { "wringer.evidence.v1": "run", "wringer.loop.v1": "loop", "wringer.loop.v2": "loop", "wringer.bench.v1": "bench", "wringer.bench.v2": "bench" };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const key = (id: string, command: string) => JSON.stringify([id, command]);
const LIMITS = [
    "Health reads recorded evidence. A gate can be well designed and still read zombie here: the claim is about the record, not the gate.",
    "Only declared gates are visible. Checks outside .wringer.yaml — scripts, CI steps, hand-kept lists — are beyond this instrument, and they narrow too.",
    "Thin history cannot support zombie. It can support alive: one recorded genuine failure is a demonstration, and no number of runs is needed to believe a demonstration.",
    "A sensitive row proves the gate's result changed with the tree, not that the change was honest. Deleting an already-failing assertion records one for the wrong reason (SPEC_VACUITY_V0 §5a); health inherits that blind spot whole.",
    "Observed stability is a frequency in the record, never a probability about the gate. Unmeasured stability is unknown; flaky failures and sensitivity never make a gate alive.",
];
async function exists(path: string) {
    try {
        await lstat(path);
        return true;
    }
    catch (e: any) {
        if (e.code === "ENOENT")
            return false;
        throw e;
    }
}
function within(root: string, path: string) { return path === root || path.startsWith(root + sep); }
async function safeFile(root: Root, path: string) {
    const actual = await realpath(path);
    if (!within(root.path, actual))
        throw new Error("symbolic link leaves the named search root");
    const info = await stat(actual);
    if (!info.isFile())
        throw new Error("not a regular file");
    if (info.size > 16 * 1024 * 1024)
        throw new Error("record exceeds the disclosed 16 MiB per-file reading limit");
    return actual;
}
function receipt(root: Root, path: string, repo: string | null) { const local = relative(root.path, path) || "."; return root.extra ? `${root.label}:${local}` : repo ? relative(repo, path) : path; }
async function discoverDirectories(root: Root, warnings: string[]): Promise<string[]> {
    const pending = [root.path], found: string[] = [];
    while (pending.length) {
        const path = pending.pop()!;
        let entries;
        try {
            entries = await readdir(path, { withFileTypes: true });
        }
        catch {
            warnings.push(`Unreadable search directory: ${root.label}:${relative(root.path, path) || "."}; its unseen contents cannot be counted.`);
            continue;
        }
        if (entries.some(e => e.name === "manifest.json"))
            found.push(path);
        for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
            if (entry.isDirectory())
                pending.push(join(path, entry.name));
            else if (entry.isSymbolicLink() && entry.name !== "manifest.json")
                warnings.push(`Not followed: symbolic link ${root.label}:${relative(root.path, join(path, entry.name))}. Name its target explicitly with --from to include it.`);
        }
    }
    return found.sort(compare);
}
async function readRecord(reader: Reader, bundle: Bundle, name: string, version: string, warnings: string[]): Promise<Obj | null | false> {
    const path = join(bundle.path, name);
    if (!await exists(path))
        return null;
    try {
        const safe = await safeFile({ ...bundle.root, path: bundle.path }, path), result = await reader.read<Obj>(safe, version);
        if (!result.ok)
            throw new Error(result.reason);
        return result.value;
    }
    catch (error) {
        warnings.push(`Unreadable evidence: ${bundle.receipt}/${name} (${String(error)}); no gate observations in this bundle qualify.`);
        return false;
    }
}
function median(values: number[]) { const ordered = [...values].sort((a, b) => a - b), mid = Math.floor(ordered.length / 2); return ordered.length % 2 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2; }
/** Pure history view: no environment, execution, clock, network or writes. */
export async function health(repo: string | null, options: HealthOptions = {}): Promise<HealthReport> {
    const unknown = Object.keys(options).filter(k => k !== "from");
    if (unknown.length)
        throw new EngineError(`health: unsupported option ${unknown.join(", ")}`);
    if (options.from !== undefined && (!Array.isArray(options.from) || options.from.some(p => typeof p !== "string" || !p.trim())))
        throw new EngineError("health.from must be a list of paths");
    const base = repo ? await realpath(repo) : null, roots: Root[] = [], warnings: string[] = [];
    const configPath = base ? join(base, ".wringer.yaml") : null;
    let declared: Map<string, {
        id: string;
        command: string;
        optional: boolean;
    }> | null = null;
    if (configPath && await exists(configPath)) {
        try {
            const actual = await realpath(configPath);
            if (!within(base!, actual))
                throw new Error("config link outside repository");
            const cfg = parseConfig(await readFile(actual, "utf8"));
            declared = new Map(cfg.gates.map(g => [key(g.id, g.run), { id: g.id, command: g.run, optional: g.optional }]));
        }
        catch {
            throw new EngineError("Unreadable .wringer.yaml: invalid or unsafe configuration. Health did not render raw configuration because it can contain secrets.");
        }
    }
    const candidates = base ? [".wringer/runs", ".wringer/loops", ".wringer/benches", ".wringer/worktrees", ".wringer.example"].map(p => ({ path: join(base, p), label: p, extra: false })) : [];
    candidates.push(...(options.from ?? []).map(p => ({ path: resolve(base ?? ".", p), label: p, extra: true })));
    for (const candidate of candidates) {
        try {
            if ((await stat(candidate.path)).isDirectory()) {
                const actual = await realpath(candidate.path);
                if (!candidate.extra && base && !within(base, actual)) {
                    warnings.push(`Not followed: ${candidate.label} is a symbolic-link search root outside the repository. Name its target explicitly with --from to include it.`);
                    continue;
                }
                roots.push({ ...candidate, path: actual });
            }
        }
        catch (error: any) {
            if (error.code !== "ENOENT")
                throw new EngineError(`Cannot inspect health search root: ${candidate.label}`);
            if (candidate.extra)
                warnings.push(`Search root absent: ${candidate.label}.`);
        }
    }
    if (!roots.length)
        throw new EngineError("No health search root is available. Run wring verify, or name existing evidence with wring health --from DIR.");
    const reader = await openReader(SCHEMAS), report: HealthReport = { schema_version: "wringer.health.v1", coverage: { roots: roots.map(r => r.label).sort(compare), read: 0, counts: { run: 0, loop: 0, bench: 0 }, skipped: [], duplicates: [], discovered: 0 }, gates: [], retired: [], limits: [] };
    const bundles: Bundle[] = [], seen = new Map<string, string>();
    for (const root of roots)
        for (const path of await discoverDirectories(root, warnings)) {
            const ref = receipt(root, path, base);
            report.coverage.discovered++;
            try {
                const manifest = await reader.read<Obj>(await safeFile(root, join(path, "manifest.json")));
                if (!manifest.ok)
                    throw new Error(manifest.reason);
                const raw = manifest.value, kind = KINDS[raw.schema_version];
                if (!kind)
                    throw new Error(`schema ${raw.schema_version} is not a run, loop or bench manifest`);
                const id = raw.run_id ?? raw.loop_id ?? raw.bench_id;
                if (typeof id !== "string" || !id)
                    throw new Error("manifest names no id");
                if (seen.has(id)) {
                    report.coverage.duplicates.push({ receipt: ref, already_read_as: seen.get(id)! });
                    continue;
                }
                seen.set(id, ref);
                const positional = `${path}/`, nonqualifying = ["/.wringer/benches/", "/.wringer/worktrees/", "/.wringer.example/"].find(p => positional.includes(p));
                const stamp = Date.parse(raw.started_at), bundle: Bundle = { path, receipt: ref, kind, id, stamp: Number.isFinite(stamp) ? stamp : -Infinity, qualifying: kind === "run" && !nonqualifying, root };
                bundles.push(bundle);
                report.coverage.read++;
                report.coverage.counts[kind]++;
                if (kind === "run" && nonqualifying)
                    warnings.push(`Read but non-qualifying: ${ref} (${nonqualifying.includes("example") ? "committed example" : "bench/worktree evidence"}); these observations decide no verdict.`);
            }
            catch (error) {
                report.coverage.skipped.push({ receipt: ref, reason: String(error).replace(/^Error: /, "") });
            }
        }
    bundles.sort((a, b) => (a.stamp - b.stamp) || compare(a.id, b.id) || compare(a.receipt, b.receipt));
    const validateGate = addFormats(new Ajv2020({ strict: false })).compile<Obj>(await readSchema("gate-result.schema.json", SCHEMAS) as object);
    const pairs = new Map<string, {
        id: string;
        command: string;
        rows: Observation[];
    }>();
    for (const bundle of bundles) {
        if (bundle.kind !== "run")
            continue;
        const sensitivity = await readRecord(reader, bundle, "vacuity.json", "wringer.vacuity.v1", warnings), stability = await readRecord(reader, bundle, "stability.json", "wringer.stability.v1", warnings), concurrency = await readRecord(reader, bundle, "concurrency.json", "wringer.concurrency.v1", warnings);
        if (sensitivity === false || stability === false || concurrency === false)
            continue;
        let directories;
        try {
            const path = join(bundle.path, "gates");
            if (!await exists(path))
                continue;
            const actual = await realpath(path);
            if (!within(bundle.path, actual))
                throw new Error("gate directory link leaves its bundle");
            directories = await readdir(actual, { withFileTypes: true });
        }
        catch (error) {
            warnings.push(`Unreadable gates: ${bundle.receipt}/gates (${String(error)}).`);
            continue;
        }
        const observations: Observation[] = [], ids = new Set<string>();
        let duplicate = false;
        for (const directory of directories.sort((a, b) => compare(a.name, b.name))) {
            if (!directory.isDirectory() && !directory.isSymbolicLink())
                continue;
            const path = join(bundle.path, "gates", directory.name, "result.json");
            if (!await exists(path))
                continue;
            try {
                const raw = JSON.parse(await readFile(await safeFile({ ...bundle.root, path: bundle.path }, path), "utf8"));
                if (!validateGate(raw) || !new RegExp(`^\\d+_${raw.gate_id}$`).test(directory.name) || (raw.status === "passed") !== (raw.exit_code === 0 && !raw.timed_out))
                    throw new Error("invalid or contradictory gate result");
                if (ids.has(raw.gate_id)) {
                    duplicate = true;
                    throw new Error("duplicate gate id; entire bundle excluded from gate history");
                }
                ids.add(raw.gate_id);
                const sensitive = sensitivity?.gates.some((g: Obj) => g.gate_id === raw.gate_id && g.sensitive && g.changed === "passed" && g.pre_change === "failed") ?? false;
                const classification = stability?.gates.find((g: Obj) => g.gate_id === raw.gate_id)?.classification ?? null;
                observations.push({ gate: raw.gate_id, command: raw.command, receipt: bundle.receipt, qualifying: bundle.qualifying, status: raw.status, exit: raw.exit_code, timeout: raw.timed_out, optional: raw.optional, duration: raw.duration_ms, truncated: raw.stdout_truncated || raw.stderr_truncated, sensitive: sensitive && raw.status === "passed", flaky: classification === "flaky", classification, concurrent: concurrency?.gates.some((g: Obj) => g.gate_id === raw.gate_id) ?? false });
            }
            catch (error) {
                warnings.push(`Unreadable gate result: ${bundle.receipt}/gates/${directory.name}/result.json (${String(error)}); it does not qualify.`);
            }
        }
        if (!duplicate)
            for (const row of observations) {
                const k = key(row.gate, row.command), pair = pairs.get(k) ?? { id: row.gate, command: row.command, rows: [] };
                pair.rows.push(row);
                pairs.set(k, pair);
            }
    }
    if (declared)
        for (const [k, g] of declared)
            if (!pairs.has(k))
                pairs.set(k, { id: g.id, command: g.command, rows: [] });
    const recent = new Set(bundles.filter(b => b.qualifying).slice(-HEALTH_WINDOW).map(b => b.receipt));
    for (const [k, pair] of [...pairs].sort((a, b) => compare(a[1].id, b[1].id) || compare(a[1].command, b[1].command))) {
        const window = pair.rows.filter(r => r.qualifying).slice(-HEALTH_WINDOW), failures = window.filter(r => r.status === "failed" && !r.timeout && r.exit !== 127 && !r.flaky), sensitives = window.filter(r => r.sensitive && !r.flaky);
        const current = declared ? declared.has(k) : pair.rows.some(r => r.qualifying && recent.has(r.receipt)), verdict: HealthGate["verdict"] = !current ? "retired" : failures.length || sensitives.length ? "alive" : window.length >= HEALTH_MIN_HISTORY ? "zombie" : "untested";
        const durations = window.filter(r => !r.concurrent).map(r => r.duration), oldest = durations.length >= 10 ? median(durations.slice(0, 5)) : 0, ratio = oldest > 0 ? Math.round(median(durations.slice(-5)) / oldest * 1000) / 1000 : null;
        const row: HealthGate = { gate_id: pair.id, command: pair.rows.length ? pair.command : "—", verdict, qualifying_runs: window.length, optional: declared?.get(k)?.optional ?? window.at(-1)?.optional ?? false, last_failure: failures.at(-1)?.receipt ?? null, last_sensitive: sensitives.at(-1)?.receipt ?? null, drift: { duration_trend: ratio, slow: ratio !== null && ratio >= 2, timeouts: window.filter(r => r.timeout).length, truncations: window.filter(r => r.truncated).length }, receipts: window.map(r => r.receipt) };
        (current ? report.gates : report.retired).push(row);
        const contended = window.length - durations.length;
        if (contended)
            warnings.push(`${pair.id}: ${contended} contended duration${contended === 1 ? "" : "s"} excluded from this window's duration comparison; timeout and truncation counts still include them.`);
        const measured = window.filter(r => r.classification !== null);
        if (measured.length)
            warnings.push(`${pair.id}: flaky in ${measured.filter(r => r.flaky).length} of ${measured.length} measured runs; this is an observed frequency, not a probability.`);
    }
    report.coverage.skipped.sort((a, b) => compare(a.receipt, b.receipt));
    report.coverage.duplicates.sort((a, b) => compare(a.receipt, b.receipt));
    report.limits = [...LIMITS, `Verdicts use the newest ${HEALTH_WINDOW} qualifying observations per exact (id, command) pair; zombie needs at least ${HEALTH_MIN_HISTORY}.`, ...(declared ? [] : ["No .wringer.yaml was read. Current identities follow the newest 25 qualifying bundles; --strict cannot determine any declared required gate."]), ...warnings.sort(compare)];
    return report;
}
// A report without a config cannot promote historical requiredness to present authority.
export function healthExitCode(report: HealthReport, strict = false): 0 | 1 { return strict && !report.limits.some(l => l.startsWith("No .wringer.yaml was read.")) && report.gates.some(g => g.verdict === "zombie" && !g.optional) ? 1 : 0; }
const cell = (s: string) => s.replace(/[\r\n]/g, " ").replace(/\|/g, "\\|").replace(/`/g, "\\`");
export function renderHealth(report: HealthReport): string {
    const c = report.coverage, lines = [`Searched ${c.roots.length} roots · read ${c.read} bundles (${c.counts.run} runs, ${c.counts.loop} loops, ${c.counts.bench} bench) · skipped ${c.skipped.length} · duplicate ${c.duplicates.length}`, "", ...c.roots.map(r => `Root: ${r}`), ...c.skipped.map(s => `Skipped: ${s.receipt} — ${s.reason}`), ...c.duplicates.map(d => `Duplicate: ${d.receipt} — already read as ${d.already_read_as}`), "", "| Check | Recorded command | Verdict | Qualifying runs | Last failure | Last sensitive | Duration trend |", "| --- | --- | --- | ---: | --- | --- | --- |"];
    for (const g of [...report.gates, ...report.retired])
        lines.push(`| ${cell(g.gate_id)}${g.optional ? " (optional)" : ""} | ${cell(g.command)} | ${g.verdict} | ${g.qualifying_runs} | ${cell(g.last_failure ?? "—")} | ${cell(g.last_sensitive ?? "—")} | ${g.drift.duration_trend === null ? "—" : `${g.drift.duration_trend}×`}${g.drift.slow ? " (slower)" : ""} |`);
    for (const g of report.gates.filter(g => g.verdict === "zombie"))
        lines.push(`\n${g.gate_id}: ${g.optional ? "Optional gates are never proved; only a genuine recorded failure can settle this one." : "wring verify --prove — on a changed, currently green tree, records sensitivity or confirms the doubt. A broken comparison environment is inconclusive."}\n`);
    lines.push("", "Receipts", "");
    for (const g of [...report.gates, ...report.retired])
        lines.push(`${g.gate_id} (${g.command}): ${g.receipts.length ? g.receipts.join(", ") : "no qualifying observations"}; timeouts ${g.drift.timeouts}, truncated logs ${g.drift.truncations}.`);
    lines.push("", "Limits", "", ...report.limits.map(l => `- ${l}`), "", "Make the evidence better, not the check weaker.");
    return lines.join("\n") + "\n";
}
