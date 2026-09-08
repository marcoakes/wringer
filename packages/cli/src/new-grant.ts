import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createExecutionAuthority, hashValue } from "@wringer/plan";
import { readController } from "@wringer/application";
import { queryContainedJourney } from "@wringer/workflow";
import { allowed, flag, positionals, quote, required, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";

const needsNewContract = new Set(["acceptance-born-green", "intent-needs-decision", "human-display-missing"]);
const inside = (parent: string, child: string) => {
    const path = relative(parent, child);
    return path === "" || !isAbsolute(path) && path !== ".." && !path.startsWith("../");
};

/** A preview is deliberately read-only, including when the old authority expired. */
export async function newGrantCommand(a: Args, repo: string, context: DispatchContext = {}): Promise<Answer> {
    positionals(a, 0);
    allowed(a, ["state", "confirm-new-grant", "actor", "expires", "output"]);
    context.signal?.throwIfAborted();
    const stateDir = resolve(repo, required(a, "state")), confirm = flag(a, "confirm-new-grant");
    if (!confirm && ["actor", "expires", "output"].some(key => a.flags.has(key)))
        throw new Error("Preview takes only --state. Creating a new grant requires --confirm-new-grant together with --actor, --expires and --output.");
    const history = await readController(stateDir, false, true), query = await queryContainedJourney(stateDir);
    if (query.revision !== history.events.at(-1)?.sha256)
        throw new Error("The old journey changed during inspection. Run the new-grant preview again; no grant was created.");
    const authorityExpired = Date.now() >= Date.parse(history.authority.expires_at);
    const active = query.status === "running";
    const stoppedOrExhausted = history.result.status === "stopped" || authorityExpired || query.budget.wallClock.expired;
    // The most recent stop can be a harmless mistyped retry. It must not erase
    // an unresolved contract defect established by the immutable plan/history.
    const contractBlockers: { code: string; reason: string }[] = [];
    const bornGreen = history.state.baseline?.checks.filter(check => check.status === "passed") ?? [];
    if (bornGreen.length) contractBlockers.push({ code: "acceptance-born-green", reason: `Baseline evidence already passes these acceptance checks: ${bornGreen.map(check => check.id).join(", ")}. Strengthen the original contract; a fresh budget cannot create red-first evidence.` });
    if (history.state.stage === "planner" && !history.state.plannerComplete && history.events.some(event => event.type === "planner-decisions-requested"))
        contractBlockers.push({ code: "intent-needs-decision", reason: "The immutable planner-decisions-requested record still has unresolved intent at the planning step. Resolve its questions or omissions in a revised contract." });
    const missingDisplays = history.plan.acceptance.criteria.filter(criterion => criterion.required && criterion.kind === "human" && !criterion.show);
    if (missingDisplays.length) contractBlockers.push({ code: "human-display-missing", reason: `Required human requirements lack an approved display command: ${missingDisplays.map(criterion => criterion.id).join(", ")}. Add the show command to a revised contract; recording without a display is not available.` });
    const recordedReason = history.result.stop?.reason;
    if (recordedReason && needsNewContract.has(recordedReason) && !contractBlockers.some(blocker => blocker.code === recordedReason))
        contractBlockers.push({ code: recordedReason, reason: "The recorded stop requires a revised contract, not additional attempts against unchanged approval." });
    const contractRequired = contractBlockers.length > 0;
    const old = {
        stateDir, journeyId: history.state.id, revision: query.revision,
        status: history.result.status, stop: history.result.stop,
        planSha256: history.plan.plan_sha256, authoritySha256: hashValue(history.authority),
        grantedAt: history.authority.granted_at, expiresAt: history.authority.expires_at, authorityExpired,
        limits: history.authority.budget, usage: query.budget,
        cost: { status: "unknown", amount: null, currency: null },
        candidate: history.result.candidate,
    };
    // A new execution grant never silently increases a narrower old approval to
    // the plan ceiling, or carries publication authority into this command.
    const actions = history.authority.actions.filter(action => action !== "deliver");
    const policy = {
        allowed: !contractRequired && !active && stoppedOrExhausted, contractRevisionRequired: contractRequired, contractBlockers,
        originalBaseline: history.plan.repository, actions, limits: history.authority.budget,
        previousSpendReset: false, candidateReused: false, humanJudgementGranted: false, publicationGranted: false,
    };
    const limits = history.authority.budget;
    const summary = [
        `Previous journey: ${history.state.id} (${history.result.stop?.reason ?? history.result.status}).`,
        `Original baseline: ${history.plan.repository.commit}.`,
        `Old limits: ${limits.max_sessions} agent sessions; planner ${limits.max_planner_turns}, worker ${limits.max_worker_turns}, judge ${limits.max_judge_turns}; whole journey ${limits.wall_clock_seconds}s; each session ${limits.session_timeout_seconds}s.`,
        `Old reservations: ${query.budget.sessions.reserved} agent sessions; ${query.budget.verificationAttempts.reserved} verification attempts. Tokens: input ${query.budget.tokens.input ?? "unknown"}, output ${query.budget.tokens.output ?? "unknown"}. Cost: unknown, not zero.`,
        `Old approval expires: ${history.authority.expires_at}${authorityExpired ? " (out of date)" : ""}. Elapsed whole-journey time: ${Math.floor(query.budget.wallClock.elapsedSeconds)}s.`,
        "A fresh grant authorizes a NEW WHOLE JOURNEY from the ORIGINAL BASELINE. It is not a budget reset, resume, or reuse of the old candidate. Old history and charged/unknown spending remain unchanged. Repeating work can incur additional spend.",
        "The new grant keeps the old execution limits and non-publication actions. It supplies no human verdict, publication approval, sandbox bypass or guaranteed cash ceiling.",
    ].join("\n");
    const inspectCommand = `wringer-drive status --state ${quote(stateDir)}`;
    if (active || !stoppedOrExhausted) {
        const reason = active ? "The old journey is active or its ownership is uncertain. Wait for a validated stop before considering a new grant." : "The current journey is neither stopped nor exhausted. Finish its review or use its recorded next action; no new allocation is available here.";
        if (confirm) throw new Error(reason);
        const next = [`Inspect the current journey: ${inspectCommand}`, `After a stable stop or exhausted approval, run this preview again: wringer-drive new-grant --state ${quote(stateDir)}`];
        return { value: { status: "preview", old, policy, next }, text: `New-grant preview only: no files changed, credentials read, source prepared or agents started.\n${summary}\n${reason}\nNext steps:\n${next.join("\n")}`, exit: 0 };
    }
    if (contractRequired) {
        const next = [
            `Inspect the preserved stop and findings: ${inspectCommand}`,
            ...contractBlockers.map(blocker => `${blocker.code}: ${blocker.reason}`),
            "Revise a separate copy of the original YAML/TypeScript configuration to resolve the unanswered intent, strengthen checks that already passed, or add the missing human display. Do not edit the old plan, authority or run records.",
            "Compile and inspect that revised contract: wringer-drive plan 'REVISED-CONFIG.yaml'",
            "Approve its NEW digest: wringer-drive authority 'REVISED-CONFIG.yaml' --actor 'YOUR NAME' --expires 'FUTURE ISO-8601 TIME' --output 'NEW-AUTHORITY.json'",
            "Only after that approval, start in a fresh directory: wringer-drive run 'REVISED-CONFIG.yaml' --authority 'NEW-AUTHORITY.json' --state 'NEW-STATE-DIRECTORY'",
        ];
        if (confirm) throw new Error(`The unchanged contract cannot receive a new grant while these recorded defects remain: ${contractBlockers.map(blocker => blocker.code).join(", ")}.\n${next.join("\n")}`);
        return { value: { status: "preview", old, policy, next }, text: `New-grant preview only: no files changed, credentials read, source prepared or agents started.\n${summary}\nA revised contract and a new approval are required; this stop cannot be solved by granting more attempts.\nNext steps:\n${next.join("\n")}`, exit: 0 };
    }
    const suggestedOutput = join(dirname(stateDir), `${basename(stateDir)}-new-grant`);
    if (!confirm) {
        const next = [
            `Inspect the old failure and address its cause before repeating work: ${inspectCommand}`,
            `After reviewing the limits, explicitly approve: wringer-drive new-grant --state ${quote(stateDir)} --confirm-new-grant --actor 'YOUR NAME' --expires 'FUTURE ISO-8601 TIME' --output ${quote(suggestedOutput)}`,
            "Choose a non-existing output directory. Replace the actor and expiry placeholders with your own decision. Confirmation creates only the plan and new authority; it does not start work.",
            `After confirmation, inspect readiness (no model prompt): wringer-drive doctor --plan ${quote(join(suggestedOutput, "plan.json"))}`,
            `Start only when ready to spend under the new grant: wringer-drive run ${quote(join(suggestedOutput, "plan.json"))} --authority ${quote(join(suggestedOutput, "authority.json"))} --state ${quote(suggestedOutput)}`,
            `Once started, open the PM workspace: wringer-drive board --state ${quote(suggestedOutput)}`,
            "If you choose another output directory, use the exact matching commands printed by confirmation. Run is a separate action that can incur spend.",
        ];
        return { value: { status: "preview", old, policy, next }, text: `New-grant preview only: no files changed, credentials read, source prepared or agents started.\n${summary}\nNext steps:\n${next.join("\n")}`, exit: 0 };
    }
    const authority = createExecutionAuthority(history.plan, {
        actor: required(a, "actor"), expiresAt: required(a, "expires"), actions, budget: history.authority.budget,
    });
    const requestedOutput = resolve(repo, required(a, "output"));
    // Resolve the existing parent once and write through that canonical path.
    // Refuse direct symlink parents and every alias back into the old evidence.
    const parentInfo = await lstat(dirname(requestedOutput));
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink())
        throw new Error("The new state parent must be an existing real directory, not a symlink.");
    const output = join(await realpath(dirname(requestedOutput)), basename(requestedOutput));
    const oldDirectory = await realpath(stateDir);
    if (inside(oldDirectory, output) || inside(output, oldDirectory))
        throw new Error("New state must be separate from the old controller and its history, not inside it or an ancestor of it.");
    context.signal?.throwIfAborted();
    // No recursive mkdir, overwrite, source preparation or model work. The fresh
    // directory is reserved exclusively; authority is the last file written.
    try { await mkdir(output, { mode: 0o700 }); }
    catch (error: any) {
        if (error.code === "EEXIST") throw new Error("The requested new state already exists. Choose a different non-existing directory; nothing was overwritten.");
        throw error;
    }
    try {
        await writeFile(join(output, "plan.json"), JSON.stringify(history.plan, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        await writeFile(join(output, "authority.json"), JSON.stringify(authority, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    } catch (error) {
        throw new Error(`New-grant files could not be completed at ${output}. The partial directory is preserved and no work started. Choose a new output directory after inspecting it. Cause: ${String(error)}`);
    }
    const next = [
        `Inspect readiness (no model prompt): wringer-drive doctor --plan ${quote(join(output, "plan.json"))}`,
        `Start only when ready to spend under this new grant: wringer-drive run ${quote(join(output, "plan.json"))} --authority ${quote(join(output, "authority.json"))} --state ${quote(output)}`,
        `Once the journey has started, open its PM workspace: wringer-drive board --state ${quote(output)}`,
    ];
    return { value: { status: "created", old, policy, stateDir: output, planPath: join(output, "plan.json"), authorityPath: join(output, "authority.json"), authority, next }, text: `Fresh bounded grant created: ${output}\n${summary}\nOnly plan.json and authority.json were created. No credentials were read, source prepared, agent started, old history changed or candidate copied.\nNext steps:\n${next.join("\n")}`, exit: 0 };
}
