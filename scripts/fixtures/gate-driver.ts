/** TEST FIXTURE ONLY. Separately compiled; never imported by the public CLI.
 * Prepares a labelled gate corpus and evaluates with a runner that really runs
 * each gate on exported trees. It does not measure real containment. */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { corpus, gateRunner, gates, git, variants } from "../../packages/application/fixtures/gate-corpus";
import { evaluateGateExperiment } from "../../packages/application/src";

const [action, directoryArgument, stateArgument, oracleArgument] = process.argv.slice(2), directory = resolve(directoryArgument!);
if (action === "prepare") {
    const c = await corpus(directory), origin = join(directory, "origin.git");
    git(["init", "-q", "--bare", "-b", "main", origin]); git(["-C", c.repo, "push", "-q", origin, "HEAD:refs/heads/main"]);
    for (const [name, gate] of [["property", gates.property], ["weakened", gates.weakened]] as const)
        await writeFile(join(directory, `${name}-proposal-input.json`), JSON.stringify({ id: name, taskFamily: "totals", candidateGates: [gate], rationale: name === "property" ? "Check the arithmetic property, not one example." : "Only check that the script runs.", inputs: { developmentItems: ["correct-sum", "tautology-two-three"] }, author: { actor: "Gate fixture operator", kind: "operator" } }, null, 2));
    await writeFile(join(directory, "labels.json"), JSON.stringify(variants.map(v => ({ itemId: v.id, label: v.label })), null, 2));
    await writeFile(join(directory, "baseline-gates.json"), JSON.stringify([gates.narrow], null, 2));
    console.log(JSON.stringify({ fixture: true, root: c.root, base: c.base, items: c.items, bundle: c.bundle, origin }));
} else if (action === "evaluate") {
    const oracle = JSON.parse(await Bun.file(resolve(oracleArgument!)).text()), { runCommands } = gateRunner(directory);
    const result = await evaluateGateExperiment(resolve(stateArgument!), oracle, { runCommands, evidenceKind: "deterministic-fixture" });
    console.log(JSON.stringify({ qualified: result.qualification.qualified, reasons: result.qualification.reasons, candidate: result.summary.candidate.heldOut, baseline: result.summary.baseline.heldOut, sha256: result.sha256 }));
} else throw new Error("Fixture actions are prepare and evaluate only");
