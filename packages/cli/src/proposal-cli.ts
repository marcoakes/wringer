import { mkdir, writeFile, lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildProposerEvidence, createPlaybookProposalRequestV2, DEFAULT_DENY_GLOBS, proposePlaybookTree, readExperiment, readPlaybookProposalResult, readProposerEvidence, readReplicateSet, replicateDivergence, validateFailurePatternReport, writeProposerEvidence, type PlaybookProposalRequestV2 } from "@wringer/application";
import { readValidatedContainedState } from "@wringer/workflow";
import { compileExecutionPlan, hashBytes, selectPlaybookTree } from "@wringer/plan";
import { processDriver } from "@wringer/runtime";
import { experimentPath, exclusiveJson, optionalJson, privateExperimentRoot, readExperimentJson, shape } from "../../application/src/experiment-store";
import { allowed, flag, required, string, values, type Args } from "./args";
import type { Answer } from "./app";

export const PROPOSAL_HELP = `Playbook proposals from evidence - a proposed way of working is a hypothesis

  wring experiment evidence --state PROPOSAL_DIR --replicates REPLICATE_DIR
      [--held-out-from EXPERIMENT_DIR] [--fence FENCE.json] [--patterns PATTERNS.json]
  wring experiment prepare-proposal --state PROPOSAL_DIR --input PROPOSAL_GRANT.json
      --output proposal-request.json
  wring experiment propose --state PROPOSAL_DIR --request proposal-request.json --yes
  wring experiment proposal-result --state PROPOSAL_DIR
  wring experiment export-proposal --state PROPOSAL_DIR --into REPOSITORY_CHECKOUT
  wring experiment select-tree --source REPOSITORY_CHECKOUT
      --manifest wringer/playbooks/ID/manifest.json [--commit SHA] [--replace PATH]

evidence builds wringer/evidence/ from a replicate set's validated journals: the task,
what each attempt did (numbered trajectory lines) and produced, where the attempts
disagreed, and today's playbook. Held-out items, oracle digests and denied paths are
refused by name and content before anything is written. PROPOSAL_GRANT.json names
{plan, proposalId, surface, dimension, prediction, actor, expiresAt, maxTurns,
wallClockSeconds}: the proposer's own plan (contained or trusted-local) may write only
wringer/proposals/<proposalId>. propose spends one session: the agent reads the
evidence in its clone and writes a playbook tree whose NOTES.md cites a trajectory
line for every changed file, or KEEP_BASE. Nothing is adopted: export-proposal copies a
proposed tree into a checkout for review, you commit it, select-tree prints the exact
plan v6 selection, and a registered comparison decides.
Guide: docs/native/PROPOSALS.md
`;
const git = async (cwd: string, args: string[]) => {
    const result = await processDriver.command(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, timeoutMs: 30000 });
    if (result.code !== 0) throw new Error(`Git could not read ${args.at(-1)}`);
    return result.stdout;
};
const summary = (result: NonNullable<Awaited<ReturnType<typeof readPlaybookProposalResult>>>) => result.status === "proposed"
    ? `Proposed ${result.manifest!.surface} playbook ${result.manifest!.id} (${result.files.length} files) in ${result.outputDirectory}.\nChanged: ${result.changed.join(", ") || "nothing"}\nCitations: ${result.notes!.citations.map(c => `${c.path} <- ${c.label} line ${c.line}`).join("; ")}\nNothing is adopted. Review it: wring experiment export-proposal --help`
    : result.status === "no-change-proposed" ? `KEEP_BASE: the proposer found no change worth testing.\n${result.notes!.text.split("\n").slice(0, 6).join("\n")}\nOne reservation was spent; nothing else changed.`
        : `Proposal stopped: ${result.reason}\nOne reservation was spent; no provider call is replayed.`;
export async function proposalCommand(a: Args, repo: string, operation: string): Promise<Answer> {
    if (operation === "select-tree") {
        allowed(a, ["source", "manifest", "commit", "replace"]);
        const source = resolve(repo, required(a, "source")), commit = string(a, "commit") ?? (await git(source, ["rev-parse", "HEAD"])).trim();
        const selection = await selectPlaybookTree(source, commit, required(a, "manifest"), { replace: values(a, "replace") ?? [], credentialEnvironment: {} });
        const protect = [selection.path, ...selection.files!.map(f => f.path)];
        return { value: { selection, protect, commit }, text: `${JSON.stringify(selection, null, 2)}\nUse this as playbook in a version 6 plan at commit ${commit}. In a comparison, add these to the baseline arm's protected_paths so only the playbook differs:\n${protect.join("\n")}` };
    }
    const root = resolve(repo, required(a, "state"));
    if (operation === "evidence") {
        allowed(a, ["state", "replicates", "held-out-from", "fence", "patterns"]); await privateExperimentRoot(root);
        const replicates = resolve(repo, required(a, "replicates")), retained = await readReplicateSet(replicates), divergence = await replicateDivergence(replicates);
        const journeys = [];
        for (const record of retained.replicates.filter(r => r.outcome !== "not-started" && r.journeyRevision)) journeys.push({ label: record.slot.id, state: await experimentPath(replicates, `journeys/${record.slot.id}`) });
        if (!journeys.length) throw new Error("No attempt of this replicate set recorded a journey; there is nothing to read");
        const baseline = retained.set.plan.playbook ? (await readValidatedContainedState(journeys[0]!.state, { allowStaleView: true })).playbook ?? null : null;
        if (retained.set.plan.playbook && !baseline) throw new Error("The replicate plan selects a playbook, but no journey retained its snapshot");
        const fence = { heldOutIds: [] as string[], oracleDigests: [] as string[], denyGlobs: [...DEFAULT_DENY_GLOBS] };
        if (a.flags.has("held-out-from")) for (const task of (await readExperiment(resolve(repo, required(a, "held-out-from")))).plan.tasks.filter(t => t.split === "held-out")) fence.heldOutIds.push(task.id, task.sourceTree);
        if (a.flags.has("fence")) { const extra = await readExperimentJson<Record<string, string[]>>(resolve(repo, required(a, "fence"))); shape(extra, ["heldOutIds", "oracleDigests", "denyGlobs"], "Evidence fence"); for (const key of ["heldOutIds", "oracleDigests", "denyGlobs"] as const) fence[key].push(...extra[key]!); }
        const patterns = a.flags.has("patterns") ? validateFailurePatternReport(await readExperimentJson(resolve(repo, required(a, "patterns")))) : null;
        const built = await buildProposerEvidence({ plan: retained.set.plan, taskFamily: retained.set.taskFamily, journeys, replicateSet: { sha256: retained.set.sha256, divergence }, patterns, baseline, fence });
        const record = await writeProposerEvidence(root, built);
        await exclusiveJson(root, "baseline.json", baseline);
        return { value: record, text: `Built the proposer's evidence: ${record.files.length} files, ${record.bytes} bytes, from ${record.journeys.length} attempts (${record.journeys.map(j => `${j.label}: ${j.outcome}, ${j.trajectoryLines} lines`).join("; ")}).\n${record.omissions.length ? `Not included: ${record.omissions.map(o => `${o.path} (${o.reason})`).join("; ")}\n` : ""}Held-out material was scanned for by name and content. No model ran. Next: wring experiment prepare-proposal --help` };
    }
    if (operation === "prepare-proposal") {
        allowed(a, ["input", "state", "output"]); await privateExperimentRoot(root);
        const input = await readExperimentJson<Record<string, any>>(resolve(repo, required(a, "input")));
        shape(input, ["plan", "proposalId", "surface", "dimension", "prediction", "actor", "expiresAt", "maxTurns", "wallClockSeconds"], "Tree proposal grant");
        const plan = compileExecutionPlan(JSON.stringify(input.plan), { format: "yaml" }), { record: evidence } = await readProposerEvidence(root), baseline = await optionalJson<PlaybookProposalRequestV2["baseline"]>(root, "baseline.json");
        const request = createPlaybookProposalRequestV2({ plan, proposalId: input.proposalId, outputDirectory: `wringer/proposals/${input.proposalId}`, surface: input.surface, dimension: input.dimension, taskFamily: evidence.taskFamily, baseline, evidence, replicateSet: evidence.replicateSetSha256 ? { sha256: evidence.replicateSetSha256, divergenceSha256: evidence.divergenceSha256! } : null, prediction: input.prediction, actor: input.actor, grantedAt: new Date().toISOString(), expiresAt: input.expiresAt, maxSessions: 1, maxTurns: input.maxTurns, wallClockSeconds: input.wallClockSeconds, credentialNames: [...(plan.agents.worker.env ?? [])], dataScope: "this-repository-only", action: "propose-one-worker-playbook-tree" });
        await exclusiveJson(root, required(a, "output"), request);
        return { value: request, text: `Prepared one separate proposal allowance: 1 session, ${request.maxTurns} turns, ${request.wallClockSeconds} seconds, on ${request.plan.runtime.kind}.\nOnly writable output: ${request.outputDirectory}/ (${request.surface} tree or KEEP_BASE).\nNo runtime or provider called. A proposal cannot adopt itself.` };
    }
    if (operation === "propose") {
        allowed(a, ["state", "request", "yes"]);
        if (!flag(a, "yes")) throw new Error("A proposal spends one separately granted session; add --yes after reviewing the request. No action was taken.");
        const result = await proposePlaybookTree(root, await readExperimentJson(await experimentPath(root, required(a, "request"))));
        return { value: result, text: summary(result) };
    }
    if (operation === "proposal-result") {
        allowed(a, ["state"]); const result = await readPlaybookProposalResult(root);
        return result ? { value: result, text: summary(result) } : { value: null, text: "No proposal has run here." };
    }
    if (operation === "export-proposal") {
        allowed(a, ["state", "into"]);
        const result = await readPlaybookProposalResult(root);
        if (result?.status !== "proposed" || !result.manifest || !result.sourceCommit) throw new Error("Only a proposed tree can be exported; nothing was written");
        const capture = JSON.parse(await readFile(await experimentPath(root, "candidates/playbook-proposal/capture.json"), "utf8")).candidate;
        if (capture?.source?.commit !== result.sourceCommit) throw new Error("The captured proposal differs from its result; nothing was written");
        const target = join(resolve(repo, required(a, "into")), "wringer/playbooks", result.manifest.id);
        if (await lstat(target).then(() => true, () => false)) throw new Error(`${target} already exists; a proposal never overwrites a playbook`);
        for (const file of result.files) {
            const content = await git(root, ["--git-dir", capture.source.objectStore, "cat-file", "blob", `${result.sourceCommit}:${result.outputDirectory}/${file.path}`]);
            if (hashBytes(content) !== file.sha256) throw new Error(`${file.path} differs from the recorded proposal; nothing more was written`);
            await mkdir(dirname(join(target, file.path)), { recursive: true }); await writeFile(join(target, file.path), content, { flag: "wx" });
        }
        return { value: { target, files: result.files.map(f => f.path) }, text: `Wrote ${result.files.length} files to ${target}.\nReview them, commit, then: wring experiment select-tree --source CHECKOUT --manifest wringer/playbooks/${result.manifest.id}/manifest.json\nNothing is selected, approved or adopted by exporting.` };
    }
    throw new Error(PROPOSAL_HELP);
}
