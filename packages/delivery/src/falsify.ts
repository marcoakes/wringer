import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, runProcess, Bundle, Redactor, preflightContainer, runGateCommand } from "@wringer/engine";
import { audit, deliveryPath } from "./audit";
import { digest, git, inside, json, put as writeRecord, quote, Refusal, seal, stamp } from "./io";
import type { Anchor } from "./deliver";
export interface Mutation {
    path: string;
    line: number;
    was: string;
    became: string;
    mutation: string;
}
const substitutions: [
    RegExp,
    string,
    string
][] = [[/===/, "!==", "'===' → '!=='"], [/!==/, "===", "'!==' → '==='"], [/(?<![=!])==(?!=)/, "!=", "'==' → '!='"], [/(?<![=!])!=(?!=)/, "==", "'!=' → '=='"], [/>=/, "<", "'>=' → '<'"], [/<=/, ">", "'<=' → '>'"], [/\btrue\b/, "false", "'true' → 'false'"], [/\bfalse\b/, "true", "'false' → 'true'"], [/\bTrue\b/, "False", "'True' → 'False'"], [/\bFalse\b/, "True", "'False' → 'True'"], [/\breturn 1\b/, "return 0", "'return 1' → 'return 0'"], [/\breturn 0\b/, "return 1", "'return 0' → 'return 1'"]];
export function mutationPlan(diff: string): Mutation[] {
    const byFile = new Map<string, Mutation[]>();
    let path = "", line = 0;
    for (const raw of diff.split("\n")) {
        if (raw.startsWith("+++ b/")) {
            path = raw.slice(6);
            continue;
        }
        const hunk = /^@@ .* \+(\d+)/.exec(raw);
        if (hunk) {
            line = Number(hunk[1]);
            continue;
        }
        if (raw.startsWith("+") && !raw.startsWith("+++")) {
            const was = raw.slice(1);
            if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|c|cpp|h|rb|sh)$/.test(path) && !/(^|\/)(?:\.wringer|node_modules|vendor)(\/|$)/.test(path) && !/^\s*(?:#|\/\/|\*)/.test(was)) {
                for (const [pattern, replacement, mutation] of substitutions)
                    if (pattern.test(was)) {
                        const items = byFile.get(path) || [];
                        items.push({ path, line, was, became: was.replace(pattern, replacement), mutation });
                        byFile.set(path, items);
                        break;
                    }
            }
            line++;
        }
        else if (raw.startsWith(" "))
            line++;
    }
    const groups = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v), result: Mutation[] = [];
    for (let index = 0; groups.some(g => g[index]); index++)
        for (const group of groups)
            if (group[index])
                result.push(group[index]!);
    return result;
}
export interface FalsifyOptions {
    maxAttempts?: number;
    wallSeconds?: number;
    signal?: AbortSignal;
}
export async function falsify(repo: string, delivery: string, options: FalsifyOptions = {}): Promise<{
    directory: string;
    record: any;
    anchor: any;
    table: string;
}> {
    repo = resolve(repo);
    const delivered = await deliveryPath(repo, delivery);
    const checked = await audit(repo, delivery);
    if (checked.status !== "passed")
        throw new Refusal("The delivered claims must audit before their committed range can be falsified.", `wring audit --repo ${quote(repo)} --delivery ${quote(delivery)}`, "audit-failed");
    const anchor: Anchor = await json(join(delivered, "anchor.json"));
    if (!anchor.code_commit)
        throw new Refusal("A dry-run has no committed range to falsify.", `wring deliver --repo ${quote(repo)} --send`);
    const started = performance.now(), id = stamp(), directory = await inside(repo, `.wringer/falsifications/${id}`);
    const max = options.maxAttempts ?? 24, wall = options.wallSeconds ?? 60;
    if (!Number.isInteger(max) || max < 1 || max > 500 || !Number.isFinite(wall) || wall <= 0 || wall > 3600)
        throw new Error("Falsification needs 1–500 attempts and a 1–3600 second wall ceiling");
    const diff = await git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--unified=0", anchor.base_commit, anchor.code_commit, "--", ".", ":(exclude).wringer"], { raw: true });
    const checkRecord = await json(join(delivered, "run/checks.json")), checkFiles = new Set<string>(checkRecord.checks.flatMap((c: any) => Object.keys(c.files)));
    const candidates = mutationPlan(diff).filter(c => !checkFiles.has(c.path)), attempts: any[] = [], gatesUsed: string[] = [];
    let redactor = new Redactor();
    const put = (path: string, value: unknown) => writeRecord(path, value, redactor);
    const remaining = () => Math.max(0.01, wall - (performance.now() - started) / 1000);
    let verdict = "measured", reason = "", truncated: string | undefined;
    const scratch = await mkdtemp(join(tmpdir(), "wringer-falsify-")), work = join(scratch, "repo");
    try {
        if (!candidates.length) {
            verdict = "not-applicable";
            reason = "The committed range contains no supported changed source lines.";
        }
        else {
            await git(scratch, ["clone", "--no-local", "--quiet", repo, work], { timeout: remaining() });
            await git(work, ["checkout", "--detach", anchor.code_commit], { timeout: remaining() });
            const config = await loadConfig(work), bound = config.gates.filter(g => g.proves.length);
            redactor = new Redactor(config.evidence.redact.env);
            await preflightContainer(work, config);
            const bundle = await new Bundle(directory, redactor).prepare();
            if (!bound.length) {
                verdict = "not-applicable";
                reason = "No checks bind requirements in the committed configuration.";
            }
            else {
                if (config.run?.prove_setup) {
                    const setup = await runProcess(config.run.prove_setup, { cwd: work, timeout: Math.min(remaining(), 120), signal: options.signal, redactor });
                    await put(join(directory, "control/setup.stdout.log"), setup.stdout);
                    await put(join(directory, "control/setup.stderr.log"), setup.stderr);
                    if (setup.exit_code || setup.timed_out) {
                        verdict = "inconclusive";
                        reason = "The committed scratch setup failed. No mutant is claimed caught.";
                    }
                }
                if (verdict === "measured")
                    for (const gate of bound) {
                        const result = await runGateCommand(work, config, bundle, `control/${gate.id}`, gate.run, { cwd: work, timeout: Math.min(gate.timeout, remaining()), signal: options.signal, redactor });
                        await put(join(directory, "control", `${gate.id}.json`), result);
                        if (result.exit_code !== 0 || result.timed_out || result.interrupted) {
                            verdict = "inconclusive";
                            reason = `The unmutated committed control failed at ${gate.id}; no mutant is claimed caught. ${result.stderr || result.stdout}`;
                            break;
                        }
                    }
                if (verdict === "measured") {
                    gatesUsed.push(...bound.map(g => g.id));
                    for (const candidate of candidates.slice(0, max)) {
                        if (options.signal?.aborted || (performance.now() - started) / 1000 >= wall) {
                            truncated = `Wall-clock or cancellation ceiling reached; ${candidates.length - attempts.length} possible mutations were not attempted.`;
                            break;
                        }
                        // Each mutant starts from a new committed checkout. Gate-created state from another
                        // mutant cannot make it appear caught, or let it survive by warming a cache.
                        const variant = join(scratch, `mutant-${attempts.length.toString().padStart(3, "0")}`);
                        await git(scratch, ["clone", "--no-local", "--quiet", work, variant], { timeout: remaining() });
                        await git(variant, ["checkout", "--detach", anchor.code_commit], { timeout: remaining() });
                        const trialDir = `attempts/${attempts.length.toString().padStart(3, "0")}`;
                        if (config.run?.prove_setup) {
                            const setup = await runProcess(config.run.prove_setup, { cwd: variant, timeout: Math.min(remaining(), 120), signal: options.signal, redactor });
                            await put(join(directory, trialDir, "setup.json"), setup);
                            if (setup.exit_code || setup.timed_out || setup.interrupted) {
                                truncated = `Mutant setup failed before ${candidate.path}:${candidate.line}; this is not a caught mutant.`;
                                break;
                            }
                        }
                        const target = await inside(variant, candidate.path), original = await Bun.file(target).text(), lines = original.split("\n");
                        if (lines[candidate.line - 1] !== candidate.was)
                            throw new Error(`Committed diff line does not match ${candidate.path}:${candidate.line}`);
                        lines[candidate.line - 1] = candidate.became;
                        await writeFile(target, lines.join("\n"));
                        const caught: string[] = [];
                        let uncertain = false;
                        try {
                            for (const gate of bound) {
                                const result = await runGateCommand(variant, config, bundle, `${trialDir}/${gate.id}`, gate.run, { cwd: variant, timeout: Math.min(gate.timeout, remaining()), signal: options.signal, redactor });
                                await put(join(directory, `attempts/${attempts.length.toString().padStart(3, "0")}/${gate.id}.json`), result);
                                if (result.timed_out || result.interrupted || [126, 127].includes(result.exit_code)) {
                                    uncertain = true;
                                    break;
                                }
                                if (result.exit_code !== 0)
                                    caught.push(gate.id);
                            }
                        }
                        finally {
                            await rm(variant, { recursive: true, force: true });
                        }
                        if (uncertain) {
                            truncated = `Measurement stopped at ${candidate.path}:${candidate.line}: timeout, cancellation or unavailable command is not a caught mutant. ${candidates.length - attempts.length} remain unmeasured.`;
                            break;
                        }
                        attempts.push({ ...candidate, caught_by: caught, survived: caught.length === 0 });
                    }
                    if (candidates.length > attempts.length && !truncated)
                        truncated = `Attempt ceiling ${max} reached; ${candidates.length - attempts.length} possible mutations were not attempted.`;
                    if (!attempts.length) {
                        verdict = "inconclusive";
                        reason = truncated || "No mutation completed within the declared budget.";
                        gatesUsed.length = 0;
                    }
                }
            }
        }
    }
    finally {
        await rm(scratch, { recursive: true, force: true });
    }
    const record = { schema_version: "wringer.falsification.v1", verdict, reason, counts: { attempted: attempts.length, caught: attempts.filter(a => !a.survived).length, survived: attempts.filter(a => a.survived).length }, gates: gatesUsed, attempts, duration_ms: Math.round(performance.now() - started), ...(truncated ? { truncated } : {}), limits: ["Survivors are findings about the checks, never verdicts on the work.", "Catching these mechanical mutations is necessary and demonstrably not sufficient; it is not a quality score.", "Textual substitutions do not understand program semantics and cover only selected changed lines.", "This measurement refuses no delivery and does not change any acceptance judgement."] };
    const measured = { schema_version: "wringer.native.falsification-anchor.v1", delivery_id: anchor.delivery_id, run_id: anchor.run_id, base_commit: anchor.base_commit, code_commit: anchor.code_commit, range: `${anchor.base_commit}..${anchor.code_commit}`, diff_sha256: digest(diff), at: new Date().toISOString() };
    await put(join(directory, "falsification.json"), record);
    await put(join(directory, "anchor.json"), measured);
    const table = renderFalsification(record, measured);
    await put(join(directory, "summary.md"), table + "\n");
    await seal(directory);
    return { directory, record, anchor: measured, table };
}
export function renderFalsification(record: any, anchor: any): string {
    return [`Falsification: ${record.verdict}`, `Committed range: ${anchor.range}`, `Measured at commit: ${anchor.code_commit}`, record.reason ? `Reason: ${record.reason}` : "Reason: the unmutated control passed and the following mutations were measured.", "", "| Changed line | Mutation | Observation |", "|---|---|---|", ...record.attempts.map((a: any) => `| ${a.path}:${a.line} | ${a.mutation} | ${a.survived ? "SURVIVED" : `Caught by ${a.caught_by.join(", ")}`} |`), "", record.verdict === "measured" ? `${record.counts.attempted} attempted · ${record.counts.caught} caught · ${record.counts.survived} survived.` : "No mutation result is claimed.", record.truncated || "", ...record.limits].filter((v, i) => v || i > 0).join("\n");
}
