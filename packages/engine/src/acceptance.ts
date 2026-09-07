import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseYaml, exists } from "./config";
import { Bundle, criterionDigest, maybeJson, posix, safePath, schemaDirectory, sha256, validateDigests } from "./io";
import { EngineError, type Config, type Gate, type GateResult } from "./types";
import { openReader } from "@wringer/records";
import { humanSourceFingerprint } from "./git";
export interface Criterion {
    id: string;
    title: string;
    guidance?: string;
    required?: boolean;
    human?: boolean;
}
export async function loadSpec(repo: string): Promise<any | null> {
    const path = await safePath(repo, "wringer.spec.yaml");
    if (!await exists(path))
        return null;
    const spec = parseYaml(await readFile(path, "utf8"), path);
    const reader = await openReader(schemaDirectory()), checked = await reader.validate(spec, "spec.schema.json");
    if (!checked.ok)
        throw new EngineError(`${path} does not satisfy wringer.spec.v1: ${checked.said}`);
    const ids = new Set();
    for (const c of spec.criteria) {
        if (!c || typeof c.id !== "string" || typeof c.title !== "string" || !c.title || ids.has(c.id))
            throw new EngineError(`${path}: invalid or duplicate criterion`);
        ids.add(c.id);
        if (c.required !== undefined && typeof c.required !== "boolean")
            throw new EngineError(`${path}: required must be boolean`);
        if (c.human !== undefined && typeof c.human !== "boolean")
            throw new EngineError(`${path}: human must be boolean`);
    }
    return spec;
}
/** Conservative POSIX token scan. Comments never become checks, quoted paths remain one token. */
export function shellTokens(command: string): string[] {
    const out: string[] = [];
    let token = "", quote = "", escaped = false;
    for (const c of command) {
        if (escaped) {
            token += c;
            escaped = false;
            continue;
        }
        if (c === "\\" && quote !== "'") {
            escaped = true;
            continue;
        }
        if (quote) {
            if (c === quote)
                quote = "";
            else
                token += c;
            continue;
        }
        if (c === "'" || c === '"') {
            quote = c;
            continue;
        }
        if (c === "#" && !token)
            break;
        if (/\s|[;|&()<>]/.test(c)) {
            if (token)
                out.push(token);
            token = "";
        }
        else
            token += c;
    }
    if (token)
        out.push(token);
    return out;
}
export async function checkIdentity(repo: string, gate: Gate) {
    const files: Record<string, string> = {};
    for (const token of shellTokens(gate.run)) {
        if (!token.includes("/") && !/\.(?:py|[cm]?[jt]sx?|sh|rb|go|rs|java|kt|php|sql|ya?ml|json|toml)$/.test(token))
            continue;
        try {
            const path = await safePath(repo, token), name = posix(relative(repo, path));
            if (name === ".wringer" || name.startsWith(".wringer/"))
                continue;
            const stat = await Bun.file(path).stat();
            if (stat.isFile())
                files[name] = sha256(await readFile(path));
        }
        catch { }
    }
    return { gate_id: gate.id, run: gate.run, run_sha256: sha256(gate.run), files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))), coverage: Object.keys(files).length ? "command-and-files" : "command-only" };
}
export async function latestRun(repo: string): Promise<string | null> {
    const root = await safePath(repo, ".wringer/runs");
    if (!await exists(root))
        return null;
    const runs: {
        path: string;
        time: number;
    }[] = [];
    for (const e of await readdir(root, { withFileTypes: true })) {
        if (!e.isDirectory() || e.isSymbolicLink())
            continue;
        const path = join(root, e.name);
        const m = await maybeJson(join(path, "manifest.json"));
        if (m?.schema_version === "wringer.evidence.v1" && m.result)
            runs.push({ path, time: Date.parse(m.started_at) });
    }
    return runs.sort((a, b) => b.time - a.time)[0]?.path ?? null;
}
async function receipts(repo: string, current: string, checks: any[]) {
    const root = await safePath(repo, ".wringer/runs"), found = new Map<string, {
        kind: string;
        bundle: string;
        cites: string;
    }>(), notices: string[] = [];
    const currentExecution = await maybeJson(join(current, "execution.json"));
    if (!await exists(root))
        return { found, notices };
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries.sort((a, b) => b.name.localeCompare(a.name))) {
        if (!e.isDirectory() || e.isSymbolicLink())
            continue;
        const directory = join(root, e.name);
        if (resolve(directory) === resolve(current))
            continue;
        try {
            const manifest = await maybeJson(join(directory, "manifest.json"));
            if (!manifest || manifest.schema_version !== "wringer.evidence.v1" || manifest.result.status === "interrupted")
                continue;
            const sealed = await validateDigests(directory);
            if (!sealed.ok) {
                notices.push(`${posix(relative(repo, directory))}: ${sealed.errors.join("; ")}`);
                continue;
            }
            const prior = await maybeJson(join(directory, "checks.json"));
            const execution = await maybeJson(join(directory, "execution.json"));
            if (execution && currentExecution && ["backend", "execution_mode", "image", "runtime", "network", "user", "env_allowlist"].some(key => JSON.stringify(execution[key]) !== JSON.stringify(currentExecution[key])))
                continue;
            for (const check of checks) {
                if (found.has(check.gate_id))
                    continue;
                const identical = prior?.checks?.find((c: any) => c.gate_id === check.gate_id && c.run === check.run && JSON.stringify(c.files) === JSON.stringify(check.files));
                if (!identical)
                    continue;
                const dirs = await readdir(join(directory, "gates"), { withFileTypes: true });
                for (const d of dirs) {
                    if (!d.isDirectory() || d.isSymbolicLink())
                        continue;
                    const r = await maybeJson(join(directory, "gates", d.name, "result.json"));
                    if (r?.gate_id === check.gate_id && r.command === check.run && r.status === "failed" && r.exit_code !== 0 && ![126, 127, 137, 143].includes(r.exit_code) && !r.timed_out) {
                        const stability = await maybeJson(join(directory, "stability.json"));
                        if (stability?.gates?.some((s: any) => s.gate_id === check.gate_id && s.classification !== "stable_fail"))
                            continue;
                        found.set(check.gate_id, { kind: "failure", bundle: posix(relative(repo, directory)), cites: `gates/${d.name}/result.json` });
                        break;
                    }
                }
            }
        }
        catch (e) {
            notices.push(`${posix(relative(repo, directory))}: ${(e as Error).message}`);
        }
    }
    return { found, notices };
}
export async function acceptance(repo: string, config: Config, bundle: Bundle, results: GateResult[], checks: any[], spec: any | null, vacuity?: any, mutated = new Set<string>()) {
    if (!spec?.approved)
        return undefined;
    const history = await receipts(repo, bundle.directory, checks);
    const judgementPath = await safePath(repo, "wringer.judgements.yaml");
    let judgements: any = null;
    if (await exists(judgementPath)) {
        judgements = parseYaml(await readFile(judgementPath, "utf8"), judgementPath);
        if (!["wringer.judgement.v1", "wringer.judgement.v2"].includes(judgements.schema_version) || !Array.isArray(judgements.judgements))
            throw new EngineError(`Invalid judgement record ${judgementPath}`);
        const seen = new Set();
        for (const j of judgements.judgements) {
            if (!j || seen.has(j.criterion) || !["met", "not_met"].includes(j.verdict) || typeof j.by !== "string" || typeof j.at !== "string" || !/[0-9a-f]{64}/.test(j.criterion_digest))
                throw new EngineError(`Malformed or duplicate judgement in ${judgementPath}`);
            seen.add(j.criterion);
        }
        await bundle.json("judgements.json", { schema_version: "wringer.judgementrecord.v1", source_schema_version: judgements.schema_version, entries: judgements.judgements });
    }
    const bindings = await maybeJson(await safePath(repo, ".wringer/judgement-bindings.json"));
    const validBindings = bindings?.schema_version === "wringer.native.judgement-bindings.v1" && Array.isArray(bindings.entries) && bindings.entries.every((b: any) => b && typeof b.criterion === "string" && /^[a-f0-9]{64}$/.test(b.source_fingerprint) && /^[a-f0-9]{64}$/.test(b.entry_sha256)) && new Set(bindings.entries.map((b: any) => b.criterion)).size === bindings.entries.length;
    const currentSource = spec.criteria.some((c: Criterion) => c.human) ? await humanSourceFingerprint(repo) : null;
    if (currentSource) {
        await bundle.json("human-source.json", { schema_version: "wringer.native.human-source.v1", fingerprint: currentSource, excluded: [".wringer/", "wringer.judgements.yaml"], limits: ["This source fingerprint also includes Git state; changing a commit or staging state can conservatively invalidate an unchanged rendering."] });
        if (bindings)
            await bundle.json("judgement-bindings.json", bindings);
    }
    const counts: Record<string, number> = { evidenced: 0, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 0 };
    const criteria = spec.criteria.map((c: Criterion) => {
        const g = config.gates.find(g => g.proves.includes(c.id));
        const result = g ? results.find(r => r.gate_id === g.id) : null;
        const sensitive = vacuity?.verdict === "proven" ? vacuity.gates?.find((r: any) => r.gate_id === g?.id && r.sensitive) : undefined;
        const receipt = g ? history.found.get(g.id) ?? (sensitive ? { kind: "sensitive", bundle: posix(relative(repo, bundle.directory)), cites: sensitive.cites } : undefined) : undefined;
        const row: any = { criterion: c.id, title: c.title, required: c.required !== false, state: "unevidenced", gate: g?.id ?? null, command: g?.run ?? null, receipt: null, reason: "No check is bound to this requirement. Add a proves binding and record the check failing before building.", refuses: c.required !== false, witness: null, cause: "unbound", demonstrated_able_to_fail: g ? !!receipt : null, judgement: null };
        if (c.human) {
            row.state = "human";
            row.gate = null;
            row.command = null;
            row.demonstrated_able_to_fail = null;
            const j = judgements?.judgements.find((j: any) => j.criterion === c.id);
            if (j) {
                const binding = validBindings ? bindings.entries.find((b: any) => b.criterion === c.id) : null;
                const stale = j.criterion_digest !== criterionDigest(c) || !binding || binding.source_fingerprint !== currentSource || binding.entry_sha256 !== sha256(JSON.stringify(j));
                row.judgement = { verdict: j.verdict, by: j.by, at: j.at, stale, ...(j.note !== undefined ? { note: j.note } : {}) };
                row.refuses = row.required && (stale || j.verdict !== "met");
                row.cause = stale ? "human-judgement-stale" : j.verdict !== "met" ? "human-said-no" : null;
                row.reason = stale ? "The requirement, reviewed source, or judgement binding changed or has no source-bound receipt. Show the current result and record a current answer." : j.verdict === "met" ? "A person recorded that this requirement is met against the current source." : "A person recorded that this requirement is not met.";
            }
            else {
                row.cause = "human-unanswered";
                row.reason = `A person must inspect the display and record their own judgement: wringer-board judge --id ${c.id}`;
            }
        }
        else if (g) {
            row.cause = null;
            if (mutated.has(g.id)) {
                row.reason = `The named check files for ${g.id} changed during execution. Its result cannot establish proof against the recorded check identity. Restore the intended check and verify again.`;
            }
            else if (!result) {
                row.state = "gate-did-not-run";
                row.reason = `The bound check ${g.id} did not run. Run wring verify.`;
            }
            else if (result.status !== "passed") {
                row.state = "gate-failed";
                row.reason = `The bound check ${g.id} failed. Run wring explain for its output.`;
            }
            else if (receipt) {
                row.state = "evidenced";
                row.receipt = receipt;
                row.refuses = false;
                row.reason = "The same check passed now and a sealed earlier record shows it genuinely failing.";
            }
            else {
                row.cause = "born-green";
                row.reason = "This check passed, but no sealed earlier failure of this same check was found. A passing check alone cannot prove the requirement.";
            }
        }
        counts[row.state] = (counts[row.state] ?? 0) + 1;
        return row;
    });
    const record = { schema_version: "wringer.acceptance.v3", counts, criteria, limits: ["Evidence establishes the declared check's result, not the completeness of the requirement or correctness of all software.", "A historical failure is accepted only with matching recorded command and named check-file identities; commands naming no files have command-only coverage.", "Human judgements record a person's words; identity is not verified. A matching source/entry binding is required; legacy unbound judgements remain readable but cannot authorize delivery.", "Local evidence is tamper-evident, not tamper-proof. A writer who controls the whole evidence store can replace the seals.", "Sensitivity receipts, where present in legacy records, describe two trees' outcomes and do not alone prove the change caused the difference."] };
    await bundle.json("acceptance.json", record);
    const requirements = criteria.map((r: any) => ({ criterion: r.criterion, title: r.title, needs_a_person: r.state === "human", covered: r.state === "human" ? null : !!r.gate, check: r.gate, shown: r.state === "human" ? !!config.show?.[r.criterion] : null, show: r.state === "human" ? config.show?.[r.criterion] ?? null : null }));
    await bundle.json("coverage.json", { schema_version: "wringer.coverage.v1", counts: { covered: requirements.filter((r: any) => r.covered).length, checkable: requirements.filter((r: any) => !r.needs_a_person).length, shown: requirements.filter((r: any) => r.shown).length, needing_a_person: requirements.filter((r: any) => r.needs_a_person).length }, requirements, limits: ["A bound check does not establish that it covers the requirement's meaning. A declared display is not a recorded successful showing."] });
    if (history.notices.length)
        await bundle.json("history-notices.json", { schema_version: "wringer.native.history-notices.v1", skipped: history.notices });
    return record;
}
