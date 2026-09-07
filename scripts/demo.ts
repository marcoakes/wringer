/** Deterministic delivery regression: no provider, real person or container claim. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { dispatch } from "../packages/cli/src/app";
import { git, newId, runProcess } from "../packages/engine/src/index";
import { audit } from "../packages/delivery/src/index";
const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `native-demo-${newId()}`), repo = join(directory, "work"), origin = join(directory, "origin.git"), clone = join(directory, "fresh-clone");
await mkdir(repo, { recursive: true });
const started = performance.now(), transcript = ["# Bun delivery/evidence regression", "", "Deterministic test inputs, trusted-local checks and local bare origin. No ACP session, provider spend, container isolation or real human endorsement is measured.", ""];
async function command(surface: string, args: string[], expected = 0) {
    const answer = await dispatch([...args, "--repo", repo], surface);
    transcript.push(`## ${surface} ${args.join(" ")}`, "", "```text", answer.text ?? JSON.stringify(answer.value, null, 2), "```", `Exit: ${answer.exit ?? 0}`, "");
    await writeFile(join(directory, "transcript.md"), transcript.join("\n"));
    if ((answer.exit ?? 0) !== expected)
        throw new Error(`${surface}: ${answer.text}`);
    return answer.value as any;
}
try {
    await git(directory, ["init", "--bare", "--initial-branch=main", origin]);
    await git(repo, ["init", "--initial-branch=main"]);
    for (const [key, value] of [["user.name", "Deterministic test operator"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"]])
        await git(repo, ["config", key!, value!]);
    const inputs: Record<string, string> = {
        ".gitignore": ".wringer/\n", "package.json": JSON.stringify({ type: "module" }),
        "product.js": "export function enabled() { return false; }\nexport function unused() { return false; }\n",
        "check.mjs": "import assert from 'node:assert/strict';import{enabled}from'./product.js';assert.equal(enabled(),true,'feature must be enabled');\n",
        "display.mjs": "import{enabled}from'./product.js';console.log(enabled()?'ENABLED — feature available.':'DISABLED');\n",
        "fixture-worker.mjs": "import{writeFile}from'node:fs/promises';await writeFile('product.js','export function enabled() { return true; }\\nexport function unused() { return true; }\\n');\n",
        ".wringer.yaml": JSON.stringify({ version: 1, gates: [{ id: "enabled", run: "node check.mjs", proves: "enabled" }], show: { display: "node display.mjs" }, deliver: { base: "main", remote: "origin" } }),
        "wringer.spec.yaml": JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Enabled feature with clear display", intent: "Enable the feature and show its state clearly.", criteria: [{ id: "enabled", title: "Feature enabled", required: true }, { id: "display", title: "Display is clear", required: true, human: true }], open_questions: [], tasks: [{ id: "enable", brief: "brief.md", objective: "Enable the feature" }], gates: [] })
    };
    for (const [path, text] of Object.entries(inputs))
        await writeFile(join(repo, path), text);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-m", "Committed red-first deterministic fixture"]);
    await git(repo, ["remote", "add", "origin", origin]);
    await git(repo, ["push", "-u", "origin", "main"]);
    await git(repo, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    const red = await command("wring", ["verify"], 1);
    const worker = await runProcess(["node", "fixture-worker.mjs"], { cwd: repo, timeout: 10 });
    if (worker.exit_code !== 0)
        throw new Error(worker.stderr);
    transcript.push("## Deterministic worker", "", "A labelled test program changed product.js; no agent convergence claim.", "");
    await command("wring", ["verify"]);
    const shown = await command("wringer-board", ["show", "--criterion", "display"]);
    await command("wringer-board", ["judge", "--criterion", "display", "--display", shown.id, "--verdict", "met", "--by", "Deterministic test operator", "--note", "Fixture observation: ENABLED is readable and describes availability."]);
    await command("wring", ["verify"]);
    await command("wring", ["deliver"]);
    const delivered = await command("wring", ["deliver", "--send"]);
    await git(directory, ["clone", "--branch", delivered.branch, origin, clone]);
    const mr = await readFile(join(delivered.directory, "mr.md"), "utf8");
    for (const printed of [delivered.audit_command, delivered.falsify_command]) {
        if (!mr.includes(printed))
            throw new Error(`Missing printed command ${printed}`);
        const result = await runProcess(printed, { cwd: clone, env: { ...process.env, PATH: `${join(root, "dist")}:${process.env.PATH ?? ""}` }, timeout: 90 });
        transcript.push(`## AS PRINTED: ${printed}`, "", "```text", result.stdout, result.stderr, "```", `Exit: ${result.exit_code}`, "");
        if (result.exit_code !== 0)
            throw new Error(`Printed command failed: ${printed}\n${result.stdout}\n${result.stderr}`);
    }
    const checked = await audit(clone, delivered.delivery_id), measured = await readdir(join(clone, ".wringer/falsifications"));
    if (measured.length !== 1)
        throw new Error("Expected one falsification record");
    const falsification = JSON.parse(await readFile(join(clone, ".wringer/falsifications", measured[0]!, "falsification.json"), "utf8"));
    await command("wring", ["doctor"]);
    const result = { status: "passed", fixture: "local-delivery-evidence", delivery: delivered.delivery_id, red_run: red.evidence_dir, audit: checked.status, uncheckable: checked.uncheckable, falsification: falsification.counts, printed_commands_executed: 2, paid_calls: 0, acp_sessions: 0, real_containment_measured: false, human_judgement: "labelled test input", wall_ms: Math.round(performance.now() - started) };
    await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ directory, ...result }, null, 2));
}
catch (error) {
    transcript.push("## STOP", "", String(error));
    throw error;
}
finally {
    await writeFile(join(directory, "transcript.md"), transcript.join("\n"));
}
