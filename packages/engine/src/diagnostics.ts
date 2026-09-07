import { readFile, readdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { exists, loadConfig } from "./config";
import { latestRun, shellTokens } from "./acceptance";
import { maybeJson, posix, safePath, Redactor } from "./io";
import { runProcess } from "./process";
import { snapshot } from "./git";
import { EngineError, type Config } from "./types";
const SHELL_VENDORS = [{ binary: "codex", key: "CODEX_API_KEY", probe: ["login", "status"], logged: /logged in/i, loggedOut: /not logged in/i, login: "codex login" }, { binary: "claude", key: "ANTHROPIC_API_KEY", probe: ["auth", "status"], logged: /"loggedIn"\s*:\s*true/i, loggedOut: /"loggedIn"\s*:\s*false/i, login: "claude auth login" }];
export async function workerAuth(repo: string, config: Config) {
    if (!config.run)
        return { state: "not-applicable", credential: "none", blocking: false, words: "No coding worker is declared. Setup and verification need no coding agent." };
    if (config.run.containment)
        return { state: "unknown", credential: "contained", blocking: false, words: `The worker runs inside the declared container. Host logins are not evidence of container authentication. Only these environment names cross: ${config.run.containment.env.join(", ") || "none"}. The first worker turn decides whether its credential serves.` };
    const tokens = shellTokens(config.run.worker);
    if (tokens[0] === "env" || /^[A-Za-z_]\w*=/.test(tokens[0] ?? ""))
        return { state: "unknown", credential: "shell-environment", blocking: false, words: "The declared shell worker modifies its own environment. The login probe cannot establish those child credentials. Execution and authentication have not been tested." };
    const binary = tokens[0] ?? "";
    if (["if", "for", "while", "until", "case", "cd", "export", "exec", "command", ".", "source", ":", "test", "[", "printf", "echo", "read", "set", "unset", "umask"].includes(binary))
        return { state: "unknown", credential: "shell-command", blocking: false, words: "The worker is a shell program or composite command. No independent credential probe can establish what it will invoke. Execution and authentication have not been tested." };
    const located = Bun.which(binary, { cwd: repo, PATH: process.env.PATH });
    if (!located)
        return { state: "rejected", credential: "missing-binary", blocking: true, words: `The declared coding agent ${binary} was not found on PATH. Install that agent, then run wring doctor.`, next_move: "wring doctor" };
    const vendor = SHELL_VENDORS.find(v => binary.split("/").at(-1) === v.binary);
    if (!vendor)
        return { state: "unknown", credential: "unmeasured", blocking: false, words: `The declared worker ${binary} is present. Execution and authentication have not been tested; this worker has no measured credential probe.` };
    // Probe saved login without the exported worker key: otherwise a CLI may describe
    // that key itself as "logged in", manufacturing a key+login displacement warning.
    const probe = await runProcess([located, ...vendor.probe], { cwd: repo, timeout: 10, env: { ...process.env, [vendor.key]: undefined } });
    const said = new Redactor().scrub(`${probe.stdout}\n${probe.stderr}`.trim());
    const complete = !probe.timed_out && !probe.interrupted;
    const noLogin = complete && [0, 1].includes(probe.exit_code) && vendor.loggedOut.test(said), logged = complete && !vendor.loggedOut.test(said) && vendor.logged.test(said) && probe.exit_code === 0;
    const key = !!process.env[vendor.key];
    if (key && logged)
        return { state: "rejected", credential: "key-and-login", blocking: true, words: `${vendor.key} is set and the agent reports a stored login. The exported key displaces that login; key presence is not key validity. Choose one credential source before spending.`, probe: said, next_move: `unset ${vendor.key}; wring run` };
    if (key && !noLogin)
        return { state: "unknown", credential: "key-login-unsettled", blocking: true, words: `${vendor.key} is exported, but the free probe could not establish whether a saved login is also present. A key would displace that login. No worker spend is authorized while this credential choice is unsettled.`, probe: said, next_move: `${vendor.binary} ${vendor.probe.join(" ")}` };
    if (key)
        return { state: "unknown", credential: "key-only", blocking: false, words: `The only detected worker credential is ${vendor.key}; the agent reports no stored login. Presence is not validity: only the worker's first turn can establish that this key serves.`, probe: said };
    if (logged)
        return { state: "verified", credential: "login-only", blocking: false, words: "The coding agent reports a stored login, and no overriding worker key is exported. The login probe succeeded; a paid turn has not yet run.", probe: said };
    if (noLogin)
        return { state: "rejected", credential: "none", blocking: true, words: `The agent reports no stored login and ${vendor.key} is absent. Configure the worker's credential, then resume.`, probe: said, next_move: vendor.login };
    return { state: "unknown", credential: "unsettled", blocking: false, words: "The worker credential could not be settled by the free probe. This does not claim validity or rejection; the first worker turn will decide.", probe: said };
}
export async function explain(repo: string, path?: string) {
    repo = resolve(repo);
    const directory = path ? await safePath(repo, path) : await latestRun(repo);
    if (!directory)
        throw new EngineError("No verification record exists. Run wring verify.");
    const manifest = await maybeJson(join(directory, "manifest.json"));
    if (!manifest)
        throw new EngineError(`No manifest.json at ${directory}`);
    const gate = manifest.result.failed_gate;
    let result: any = null, stdout = "", stderr = "";
    if (gate && await exists(join(directory, "gates")))
        for (const d of await readdir(join(directory, "gates"), { withFileTypes: true })) {
            if (!d.isDirectory() || d.isSymbolicLink())
                continue;
            const found = await maybeJson(join(directory, "gates", d.name, "result.json"));
            if (found?.gate_id === gate) {
                result = found;
                stdout = (await readFile(join(directory, "gates", d.name, "stdout.log"), "utf8")).split("\n").slice(-21).join("\n");
                stderr = (await readFile(join(directory, "gates", d.name, "stderr.log"), "utf8")).split("\n").slice(-21).join("\n");
                break;
            }
        }
    const data = { status: manifest.result.status, run_id: manifest.run_id, evidence_dir: posix(relative(repo, directory)), failed_gate: gate, command: result?.command ?? null, exit_code: result?.exit_code ?? null, stdout, stderr, rerun: gate ? `wring verify --gate ${gate}` : "wring verify", acceptance: await maybeJson(join(directory, "acceptance.json")), summary: await readFile(join(directory, "summary.md"), "utf8") };
    return data;
}
export async function doctor(repo: string) {
    repo = resolve(repo);
    const checks: any[] = [];
    let config: Config | undefined;
    try {
        const s = await snapshot(repo);
        repo = s.root;
        checks.push({ name: "repository", status: "ok", detail: `${s.branch ?? "detached"} at ${s.head_sha ?? "unborn HEAD"}` });
    }
    catch (e) {
        checks.push({ name: "repository", status: "blocked", detail: (e as Error).message });
    }
    try {
        config = await loadConfig(repo);
        checks.push({ name: "configuration", status: "ok", detail: `${config.gates.length} declared checks` });
    }
    catch (e) {
        checks.push({ name: "configuration", status: "blocked", detail: (e as Error).message });
    }
    checks.push({ name: "runtime", status: "ok", detail: `Bun ${Bun.version}; ${process.platform}; trusted local execution` });
    const auth = config ? await workerAuth(repo, config) : null;
    if (auth)
        checks.push({ name: "worker credential", status: auth.blocking ? "blocked" : auth.state === "unknown" ? "unknown" : "ok", detail: auth.words });
    if (config?.judge)
        checks.push({ name: "drafting key", status: process.env[config.judge.api_key_env] ? "present" : "unknown", detail: process.env[config.judge.api_key_env] ? `${config.judge.api_key_env} is present; validity has not been tested.` : `${config.judge.api_key_env} is absent from this process.` });
    const latest = await latestRun(repo);
    if (latest) {
        const manifest = await maybeJson(join(latest, "manifest.json"));
        checks.push({ name: "last verify", status: "ok", detail: `${manifest.run_id}: ${manifest.result.status}; ${posix(relative(repo, latest))}` });
    }
    else
        checks.push({ name: "last verify", status: "unknown", detail: "No completed verification record exists. Run wring verify." });
    return { status: checks.some(c => c.status === "blocked") ? "blocked" : "ready", exit_code: checks.some(c => c.status === "blocked") ? 1 : 0, checks, worker_auth: auth, last_verify: latest ? posix(relative(repo, latest)) : null };
}
