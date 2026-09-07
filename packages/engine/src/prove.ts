import { mkdtemp, mkdir, readFile, writeFile, chmod, lstat, rm } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { git } from "./git";
import { Bundle, posix, safePath } from "./io";
import { runProcess } from "./process";
import { checkIdentity } from "./acceptance";
import { runGateCommand } from "./backend";
import { captureArtifacts } from "./artifacts";
import type { Config, GateResult, Snapshot, VerifyOptions } from "./types";
export async function prove(repo: string, config: Config, bundle: Bundle, snapshot: Snapshot, results: GateResult[], checks: any[], options: VerifyOptions) {
    const record: any = { schema_version: "wringer.vacuity.v1", verdict: "not_applicable", reason: "No changed tree was available to compare.", worktree_ms: 0, prove_ms: 0, setup: null, gates: [] };
    if (!snapshot.dirty || !snapshot.head_sha || !results.some(r => !r.optional)) {
        await bundle.json("vacuity.json", record);
        return record;
    }
    if (results.some(r => !r.optional && r.status !== "passed")) {
        record.reason = "Required checks are still failing on the changed tree; sensitivity is measured only after they pass.";
        await bundle.json("vacuity.json", record);
        return record;
    }
    const container = config.execution?.backend !== undefined && config.execution.backend !== "local";
    const start = performance.now(), parent = await mkdtemp(join(tmpdir(), "wringer-native-prove-")), tree = join(parent, "tree");
    let registered = false;
    try {
        const created = container ? await git(repo, ["clone", "--no-local", "--no-checkout", "--quiet", repo, tree], true) : await git(repo, ["worktree", "add", "--detach", tree, snapshot.head_sha], true);
        record.worktree_ms = Math.round(performance.now() - start);
        if (created.exit_code !== 0) {
            record.verdict = "inconclusive";
            record.reason = `Could not create the pre-change worktree: ${created.stderr.trim()}`;
            await bundle.json("vacuity.json", record);
            return record;
        }
        registered = !container;
        // A container needs self-contained .git metadata inside its mounted repository.
        if (container) {
            const checkout = await git(tree, ["checkout", "--detach", snapshot.head_sha], true);
            if (checkout.exit_code !== 0) {
                record.verdict = "inconclusive";
                record.reason = `Could not check out the pre-change commit: ${checkout.stderr.trim()}`;
                await bundle.json("vacuity.json", record);
                return record;
            }
        }
        const proveStart = performance.now();
        const materialized: string[] = [];
        // Re-run the same declared checks, including a new acceptance script that was not in HEAD.
        // Never copy arbitrary implementation files merely because they changed.
        for (const check of checks)
            for (const file of Object.keys(check.files)) {
                const source = await safePath(repo, file), target = await safePath(tree, file);
                const st = await lstat(source);
                if (!st.isFile())
                    continue;
                await mkdir(dirname(target), { recursive: true });
                await writeFile(target, await readFile(source));
                await chmod(target, st.mode & 0o777);
                materialized.push(file);
            }
        await bundle.json("prove-checks.json", { schema_version: "wringer.native.prove-checks.v1", base_sha: snapshot.head_sha, materialized: [...new Set(materialized)].sort(), limits: ["Only explicitly named check files were copied into the pre-change tree. Implicitly discovered dependencies are not inferred.", "A differing result describes two environments and trees, not proof that a particular source line caused it."] });
        if (config.run?.prove_setup) {
            const setup = await runProcess(config.run.prove_setup, { cwd: tree, timeout: 900, signal: options.signal, redactor: bundle.redactor });
            await bundle.write("prove/setup.stdout.log", setup.stdout);
            await bundle.write("prove/setup.stderr.log", setup.stderr);
            record.setup = { command: config.run.prove_setup, ok: setup.exit_code === 0 && !setup.timed_out && !setup.interrupted, exit_code: setup.exit_code, duration_ms: setup.duration_ms, cites: "prove/setup.stderr.log" };
            if (!record.setup.ok) {
                record.verdict = "inconclusive";
                record.reason = "The declared prove_setup failed in the pre-change worktree. A broken environment cannot supply proof.";
                record.prove_ms = Math.round(performance.now() - proveStart);
                await bundle.json("vacuity.json", record);
                return record;
            }
        }
        const copiedChecks = () => Promise.all(config.gates.map(g => checkIdentity(tree, g)));
        if (JSON.stringify(await copiedChecks()) !== JSON.stringify(checks)) {
            record.verdict = "inconclusive";
            record.reason = "Pre-change setup changed the copied check identity. Different check bytes cannot establish sensitivity.";
            await bundle.json("vacuity.json", record);
            return record;
        }
        let unsettled = false;
        for (const [index, g] of config.gates.entries()) {
            const changed = results.find(r => r.gate_id === g.id);
            if (!changed || g.optional)
                continue;
            const prefix = `prove/gates/${String(index + 1).padStart(3, "0")}_${g.id}`, staging = g.artifacts ? await mkdtemp(join(tmpdir(), "wringer-prove-artifacts-")) : undefined;
            let p;
            try {
                p = await runGateCommand(tree, config, bundle, prefix, g.run, { cwd: tree, timeout: g.timeout, signal: options.signal, redactor: bundle.redactor, ...(staging ? { env: { ...process.env, WRINGER_ARTIFACTS_DIR: staging } } : {}) }, staging);
                if (staging)
                    await captureArtifacts(staging, g, bundle, prefix);
            }
            finally {
                if (staging)
                    await rm(staging, { recursive: true, force: true });
            }
            await bundle.write(`${prefix}/stdout.log`, p.stdout);
            await bundle.write(`${prefix}/stderr.log`, p.stderr);
            const pre: GateResult = { gate_id: g.id, command: g.run, exit_code: p.exit_code, duration_ms: p.duration_ms, timed_out: p.timed_out, stdout_truncated: p.stdout_truncated, stderr_truncated: p.stderr_truncated, optional: g.optional, status: p.exit_code === 0 && !p.timed_out ? "passed" : "failed" };
            await bundle.json(`${prefix}/result.json`, pre);
            const environment = p.timed_out || p.interrupted || [2, 126, 127, 137, 143].includes(p.exit_code);
            if (environment)
                unsettled = true;
            const sensitive = changed.status === "passed" && pre.status === "failed" && !environment;
            record.gates.push({ gate_id: g.id, changed: changed.status, pre_change: pre.status, sensitive, cites: sensitive ? `${prefix}/result.json` : null, pre_change_log: `${prefix}/stdout.log` });
            if (options.signal?.aborted)
                break;
        }
        record.prove_ms = Math.round(performance.now() - proveStart);
        const checkChanged = JSON.stringify(await copiedChecks()) !== JSON.stringify(checks);
        if (checkChanged)
            unsettled = true;
        record.verdict = unsettled ? "inconclusive" : record.gates.length && record.gates.every((r: any) => r.sensitive) ? "proven" : "gates_vacuous";
        record.reason = checkChanged ? "A copied check changed during its pre-change run. Different check bytes cannot establish sensitivity." : unsettled ? "A pre-change check timed out, was interrupted, could not execute, or returned a collection/configuration failure. Those failures do not establish sensitivity." : record.verdict === "proven" ? "Every required check passed on the changed tree and failed on the pre-change tree using the same explicitly named check files." : "At least one required check also passed without the implementation change. Write a check that fails without your change.";
        await bundle.json("vacuity.json", record);
        return record;
    }
    finally {
        if (registered)
            await git(repo, ["worktree", "remove", "--force", tree], true);
        await rm(parent, { recursive: true, force: true });
    }
}
