import { resolve } from "node:path";
import { applicationDirectory, collectReplicateSet, createReplicateGrant, jobReplicateLocation, readReplicateSet, registerReplicateSet, replicateDivergence } from "@wringer/application";
import { experimentPath, exclusiveJson, readExperimentJson } from "../../application/src/experiment-store";
import { allowed, flag, number, positionals, required, string, type Args } from "./args";
import type { Answer } from "./app";

export const REPLICATE_HELP = `Replicate sets - the same approved plan k times, and where the attempts disagreed

  wring experiment replicate register --state PRIVATE_DIR --input REPLICATE_SET.json
  wring experiment replicate grant --state PRIVATE_DIR --actor NAME --expires ISO_TIME --output grant.json
  wring experiment replicate collect --state PRIVATE_DIR --grant grant.json --yes
  wring experiment replicate status --state PRIVATE_DIR

For an ordinary job whose future improvements are connected:
  wring experiment replicate register --job JOB_ID --task-family FAMILY --replicate-set ID [--k 3] [--seconds 3600]
  Then use --job JOB_ID --replicate-set ID in place of --state for grant, collect and status.

REPLICATE_SET.json names {id, taskFamily, plan, k, sourceTree, wallClockSeconds}; k is 2 to 5.
The job form uses the job's approved plan and the source tree its journey measured.
Register and status are offline. Grant records one separate finite allowance; collect
reserves all k attempts first, runs each once, keeps every outcome (failures and
unstarted attempts included) and writes a divergence report. An interrupted attempt is
reconciled from what was retained, never replayed. The report says where attempts
disagreed, never why; no model reads it. Replicates are never delivered.
Guide: docs/native/REPLICATES.md
`;
const confirmed = (a: Args) => { if (!flag(a, "yes")) throw new Error("Collecting a replicate set spends its separate allowance; add --yes after reviewing it. No action was taken."); };
export async function replicateCommand(a: Args, repo: string): Promise<Answer> {
    if (flag(a, "help")) return { value: { help: REPLICATE_HELP }, text: REPLICATE_HELP };
    positionals(a, 2); const operation = a.words[1];
    let root: string;
    if (a.flags.has("job")) {
        if (a.flags.has("state")) throw new Error("Choose a job handle or a private path, never both");
        const register = operation === "register";
        if (register) allowed(a, ["job", "app-dir", "task-family", "replicate-set", "k", "seconds"]);
        const location = await jobReplicateLocation(applicationDirectory(string(a, "app-dir")), required(a, "job"), required(a, "replicate-set"), register ? { taskFamily: required(a, "task-family"), k: number(a, "k", 3), wallClockSeconds: number(a, "seconds", 3600) } : undefined);
        if (register) {
            const set = await registerReplicateSet(location.state, location.input!);
            return { value: set, text: `Registered replicate set ${set.id}: ${set.k} attempts of plan ${set.plan.plan_sha256}.\nNo attempt started and nothing was spent. Next: wring experiment replicate grant --job ${required(a, "job")} --replicate-set ${set.id} --actor NAME --expires ISO_TIME --output grant.json` };
        }
        const flags = new Map(a.flags); for (const key of ["job", "app-dir", "replicate-set"]) flags.delete(key);
        flags.set("state", location.state); a = { ...a, flags };
    }
    root = resolve(repo, required(a, "state"));
    if (operation === "register") {
        allowed(a, ["state", "input"]);
        const set = await registerReplicateSet(root, await readExperimentJson(resolve(repo, required(a, "input"))));
        return { value: set, text: `Registered replicate set ${set.id}: ${set.k} attempts of plan ${set.plan.plan_sha256}.\nNo attempt started and nothing was spent. Next: wring experiment replicate grant --help` };
    }
    if (operation === "grant") {
        allowed(a, ["state", "actor", "expires", "output"]);
        const { set } = await readReplicateSet(root);
        const grant = createReplicateGrant(set, { actor: required(a, "actor"), expiresAt: required(a, "expires"), credentialNames: set.plan.runtime.env ?? [] });
        await exclusiveJson(root, required(a, "output"), grant);
        return { value: grant, text: `Recorded a separate allowance: ${grant.limits.replicates} attempts, at most ${grant.limits.maxRoleSessions} role sessions and ${grant.limits.wallClockSeconds} seconds.\nExpires: ${grant.expiresAt}. Nothing started. Collect with --yes when ready.` };
    }
    if (operation === "collect") {
        allowed(a, ["state", "grant", "yes"]); confirmed(a);
        const collected = await collectReplicateSet(root, await readExperimentJson(await experimentPath(root, required(a, "grant"))));
        return { value: collected, text: summary(collected.replicates, collected.divergence) };
    }
    if (operation === "status") {
        allowed(a, ["state"]);
        const current = await readReplicateSet(root), divergence = current.replicates.length ? await replicateDivergence(root) : null;
        return { value: { ...current, divergence }, text: divergence ? summary(current.replicates, divergence) : `Replicate set ${current.set.id} is registered; no attempt has been recorded.` };
    }
    throw new Error(REPLICATE_HELP);
}
function summary(replicates: { slot: { index: number }; outcome: string; workerAttempts: number | null }[], divergence: { diverging: string[]; k: number }) {
    return [...replicates.map(r => `Attempt ${r.slot.index}: ${r.outcome}${r.workerAttempts !== null ? `, ${r.workerAttempts} worker attempt${r.workerAttempts === 1 ? "" : "s"}` : ""}`),
        divergence.diverging.length ? `Disagreed on: ${divergence.diverging.join(", ")}.` : `All ${divergence.k} attempts agreed on every check, judgement, decision and candidate.`,
        "This says where the attempts disagreed, not why. Replicates are never delivered."].join("\n");
}
