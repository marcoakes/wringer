import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { readdir, realpath, stat } from "node:fs/promises";
import { parseDocument } from "yaml";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { openReader, readSchema, SCHEMA_BY_VERSION, type Reader } from "@wringer/records";
import { deriveFacts, deriveRail, deriveNextAction, type BoardModel, type Gate, type Issue, type Requirement, type Receipt, type SourceQuote } from "./model";
import { nativeContext } from "./native";
type Obj = Record<string, any>;
const SCHEMAS = new URL("../../../schema/", import.meta.url).pathname;
const ACCEPTANCE = new Set(["wringer.acceptance.v1", "wringer.acceptance.v2", "wringer.acceptance.v3"]);
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const safeInteger = (v: unknown): number | null => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
/** Resolve records without granting the record authority to read outside the repository. */
export async function safeRecordPath(repo: string, value: string): Promise<string> {
    if (!value || value.includes("\0") || isAbsolute(value) || value.split(/[\\/]/).includes(".."))
        throw new Error(`Unsafe evidence path: ${value}`);
    const root = await realpath(repo), path = resolve(root, value);
    if (path !== root && !path.startsWith(root + sep))
        throw new Error(`Evidence path leaves the repository: ${value}`);
    let existing = path;
    for (;;) {
        try {
            const actual = await realpath(existing);
            if (actual !== root && !actual.startsWith(root + sep))
                throw new Error(`Evidence symlink leaves the repository: ${value}`);
            return path;
        }
        catch (error: any) {
            if (error?.code !== "ENOENT")
                throw error;
            if (existing === root)
                throw error;
            existing = dirname(existing);
        }
    }
}
class Records {
    issues: Issue[] = [];
    private validators = new Map<string, ValidateFunction>();
    private ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
    constructor(readonly repo: string, readonly reader: Reader) { }
    issue(path: string, code: string, message: string) { this.issues.push({ path: relative(this.repo, path), code, message }); }
    async path(value: string) { return safeRecordPath(this.repo, value); }
    async text(path: string, required = false): Promise<string | null> {
        try {
            const safe = await this.path(relative(this.repo, path));
            if (!(await Bun.file(safe).exists())) {
                if (required)
                    this.issue(path, "absent", "The recorded file is missing.");
                return null;
            }
            const size = (await stat(safe)).size;
            if (size > 8 * 1024 * 1024) {
                this.issue(path, "oversized", "This file exceeds the board's 8 MiB reading limit.");
                return null;
            }
            return await Bun.file(safe).text();
        }
        catch (error) {
            this.issue(path, "unsafe-or-unreadable", String(error));
            return null;
        }
    }
    async validate(value: unknown, file: string): Promise<boolean> {
        let validate = this.validators.get(file);
        if (!validate) {
            validate = this.ajv.compile(await readSchema(file, SCHEMAS) as object);
            this.validators.set(file, validate);
        }
        return Boolean(validate(value));
    }
    async json(path: string, expect?: string, required = false): Promise<Obj | null> {
        if (await this.text(path, required) === null)
            return null;
        const result = await this.reader.read<Obj>(path, expect);
        if (result.ok)
            return result.value;
        this.issue(path, result.reason, result.said);
        return null;
    }
    async yaml(path: string, expect: string): Promise<Obj | null> {
        const text = await this.text(path);
        if (text === null)
            return null;
        try {
            const document = parseDocument(text, { uniqueKeys: true, strict: true, schema: "core" });
            if (document.errors.length || document.warnings.length)
                throw new Error([...document.errors, ...document.warnings].map(e => e.message).join("; "));
            const data = document.toJS({ maxAliasCount: 20 });
            const schema = SCHEMA_BY_VERSION[expect];
            if (!object(data) || data.schema_version !== expect || !schema || !await this.validate(data, schema))
                throw new Error(`File does not satisfy ${expect}.`);
            return data;
        }
        catch (error) {
            this.issue(path, "invalid-yaml", String(error));
            return null;
        }
    }
    async dirs(value: string): Promise<string[]> {
        try {
            const path = await this.path(value);
            const entries = await readdir(path, { withFileTypes: true });
            return entries.filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => resolve(path, e.name));
        }
        catch (error: any) {
            if (error?.code !== "ENOENT")
                this.issue(resolve(this.repo, value), "unsafe-or-unreadable", String(error));
            return [];
        }
    }
}
async function newestDirectories(records: Records, family: string): Promise<string[]> {
    const paths = await records.dirs(`.wringer/${family}`);
    const stamped = await Promise.all(paths.map(async (path) => {
        try {
            const safe = await records.path(relative(records.repo, path));
            const mf = resolve(safe, "manifest.json");
            // Filesystem recency selects the record. Names never vote, including custom --output names.
            const time = (await stat(await Bun.file(mf).exists() ? mf : safe)).mtimeMs;
            return { path, time };
        }
        catch (error) {
            records.issue(path, "unsafe-or-unreadable", String(error));
            return null;
        }
    }));
    return stamped.filter((v): v is {
        path: string;
        time: number;
    } => v !== null).sort((a, b) => b.time - a.time).map(v => v.path);
}
async function readGates(records: Records, run: string): Promise<Gate[]> {
    const result: Gate[] = [];
    const gates = await records.dirs(relative(records.repo, resolve(run, "gates")));
    for (const gate of gates.sort((a, b) => basename(a).localeCompare(basename(b)))) {
        const path = resolve(gate, "result.json"), text = await records.text(path);
        if (text === null)
            continue;
        try {
            const value = JSON.parse(text);
            if (!await records.validate(value, "gate-result.schema.json"))
                throw new Error("Gate result does not satisfy its published schema.");
            if (!new RegExp(`^\\d+_${value.gate_id}$`).test(basename(gate)))
                throw new Error("Gate directory does not match its declared id.");
            if ((value.status === "passed") !== (value.exit_code === 0 && !value.timed_out))
                throw new Error("Gate status contradicts exit code or timeout.");
            if (result.some(g => g.id === value.gate_id))
                throw new Error("The run contains two results for the same gate.");
            result.push({ id: value.gate_id, command: value.command, status: value.status, optional: value.optional, exitCode: value.exit_code, timedOut: value.timed_out, durationMs: value.duration_ms, path: relative(records.repo, gate), stdout: await records.text(resolve(gate, "stdout.log")), stderr: await records.text(resolve(gate, "stderr.log")) });
        }
        catch (error) {
            records.issue(path, "invalid-gate-result", String(error));
        }
    }
    return result;
}
async function resolveReceipt(records: Records, row: Obj, run: string, gates: Gate[]): Promise<Receipt> {
    const raw = row.receipt;
    const receipt: Receipt = { kind: raw?.kind ?? "missing", path: raw?.bundle ?? null, resolved: false, message: "The record's proof cannot be followed here.", before: null, after: null };
    if (!object(raw) || typeof raw.bundle !== "string")
        return receipt;
    let cited: string;
    try {
        cited = await records.path(raw.bundle);
    }
    catch (error) {
        records.issue(run, "unsafe-receipt", String(error));
        return receipt;
    }
    const manifest = await records.json(resolve(cited, "manifest.json"), "wringer.evidence.v1", true);
    if (!manifest)
        return receipt;
    const current = gates.find(g => g.id === row.gate && g.command === row.command);
    if (raw.kind === "failure") {
        const past = (await readGates(records, cited)).find(g => g.id === row.gate && g.command === row.command);
        if (current?.status !== "passed" || !past || past.status !== "failed" || past.timedOut || past.exitCode <= 0 || [126, 127].includes(past.exitCode))
            return receipt;
        receipt.resolved = true;
        receipt.message = "The same check is passing now and has a recorded failure.";
        receipt.before = past.stderr?.trim() || past.stdout?.trim() || "The check recorded a failure without output.";
        receipt.after = current.stdout?.trim() || current.stderr?.trim() || "The check passed without output.";
    }
    else if (raw.kind === "sensitive") {
        const comparison = await records.json(resolve(cited, "vacuity.json"), "wringer.vacuity.v1", true);
        const measured = comparison?.gates.find((g: Obj) => g.gate_id === row.gate && g.sensitive && g.changed === "passed" && g.pre_change === "failed" && g.cites === raw.cites);
        if (!current || current.status !== "passed" || !measured || comparison?.verdict !== "proven" || comparison.setup?.ok === false)
            return receipt;
        const citedGate = (await readGates(records, cited)).find(g => g.id === row.gate && g.command === row.command && g.status === "passed");
        if (!citedGate)
            return receipt;
        if (typeof measured.pre_change_log !== "string")
            return receipt;
        let beforePath: string;
        try {
            beforePath = await records.path(relative(records.repo, resolve(cited, measured.pre_change_log)));
        }
        catch (error) {
            records.issue(cited, "unsafe-receipt", String(error));
            return receipt;
        }
        if (!beforePath.startsWith(cited + sep) || await records.text(beforePath, true) === null)
            return receipt;
        receipt.resolved = true;
        receipt.message = "The check failed on the earlier code and passed on the changed code.";
        receipt.before = raw.cites;
        receipt.after = current.stdout;
    }
    else if (raw.kind === "witness") {
        // A copied assertion is not a resolved evidence chain. Require the cited record too.
        const citedAcceptance = await records.json(resolve(cited, "acceptance.json"), undefined, true);
        const match = citedAcceptance?.criteria?.find((r: Obj) => r.criterion === row.criterion);
        if (!match || match.state !== "evidenced" || match.witness?.pinned_sha256 !== row.witness?.pinned_sha256 || match.witness?.proved_red !== "assertion" || match.witness?.result !== "passed" || match.witness?.discarded)
            return receipt;
        receipt.message = "This older record claims a pinned check failed then passed, but its isolated proof files are not carried here. The board cannot resolve that claim.";
    }
    return receipt;
}
function wording(row: Obj, proved: boolean): {
    label: string;
    status: Requirement["status"];
} {
    if (row.state === "evidenced")
        return proved ? { label: "Proved", status: "complete" } : { label: "Proof unavailable", status: "unknown" };
    if (row.state === "human") {
        if (row.judgement?.stale)
            return { label: "Judge again", status: "pending" };
        if (row.judgement?.verdict === "met")
            return { label: "Person said met", status: "complete" };
        if (row.judgement?.verdict === "not_met")
            return { label: "Person said not met", status: "failed" };
        return { label: "Needs human judgement", status: "pending" };
    }
    if (row.state === "gate-failed")
        return { label: "Check failing", status: "failed" };
    if (row.state === "gate-did-not-run")
        return { label: "Not checked this run", status: "pending" };
    if (row.state === "unevidenced")
        return { label: row.gate === null && !row.witness ? "No check proves this" : "Proof still needed", status: "pending" };
    return { label: "Unrecognised evidence", status: "unknown" };
}
function quoteFor(id: string, sources: Obj | null, intent: string | null, frozen: boolean): SourceQuote {
    const quote = sources?.sources?.[id];
    if (typeof quote !== "string")
        return { quote: null, status: "missing", against: null, message: "No source quotation was recorded for this requirement." };
    if (!intent)
        return { quote, status: "missing", against: null, message: "The original intent is not available to check this quotation." };
    if (!normalize(intent).includes(normalize(quote)))
        return { quote, status: "mismatch", against: frozen ? "frozen intent" : "current intent", message: "This quotation is not present in the recorded intent." };
    return { quote, status: frozen ? "verified" : "unfrozen", against: frozen ? "frozen intent" : "current intent", message: frozen ? "Quotation checked against the intent frozen with this run." : "Quotation matches the current intent; this older run carries no frozen copy." };
}
export async function loadBoard(repo: string, run?: string): Promise<BoardModel> {
    repo = await realpath(repo);
    const records = new Records(repo, await openReader(SCHEMAS));
    const model: BoardModel = { version: "wringer.board.v1", repo, title: basename(repo), intent: null, generatedAt: new Date().toISOString(), selected: Boolean(run), run: null, delivery: null, journey: null, gates: [], requirements: [], acceptanceCounts: null, facts: {} as BoardModel["facts"], rail: [], nextAction: { title: "Record the first check", description: "There is no verification record to review yet.", command: "wring verify", owner: "operator", spends: false }, timeline: [], usage: [{ lane: "drafting", tokens: null, cost: null, basis: "Not reported", calls: null }, { lane: "building", tokens: null, cost: null, basis: "Not reported", calls: null }], issues: records.issues, limits: [] };
    let runPath: string | undefined;
    if (run) {
        try {
            runPath = await records.path(run.includes("/") ? run : `.wringer/runs/${run}`);
        }
        catch (error) {
            records.issue(repo, "unsafe-run", String(error));
        }
    }
    else
        runPath = (await newestDirectories(records, "runs"))[0];
    const manifest = runPath ? await records.json(resolve(runPath, "manifest.json"), "wringer.evidence.v1", true) : null;
    if (manifest && runPath) {
        model.run = { id: manifest.run_id, path: relative(repo, runPath), createdAt: manifest.started_at, head: manifest.repo.head_sha, branch: manifest.repo.branch, result: manifest.result.status };
        model.gates = await readGates(records, runPath);
    }
    const frozenPath = runPath ? resolve(runPath, "wringer.spec.yaml") : null;
    const frozen = frozenPath !== null && await Bun.file(frozenPath).exists();
    const spec = await records.yaml(frozen && frozenPath ? frozenPath : resolve(repo, "wringer.spec.yaml"), "wringer.spec.v1");
    model.title = spec?.title ?? model.title;
    model.intent = spec?.intent ?? null;
    const sourcePath = frozen && runPath ? resolve(runPath, "wringer.sources.yaml") : resolve(repo, "wringer.sources.yaml");
    const sources = await records.yaml(sourcePath, "wringer.sources.v1");
    if (model.run && runPath) {
        const accepted = await records.json(resolve(runPath, "acceptance.json"));
        const coverage = await records.json(resolve(runPath, "coverage.json"), "wringer.coverage.v1");
        const judgements = await records.json(resolve(runPath, "judgements.json"), "wringer.judgementrecord.v1");
        if (accepted && !ACCEPTANCE.has(accepted.schema_version))
            records.issue(runPath, "wrong-acceptance-version", `Cannot render ${accepted.schema_version} as requirements.`);
        if (accepted && ACCEPTANCE.has(accepted.schema_version)) {
            const computed: Record<string, number> = { evidenced: 0, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 0 };
            for (const row of accepted.criteria)
                computed[row.state] = (computed[row.state] ?? 0) + 1;
            const countsOkay = Object.keys(computed).every(k => computed[k] === accepted.counts[k]);
            const ids = accepted.criteria.map((r: Obj) => r.criterion);
            if (!countsOkay)
                records.issue(resolve(runPath, "acceptance.json"), "counts-mismatch", "Recorded requirement counts disagree with the requirement rows.");
            else if (new Set(ids).size !== ids.length)
                records.issue(resolve(runPath, "acceptance.json"), "duplicate-requirement", "Two rows name the same requirement.");
            else {
                model.acceptanceCounts = accepted.counts;
                model.limits = accepted.limits;
                if (spec && JSON.stringify(spec.criteria.map((r: Obj) => [r.id, r.title, r.required !== false])) !== JSON.stringify(accepted.criteria.map((r: Obj) => [r.criterion, r.title, r.required])))
                    records.issue(resolve(runPath, "acceptance.json"), "requirements-mismatch", "The assessed requirements do not match the recorded spec's ids, titles, order or required flags.");
                for (const row of accepted.criteria) {
                    const receipt = row.state === "evidenced" ? await resolveReceipt(records, row, runPath, model.gates) : null;
                    const proved = row.state === "evidenced" && receipt?.resolved === true;
                    if (row.state === "evidenced" && !proved)
                        records.issue(runPath, "unresolved-proof", `The proof for ${row.criterion} does not resolve.`);
                    const source = quoteFor(row.criterion, sources, model.intent, frozen);
                    if (source.status === "mismatch")
                        records.issue(sourcePath, "source-mismatch", `${row.criterion}: ${source.message}`);
                    const judgement = row.judgement ? { verdict: row.judgement.verdict, by: row.judgement.by, at: row.judgement.at, stale: row.judgement.stale, note: row.judgement.note ?? null, withoutDisplay: Boolean(judgements?.entries?.find((j: Obj) => j.criterion === row.criterion && j.at === row.judgement.at && j.verdict === row.judgement.verdict)?.judged_without_display) } : null;
                    model.requirements.push({ id: row.criterion, title: row.title, required: row.required, state: row.state, cause: row.cause ?? null, ...wording(row, proved), reason: row.reason, refuses: row.refuses, human: row.state === "human", proved, gate: row.gate, command: row.command, receipt, rawReceipt: row.receipt ?? null, rawJudgement: row.judgement ?? null, source, judgement, show: coverage?.requirements?.find((r: Obj) => r.criterion === row.criterion)?.show ?? null });
                }
            }
        }
    }
    let built: boolean | null = null;
    const loopDirs = await newestDirectories(records, "loops");
    for (const path of loopDirs) {
        const loop = await records.json(resolve(path, "manifest.json"));
        if (!loop || !["wringer.loop.v1", "wringer.loop.v2"].includes(loop.schema_version))
            continue;
        if (!model.run || loop.result.final_run !== model.run.path)
            continue;
        built = loop.result.status === "converged";
        const usage = await records.json(resolve(path, "usage.json"), "wringer.usage.v1");
        if (usage)
            model.usage[1] = { lane: "building", tokens: safeInteger(usage.totals.used), cost: usage.totals.cost ?? null, basis: "Reported by the worker; not independently verified", calls: safeInteger(usage.totals.sessions) };
        model.timeline.push({ at: loop.started_at, label: "Build", detail: `${loop.result.iterations} verification lap(s) · ${loop.result.reason}`, status: built ? "complete" : "pending" });
        break;
    }
    if (model.run)
        model.timeline.push({ at: model.run.createdAt, label: "Verification", detail: `${model.gates.length} recorded checks · ${model.run.result}`, status: model.run.result === "passed" ? "complete" : "failed" });
    for (const path of await newestDirectories(records, "deliveries")) {
        const delivery = await records.json(resolve(path, "manifest.json"), "wringer.delivery.v1");
        if (!delivery || !model.run || delivery.run_dir !== model.run.path)
            continue;
        model.delivery = { id: delivery.delivery_id, mode: delivery.mode, commit: delivery.result.commit ?? null, pushed: delivery.result.pushed === true };
        break;
    }
    // A stop remains visible verbatim, including the absence of a next command.
    for (const path of await records.dirs(".wringer/journeys")) {
        const journey = await records.json(resolve(path, "journey.json"), "wringer.journey.v1");
        if (!journey || !model.run || !journey.phases.some((p: Obj) => p.kind === "verify" && p.id === model.run!.id))
            continue;
        model.journey = journey.journey_id;
        model.timeline = journey.phases.map((p: Obj) => ({ at: p.started_at, label: p.phase, detail: p.outcome ?? "In progress", status: p.ended_at ? (String(p.outcome).includes("stop") ? "pending" : "complete") : "pending" }));
        const stop = await records.json(resolve(path, "stop.json"), "wringer.stop.v1");
        if (stop && stop.next_move === null)
            records.issue(resolve(path, "stop.json"), "missing-next-command", "The product's stop record did not supply a runnable next command.");
        if (stop?.next_move)
            model.nextAction = { title: stop.what, description: stop.why ?? "", command: stop.next_move, owner: "operator", spends: stop.next_spends };
        break;
    }
    // Context and usage may be unreadable without invalidating independently carried proof.
    const contextRecords = new Records(repo, records.reader);
    if (frozen)
        await nativeContext(contextRecords, model, spec);
    model.limits.push(...contextRecords.issues.map(i => `Supplemental workflow context ${i.path}: ${i.message}`));
    model.facts = deriveFacts({ ...model, built });
    model.rail = deriveRail(model.facts);
    model.nextAction = deriveNextAction(model);
    return model;
}
