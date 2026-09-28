import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readFile, mkdtemp, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
const root = resolve(import.meta.dir, "../../..");
test("Action exposes binary/source, prove and bounded selection without publication authority", async () => {
    const action = Bun.YAML.parse(await readFile(join(root, "action.yml"), "utf8")) as any;
    expect(action.inputs.mode.default).toBe("binary");
    expect(action.inputs.prove.default).toBe("false");
    expect(action.inputs.selection.default).toBe("[]");
    expect(action.runs.steps.some((step: any) => step.env?.WRINGER_ACTION_REF === "${{ github.action_ref }}")).toBe(true);
    expect(JSON.stringify(action)).not.toContain("pull_request_target");
});

import { actionSelection, runVerification } from "../../../packaging/action.mjs";

test("the Action resolves only its own exact tag or explicit source mode, never the consumer release tag", () => {
    const version = "1.0.0-test.7";
    expect(actionSelection({ WRINGER_ACTION_REF: `v${version}`, GITHUB_REF_NAME: "v9.9.9" }, version).version).toBe(version);
    expect(() => actionSelection({ WRINGER_ACTION_REF: "main", GITHUB_REF_NAME: `v${version}` }, version)).toThrow("exact action release");
    expect(() => actionSelection({ WRINGER_ACTION_REF: "v1.0.0-other" }, version)).toThrow("exact action release");
    expect(actionSelection({ WRINGER_MODE: "source" }, version).mode).toBe("source");
    for (const selection of ['"gate"', '["--send"]', '["a","a"]', '["gate;echo injected"]']) expect(() => actionSelection({ WRINGER_MODE: "source", WRINGER_SELECTION: selection }, version)).toThrow("gate IDs");
});

test("every verifier exit including 3 and interruption survives summary/output failures and fork credentials are unnecessary", async () => {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-action-exit-"))), script = join(scratch, "verify.mjs");
    await writeFile(script, 'process.stdout.write(JSON.stringify({args:process.argv.slice(2)})); process.exit(Number(process.env.FIXTURE_EXIT));');
    const selection = actionSelection({ WRINGER_MODE: "source", WRINGER_PROVE: "true", WRINGER_SELECTION: '["unit"]' }, "1.0.0-test");
    for (const exit of [0, 1, 2, 3, 4]) {
        const result = await runVerification({ launcher: [process.execPath, script], repo: scratch, output: join(scratch, "evidence"), selection, env: { ...process.env, FIXTURE_EXIT: String(exit), GITHUB_EVENT_NAME: "pull_request", GITHUB_TOKEN: undefined, GITHUB_OUTPUT: join(scratch, "missing/output"), GITHUB_STEP_SUMMARY: join(scratch, "missing/summary") } });
        expect(result.exit).toBe(exit); expect(result.reporting).toHaveLength(2);
        expect(result.observed.args).toContain("--prove"); expect(result.observed.args).toContain("--strict"); expect(result.observed.args.slice(-2)).toEqual(["--gate", "unit"]);
    }
});

test("actual partial verification and missing proof remain distinguishable in the Action evidence", async () => {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-action-real-"))), repo = join(scratch, "repo"); await mkdir(repo);
    for (const args of [["init", "-b", "main"], ["config", "user.name", "Action Fixture"], ["config", "user.email", "fixture@example.invalid"], ["config", "commit.gpgsign", "false"]]) expect(Bun.spawnSync(["git", ...args], { cwd: repo }).exitCode).toBe(0);
    await writeFile(join(repo, ".gitignore"), ".wringer/\n");
    await writeFile(join(repo, ".wringer.yaml"), 'version: 1\ngates:\n  - id: unit\n    run: "test 2 -eq 2"\n  - id: other\n    run: "exit 1"\n');
    expect(Bun.spawnSync(["git", "add", "."], { cwd: repo }).exitCode).toBe(0); expect(Bun.spawnSync(["git", "commit", "-m", "fixture"], { cwd: repo }).exitCode).toBe(0);
    const summary = join(scratch, "summary"), env = { ...process.env, GITHUB_OUTPUT: join(scratch, "output"), GITHUB_STEP_SUMMARY: summary };
    const selected = actionSelection({ WRINGER_MODE: "source", WRINGER_SELECTION: '["unit"]' }, "1.0.0-test");
    const partial = await runVerification({ launcher: [process.execPath, join(root, "packages/cli/src/launcher.ts")], repo, output: join(repo, ".wringer/runs/partial"), selection: selected, env });
    expect(partial.exit).toBe(0); expect(partial.observed.selection.complete).toBe(false);
    expect(await readFile(summary, "utf8")).toContain("Partial selection");
    expect(await readFile(summary, "utf8")).toContain("No complete requirement proof is inferred");
    const all = await runVerification({ launcher: [process.execPath, join(root, "packages/cli/src/launcher.ts")], repo, output: join(repo, ".wringer/runs/all"), selection: { ...selected, gates: [], prove: true }, env });
    expect(all.exit).toBe(1); expect(all.observed.selection.complete).toBe(true);
    expect(await readFile(summary, "utf8")).toContain("Proof requested: **yes**");
});
