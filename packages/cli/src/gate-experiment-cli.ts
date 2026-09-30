/** Thin routes for gate and workflow proposals. The evaluator, oracle and records
 * live in @wringer/application; no fixture runner is reachable from here. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { adoptGateSelection, createGateOracle, createGateProposal, evaluateGateExperiment, loadContainedGraphFile, prepareGateChange, readGateExperiment, readGateSelections, registerGateExperiment, registerWorkflowExperiment, sendGateChange, undoGateSelection, type GateEvaluation } from "@wringer/application";
import { EngineError } from "@wringer/engine";
import { allowed, flag, positionals, quote, required, string, type Args } from "./args";
import type { Answer } from "./app";

export const GATE_EXPERIMENT_HELP = `wring experiment gate · compare a proposed check against a frozen oracle

  wring experiment gate propose --input PROPOSAL-INPUT.json --output PROPOSAL.json
  wring experiment gate oracle --corpus ID --labels LABELS.json --output ORACLE.json
  wring experiment gate register --input EXPERIMENT.json --proposal PROPOSAL.json --source-bundle CORPUS.bundle --state DIR
  wring experiment workflow register --input EXPERIMENT.json --proposal PROPOSAL.json --source-bundle CORPUS.bundle --state DIR
  wring experiment gate evaluate --state DIR --oracle ORACLE.json --yes
  wring experiment gate status --state DIR
  wring experiment gate change --state DIR --output NEW-DIRECTORY
  wring experiment gate send --state DIR --remote URL_OR_BARE_PATH --source-branch REVIEW --by NAME --yes
  wring experiment gate adopt --state DIR --registry DIR --by NAME [--revision SHA] --yes
  wring experiment gate undo --registry DIR --by NAME --revision SHA --yes
  wring experiment gate selections --registry DIR

A proposal changes how work is checked, so it never grades itself. Registration
freezes exact corpus commits and splits, a commitment to the oracle's labels,
both arms' gates pinned by content, the prediction and a fixed run budget. The
oracle stays with the evaluator until evaluation. Every run executes in a fresh
contained verifier with the arm's gate files overlaid; a reserved run without a
record is uncertain and never rerun. Qualification is decided on the held-out
split against the oracle, never by a gate's own pass rate.

A workflow arm is the set of gates its loops require plus its required human
holds, compared on the same corpus (EXPERIMENT.json names baselineGraph and
candidateGraph files). This is a static evaluation of recorded candidates, not a
live run. Preparing a source change, sending it and adopting it for future plans
are separate actions; none changes an active plan, grader or approval.
Exit: 0 done or qualified, 3 evaluated but not qualified, 2 refused.
Guide: docs/native/GATE_EXPERIMENTS.md`;

const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const confirm = (a: Args) => { if (!flag(a, "yes")) throw new EngineError("This separate operator action needs --yes after reviewing exactly what it does. Nothing was done.", 2); };
function describe(evaluation: GateEvaluation) {
    const row = (label: string, arm: GateEvaluation["summary"]["baseline"]) => `  ${label.padEnd(9)} caught ${arm.heldOut.caught}/${arm.heldOut.defects} held-out defects · failed ${arm.heldOut.falsePositives}/${arm.heldOut.controls} correct controls · pass rate ${Math.round(arm.heldOut.passRate * 100)}% · required holds ${arm.requiredHolds} · ${arm.gateRuns} gate runs in ${arm.durationMs} ms`;
    return [`Evaluated against the frozen oracle (${evaluation.evidenceKind}): ${evaluation.qualification.qualified ? "QUALIFIED" : "not qualified"}.`, row("Baseline", evaluation.summary.baseline), row("Candidate", evaluation.summary.candidate), ...evaluation.qualification.reasons.map(reason => `  - ${reason}`)].join("\n");
}
/** Refuse before any reservation when no contained runtime exists: a fixed sample is never spent on a missing runtime. */
function requireRuntime(kind: string) {
    const binary = kind === "apple-container" ? "container" : "kubectl";
    if (!Bun.which(binary, { PATH: process.env.PATH ?? "" })) throw new EngineError(`Containment unavailable: ${binary} is not on PATH. No gate ran and no run was reserved; the fixed sample is intact.`, 2, "wringer-drive doctor --help");
}
export async function gateExperimentCommand(a: Args, repo: string): Promise<Answer> {
    const family = a.words[0], verb = a.words[1];
    if (!verb || flag(a, "help")) return { text: GATE_EXPERIMENT_HELP };
    positionals(a, 2);
    const state = () => resolve(repo, required(a, "state"));
    if (family === "workflow" && verb !== "register") throw new EngineError("A registered workflow comparison uses the gate verbs: evaluate, status, change, send and adopt.", 2, "wring experiment gate --help");
    if (verb === "propose") {
        allowed(a, ["input", "output"]);
        const proposal = createGateProposal(await readJson(resolve(repo, required(a, "input")))), output = resolve(repo, required(a, "output"));
        await writeFile(output, JSON.stringify(proposal, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        return { value: proposal, text: `Proposal recorded: ${output}\nDigest ${proposal.sha256}. It grants nothing and cannot evaluate itself.\nNext: register it with its corpus, oracle commitment and prediction.` };
    }
    if (verb === "oracle") {
        allowed(a, ["corpus", "labels", "output"]);
        const oracle = createGateOracle(required(a, "corpus"), await readJson(resolve(repo, required(a, "labels")))), output = resolve(repo, required(a, "output"));
        await writeFile(output, JSON.stringify(oracle, null, 2) + "\n", { flag: "wx", mode: 0o600 });
        return { value: { sha256: oracle.sha256, output }, text: `Oracle sealed: ${output}\nRegister only its digest: ${oracle.sha256}\nKeep the labels with the evaluator, outside every repository a proposer or worker can read.` };
    }
    if (verb === "register") {
        allowed(a, ["input", "proposal", "source-bundle", "state"]);
        const input = await readJson(resolve(repo, required(a, "input"))), proposal = await readJson(resolve(repo, required(a, "proposal"))), bundle = resolve(repo, required(a, "source-bundle"));
        if (family === "workflow") for (const key of ["baselineGraph", "candidateGraph"]) if (typeof input[key] === "string") input[key] = await loadContainedGraphFile(resolve(repo, input[key]));
        const value = family === "workflow" ? await registerWorkflowExperiment(state(), input, proposal, bundle) : await registerGateExperiment(state(), input, proposal, bundle);
        return { value, text: `${family === "workflow" ? "Workflow" : "Gate"} comparison registered: ${value.sha256}\n${value.corpus.items.length} corpus items (${value.corpus.items.filter(item => item.split === "held-out").length} held out) · ${value.corpus.items.length * 2} planned runs within a budget of ${value.limits.maxGateRuns}.\nThe prediction and oracle commitment are frozen before any run.\nNext: wring experiment gate evaluate --state ${quote(state())} --oracle ORACLE.json --yes` };
    }
    if (verb === "evaluate") {
        allowed(a, ["state", "oracle", "yes"]); confirm(a);
        const current = await readGateExperiment(state());
        if (!current.evaluation) requireRuntime(current.registration.runtime.kind);
        const evaluation = await evaluateGateExperiment(state(), await readJson(resolve(repo, required(a, "oracle"))), { evidenceKind: "contained" });
        return { value: evaluation, text: describe(evaluation), exit: evaluation.qualification.qualified ? 0 : 3 };
    }
    if (verb === "status") {
        allowed(a, ["state"]);
        const current = await readGateExperiment(state());
        return { value: current, text: current.evaluation ? `${describe(current.evaluation)}${current.change ? `\nSource change prepared: ${current.change.commit}` : ""}${current.sent ? `\nSent to ${current.sent.sourceBranch}` : ""}` : `Registered ${current.registration.sha256}; not evaluated. The prediction is frozen.`, exit: current.evaluation?.qualification.qualified ? 0 : 3 };
    }
    if (verb === "change") {
        allowed(a, ["state", "output"]);
        const output = resolve(repo, required(a, "output")), value = await prepareGateChange(state(), output);
        return { value, text: `Source change prepared in ${output} (change.patch, PROPOSAL.md with prediction, results, scope limits and rollback).\nCommit ${value.commit} on base ${value.base}. Nothing was sent.\nNext: wring experiment gate send --state ${quote(state())} --remote REMOTE --source-branch REVIEW-BRANCH --by 'YOUR NAME' --yes` };
    }
    if (verb === "send") {
        allowed(a, ["state", "remote", "source-branch", "by", "yes"]); confirm(a);
        const value = await sendGateChange(state(), { remote: required(a, "remote"), sourceBranch: required(a, "source-branch"), actor: required(a, "by") });
        return { value, text: `The exact prepared change ${value.commit} was sent to review branch ${value.sourceBranch}. No merge, adoption or plan change happened.` };
    }
    if (verb === "adopt" || verb === "undo") {
        allowed(a, verb === "adopt" ? ["state", "registry", "by", "revision", "yes"] : ["registry", "by", "revision", "yes"]); confirm(a);
        const registry = resolve(repo, required(a, "registry")), revision = string(a, "revision") ?? null;
        const value = verb === "adopt" ? await adoptGateSelection(state(), registry, { actor: required(a, "by"), expectedRevision: revision }) : await undoGateSelection(registry, { actor: required(a, "by"), expectedRevision: revision });
        return { value, text: `${verb === "adopt" ? "Selected" : "Undid"} ${value.gates.map(gate => gate.id).join(", ")} for FUTURE plans only. Active plans, graders and old evidence are unchanged.\nRevision ${value.sha256}` };
    }
    if (verb === "selections") {
        allowed(a, ["registry"]);
        const value = await readGateSelections(resolve(repo, required(a, "registry")));
        return { value, text: value.current ? `Current future selection: ${value.current.gates.map(gate => gate.id).join(", ")} (from evaluation ${value.current.evaluationSha256}). Revision ${value.revision}.` : `No gate selection is active${value.revision ? `; revision ${value.revision}` : ""}.` };
    }
    throw new EngineError(`Unknown gate experiment verb ${verb}. See wring experiment gate --help.`, 2);
}
