import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, verify } from "@wringer/engine";

/** Packaged, deterministic fixture. Nothing in the caller's repository is read. */
export async function runDemo(signal?: AbortSignal) {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "wringer-simulation-")));
    await git(repo, ["init", "--initial-branch=main"]);
    await git(repo, ["config", "user.name", "Wringer automated fixture"]);
    await git(repo, ["config", "user.email", "simulation@example.invalid"]);
    await git(repo, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "answer", run: 'test "$(cat answer.txt)" = 42', inputs: ["answer.txt"] }] }));
    await writeFile(join(repo, "answer.txt"), "41\n");
    await git(repo, ["add", "."]);
    await git(repo, ["-c", "core.hooksPath=/dev/null", "commit", "-m", "Deterministic simulation: incorrect answer"]);
    const red = await verify(repo, { strict: true, signal });
    if (red.exit_code !== 1) throw new Error("Simulation did not establish its expected failing check; evidence was retained.");
    await writeFile(join(repo, "answer.txt"), "42\n");
    const green = await verify(repo, { strict: true, signal });
    if (green.exit_code !== 0) throw new Error("Simulation did not establish its corrected check; evidence was retained.");
    return { schema_version: "wringer.demo.v1", simulation: true, mode: "verification", boundary: "trusted-local", providerCalls: 0, humanAcceptance: "not-measured", red: { exit: red.exit_code, evidence: red.evidence_dir }, corrected: { exit: green.exit_code, evidence: green.evidence_dir }, repo, note: "SIMULATION: deterministic local checks. No agent, provider, container, human judgment or publication. Passing this check does not prove a product requirement." };
}
