import { mkdir, mkdtemp, readFile, writeFile, lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { hashBytes, hashValue, validateExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { processDriver, runContainedCommands, type ContainedCommandRequest, type ContainedCommandResult } from "@wringer/runtime";
import { Redactor } from "@wringer/engine";
import { auditContained } from "./contained";
import { mutationPlan, type Mutation } from "./falsify";
import { inside, files, seal, quote } from "./io";
export interface ContainedFalsifyOptions {
    bundleDir: string;
    outputDir?: string;
    maxAttempts?: number;
    wallSeconds?: number;
    signal?: AbortSignal;
}
export interface ContainedFalsification {
    schema_version: "wringer.contained-falsification.v1";
    id: string;
    deliveryId: string;
    measuredAt: string;
    status: "measured" | "inconclusive" | "not-applicable";
    reason: string;
    anchor: {
        baseCommit: string;
        codeCommit: string;
        candidateTree: string;
        committedRange: string;
        diffSha256: string;
        candidateBundleSha256: string;
        deliveryManifestSha256: string;
        acceptanceSha256: string;
    };
    budget: {
        maxAttempts: number;
        wallSeconds: number;
    };
    control: {
        status: "passed" | "unavailable";
        receipt: string | null;
        reason: string;
    };
    attempts: {
        path: string;
        line: number;
        mutation: string;
        beforeSha256: string | null;
        afterSha256: string | null;
        status: "caught" | "survived" | "unavailable";
        caughtBy: string[];
        receipt: string | null;
        reason: string;
    }[];
    counts: {
        supported: number;
        attempted: number;
        caught: number;
        survived: number;
        unavailable: number;
        unattempted: number;
    };
    limits: string[];
}
const limits = [
    "A bounded lexical mutation challenge, not a correctness proof or a complete mutation score. Unsupported languages, operators and equivalent mutants are not resolved.",
    "Only supported added/changed committed source lines are challenged; the unchanged pinned acceptance inputs and regression commands run in a new isolated clone for every control and mutant.",
    "A timeout, missing command, failed setup, failed mutation-integrity check or unavailable runtime is not a caught mutant. No worker or judge is called and no agent answer determines the result.",
    "Platform provenance is recorded; these receipts do not substitute for the live Apple-container/gVisor isolation release gate. Execution may require the declared image and network policy; no host fallback exists.",
];
const env = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
async function git(store: string, args: string[], signal?: AbortSignal) {
    const result = await processDriver.command(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=always", "--git-dir", store, ...args], { signal, env, timeoutMs: 60000 });
    if (result.code !== 0)
        throw new Error(`Falsification source operation failed: ${new Redactor().scrub(result.stderr)}`);
    return result.stdout;
}
const timedOut = (code: number) => [124, 126, 127, 137, 143].includes(code);
function portable(measured: ContainedCommandResult, redactor: Redactor) {
    const p = measured.provenance;
    return redactor.deep({ ...measured, provenance: { ...p, repository: { url: p.repository.url, commit: p.repository.commit } } });
}
function sanitize(value: unknown, redactor: Redactor): unknown {
    if (typeof value === "string")
        return redactor.scrub(value).replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]").replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/g, "[REDACTED INCOMPLETE PRIVATE KEY]");
    if (Array.isArray(value))
        return value.map(item => sanitize(item, redactor));
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [redactor.scrub(key), sanitize(item, redactor)]));
    return value;
}
function commands(plan: ExecutionPlan, remaining: number, mutation?: {
    candidate: Mutation;
    original: string;
    altered: string;
}): ContainedCommandRequest["commands"] {
    const rows: ContainedCommandRequest["commands"] = plan.environment.setup.map(c => ({ id: `setup/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: Math.min(remaining, c.timeout_seconds * 1000) }));
    if (mutation) {
        const { candidate, original, altered } = mutation, target = quote(`./${candidate.path}`), before = hashBytes(original), after = hashBytes(altered);
        rows.push({ id: "mutation/apply", cwd: ".", timeoutMs: Math.min(remaining, 10000), argv: ["/bin/sh", "-c", `set -eu; test "$(sha256sum ${target} | cut -d ' ' -f 1)" = ${quote(before)}; printf %s ${quote(altered)} > ${target}; test "$(sha256sum ${target} | cut -d ' ' -f 1)" = ${quote(after)}`] });
    }
    rows.push(...plan.environment.baseline.map(c => ({ id: `baseline/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: Math.min(remaining, c.timeout_seconds * 1000) })), ...plan.acceptance.checks.map(c => ({ id: `acceptance/${c.id}`, argv: c.argv, cwd: c.cwd, timeoutMs: Math.min(remaining, c.timeout_seconds * 1000) })));
    if (mutation) {
        const target = quote(`./${mutation.candidate.path}`);
        rows.push({ id: "mutation/integrity", cwd: ".", timeoutMs: Math.min(remaining, 10000), argv: ["/bin/sh", "-c", `set -eu; test "$(sha256sum ${target} | cut -d ' ' -f 1)" = ${quote(hashBytes(mutation.altered))}; test "$(git -c core.quotePath=false diff --name-only --no-renames)" = ${quote(mutation.candidate.path)}; test -z "$(git ls-files --others -- . ${plan.environment.writable_directories.map(directory => quote(`:(exclude,literal)${directory}`)).join(" ")})"`] });
    }
    return rows;
}
/** Mechanical challenges of exact committed source, exclusively through the configured contained verifier. */
export async function falsifyContained(options: ContainedFalsifyOptions, services: {
    executeCommands?: (request: ContainedCommandRequest) => Promise<ContainedCommandResult>;
} = {}): Promise<{
    directory: string;
    record: ContainedFalsification;
    table: string;
}> {
    const max = options.maxAttempts ?? 24, wall = options.wallSeconds ?? 60;
    if (!Number.isSafeInteger(max) || max < 1 || max > 500 || !Number.isFinite(wall) || wall < 1 || wall > 3600)
        throw new Error("Contained falsification requires 1–500 attempts and 1–3600 seconds");
    options.signal?.throwIfAborted();
    const source = await realpath(options.bundleDir), output = resolve(options.outputDir ?? join(process.cwd(), ".wringer/falsifications"));
    if (output === source || output.startsWith(source + "/"))
        throw new Error("Falsification output must not change the sealed delivery bundle");
    await mkdir(output, { recursive: true, mode: 0o700 });
    if ((await lstat(output)).isSymbolicLink())
        throw new Error("Falsification output may not be a symlink");
    const actualOutput = await realpath(output);
    if (actualOutput === source || actualOutput.startsWith(source + "/"))
        throw new Error("Falsification output may not resolve inside its sealed delivery");
    const directory = await mkdtemp(join(output, "contained-")), carried = join(directory, "delivery");
    await mkdir(carried, { mode: 0o700 });
    // Freeze a complete portable copy before audit/execution; later source-file edits cannot replace its authority.
    for (const name of await files(source)) {
        const from = await inside(source, name), to = await inside(carried, name), stat = await lstat(from);
        if (stat.size > 64 * 1024 * 1024)
            throw new Error("Delivery input exceeds 64 MiB");
        await mkdir(resolve(to, ".."), { recursive: true, mode: 0o700 });
        await writeFile(to, await readFile(from), { flag: "wx", mode: 0o600 });
    }
    const audit = await auditContained(carried);
    if (audit.status !== "passed")
        throw new Error(`Contained delivery must audit before falsification: ${audit.claims.filter(c => c.status === "failed").map(c => c.reason).join("; ")}`);
    const manifest = JSON.parse(await readFile(join(carried, "manifest.json"), "utf8")), plan = validateExecutionPlan(JSON.parse(await readFile(join(carried, "plan.json"), "utf8"))), bundlePath = join(carried, "candidate.bundle"), redactor = new Redactor(["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*", ...(plan.runtime.env ?? [])]), scratch = await mkdtemp(join(tmpdir(), "wringer-contained-falsify-objects-")), store = join(scratch, "objects.git");
    await git(store, ["init", "--bare", ...(manifest.source.codeCommit.length === 64 ? ["--object-format=sha256"] : []), store], options.signal);
    await git(store, ["bundle", "verify", bundlePath], options.signal);
    await git(store, ["fetch", "--no-tags", bundlePath, `${manifest.source.codeCommit}:refs/heads/candidate`], options.signal);
    const diff = await git(store, ["diff", "--no-ext-diff", "--no-textconv", "--unified=0", manifest.source.baseCommit, manifest.source.codeCommit, "--"], options.signal), protectedFiles = [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])], protectedInput = (await readFile(join(carried, manifest.verification.evidenceRef, "observations.json"), "utf8")), inputSha = JSON.parse(protectedInput).checkInputsSha256;
    const candidates = mutationPlan(diff).filter(c => !protectedFiles.some(p => p === "." || c.path === p || c.path.startsWith(p + "/")) && plan.scope.writable.some(p => p === "." || c.path === p || c.path.startsWith(p + "/")) && !c.path.startsWith("/") && !c.path.split("/").some(p => p === ".." || p === ".git") && !/[\x00-\x1f\x7f]/.test(c.path));
    const record: ContainedFalsification = { schema_version: "wringer.contained-falsification.v1", id: randomUUID(), deliveryId: manifest.id, measuredAt: new Date().toISOString(), status: "inconclusive", reason: "No complete measurement was made.", anchor: { baseCommit: manifest.source.baseCommit, codeCommit: manifest.source.codeCommit, candidateTree: manifest.source.tree, committedRange: `${manifest.source.baseCommit}..${manifest.source.codeCommit}`, diffSha256: hashBytes(diff), candidateBundleSha256: hashBytes(await readFile(bundlePath)), deliveryManifestSha256: hashBytes(await readFile(join(carried, "manifest.json"))), acceptanceSha256: plan.acceptance_sha256 }, budget: { maxAttempts: max, wallSeconds: wall }, control: { status: "unavailable", receipt: null, reason: "Not attempted." }, attempts: [], counts: { supported: candidates.length, attempted: 0, caught: 0, survived: 0, unavailable: 0, unattempted: candidates.length }, limits };
    const save = async (name: string, value: unknown) => { const file = await inside(directory, name); await mkdir(resolve(file, ".."), { recursive: true, mode: 0o700 }); await writeFile(file, JSON.stringify(sanitize(value, redactor), null, 2) + "\n", { flag: "wx", mode: 0o600 }); };
    await save("anchor.json", record.anchor);
    const started = performance.now(), runtimeIds = new Set<string>(), execute = services.executeCommands ?? runContainedCommands, remaining = () => Math.max(0, wall * 1000 - (performance.now() - started));
    const measure = async (name: string, mutation?: {
        candidate: Mutation;
        original: string;
        altered: string;
    }) => {
        if (remaining() < 1 || options.signal?.aborted)
            throw new Error("Wall-clock ceiling or cancellation stopped measurement");
        const request: ContainedCommandRequest = { repo: { url: manifest.source.url, commit: manifest.source.codeCommit, bundlePath }, runtime: plan.runtime, acceptanceSource: { url: plan.repository.url, commit: plan.repository.commit, bundlePath }, protectedFiles, writableDirectories: plan.environment.writable_directories, commands: commands(plan, remaining(), mutation), timeoutMs: remaining(), signal: options.signal };
        const { signal: _signal, ...serializableRequest } = request;
        const requestSha256 = hashValue({ ...serializableRequest, repo: { url: request.repo.url, commit: request.repo.commit }, acceptanceSource: { url: request.acceptanceSource!.url, commit: request.acceptanceSource!.commit } });
        await save(`reservations/${name}.json`, { schema_version: "wringer.contained-falsify-reservation.v1", at: new Date().toISOString(), requestSha256, anchorSha256: hashValue(record.anchor), timeoutMs: request.timeoutMs, commandIds: request.commands.map(c => c.id) });
        const measured = await execute(request), p = measured.provenance;
        if (!Array.isArray(measured.results) || measured.results.some(r => typeof r.stdout !== "string" || typeof r.stderr !== "string" || Buffer.byteLength(r.stdout + r.stderr) > 1024 * 1024))
            throw new Error("A command observation exceeded the 1 MiB portable ceiling; no truncated result is claimed");
        const receipt = `receipts/${name}.json`;
        await save(receipt, { schema_version: "wringer.contained-falsify-observation.v1", requestSha256, measured: portable(measured, redactor) });
        if (p.role !== "verifier" || p.kind !== plan.runtime.kind || p.image !== plan.runtime.image || p.repository.commit !== manifest.source.codeCommit || !p.clonedInside || p.hostMounts.length || !p.runtimeId || runtimeIds.has(p.runtimeId) || measured.sourceTree !== manifest.source.tree || measured.checkInputsSha256 !== inputSha)
            throw new Error("Verifier source/input/runtime identity is unavailable or was reused");
        if (JSON.stringify(p.observed.writableDirectories ?? []) !== JSON.stringify(plan.environment.writable_directories))
            throw new Error("Verifier writable-output policy changed");
        runtimeIds.add(p.runtimeId);
        if (JSON.stringify(measured.results.map(r => r.id)) !== JSON.stringify(request.commands.map(r => r.id)) || measured.results.some(r => !Number.isInteger(r.code) || r.code < 0 || r.code > 255))
            throw new Error("Verifier omitted or reordered a declared command or returned an invalid exit code");
        const infrastructure = measured.results.find(r => timedOut(r.code) || (r.id.startsWith("setup/") || r.id.startsWith("mutation/")) && r.code !== 0);
        if (infrastructure)
            throw new Error(`Infrastructure or mutation integrity failed at ${infrastructure.id} (exit ${infrastructure.code}); no caught mutant is claimed`);
        if (mutation ? !measured.sourceChanged : measured.sourceChanged)
            throw new Error(mutation ? "Mutation was not observed in the candidate clone" : "The unmutated control changed repository source");
        return { receipt, caught: measured.results.filter(r => (r.id.startsWith("acceptance/") || r.id.startsWith("baseline/")) && r.code !== 0).map(r => r.id) };
    };
    if (!candidates.length) {
        record.status = "not-applicable";
        record.reason = "The committed range contains no supported changed source lines; no runtime was allocated.";
    }
    else {
        try {
            const control = await measure("control");
            record.control = { status: control.caught.length ? "unavailable" : "passed", receipt: control.receipt, reason: control.caught.length ? `Unmutated committed control failed: ${control.caught.join(", ")}` : "The exact unmutated committed candidate passed its original checks." };
        }
        catch (error) {
            record.control = { status: "unavailable", receipt: null, reason: redactor.scrub(String(error)) };
            await save("control-failure.json", record.control);
        }
        if (record.control.status !== "passed")
            record.reason = `Control unavailable. ${record.control.reason}`;
        else {
            for (const candidate of candidates.slice(0, max)) {
                if (remaining() < 1 || options.signal?.aborted)
                    break;
                const index = record.attempts.length, row: ContainedFalsification["attempts"][number] = { path: candidate.path, line: candidate.line, mutation: candidate.mutation, beforeSha256: null, afterSha256: null, status: "unavailable", caughtBy: [], receipt: null, reason: "" };
                try {
                    const entry = await git(store, ["--literal-pathspecs", "ls-tree", manifest.source.codeCommit, "--", candidate.path], options.signal);
                    if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(entry))
                        throw new Error("Mutation target is not a regular committed blob");
                    const blob = / blob ([a-f0-9]+)\t/.exec(entry)![1]!;
                    if (Number((await git(store, ["cat-file", "-s", blob], options.signal)).trim()) > 32768)
                        throw new Error("Mutation target exceeds the bounded 32 KiB lexical rewrite limit");
                    const original = await git(store, ["cat-file", "blob", blob], options.signal), lines = original.split("\n");
                    if (original.includes("\0") || lines[candidate.line - 1] !== candidate.was)
                        throw new Error("Mutation does not match the exact committed text line");
                    lines[candidate.line - 1] = candidate.became;
                    const altered = lines.join("\n");
                    row.beforeSha256 = hashBytes(original);
                    row.afterSha256 = hashBytes(altered);
                    const result = await measure(`attempt-${index}`, { candidate, original, altered });
                    row.receipt = result.receipt;
                    row.caughtBy = result.caught;
                    row.status = result.caught.length ? "caught" : "survived";
                    row.reason = result.caught.length ? "Original pinned checks rejected the source mutation." : "The source mutation remained in place and every pinned check passed.";
                }
                catch (error) {
                    row.reason = redactor.scrub(String(error));
                    await save(`failures/attempt-${index}.json`, row);
                }
                record.attempts.push(row);
            }
            const completed = record.attempts.filter(a => a.status !== "unavailable");
            record.status = completed.length ? "measured" : "inconclusive";
            record.reason = completed.length ? `${completed.length} committed source mutations measured; ${record.attempts.filter(a => a.status === "survived").length} survived. ${candidates.length - record.attempts.length} were not attempted and ${record.attempts.length - completed.length} were unavailable.` : "No mutant completed; runtime, setup, mutation integrity, cancellation or the declared ceiling prevented measurement.";
        }
    }
    record.counts = { supported: candidates.length, attempted: record.attempts.length, caught: record.attempts.filter(a => a.status === "caught").length, survived: record.attempts.filter(a => a.status === "survived").length, unavailable: record.attempts.filter(a => a.status === "unavailable").length, unattempted: candidates.length - record.attempts.length };
    await save("record.json", record);
    const table = renderContainedFalsification(record);
    await writeFile(join(directory, "table.md"), table + "\n", { flag: "wx", mode: 0o600 });
    await seal(directory);
    return { directory, record, table };
}
export function renderContainedFalsification(record: ContainedFalsification): string {
    const cell = (value: unknown) => String(value).replaceAll("|", "\\|").replace(/[\r\n]+/g, " ");
    return [`Falsification: ${record.status}`, `Delivery: ${record.deliveryId}`, `Committed range: ${record.anchor.committedRange}`, `Measured at commit: ${record.anchor.codeCommit}`, `Reason: ${record.reason}`, "", "| Source line | Mutation | Result | Caught by / reason |", "| --- | --- | --- | --- |", ...record.attempts.map(a => `| ${cell(a.path)}:${a.line} | ${cell(a.mutation)} | ${a.status} | ${cell(a.caughtBy.join(", ") || a.reason)} |`), "", `Caught: ${record.counts.caught}; survived: ${record.counts.survived}; unavailable: ${record.counts.unavailable}; unattempted: ${record.counts.unattempted}.`, ...record.limits].join("\n");
}
