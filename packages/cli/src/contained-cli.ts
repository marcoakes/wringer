import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadExecutionPlan, canonicalPlanJson, validateExecutionPlan, discoverEnvironment, createExecutionAuthority, validateExecutionAuthority, hashValue, type ExecutionPlan, type EnvironmentMap } from "@wringer/plan";
import { runContainedJourney, readValidatedContainedState, recordContainedHumanJudgement, type CandidateHumanJudgement } from "@wringer/workflow";
import { deliverContained, auditContained, falsifyContained } from "@wringer/delivery";
import type { PreparedRepositorySource } from "@wringer/runtime";
import { Redactor, EngineError } from "@wringer/engine";
import { containedServices, prepareContainedSource, showContainedCandidate } from "./contained-services";
import { allowed, flag, number, positionals, required, string, quote, type Args } from "./args";
import { DRIVE_HELP } from "./help";
import type { Answer, DispatchContext } from "./app";
async function read(path: string) {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
        throw new Error("Controller input must be a bounded regular JSON file, not a symlink");
    return JSON.parse(await readFile(path, "utf8"));
}
async function privateDirectory(path: string) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Controller state must be a real directory, not a symlink");
}
async function immutable(path: string, value: unknown) {
    const bytes = JSON.stringify(value, null, 2) + "\n";
    try {
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    }
    catch (error: any) {
        if (error.code !== "EEXIST")
            throw error;
        await read(path);
        if (await readFile(path, "utf8") !== bytes)
            throw error;
    }
}
const statePath = (repo: string, a: Args) => resolve(repo, required(a, "state"));
const nextResume = (state: string) => `wringer-drive resume --state ${quote(state)}`;
async function savedPlan(state: string): Promise<ExecutionPlan> { return validateExecutionPlan(await read(join(state, "plan.json"))); }
async function validatedState(state: string, currentAuthority = false) {
    const history = await readValidatedContainedState(state);
    if (hashValue(await savedPlan(state)) !== hashValue(history.plan) || hashValue(await read(join(state, "authority.json"))) !== hashValue(history.authority))
        throw new Error("Saved outer plan or authority differs from the immutable journey approval");
    if (currentAuthority)
        validateExecutionAuthority(history.authority, history.plan);
    return history;
}
export async function containedDrive(a: Args, repo: string, context: DispatchContext): Promise<Answer> {
    if (flag(a, "help") || !a.command)
        return { text: DRIVE_HELP };
    context.signal?.throwIfAborted();
    if (a.command === "plan") {
        positionals(a, 1);
        allowed(a, []);
        const plan = await loadExecutionPlan(resolve(repo, a.words[0]!));
        return { value: plan, text: `${canonicalPlanJson(plan)}\nPlan validated; no agent or repository command ran.\nNext: wringer-drive authority ${quote(resolve(repo, a.words[0]!))} --actor 'YOUR NAME' --expires 'EXPIRY IN ISO-8601' --output authority.json` };
    }
    if (a.command === "authority") {
        positionals(a, 1);
        allowed(a, ["actor", "expires", "output"]);
        const plan = await loadExecutionPlan(resolve(repo, a.words[0]!));
        const authority = createExecutionAuthority(plan, { actor: required(a, "actor"), expiresAt: required(a, "expires"), actions: ["plan", "build", "verify", "judge"] });
        const output = resolve(repo, required(a, "output"));
        await writeFile(output, JSON.stringify(authority, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        return { value: { path: output, authority }, text: `Bounded authority saved: ${output}\nPlan: ${plan.plan_sha256}\nNo human verdict, publication or sandbox bypass was granted.\nNext: wringer-drive run ${quote(resolve(repo, a.words[0]!))} --authority ${quote(output)}` };
    }
    if (a.command === "status") {
        positionals(a, 0);
        allowed(a, ["state"]);
        const state = statePath(repo, a), { result: value } = await validatedState(state);
        return { value, text: `${value.status}. The recorded view agrees with the validated authoritative journal.\n${value.stop?.message ?? ""}\nNext: ${nextResume(state)}`, exit: value.status === "review-ready" ? 0 : 3 };
    }
    if (a.command === "audit") {
        positionals(a, 0);
        allowed(a, ["bundle"]);
        const value = await auditContained(resolve(repo, required(a, "bundle")));
        return { value, text: `Contained delivery audit ${value.status}: ${value.deliveryId ?? "unreadable delivery"}\n${value.claims.map(row => `${row.status}: ${row.id} — ${row.reason}`).join("\n")}\n${value.limits.join("\n")}`, exit: value.status === "passed" ? 0 : 3 };
    }
    if (a.command === "falsify") {
        positionals(a, 0);
        allowed(a, ["bundle", "output", "max-attempts", "wall-seconds"]);
        const value = await falsifyContained({ bundleDir: resolve(repo, required(a, "bundle")), outputDir: resolve(repo, string(a, "output", ".wringer/falsifications")!), maxAttempts: number(a, "max-attempts", 24), wallSeconds: number(a, "wall-seconds", 60), signal: context.signal });
        const incomplete = value.record.status === "inconclusive" || value.record.counts.survived > 0 || value.record.counts.unavailable > 0 || value.record.counts.unattempted > 0;
        return { value, text: `${value.table}\n\nRecords: ${value.directory}`, exit: context.signal?.aborted ? 4 : incomplete ? 3 : 0 };
    }
    if (a.command === "deliver") {
        positionals(a, 0);
        allowed(a, ["state", "remote", "source-branch", "target-branch", "forge-config", "send"]);
        const state = statePath(repo, a);
        await validatedState(state);
        const publication = { remote: required(a, "remote"), sourceBranch: required(a, "source-branch"), targetBranch: required(a, "target-branch"), ...(a.flags.has("forge-config") ? { forge: await read(resolve(repo, required(a, "forge-config"))) } : {}) };
        const resumeCommand = `wringer-drive deliver --state ${quote(state)} --remote ${quote(publication.remote)} --source-branch ${quote(publication.sourceBranch)} --target-branch ${quote(publication.targetBranch)}${a.flags.has("forge-config") ? ` --forge-config ${quote(resolve(repo, required(a, "forge-config")))}` : ""} --send`;
        const value = await deliverContained({ stateDir: state, publication, send: flag(a, "send"), signal: context.signal, resumeCommand });
        const forgeBlocked = value.forge && ["blocked", "uncertain"].includes(value.forge.status);
        const next = forgeBlocked ? value.forge!.next_move : value.pushed ? `From the root of a fresh clone of ${quote(value.sourceBranch)}, run ${value.auditCommand}` : resumeCommand;
        return { value, text: `${value.status}: ${value.deliveryId}\nCandidate: ${value.codeCommit}\nEvidence commit: ${value.evidenceCommit}\nBundle: ${value.bundleDir}\n${value.pushed ? "The exact evidence branch was pushed." : "Nothing was pushed. Publication needs the separate --send decision."}${value.forge ? `\nReview request: ${value.forge.status}${value.forge.url ? ` — ${value.forge.url}` : ""}${value.forge.reason ? ` — ${value.forge.reason}` : ""}` : ""}\nFalsification: ${value.falsify.reason}\nAfter publication, from the fresh review-branch clone root: ${value.falsify.command}\nNext: ${next}`, exit: forgeBlocked ? 3 : 0 };
    }
    if (["show", "review"].includes(a.command))
        return human(a, repo, context);
    if (!["run", "resume"].includes(a.command))
        throw new Error(`Unknown drive command ${a.command}. See wringer-drive --help.`);
    positionals(a, a.command === "run" ? 1 : 0);
    allowed(a, ["authority", "state", "retry-uncertain", "retry-stopped"]);
    const plan = a.command === "run" ? await loadExecutionPlan(resolve(repo, a.words[0]!)) : await savedPlan(statePath(repo, a));
    const state = resolve(repo, string(a, "state", `.wringer/control/${plan.plan_sha256.slice(0, 20)}`)!);
    const authority = validateExecutionAuthority(await read(a.flags.has("authority") ? resolve(repo, required(a, "authority")) : join(state, "authority.json")), plan);
    await privateDirectory(state);
    await immutable(join(state, "plan.json"), plan);
    await immutable(join(state, "authority.json"), authority);
    let prepared: PreparedRepositorySource, environment: EnvironmentMap;
    const preparedPath = join(state, "prepared-source.json"), environmentPath = join(state, "environment.json");
    if (await Bun.file(preparedPath).exists()) {
        prepared = await read(preparedPath);
        if (prepared.url !== plan.repository.url || prepared.commit !== plan.repository.commit)
            throw new Error("Prepared source record differs from the authorized repository revision");
    }
    else {
        prepared = await prepareContainedSource(plan, state);
        await immutable(preparedPath, prepared);
    }
    if (await Bun.file(environmentPath).exists())
        environment = await read(environmentPath);
    else {
        environment = await discoverEnvironment(prepared.objectStore, plan);
        await immutable(environmentPath, environment);
    }
    // This compatibility file is an inspectable cache, never approval authority.
    // A stale met cache must not override a newer journaled human withdrawal.
    if (await Bun.file(join(state, "human-judgements.json")).exists())
        await validatedHumanJudgements(state, plan);
    const value = await runContainedJourney({ controllerDir: state, plan, authority, environment, services: containedServices(state, prepared), retryUncertain: flag(a, "retry-uncertain"), retryStopped: flag(a, "retry-stopped"), signal: context.signal, onEvent: !flag(a, "json") ? row => { process.stderr.write(JSON.stringify(new Redactor().deep(row)) + "\n"); } : undefined });
    const next = value.stop?.next_move ?? `Review the candidate and evidence in ${quote(value.recordDir)}; publication remains a separate action.`;
    return { value, text: `${value.status}: ${plan.name}\n${value.stop?.message ?? "Required checks and reviews completed for the recorded candidate."}\nCandidate: ${value.candidate?.source.commit ?? "none recorded"}\nRecords: ${value.recordDir}\nSessions: ${value.sessions}; token usage: ${JSON.stringify(value.tokens)}\nNext: ${next}`, exit: context.signal?.aborted ? 4 : value.status === "review-ready" ? 0 : 3 };
}
async function validatedHumanJudgements(state: string, plan: ExecutionPlan): Promise<CandidateHumanJudgement[]> {
    const rows = await read(join(state, "human-judgements.json"));
    if (!Array.isArray(rows))
        throw new Error("Human judgement file is malformed");
    for (const row of rows) {
        if (!row || !/^[a-f0-9-]{36}$/.test(row.displayId))
            throw new Error("Human judgement has an invalid display receipt id");
        const receipt = await read(join(state, "displays", `${row.displayId}.json`));
        const { sha256, ...body } = receipt;
        if (!/^[a-f0-9-]{36}$/.test(row.displayId) || sha256 !== hashValue(body) || !receipt.success || receipt.criterionId !== row.criterionId || receipt.candidateTree !== row.candidateTree || receipt.acceptanceSha256 !== plan.acceptance_sha256 || row.display?.receiptSha256 !== sha256)
            throw new Error("Human judgement is not backed by an intact successful candidate display");
        assertDisplay(receipt, plan, row.criterionId, row.candidateTree);
    }
    return rows;
}
function assertDisplay(receipt: any, plan: ExecutionPlan, criterionId: string, candidateTree: string, candidateCommit?: string) {
    const criterion = plan.acceptance.criteria.find(c => c.id === criterionId), measured = receipt.measured, p = measured?.provenance;
    const expected = [...plan.environment.setup.map(c => `setup/${c.id}`), criterion?.show?.id];
    if (!criterion || criterion.kind !== "human" || !criterion.show || receipt.schema_version !== "wringer.contained-display.v1" || !measured || measured.sourceChanged !== false || measured.sourceTree !== candidateTree || !Array.isArray(measured.results) || hashValue(measured.results.map((r: any) => r.id)) !== hashValue(expected) || measured.results.some((r: any) => r.code !== 0) || !p || p.role !== "verifier" || p.kind !== plan.runtime.kind || p.image !== plan.runtime.image || p.repository?.url !== plan.repository.url || candidateCommit && p.repository?.commit !== candidateCommit || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length || hashValue(p.observed?.writableDirectories ?? []) !== hashValue(plan.environment.writable_directories))
        throw new Error("Display does not establish the declared setup and human criterion in its contained candidate; no judgement recorded");
}
async function human(a: Args, repo: string, context: DispatchContext): Promise<Answer> {
    positionals(a, 0);
    allowed(a, ["state", "criterion", ...(a.command === "review" ? ["display", "verdict", "by", "note"] : [])]);
    const state = statePath(repo, a), { plan, result: latest } = await validatedState(state, true), criterionId = required(a, "criterion");
    if (!plan.acceptance.criteria.some(c => c.id === criterionId && c.kind === "human"))
        throw new Error("Name a declared human acceptance criterion");
    if (!latest.candidate || !latest.verification || latest.verification.status !== "passed" || latest.verification.candidateTree !== latest.candidate.tree)
        throw new Error("There is no verified candidate to show or judge");
    if (a.command === "show") {
        const { measured, success } = await showContainedCandidate(plan, latest.candidate.source, criterionId, context.signal);
        if (measured.sourceTree !== latest.candidate.tree)
            throw new Error("Display runtime measured a different candidate tree");
        const id = crypto.randomUUID(), body = { schema_version: "wringer.contained-display.v1", id, criterionId, candidateTree: latest.candidate.tree, acceptanceSha256: plan.acceptance_sha256, at: new Date().toISOString(), success, measured };
        const value = { ...body, sha256: hashValue(body) };
        await privateDirectory(join(state, "displays"));
        await immutable(join(state, "displays", `${id}.json`), value);
        const output = measured.results.map(r => r.stdout + r.stderr).join("\n");
        const next = success ? `wringer-drive review --state ${quote(state)} --criterion ${quote(criterionId)} --display ${id} --verdict met --by 'YOUR NAME' --note 'YOUR OWN OBSERVATION'` : `wringer-drive show --state ${quote(state)} --criterion ${quote(criterionId)}`;
        return { value, text: `${output}\nDisplay ${success ? "completed" : "failed"}; no judgement was recorded.\nNext: ${next}`, exit: success ? 0 : 3 };
    }
    const id = required(a, "display");
    if (!/^[a-f0-9-]{36}$/.test(id))
        throw new Error("Invalid display receipt id");
    const receipt = await read(join(state, "displays", `${id}.json`)), { sha256, ...body } = receipt;
    if (sha256 !== hashValue(body) || !receipt.success || receipt.candidateTree !== latest.candidate.tree || receipt.acceptanceSha256 !== plan.acceptance_sha256 || receipt.criterionId !== criterionId)
        throw new Error("Display failed, changed or describes another candidate; no judgement recorded");
    assertDisplay(receipt, plan, criterionId, latest.candidate.tree, latest.candidate.source.commit);
    const verdict = required(a, "verdict");
    if (!["met", "not_met"].includes(verdict))
        throw new Error("Verdict must be met or not_met");
    const row = new Redactor(plan.runtime.env).deep({ criterionId, candidateTree: latest.candidate.tree, acceptanceSha256: plan.acceptance_sha256, verdict: verdict as "met" | "not_met", by: required(a, "by"), note: required(a, "note"), displayId: id, display: { candidateTree: latest.candidate.tree, status: "shown" as const, receiptSha256: sha256 } });
    const recorded = await recordContainedHumanJudgement(state, row);
    return { value: recorded.judgement, text: `Judgement recorded in ${recorded.judgement.by}'s words: ${recorded.judgement.note}\nHuman hold: previous readiness is withdrawn until all current observations are evaluated.\nNext: ${nextResume(state)}` };
}
