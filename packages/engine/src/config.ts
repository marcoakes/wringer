import { readFile, writeFile, access, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parseDocument, stringify } from "yaml";
import { EngineError, type Config, type Gate } from "./types";
import { safePath } from "./io";
const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function object(value: unknown, name: string): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new EngineError(`${name} must be a mapping`);
    return value as Record<string, any>;
}
export function keys(value: Record<string, any>, allowed: string[], name: string) {
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new EngineError(`${name}: unknown key ${key}`);
}
export function textValue(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0"))
        throw new EngineError(`${name} must be a nonempty string`);
    return value;
}
function boolean(value: unknown, name: string, fallback: boolean) {
    if (value === undefined)
        return fallback;
    if (typeof value !== "boolean")
        throw new EngineError(`${name} must be true or false`);
    return value;
}
function integer(value: unknown, name: string, fallback: number, max = 86400) {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max)
        throw new EngineError(`${name} must be an integer between 1 and ${max}`);
    return Number(value);
}
function strings(value: unknown, name: string, fallback: string[] = []): string[] {
    if (value === undefined)
        return fallback;
    if (!Array.isArray(value))
        throw new EngineError(`${name} must be a list of strings`);
    return value.map((v) => textValue(v, name));
}
export function parseYaml(source: string, name = "YAML"): any {
    if (Buffer.byteLength(source) > 2 * 1024 * 1024)
        throw new EngineError(`${name} exceeds 2 MiB`);
    const doc = parseDocument(source, { uniqueKeys: true, strict: true, schema: "core" });
    if (doc.errors.length || doc.warnings.length)
        throw new EngineError(`${name}: ${[...doc.errors, ...doc.warnings].map(e => e.message).join("; ")}`);
    try {
        return doc.toJS({ maxAliasCount: 20 });
    }
    catch (e) {
        throw new EngineError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
}
export function parseGate(value: unknown): Gate {
    const g = object(value, "gate");
    keys(g, ["id", "run", "timeout", "optional", "required", "proves", "concurrent", "stability", "artifacts"], "gate");
    const id = textValue(g.id, "gate.id");
    if (!SLUG.test(id))
        throw new EngineError(`gate.id ${id} must be a slug of at most 64 characters`);
    if (g.optional !== undefined && g.required !== undefined)
        throw new EngineError(`gate ${id}: use optional or required, never both`);
    const gate: Gate = { id, run: textValue(g.run, `gate ${id}.run`), timeout: integer(g.timeout, `gate ${id}.timeout`, 120), optional: g.required === undefined ? boolean(g.optional, "optional", false) : !boolean(g.required, "required", true), proves: typeof g.proves === "string" ? [textValue(g.proves, "proves")] : strings(g.proves, "proves"), concurrent: boolean(g.concurrent, "concurrent", false) };
    for (const criterion of gate.proves)
        if (!SLUG.test(criterion))
            throw new EngineError(`invalid criterion id ${criterion}`);
    if (g.stability !== undefined) {
        const s = object(g.stability, "stability");
        keys(s, ["attempts", "require_consistent"], "stability");
        gate.stability = { attempts: integer(s.attempts, "stability.attempts", 1, 10), require_consistent: boolean(s.require_consistent, "stability.require_consistent", true) };
    }
    if (g.artifacts !== undefined) {
        const a = object(g.artifacts, "artifacts");
        keys(a, ["max_bytes", "total_bytes"], "artifacts");
        gate.artifacts = { max_bytes: integer(a.max_bytes, "artifacts.max_bytes", 5 * 1024 * 1024, 100 * 1024 * 1024), total_bytes: integer(a.total_bytes, "artifacts.total_bytes", 20 * 1024 * 1024, 500 * 1024 * 1024) };
    }
    return gate;
}
export function parseConfig(value: string | unknown): Config {
    const c = object(typeof value === "string" ? parseYaml(value, ".wringer.yaml") : value, "config");
    keys(c, ["version", "gates", "evidence", "run", "judge", "show", "deliver", "execution", "provenance", "fleet", "workspace", "forge", "bench"], "config");
    if (c.version !== 1)
        throw new EngineError(".wringer.yaml version must be 1");
    if (Object.prototype.hasOwnProperty.call(c, "workspace"))
        throw new EngineError("workspace declarations are not supported by the native runtime. Clone with wring get URL DIRECTORY, then select the task repository explicitly with --repo DIRECTORY; remove the unused workspace declaration.", 2, "wring get --help");
    if (!Array.isArray(c.gates) || c.gates.length === 0)
        throw new EngineError("gates must contain at least one declared check; run wring init to detect project commands");
    const gates = c.gates.map(parseGate);
    const seen = new Set<string>();
    const bound = new Set<string>();
    for (const g of gates) {
        if (seen.has(g.id))
            throw new EngineError(`duplicate gate id ${g.id}`);
        seen.add(g.id);
        for (const p of g.proves) {
            if (bound.has(p))
                throw new EngineError(`criterion ${p} is bound more than once`);
            bound.add(p);
        }
    }
    const e = c.evidence === undefined ? {} : object(c.evidence, "evidence");
    keys(e, ["include", "redact"], "evidence");
    const r = e.redact === undefined ? {} : object(e.redact, "evidence.redact");
    keys(r, ["env"], "evidence.redact");
    const include = strings(e.include, "evidence.include");
    if (include.length)
        throw new EngineError("Nonempty evidence.include is not supported by the native runtime: those files would not be captured. Remove that setting or use explicit gate artifacts capture; verification has not started.");
    const out: Config = { ...c, version: 1, gates, evidence: { include, redact: { env: strings(r.env, "evidence.redact.env", ["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*"]) } } };
    if (c.run !== undefined) {
        const v = object(c.run, "run");
        keys(v, ["worker", "max_iterations", "worker_timeout", "wall_clock", "prove", "prove_setup", "containment"], "run");
        const worker = textValue(v.worker, "run.worker (a declared shell command)");
        for (const m of worker.matchAll(/(?<!\$)\{([a-z_]+)\}/g))
            if (!["brief", "evidence_dir", "iteration"].includes(m[1]!))
                throw new EngineError(`unknown worker placeholder ${m[0]}; allowed: {brief}, {evidence_dir}, {iteration}`);
        out.run = { worker, max_iterations: integer(v.max_iterations, "run.max_iterations", 3, 1000), worker_timeout: integer(v.worker_timeout, "run.worker_timeout", 900) };
        if (v.wall_clock !== undefined)
            out.run.wall_clock = integer(v.wall_clock, "run.wall_clock", 3600);
        if (v.prove !== undefined)
            out.run.prove = boolean(v.prove, "run.prove", false);
        if (v.prove_setup !== undefined)
            out.run.prove_setup = textValue(v.prove_setup, "run.prove_setup");
        if (v.containment !== undefined) {
            const c = object(v.containment, "run.containment");
            keys(c, ["runtime", "image", "requires", "env", "user", "egress"], "run.containment");
            const runtime = c.runtime ?? "docker";
            if (!["docker", "podman", "nerdctl"].includes(runtime))
                throw new EngineError("Unknown containment runtime");
            const image = textValue(c.image, "containment.image");
            if (image.startsWith("-"))
                throw new EngineError("containment.image may not start with '-'");
            const env = strings(c.env, "containment.env");
            for (const name of env)
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
                    throw new EngineError(`Invalid environment variable name ${name}`);
            if (c.user !== undefined && !/^\d+(?::\d+)?$/.test(c.user))
                throw new EngineError("containment.user must be uid or uid:gid");
            const requires = strings(c.requires, "containment.requires");
            for (const b of requires)
                if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(b))
                    throw new EngineError(`Invalid required binary ${b}`);
            const e = c.egress === undefined ? { policy: "none" } : object(c.egress, "containment.egress");
            keys(e, ["policy", "hosts", "ports", "broker_image"], "containment.egress");
            if (!["none", "allowlist"].includes(e.policy))
                throw new EngineError("containment.egress.policy must be none or allowlist");
            const hosts = strings(e.hosts, "egress.hosts");
            for (const h of hosts)
                if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h) || h.includes(".."))
                    throw new EngineError(`Invalid egress host ${h}`);
            const ports = e.ports === undefined ? [443] : e.ports;
            if (!Array.isArray(ports) || ports.length === 0 || ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535))
                throw new EngineError("egress.ports must contain port numbers from 1 to 65535");
            if (e.policy === "allowlist" && (!hosts.length || typeof e.broker_image !== "string" || !e.broker_image || e.broker_image.startsWith("-")))
                throw new EngineError("An egress allowlist requires hosts and a local broker_image");
            out.run.containment = { runtime, image, env, requires, user: c.user, egress: { policy: e.policy, hosts, ports, broker_image: e.broker_image } };
        }
    }
    if (c.judge !== undefined) {
        const j = object(c.judge, "judge");
        keys(j, ["endpoint", "model", "api_key_env", "timeout", "max_tokens", "max_output_tokens", "rubric", "draft_in_sections"], "judge");
        textValue(j.endpoint, "judge.endpoint");
        textValue(j.model, "judge.model");
        if (j.api_key_env !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(j.api_key_env))
            throw new EngineError("judge.api_key_env must name an environment variable");
        out.judge = { ...j, api_key_env: j.api_key_env ?? "WRINGER_API_KEY" } as Config["judge"];
    }
    if (c.show !== undefined) {
        const s = object(c.show, "show");
        for (const [id, command] of Object.entries(s)) {
            if (!SLUG.test(id))
                throw new EngineError(`invalid show criterion ${id}`);
            textValue(command, `show.${id}`);
        }
        out.show = s;
    }
    if (c.execution !== undefined) {
        const e = object(c.execution, "execution");
        keys(e, ["backend", "image", "runtime", "network", "env", "user"], "execution");
        if (!["local", "container"].includes(e.backend))
            throw new EngineError("execution.backend must be local or container");
        if (e.backend === "container") {
            const runtime = e.runtime ?? "docker";
            if (!["docker", "podman", "nerdctl"].includes(runtime))
                throw new EngineError("execution.runtime must be docker, podman or nerdctl");
            const image = textValue(e.image, "execution.image");
            if (image.startsWith("-"))
                throw new EngineError("execution.image may not start with '-'");
            const env = strings(e.env, "execution.env");
            for (const name of env)
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
                    throw new EngineError(`Invalid environment variable name ${name}`);
            if (e.user !== undefined && !/^\d+(?::\d+)?$/.test(e.user))
                throw new EngineError("execution.user must be uid or uid:gid");
            out.execution = { backend: "container", runtime, image, env, user: e.user, network: boolean(e.network, "execution.network", false) };
        }
        else {
            const ignored = Object.keys(e).filter(key => key !== "backend");
            if (ignored.length)
                throw new EngineError(`execution.backend local cannot enforce container-only settings: ${ignored.join(", ")}. Declare execution.backend container with its required image, or remove those settings; local execution has no container isolation.`);
            out.execution = { backend: "local" };
        }
    }
    if (c.deliver !== undefined) {
        const d = object(c.deliver, "deliver");
        keys(d, ["branch", "base", "remote", "issues_dir"], "deliver");
        for (const [k, v] of Object.entries(d)) {
            textValue(v, `deliver.${k}`);
            if (["base", "remote"].includes(k) && (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(v) || v.includes("..")))
                throw new EngineError(`unsafe deliver.${k}`);
        }
        out.deliver = d;
    }
    if (c.provenance !== undefined) {
        const p = object(c.provenance, "provenance");
        keys(p, ["require_signature", "signer", "expect_identity"], "provenance");
        if (p.require_signature !== undefined)
            boolean(p.require_signature, "provenance.require_signature", false);
    }
    // Unsupported orchestration policy is never silently accepted as an enforced policy.
    if (c.fleet !== undefined) {
        const f = object(c.fleet, "fleet");
        keys(f, ["concurrency", "deadline", "progress_window", "retries", "on_exhausted", "join", "child", "worktree", "scope"], "fleet");
        for (const k of ["concurrency", "deadline", "progress_window"])
            if (f[k] !== undefined)
                integer(f[k], `fleet.${k}`, 1);
        if (f.retries !== undefined && (!Number.isInteger(f.retries) || f.retries < 0))
            throw new EngineError("fleet.retries must be a nonnegative integer");
        if (f.child !== undefined) {
            const child = object(f.child, "fleet.child");
            keys(child, ["max_iterations", "worker_timeout", "wall_clock"], "fleet.child");
            for (const [k, v] of Object.entries(child))
                integer(v, `fleet.child.${k}`, 1);
        }
    }
    if (c.bench !== undefined) {
        const b = object(c.bench, "bench");
        keys(b, ["contender_wall_clock", "contenders", "attempts", "parallel"], "bench");
        if (b.contender_wall_clock !== undefined)
            integer(b.contender_wall_clock, "bench.contender_wall_clock", 3600);
        if (b.attempts !== undefined)
            integer(b.attempts, "bench.attempts", 1, 10);
        if (b.parallel !== undefined)
            integer(b.parallel, "bench.parallel", 1, 8);
        if (!Array.isArray(b.contenders) || b.contenders.length < 1)
            throw new EngineError("bench.contenders must declare at least one contender");
        const seen = new Set<string>();
        for (const raw of b.contenders) {
            const contender = object(raw, "bench contender");
            keys(contender, ["id", "worker", "agent"], "bench contender");
            const id = textValue(contender.id, "contender.id");
            if (!SLUG.test(id) || seen.has(id))
                throw new EngineError(`Invalid or repeated contender ${id}`);
            seen.add(id);
            textValue(contender.worker, "contender.worker");
            if (contender.agent !== undefined)
                textValue(contender.agent, "contender.agent");
        }
    }
    return out;
}
export async function loadConfig(repo: string): Promise<Config> {
    const path = await safePath(resolve(repo), ".wringer.yaml");
    try {
        return parseConfig(await readFile(path, "utf8"));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
            throw new EngineError(`No .wringer.yaml in ${resolve(repo)}. Run wring init.`);
        throw e;
    }
}
export async function exists(path: string) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
export async function init(repo: string, options: {
    force?: boolean;
} = {}) {
    repo = resolve(repo);
    const path = await safePath(repo, ".wringer.yaml"), ignore = await safePath(repo, ".gitignore");
    if (await exists(path))
        throw new EngineError(`${path} already exists; no configuration was overwritten`);
    const found: {
        id: string;
        run: string;
    }[] = [];
    const files: string[] = [];
    if (await exists(join(repo, "package.json"))) {
        files.push("package.json");
        const p = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
        const manager = await exists(join(repo, "bun.lock")) || await exists(join(repo, "bun.lockb")) ? "bun" : await exists(join(repo, "pnpm-lock.yaml")) ? "pnpm" : "npm";
        for (const id of ["lint", "typecheck", "test", "build"])
            if (typeof p.scripts?.[id] === "string")
                found.push({ id, run: `${manager} run ${id}` });
    }
    if (await exists(join(repo, "Makefile"))) {
        files.push("Makefile");
        const m = await readFile(join(repo, "Makefile"), "utf8");
        for (const id of ["lint", "test", "check"])
            if (new RegExp(`^${id}\\s*:`, "m").test(m) && !found.some(g => g.id === id))
                found.push({ id, run: `make ${id}` });
    }
    if (await exists(join(repo, "pyproject.toml"))) {
        files.push("pyproject.toml");
        const p = await readFile(join(repo, "pyproject.toml"), "utf8");
        for (const [id, pattern, run] of [["lint", /\[tool\.ruff/, "ruff check ."], ["typecheck", /\[tool\.mypy/, "mypy ."], ["test", /\[tool\.pytest/, "pytest"]] as const)
            if (pattern.test(p) && !found.some(g => g.id === id))
                found.push({ id, run });
    }
    const template_only = found.length === 0;
    const document = { version: 1, gates: template_only ? [{ id: "placeholder", run: "true" }] : found, evidence: { redact: { env: ["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*"] } } };
    const content = `# Wringer runs only the commands this repository declares.\n${template_only ? `# No commands detected in ${files.join(", ") || "known build files"}. This placeholder proves nothing.\n` : ""}${stringify(document)}`;
    parseConfig(content);
    await writeFile(path, content, { flag: "wx" });
    const old = await exists(ignore) ? await readFile(ignore, "utf8") : "";
    if (!/^\/?\.wringer\/?$/m.test(old))
        await appendFile(ignore, `${old && !old.endsWith("\n") ? "\n" : ""}.wringer/\n`);
    return { status: "ready", config: path, gates: found, template_only, next_move: template_only ? "Replace the placeholder in .wringer.yaml with your project's real checks, then run wring verify." : "wring verify" };
}
