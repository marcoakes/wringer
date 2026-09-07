import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { AuthorityAction, DriveOptions, DriveResult, NativePlan, OperatorAuthority, ServiceResult } from "../../src/types";
import { loadAuthority } from "../../src/authority";
import { draftSpec } from "./draft";
import { answerQuestion, approveSpec, compilePlan, decideAssumption, loadNativePlan, planDigest, renderPlan } from "../../src/plan";
import { atomicWrite, digest, locked, now, readJson, readText, scrubValue, SOURCE_PATH, stop, WORKFLOW_DIR, WorkflowError, writeJson } from "../../src/storage";
import { chargedWorkerTurns, loadWorkerBudget, reserveWorkerTurns, settleWorkerTurns } from "../../src/worker-budget";
interface Journey {
    schema_version: "wringer.workflow-journey.v1";
    id: string;
    repo: string;
    source_path: string;
    started_at: string;
    updated_at: string;
    authority_path?: string;
    authority_sha256?: string;
    plan_digest?: string;
    gates_installed_digest?: string;
    build?: {
        status: "running" | "finished";
        plan_digest: string;
        result?: ServiceResult;
    };
    events: number;
    last_event_hash: string | null;
}
interface StoredSettings {
    schema_version: "wringer.workflow-settings.v1";
    endpoint: string;
    model: string;
    apiKeyEnv?: string;
    maxCalls?: number;
    maxRepairAttempts?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
    context?: string;
}
export async function runDrive(options: DriveOptions): Promise<DriveResult> {
    let journeyId = "not-started";
    try {
        return await locked(options.repo, "drive", async () => {
            const repo = resolve(options.repo);
            const checkAbort = async () => {
                if (options.signal?.aborted)
                    return stop(repo, "interrupted", "The workflow was interrupted. Completed work remains recorded; resume does not repeat recorded spend.", "wringer-drive resume");
            };
            await checkAbort();
            const statePath = `${WORKFLOW_DIR}/journey.json`;
            const previous = await readJson<Journey>(repo, statePath);
            if (previous && (previous.schema_version !== "wringer.workflow-journey.v1" || previous.repo !== repo || !previous.id || !Number.isSafeInteger(previous.events)))
                return stop(repo, "journey-unreadable", "The saved journey is malformed or belongs to another repository.", "wring explain");
            const journey: Journey = previous ?? { schema_version: "wringer.workflow-journey.v1", id: `${now().replace(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`, repo, source_path: options.prdPath ?? SOURCE_PATH, started_at: now(), updated_at: now(), events: 0, last_event_hash: null };
            journeyId = journey.id;
            const workerBudget = await loadWorkerBudget(repo, journey.id, !!previous?.build);
            if (options.prdPath)
                journey.source_path = options.prdPath;
            if (options.authorityPath)
                journey.authority_path = options.authorityPath;
            const save = async () => { journey.updated_at = now(); await writeJson(repo, statePath, journey); await writeJson(repo, `${WORKFLOW_DIR}/journeys/${journey.id}/journey.json`, journey); };
            const emit = async (event: Record<string, unknown>) => {
                const record = scrubValue({ ...event, at: now(), sequence: journey.events + 1, previous_sha256: journey.last_event_hash });
                const path = `${WORKFLOW_DIR}/journeys/${journey.id}/events.jsonl`;
                const history = await readText(repo, path) ?? "";
                const line = JSON.stringify(record);
                await atomicWrite(repo, path, history + line + "\n");
                journey.events++;
                journey.last_event_hash = digest(line);
                await save();
                await options.onEvent?.(record);
            };
            await save();
            let authority: OperatorAuthority | undefined;
            if (journey.authority_path)
                authority = await loadAuthority(repo, journey.authority_path);
            if (options.headless && !authority)
                return stop(repo, "headless-authority-missing", "Headless work needs one repository-scoped operator authority with explicit spending ceilings. It is reusable across resumes.", "wringer-drive authority --help");
            if (authority) {
                journey.authority_sha256 = digest(authority);
                await emit({ type: "operator-authority", actor: authority.actor, actions: authority.actions, budget: authority.budget, authority_sha256: journey.authority_sha256 });
            }
            const requireAction = async (action: AuthorityAction, next: string) => {
                if (!authority?.actions.includes(action))
                    return stop(repo, "operator-action-required", `The current authority does not authorize ${action}.`, next);
            };
            if (options.services.preflight) {
                const readiness = await options.services.preflight(repo);
                await checkAbort();
                await emit({ type: "readiness", ...readiness });
                if (["rejected", "unavailable", "displaced", "failed", "error"].includes(readiness.status))
                    return stop(repo, "preflight-refused", readiness.message ?? "The worker preflight refused before drafting or building was spent.", readiness.nextMove ?? "wring doctor", readiness);
            }
            const settingsPath = `${WORKFLOW_DIR}/settings.json`;
            const stored = await readJson<StoredSettings>(repo, settingsPath);
            if (stored && stored.schema_version !== "wringer.workflow-settings.v1")
                return stop(repo, "settings-unreadable", "Saved drafting settings use an unsupported schema.", "wring explain");
            const draft = options.draft ?? (stored ? { ...stored, send: true } : undefined);
            if (options.draft) {
                const { endpoint, model, apiKeyEnv, maxCalls, maxRepairAttempts, maxOutputTokens, timeoutMs, context } = options.draft;
                await writeJson(repo, settingsPath, { schema_version: "wringer.workflow-settings.v1", endpoint, model, apiKeyEnv, maxCalls, maxRepairAttempts, maxOutputTokens, timeoutMs, context });
            }
            let plan = await loadNativePlan(repo, false);
            const doDraft = async () => {
                await requireAction("draft", "wringer-drive authority --help");
                if (!draft)
                    return stop(repo, "draft-settings-missing", "Declare a drafting endpoint and model before the first paid call. Wringer chooses no vendor.", "wringer-drive run --help");
                const result = await draftSpec({ ...draft, repo, prdPath: journey.source_path, send: true, maxCalls: Math.min(draft.maxCalls ?? Infinity, authority!.budget.max_draft_calls), maxRepairAttempts: Math.min(draft.maxRepairAttempts ?? Infinity, authority!.budget.max_repair_attempts), onEvent: emit, signal: options.signal });
                await checkAbort();
                if (!result.plan)
                    return stop(repo, "draft-did-not-produce-plan", "Drafting produced no plan.", "wring explain");
                journey.source_path = SOURCE_PATH;
                await save();
                await emit({ type: "draft-finished", calls: result.calls, reused: result.reused, total_calls: result.totalCalls, tokens: result.tokens });
                return result.plan;
            };
            if (!plan || options.prdPath)
                plan = await doDraft();
            let refresh = false;
            for (const question of plan.questions) {
                const explicitAnswer = options.answers?.[question.id];
                if (explicitAnswer !== undefined && explicitAnswer !== question.answer) {
                    await answerQuestion(repo, question.id, explicitAnswer, authority?.actor ?? "operator");
                    refresh = true;
                    continue;
                }
                if (question.answer?.trim() || !question.required)
                    continue;
                if (!question.human && question.suggested_answer && authority?.actions.includes("resolve-questions")) {
                    await answerQuestion(repo, question.id, question.suggested_answer, `${authority.actor} (delegated routine decision)`);
                    refresh = true;
                    await emit({ type: "question-resolved", id: question.id, answer: question.suggested_answer, actor: authority.actor });
                }
                else
                    return stop(repo, "question-unanswered", question.question, `wringer-board answer --id ${JSON.stringify(question.id)} --text 'YOUR ANSWER'`, { question });
            }
            plan = (await loadNativePlan(repo))!;
            for (const assumption of plan.assumptions.filter(a => a.status === "pending")) {
                await requireAction("accept-assumptions", `wringer-board decide --id ${JSON.stringify(assumption.id)} --accept`);
                await decideAssumption(repo, assumption.id, "accept", "Accepted under the recorded routine operating authority.", authority!.actor);
                await emit({ type: "assumption-accepted", id: assumption.id, statement: assumption.statement, actor: authority!.actor });
            }
            const revision = await readJson<{
                status: string;
            }>(repo, `${WORKFLOW_DIR}/revision-needed.json`);
            if (refresh || revision?.status === "required")
                plan = await doDraft();
            else
                plan = (await loadNativePlan(repo))!;
            // A regenerated section is re-interviewed by the next invocation rather than
            // having new questions accidentally bypass the approval interlock.
            const unresolved = plan.questions.find(q => q.required && !q.answer?.trim());
            if (unresolved)
                return stop(repo, "question-unanswered", unresolved.question, `wringer-board answer --id ${JSON.stringify(unresolved.id)} --text 'YOUR ANSWER'`);
            const newAssumption = plan.assumptions.find(a => a.status === "pending");
            if (newAssumption)
                return stop(repo, "assumption-unanswered", newAssumption.statement, `wringer-board decide --id ${JSON.stringify(newAssumption.id)} --accept`);
            await emit({ type: "plan", digest: planDigest(plan), content: renderPlan(plan) });
            await requireAction("approve-plan", `wringer-board approve --digest ${planDigest(plan)}`);
            await approveSpec(repo, { actor: authority!.actor, authority, expectedDigest: planDigest(plan) });
            const compiled = await compilePlan(repo);
            await checkAbort();
            if (journey.plan_digest !== compiled.digest) {
                journey.plan_digest = compiled.digest;
                journey.build = undefined;
                await save();
            }
            if (journey.gates_installed_digest !== compiled.digest) {
                await requireAction("install-gates", "wringer-drive authority --help");
                await emit({ type: "gate-proposal", gates: compiled.gates, show: compiled.show, authorized_by: authority!.actor });
                await options.services.installGates(repo, compiled);
                journey.gates_installed_digest = compiled.digest;
                await save();
                await checkAbort();
                await emit({ type: "gates-installed", digest: compiled.digest });
            }
            if (journey.build?.status === "running")
                return stop(repo, "worker-spend-uncertain", "A worker was started but its result was not recorded. Inspect the engine's loop evidence before authorizing another paid turn.", "wring explain");
            if (!journey.build || journey.build.result?.status === "retryable") {
                await requireAction("build", "wringer-drive authority --help");
                const reservation = await reserveWorkerTurns(repo, workerBudget, authority!.budget.max_worker_turns, compiled.digest, journey.authority_sha256!);
                journey.build = { status: "running", plan_digest: compiled.digest };
                await save();
                await emit({ type: "build-started", maximum_worker_turns: reservation.reserved, journey_worker_ceiling: authority!.budget.max_worker_turns, reservation_id: reservation.id, previously_charged_worker_turns: chargedWorkerTurns(workerBudget) - reservation.charged });
                const result = await options.services.build(repo, compiled, reservation.reserved);
                await settleWorkerTurns(repo, workerBudget, reservation, result);
                journey.build = { status: "finished", plan_digest: compiled.digest, result };
                await save();
                await checkAbort();
                await emit({ type: "build-finished", ...result, worker_turns: reservation.actual, charged_worker_turns: reservation.charged, journey_charged_worker_turns: chargedWorkerTurns(workerBudget), reservation_id: reservation.id });
            }
            else
                await emit({ type: "build-reused", result: journey.build.result, paid_calls: 0 });
            const build = journey.build!.result!;
            if (!["passed", "succeeded", "green", "completed"].includes(build.status))
                return stop(repo, build.reason ?? "build-stopped", build.message ?? "The builder did not report a successful completed loop.", build.nextMove ?? "wring explain", build);
            const result = await options.services.verify(repo);
            await checkAbort();
            await emit({ type: "verification", ...result });
            let boardPath: string | undefined;
            if (options.services.renderBoard) {
                boardPath = await options.services.renderBoard(repo, result);
                await emit({ type: "board-written", path: boardPath });
            }
            if (result.humanPending?.length)
                return stop(repo, "human-judgement", "The build reached the human judgement hold. Routine operator authority cannot write a person's verdict.", `wringer-board judge --id ${JSON.stringify(result.humanPending[0])}`, result);
            if (result.unproved?.length)
                return stop(repo, "requirements-unproved", `${result.unproved.length} required obligations remain unproved. Passing unrelated checks does not authorize delivery.`, "wring verify --prove", result);
            if (!["passed", "succeeded", "green", "completed"].includes(result.status))
                return stop(repo, result.reason ?? "verification-stopped", result.message ?? "Verification did not pass.", result.nextMove ?? "wring verify", result);
            await emit({ type: "ready", message: "Build and verification completed. Delivery remains a separate explicit action against these results.", next_move: `wring deliver --send` });
            return { status: "ready", journeyId: journey.id, result, ...(boardPath ? { boardPath } : {}) };
        });
    }
    catch (error) {
        if (error instanceof WorkflowError)
            return { status: "stopped", journeyId, stop: error.stop };
        try {
            await stop(options.repo, "workflow-error", (error as Error).message, "wring explain");
        }
        catch (stopped) {
            if (stopped instanceof WorkflowError)
                return { status: "stopped", journeyId, stop: stopped.stop };
            throw stopped;
        }
        throw error;
    }
}
export const resumeDrive = runDrive;
