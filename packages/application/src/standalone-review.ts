import { mkdir, writeFile, open, unlink, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { criterionDigest, EngineError, loadConfig, loadSpec, parseYaml, Redactor, runProcess, safePath, sha256, snapshot, Bundle, humanSourceFingerprint } from "@wringer/engine";
import { readSchema } from "@wringer/records";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
export async function showCriterion(repo: string, criterion: string, options: {
    signal?: AbortSignal;
} = {}) {
    options.signal?.throwIfAborted();
    repo = resolve(repo);
    const spec = await loadSpec(repo), row = spec?.criteria.find((r: any) => r.id === criterion);
    if (!row || !row.human)
        throw new Error(`No human criterion ${criterion} is declared`);
    const config = await loadConfig(repo), command = config.show?.[criterion];
    const displayId = crypto.randomUUID(), path = await safePath(repo, `.wringer/displays/${displayId}`);
    const before = await snapshot(repo), sourceBefore = await humanSourceFingerprint(repo);
    const result = command ? await runProcess(command, { cwd: repo, timeout: 120, redactor: new Redactor(config.evidence.redact.env), signal: options.signal }) : null;
    const after = await snapshot(repo), sourceAfter = await humanSourceFingerprint(repo), output = result ? `${result.stdout}${result.stderr}` : "No show command is declared for this human criterion.";
    const success = !!result && result.exit_code === 0 && !result.timed_out && !result.interrupted && before.fingerprint === after.fingerprint && sourceBefore === sourceAfter;
    const record = { schema_version: "wringer.native.display.v1", id: displayId, criterion, criterion_digest: criterionDigest(row), command: command ?? null, at: new Date().toISOString(), success, exit: result?.exit_code ?? null, output_digest: sha256(output), fingerprint: after.fingerprint, head_sha: after.head_sha, dirty: after.dirty, reason: !command ? output : before.fingerprint !== after.fingerprint ? "The display command changed source files; verify and show the current tree again." : success ? "Display completed successfully." : `Display failed: ${output}` };
    const bundle = await new Bundle(path, new Redactor(config.evidence.redact.env)).prepare();
    await bundle.json("display.json", { ...record, source_fingerprint: sourceAfter });
    await bundle.write("output.log", output);
    await bundle.seal();
    const pen = `wringer-board judge --repo ${quote(repo)} --criterion ${quote(criterion)} --display ${displayId} --verdict met --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'`;
    return { ...record, output, ...(!success ? { independent_inspection_route: `${pen} --without-display` } : {}), next_move: success ? pen : `wringer-board show --repo ${quote(repo)} --criterion ${quote(criterion)}` };
}
export interface JudgementOptions {
    criterion: string;
    display: string;
    verdict: "met" | "not_met";
    by: string;
    note?: string;
    withoutDisplay?: boolean;
}
async function judgementEntry(repo: string, options: JudgementOptions) {
    repo = resolve(repo);
    if (!["met", "not_met"].includes(options.verdict) || typeof options.by !== "string" || !options.by.trim() || options.by.length > 200 || options.note !== undefined && (typeof options.note !== "string" || options.note.length > 16384) || (options.verdict === "not_met" || options.withoutDisplay) && !options.note?.trim())
        throw new Error("A judgement requires met/not_met and a recorded actor; correction or independent inspection also needs an observation");
    if (!/^[a-f0-9-]{36}$/.test(options.display))
        throw new Error("Invalid display receipt id");
    const { validateDigests } = await import("@wringer/engine");
    const root = await safePath(repo, `.wringer/displays/${options.display}`), sealed = await validateDigests(root);
    if (!sealed.ok)
        throw new Error(`Display receipt changed: ${sealed.errors.join("; ")}`);
    const display = await Bun.file(join(root, "display.json")).json();
    const showNext = `wringer-board show --repo ${quote(repo)} --criterion ${quote(options.criterion)}`;
    if (display.schema_version !== "wringer.native.display.v1" || display.id !== options.display || typeof display.success !== "boolean" || typeof display.reason !== "string" || (display.success && (display.exit !== 0 || typeof display.command !== "string")) || display.output_digest !== sha256(await Bun.file(join(root, "output.log")).text()))
        throw new EngineError("The display receipt is malformed or contradicts its output. No judgement was recorded.", 3, showNext);
    const spec = await loadSpec(repo), criterion = spec?.criteria.find((r: any) => r.id === options.criterion);
    if (!criterion?.human || display.criterion !== options.criterion || display.criterion_digest !== criterionDigest(criterion))
        throw new Error("The human criterion changed after it was shown");
    const snap = await snapshot(repo);
    const sourceFingerprint = await humanSourceFingerprint(repo);
    if (display.fingerprint !== snap.fingerprint || display.source_fingerprint !== sourceFingerprint)
        throw new EngineError("The working tree changed after the display. Show the current result before judging it.", 3, showNext);
    if (!display.success && !options.withoutDisplay)
        throw new EngineError(`No judgement was recorded. ${display.reason} If you inspected it independently, the explicit --without-display route records this failure beside your note.`, 3, showNext);
    const entry: any = { criterion: options.criterion, verdict: options.verdict, by: options.by, at: new Date().toISOString(), criterion_digest: criterionDigest(criterion), ...(options.note?.trim() ? { note: options.note } : {}) };
    if (display.success)
        entry.display = { command: display.command, exit: display.exit, output_digest: display.output_digest, at: display.at, head_sha: display.head_sha ?? "", dirty: display.dirty };
    else {
        entry.judged_without_display = true;
        entry.show_failure = display.reason;
    }
    return { entry, sourceFingerprint, fingerprint: snap.fingerprint };
}
export async function recordJudgement(repo: string, options: JudgementOptions) {
    const result = await recordJudgements(repo, [options]);
    return { status: result.status, entry: result.entries[0], next_move: result.next_move };
}
/** Validate every shown criterion before replacing one judgement file. A failed
 * display or stale source cannot leave only the first criterion accepted. */
export async function recordJudgements(repo: string, options: JudgementOptions[]) {
    repo = resolve(repo);
    if (!options.length || options.length > 256 || new Set(options.map(row => row.criterion)).size !== options.length) throw new Error("Select a bounded, unique set of human criteria");
    const control = await safePath(repo, ".wringer"); await mkdir(control, { recursive: true });
    const lockPath = await safePath(repo, ".wringer/judgement.lock"), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("A judgement write is active or uncertain; inspect it before retrying"); });
    try { return await persistJudgements(repo, options); }
    finally { await lock.close(); await unlink(lockPath); }
}
async function persistJudgements(repo: string, options: JudgementOptions[]) {
    const checked = [];
    for (const option of options) checked.push(await judgementEntry(repo, option));
    const sourceFingerprint = checked[0]!.sourceFingerprint, fingerprint = checked[0]!.fingerprint;
    if (checked.some(row => row.sourceFingerprint !== sourceFingerprint || row.fingerprint !== fingerprint)) throw new Error("The working tree changed between the displayed criteria");
    const criteria = new Set(options.map(row => row.criterion));
    const schemas = new URL("../../../schema/", import.meta.url).pathname, ajv = addFormats(new Ajv2020({ strict: false }));
    const validateCurrent = ajv.compile<any>(await readSchema("judgements-v2.schema.json", schemas) as object);
    const path = await safePath(repo, "wringer.judgements.yaml");
    let previous: any = { schema_version: "wringer.judgement.v2", judgements: [] };
    if (await Bun.file(path).exists()) {
        previous = parseYaml(await Bun.file(path).text(), "wringer.judgements.yaml");
        if (!["wringer.judgement.v1", "wringer.judgement.v2"].includes(previous.schema_version) || !Array.isArray(previous.judgements))
            throw new Error("The existing judgement record is malformed; it was not overwritten");
        const validatePrevious = previous.schema_version === "wringer.judgement.v1" ? ajv.compile<any>(await readSchema("judgements.schema.json", schemas) as object) : validateCurrent;
        if (!validatePrevious(previous) || new Set(previous.judgements.map((r: any) => r.criterion)).size !== previous.judgements.length)
            throw new Error("The existing judgement record is malformed or duplicated; it was not overwritten");
    }
    const record = { schema_version: "wringer.judgement.v2", judgements: [...previous.judgements.filter((r: any) => !criteria.has(r.criterion)), ...checked.map(row => row.entry)] };
    if (!validateCurrent(record))
        throw new Error("The judgement does not satisfy its published format; nothing was written");
    const persisted = new Redactor((await loadConfig(repo)).evidence.redact.env).deep(record);
    const entries = persisted.judgements.filter((row: any) => criteria.has(row.criterion));
    const bindingsPath = await safePath(repo, ".wringer/judgement-bindings.json");
    let bindings: any = { schema_version: "wringer.native.judgement-bindings.v1", entries: [] };
    if (await Bun.file(bindingsPath).exists()) {
        bindings = await Bun.file(bindingsPath).json();
        if (bindings.schema_version !== "wringer.native.judgement-bindings.v1" || !Array.isArray(bindings.entries) || bindings.entries.some((row: any) => typeof row.criterion !== "string" || !/^[a-f0-9]{64}$/.test(row.source_fingerprint) || !/^[a-f0-9]{64}$/.test(row.entry_sha256)) || new Set(bindings.entries.map((row: any) => row.criterion)).size !== bindings.entries.length)
            throw new Error("Existing source-bound judgement evidence is malformed; nothing was overwritten");
    }
    if ((await snapshot(repo)).fingerprint !== fingerprint || await humanSourceFingerprint(repo) !== sourceFingerprint)
        throw new EngineError("Source changed while recording the judgement; show it again.", 3);
    const temporary = await safePath(repo, `.wringer/judgement-${crypto.randomUUID()}.json`);
    await writeFile(temporary, JSON.stringify(persisted, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
    // A crash between the two writes fails closed: acceptance requires both.
    await mkdir(join(repo, ".wringer"), { recursive: true });
    await writeFile(bindingsPath, JSON.stringify({ ...bindings, entries: [...bindings.entries.filter((row: any) => !criteria.has(row.criterion)), ...entries.map((entry: any) => ({ criterion: entry.criterion, source_fingerprint: sourceFingerprint, entry_sha256: sha256(JSON.stringify(entry)) }))] }, null, 2) + "\n", { mode: 0o600 });
    return { status: "recorded", entries, next_move: `wring verify --repo ${quote(repo)}` };
}
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
