import { readFile, lstat } from "node:fs/promises";
import { isIP } from "node:net";
import { parseYaml, Redactor } from "@wringer/engine";
import { LOCAL_SOURCE_URL, parseRuntimePolicy, parseWritableDirectories } from "@wringer/runtime";
import { canonicalJson, freezeData, hashBytes, hashValue } from "./canonical";
import { parsePlanTypeScript } from "./dsl";
import { validatePlaybookAdoption } from "./adoption";
import { assertRecordFamily, RECORD_FAMILIES, recordVersion, sourceFamily } from "./family";
import type { AgentDeclaration, AcceptanceContract, DeclaredCommand, DesignDeclaration, ExecutionAuthority, ExecutionBudget, ExecutionPlan, PlanDeclaration, RuntimeDeclaration, LoopPolicy, PlaybookSelection } from "./types";
export function record(value: unknown, label: string, keys: string[]): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        throw new Error(`${label} must be a plain mapping`);
    for (const key of Object.keys(value))
        if (!keys.includes(key))
            throw new Error(`${label}: unknown or unsafe key ${key}`);
    return value as Record<string, any>;
}
export function text(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 1024 * 1024)
        throw new Error(`${label} must be a bounded nonempty string`);
    return value;
}
const identifier = (v: unknown, label: string) => {
    const s = text(v, label);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(s))
        throw new Error(`${label} must be a short identifier`);
    return s;
};
export function integer(v: unknown, label: string, min = 1, max = 86400): number {
    if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max)
        throw new Error(`${label} must be an integer between ${min} and ${max}`);
    return Number(v);
}
export function list<T>(v: unknown, label: string, read: (item: unknown) => T): T[] {
    if (!Array.isArray(v) || v.length > 4096)
        throw new Error(`${label} must be a bounded list`);
    return v.map(read);
}
export function distinct<T>(rows: T[], key: (row: T) => string, label: string): T[] {
    if (new Set(rows.map(key)).size !== rows.length)
        throw new Error(`${label} contains duplicate identities`);
    return rows;
}
export function repoPath(v: unknown): string {
    const path = text(v, "repository path");
    if (/[\r\n\t:*?\[\]]/.test(path))
        throw new Error("Repository paths are exact names/prefixes, not controls, globs or Git pathspec expressions");
    if (path !== "." && (!/^[^/\\]/.test(path) || path.split(/[\\/]/).some(p => !p || p === "." || p === "..") || path.includes("\\") || /^[A-Za-z]:/.test(path)))
        throw new Error(`Not a normalized repository-relative path: ${path}`);
    if (path.split("/").some(p => p === ".git" || p === ".wringer"))
        throw new Error(`Controller/Git metadata cannot be a repository declaration: ${path}`);
    return path;
}
const paths = (value: unknown, label: string) => distinct(list(value, label, repoPath), p => p, label).sort();
export function argv(value: unknown): string[] {
    const args = list(value, "argv", v => text(v, "argument"));
    if (!args.length)
        throw new Error("An empty argv cannot declare a command");
    return args;
}
function command(v: unknown): DeclaredCommand {
    const c = record(v, "command", ["id", "argv", "cwd", "timeout_seconds"]);
    return { id: identifier(c.id, "command.id"), argv: argv(c.argv), cwd: repoPath(c.cwd ?? "."), timeout_seconds: integer(c.timeout_seconds ?? 120, "command.timeout_seconds") };
}
const envNames = (v: unknown) => distinct(list(v ?? [], "environment names", n => {
    const name = text(n, "environment name");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new Error("Environment declarations are names, never secret values");
    return name;
}), n => n, "environment names").sort();
function agent(v: unknown): AgentDeclaration {
    const a = record(v, "agent", ["protocol", "command", "args", "env", "authMethod", "mode"]);
    if (a.protocol !== "acp")
        throw new Error("The production plan supports ACP agents only; host shell and direct HTTP model paths are not fallback transports");
    const result: AgentDeclaration = { protocol: "acp", command: text(a.command, "agent.command"), args: list(a.args ?? [], "agent.args", x => text(x, "agent argument")), env: envNames(a.env) };
    if (a.authMethod !== undefined)
        result.authMethod = text(a.authMethod, "agent.authMethod");
    if (a.mode !== undefined)
        result.mode = text(a.mode, "agent.mode");
    return result;
}
function runtime(v: unknown): RuntimeDeclaration {
    const r = record(v, "runtime", ["kind", "image", "cpus", "memoryMiB", "network", "env", "context", "namespace", "runtimeClass", "secretRefs"]);
    if (r.kind !== "apple-container" && r.kind !== "gvisor-kubernetes")
        throw new Error("Runtime must be apple-container or gvisor-kubernetes; no trusted-local production fallback exists");
    const image = text(r.image, "runtime.image");
    if (!/^\S+@sha256:[a-f0-9]{64}$/.test(image))
        throw new Error("runtime.image must be pinned by an explicit sha256 digest");
    const n = record(r.network, "runtime.network", ["policy", "allow", "dns"]);
    if (n.policy !== "deny" && n.policy !== "allowlist")
        throw new Error("Runtime network policy must be deny or allowlist");
    const allow = list(n.allow ?? [], "network.allow", rule => {
        const x = record(rule, "network rule", ["cidr", "ports"]);
        const cidr = text(x.cidr, "network CIDR"), parts = cidr.split("/"), family = isIP(parts[0] ?? "");
        if (parts.length !== 2 || !family || !/^\d+$/.test(parts[1]!) || Number(parts[1]) > (family === 4 ? 32 : 128))
            throw new Error("Network allow entries must be valid IP CIDRs, not host patterns");
        const ports = distinct(list(x.ports, "network ports", p => integer(p, "port", 1, 65535)), p => String(p), "ports").sort((a, b) => a - b);
        if (!ports.length)
            throw new Error("A network rule needs explicit ports");
        return { cidr, ports };
    });
    const dns = list(n.dns ?? [], "network DNS", x => {
        const address = text(x, "DNS address");
        if (!isIP(address))
            throw new Error("DNS entries must be explicit resolver IP addresses");
        return address;
    });
    if (n.policy === "deny" && (allow.length || dns.length))
        throw new Error("A deny network cannot carry ignored allowances");
    if (n.policy === "allowlist" && !allow.length)
        throw new Error("An allowlist must declare at least one rule");
    const base = { image, cpus: integer(r.cpus, "runtime.cpus", 1, 256), memoryMiB: integer(r.memoryMiB, "runtime.memoryMiB", 64, 1048576), network: { policy: n.policy as "deny" | "allowlist", allow, dns }, env: envNames(r.env) };
    if (r.kind === "apple-container") {
        if ([r.context, r.namespace, r.runtimeClass, r.secretRefs].some(v => v !== undefined))
            throw new Error("Apple runtime cannot silently ignore Kubernetes settings");
        return parseRuntimePolicy({ kind: "apple-container", ...base });
    }
    const secretRefs = r.secretRefs === undefined ? undefined : Object.fromEntries(Object.entries(record(r.secretRefs, "secretRefs", Object.keys(r.secretRefs))).map(([name, v]) => { envNames([name]); const ref = record(v, "secret reference", ["name", "key"]); return [name, { name: identifier(ref.name, "secret name"), key: identifier(ref.key, "secret key") }]; }));
    return parseRuntimePolicy({ kind: "gvisor-kubernetes", ...base, context: text(r.context, "runtime.context"), namespace: identifier(r.namespace, "runtime.namespace"), runtimeClass: identifier(r.runtimeClass, "runtime.runtimeClass"), ...(secretRefs ? { secretRefs } : {}) });
}
export function readBudget(value: unknown): ExecutionBudget {
    const keys = ["max_sessions", "max_worker_turns", "max_judge_turns", "max_planner_turns", "wall_clock_seconds", "session_timeout_seconds"];
    const b = record(value, "budget", keys);
    const result = Object.fromEntries(keys.map(key => [key, integer(b[key], `budget.${key}`, key === "max_planner_turns" ? 0 : 1)])) as unknown as ExecutionBudget;
    if (result.session_timeout_seconds > result.wall_clock_seconds)
        throw new Error("Session timeout cannot exceed the whole-journey wall clock");
    return result;
}
function acceptance(value: unknown, intent: string, version: number): AcceptanceContract {
    const a = record(value, "acceptance", ["criteria", "checks", "protected_paths"]);
    const criteria = distinct(list(a.criteria, "acceptance.criteria", v => {
        const c = record(v, "criterion", ["id", "title", "quote", "kind", "required", "show"]);
        const quote = text(c.quote, "criterion.quote");
        if (!intent.includes(quote))
            throw new Error("Every criterion must quote the original intent verbatim");
        if (c.kind !== "check" && c.kind !== "human")
            throw new Error("criterion.kind must be check or human");
        if (c.required !== undefined && typeof c.required !== "boolean")
            throw new Error("criterion.required must be boolean");
        if (c.show !== undefined && c.kind !== "human")
            throw new Error("Only human criteria may declare a display command");
        if (c.kind === "human" && (c.required ?? true) && c.show === undefined)
            throw new Error("A required human criterion needs an approved show command before any agent can spend");
        return { id: identifier(c.id, "criterion.id"), title: text(c.title, "criterion.title"), quote, kind: c.kind as "check" | "human", required: c.required ?? true, ...(c.show === undefined ? {} : { show: command(c.show) }) };
    }), c => c.id, "criteria").sort((a, b) => a.id.localeCompare(b.id));
    if (!criteria.length)
        throw new Error("An execution plan needs an acceptance contract before workers can build");
    const checks = distinct(list(a.checks, "acceptance.checks", v => {
        const c = record(v, "acceptance check", ["id", "argv", "cwd", "timeout_seconds", "criteria", "files", ...(version >= 3 ? ["evidence"] : [])]);
        const refs = distinct(list(c.criteria, "check.criteria", id => identifier(id, "criterion id")), id => id, "check criteria").sort();
        if (!refs.length || refs.some(id => !criteria.some(r => r.id === id && r.kind === "check")))
            throw new Error("A check must reference known nonhuman criteria");
        const files = paths(c.files, "check.files");
        if (!files.length || files.includes("."))
            throw new Error("A check must pin at least one explicit check source/dependency path");
        const evidence = c.evidence === undefined ? undefined : record(c.evidence, "check.evidence", ["kind", "format"]);
        if (evidence && (evidence.kind !== "assertions" || evidence.format !== "wringer-check.v1")) throw new Error("Check evidence requires the declared assertions / wringer-check.v1 adapter");
        return { ...command({ id: c.id, argv: c.argv, cwd: c.cwd, timeout_seconds: c.timeout_seconds }), criteria: refs, files, ...(evidence ? { evidence: { kind: "assertions" as const, format: "wringer-check.v1" as const } } : {}) };
    }), c => c.id, "checks").sort((a, b) => a.id.localeCompare(b.id));
    for (const criterion of criteria)
        if (criterion.required && criterion.kind === "check" && !checks.some(c => c.criteria.includes(criterion.id)))
            throw new Error(`Required criterion ${criterion.id} lacks an acceptance check`);
    const protected_paths = [...new Set([...paths(a.protected_paths ?? [], "acceptance.protected_paths"), ...checks.flatMap(c => c.files)])].sort();
    return { criteria, checks, protected_paths };
}
function designDeclaration(value: unknown, contract: AcceptanceContract, writableDirectories: string[]): DesignDeclaration {
    const d = record(value, "design", ["snapshotPath", "snapshotSha256", "reviews"]);
    const snapshotPath = repoPath(d.snapshotPath);
    if (!snapshotPath.endsWith(".json") || !/^[a-f0-9]{64}$/.test(d.snapshotSha256 ?? ""))
        throw new Error("Design needs a repository JSON snapshot and its exact SHA256");
    if (writableDirectories.some(path => snapshotPath === path || snapshotPath.startsWith(path + "/")))
        throw new Error("A design snapshot cannot live in a writable output directory");
    const reviews = distinct(list(d.reviews, "design reviews", value => {
        const row = record(value, "design review", ["criterionId", "referenceIds", "captures"]);
        const criterionId = identifier(row.criterionId, "design criterion");
        const criterion = contract.criteria.find(c => c.id === criterionId);
        if (!criterion || criterion.kind !== "human" || !criterion.required || !criterion.show)
            throw new Error("Every design review needs a required human requirement and a declared show command");
        const referenceIds = distinct(list(row.referenceIds, "design references", id => identifier(id, "design reference")), id => id, "design references").sort();
        const captures = distinct(list(row.captures, "design captures", value => {
            const c = record(value, "design capture", ["id", "path", "mimeType", "width", "height"]);
            const path = repoPath(c.path), id = identifier(c.id, "capture id");
            if (c.mimeType !== "image/png" || !path.endsWith(".png") || !writableDirectories.some(base => path.startsWith(base + "/")))
                throw new Error("Visual captures must be PNG files inside declared writable output directories");
            const width = integer(c.width, "capture width", 1, 4096), height = integer(c.height, "capture height", 1, 4096);
            if (width * height > 8_000_000) throw new Error("Visual capture exceeds its pixel ceiling");
            return { id, path, mimeType: "image/png" as const, width, height };
        }), c => c.id, "design captures").sort((a, b) => a.id.localeCompare(b.id));
        if (!referenceIds.length || referenceIds.length > 4 || !captures.length || captures.length > 4 || new Set(captures.map(c => c.path)).size !== captures.length)
            throw new Error("A design review needs one to four distinct references and captures");
        return { criterionId, referenceIds, captures };
    }), row => row.criterionId, "design reviews").sort((a, b) => a.criterionId.localeCompare(b.criterionId));
    if (!reviews.length || reviews.length > 16) throw new Error("A design plan needs one to sixteen visual reviews");
    return { snapshotPath, snapshotSha256: d.snapshotSha256, reviews };
}
export interface PlanValidationOptions { credentialEnvironment?: NodeJS.ProcessEnv; }
export function compileDeclaration(value: unknown, options: PlanValidationOptions = {}): ExecutionPlan {
    canonicalJson(value); // Reject executable/exotic input even through the programmatic API.
    const p = record(value, "plan", ["version", "name", "intent", "repository", "runtime", "agents", "environment", "scope", "acceptance", "budget", "design", "loop", "playbook", "approachAdoption"]);
    if (p.version !== 1 && p.version !== 2 && p.version !== 3 && p.version !== 4)
        throw new Error("Plan version must be 1, 2, 3 or 4");
    if (p.version < 3 && (p.loop !== undefined || p.playbook !== undefined || p.approachAdoption !== undefined)) throw new Error("Loop policy and playbook selection require plan version 3");
    if (p.version === 1 && p.design !== undefined || p.version === 2 && p.design === undefined)
        throw new Error("Design inputs require a version 2 plan with an explicit design declaration");
    const intent = text(p.intent, "intent"), name = text(p.name, "name");
    const repository = record(p.repository, "repository", ["url", "commit"]);
    const url = text(repository.url, "repository.url"), commit = text(repository.commit, "repository.commit");
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit))
        throw new Error("repository.commit must be a full immutable Git object id");
    // Version 4 exists only to name a local-only source, and no other version can.
    if (p.version === 4) {
        if (!LOCAL_SOURCE_URL.test(url))
            throw new Error("A version 4 plan names a local-only source: repository.url must be local:// followed by the 40-character root commit of its history. Hosted sources use plan version 1, 2 or 3.");
    }
    else {
        let parsed: URL;
        try {
            parsed = new URL(url);
        }
        catch {
            throw new Error("repository.url must be an explicit HTTPS or SSH URL, never a host filesystem path");
        }
        if (!["https:", "ssh:"].includes(parsed.protocol) || parsed.password || (parsed.protocol === "https:" && parsed.username) || parsed.search || parsed.hash)
            throw new Error("Repository clone URLs cannot embed credentials or use local/file transports");
    }
    const agents = record(p.agents, "agents", ["worker", "judge", "planner"]), env = record(p.environment, "environment", ["context", "tools", "setup", "baseline", "writable_directories"]);
    const scope = record(p.scope, "scope", ["writable"]), writable = paths(scope.writable, "scope.writable");
    if (!writable.length)
        throw new Error("scope.writable must explicitly name a bounded change scope");
    const contract = acceptance(p.acceptance, intent, p.version);
    const writableDirectories = parseWritableDirectories(env.writable_directories ?? [], contract.protected_paths);
    const design = p.design !== undefined ? designDeclaration(p.design, contract, writableDirectories) : undefined;
    const loop: LoopPolicy | undefined = p.version >= 3 ? (() => { const value = p.loop === undefined ? { repeatCandidate: "stop", repeatedOutcomeWarning: 3 } : record(p.loop, "loop policy", ["repeatCandidate", "repeatedOutcomeWarning"]); if (value.repeatCandidate !== "stop") throw new Error("Exact repeated unsuccessful candidates must stop; loop policy cannot grant delivery"); return { repeatCandidate: "stop", repeatedOutcomeWarning: integer(value.repeatedOutcomeWarning, "loop.repeatedOutcomeWarning", 2, 64) }; })() : undefined;
    const playbook: PlaybookSelection | undefined = p.playbook === undefined ? undefined : (() => {
        const value = record(p.playbook, "playbook selection", ["path", "sha256", "taskFamily", "adoption"]), path = repoPath(value.path);
        if (path === "." || path.length > 512 || !path.endsWith(".json") || !/^[a-f0-9]{64}$/.test(value.sha256 ?? "")) throw new Error("Playbook requires one bounded exact JSON source path and its SHA256");
        if (writableDirectories.some(base => path === base || path.startsWith(base + "/"))) throw new Error("Playbook cannot be stored in a writable output directory");
        const taskFamily = identifier(value.taskFamily, "playbook task family"), adoption = value.adoption === undefined ? undefined : validatePlaybookAdoption(value.adoption);
        if (adoption && (adoption.repository !== url || adoption.taskFamily !== taskFamily || adoption.selectedDigest !== value.sha256)) throw new Error("Playbook adoption belongs to another repository, task family or selected digest");
        return { path, sha256: value.sha256, taskFamily, ...(adoption ? { adoption } : {}) };
    })();
    if (design) contract.protected_paths = [...new Set([...contract.protected_paths, design.snapshotPath])].sort();
    const approachAdoption = p.approachAdoption === undefined ? undefined : validatePlaybookAdoption(p.approachAdoption);
    if (approachAdoption && (playbook || approachAdoption.repository !== url || approachAdoption.action !== "rollback" || approachAdoption.selectedDigest !== null || approachAdoption.previousDigest === null)) throw new Error("A no-playbook adoption must be an exact rollback for this repository without a selected playbook");
    if (playbook) contract.protected_paths = [...new Set([...contract.protected_paths, playbook.path])].sort();
    if (design && paths(env.context, "environment.context").includes(design.snapshotPath)) throw new Error("Design snapshots use their dedicated pinned reference channel, not the general text context list");
    if (playbook && paths(env.context, "environment.context").includes(playbook.path)) throw new Error("Worker playbooks use their dedicated role context, never shared planner/judge context");
    if (playbook && design?.snapshotPath === playbook.path) throw new Error("Design snapshot and worker playbook must be distinct source artifacts");
    const normalized: Omit<ExecutionPlan, "plan_sha256"> = {
        schema_version: `wringer.execution-plan.v${p.version}` as ExecutionPlan["schema_version"], name, intent, intent_sha256: hashBytes(intent), repository: { url, commit }, runtime: runtime(p.runtime),
        agents: { worker: agent(agents.worker), judge: agent(agents.judge), ...(agents.planner === undefined ? {} : { planner: agent(agents.planner) }) },
        environment: { context: paths(env.context, "environment.context"), tools: distinct(list(env.tools, "environment.tools", v => { const t = record(v, "tool", ["name", "version", "probe"]); return { name: identifier(t.name, "tool.name"), version: text(t.version, "tool.version"), probe: argv(t.probe) }; }), t => t.name, "tools").sort((a, b) => a.name.localeCompare(b.name)), setup: distinct(list(env.setup, "environment.setup", command), c => c.id, "setup commands"), baseline: distinct(list(env.baseline, "environment.baseline", command), c => c.id, "baseline commands"), writable_directories: parseWritableDirectories(env.writable_directories ?? [], contract.protected_paths) },
        scope: { writable }, acceptance: contract, acceptance_sha256: hashValue(design ? { acceptance: contract, design } : contract), budget: readBudget(p.budget), ...(design ? { design } : {}), ...(loop ? { loop } : {}), ...(playbook ? { playbook } : {}), ...(approachAdoption ? { approachAdoption } : {}),
    };
    for (const role of Object.values(normalized.agents))
        for (const name of role.env ?? [])
            if (!normalized.runtime.env?.includes(name))
                throw new Error(`Agent environment ${name} is outside the declared runtime environment allowance`);
    if (normalized.agents.planner && normalized.budget.max_planner_turns === 0)
        throw new Error("A declared planner needs a nonzero bounded planner-turn allowance");
    const wire = canonicalJson(normalized);
    const credentialEnvironment = options.credentialEnvironment ?? process.env;
    const secrets = (normalized.runtime.env ?? []).map(name => credentialEnvironment[name]).filter((v): v is string => !!v);
    if (new Redactor(undefined, credentialEnvironment, secrets).scrub(wire) !== wire)
        throw new Error("Plan contains a detected credential. Remove secret values and declare environment-variable names; no plan was retained");
    return freezeData({ ...normalized, plan_sha256: hashValue(normalized) });
}
const PLAN_VERSIONS: Record<ExecutionPlan["schema_version"], 1 | 2 | 3 | 4> = { "wringer.execution-plan.v1": 1, "wringer.execution-plan.v2": 2, "wringer.execution-plan.v3": 3, "wringer.execution-plan.v4": 4 };
/** The declaration version a canonical plan recompiles from. Every site that
 * re-derives a plan asks here, so a new version cannot be missed at one of them. */
export function planVersion(plan: { readonly schema_version?: unknown }): 1 | 2 | 3 | 4 {
    if (typeof plan.schema_version !== "string" || !Object.hasOwn(PLAN_VERSIONS, plan.schema_version))
        throw new Error("Unsupported canonical execution-plan version");
    return PLAN_VERSIONS[plan.schema_version as ExecutionPlan["schema_version"]];
}
export function validateExecutionPlan(value: unknown, options: PlanValidationOptions = {}): ExecutionPlan {
    canonicalJson(value);
    const p = record(value, "execution plan", ["schema_version", "name", "intent", "intent_sha256", "repository", "runtime", "agents", "environment", "scope", "acceptance", "acceptance_sha256", "budget", "plan_sha256", "design", "loop", "playbook", "approachAdoption"]);
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = p;
    const plan = compileDeclaration({ version: planVersion(p), ...declaration }, options);
    if (canonicalJson(plan) !== canonicalJson(p))
        throw new Error("Canonical plan content or digest changed; approve a new plan explicitly");
    return plan;
}
export function compileExecutionPlan(source: string, options: {
    format: "yaml" | "typescript";
    sourceName?: string;
}): ExecutionPlan {
    if (Buffer.byteLength(source) > 1024 * 1024)
        throw new Error("Plan source exceeds 1 MiB");
    const value = options.format === "typescript" ? parsePlanTypeScript(source, options.sourceName) : parseYaml(source, options.sourceName ?? "execution plan");
    // Proposals are frozen canonical records, not a second declaration format.
    // Revalidate their complete digests; never strip hashes to accept tampering.
    if (value && typeof value === "object" && !Array.isArray(value) && "schema_version" in value)
        return validateExecutionPlan(value);
    return compileDeclaration(value);
}
export async function loadExecutionPlan(path: string): Promise<ExecutionPlan> {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024 * 1024)
        throw new Error("Plan must be a bounded regular file, not a symlink");
    return compileExecutionPlan(await readFile(path, "utf8"), { format: path.endsWith(".ts") ? "typescript" : "yaml", sourceName: path });
}
export const canonicalPlanJson = (plan: ExecutionPlan) => canonicalJson(validateExecutionPlan(plan)) + "\n";
export const executionPlanDigest = (plan: ExecutionPlan) => validateExecutionPlan(plan).plan_sha256;
export function validateExecutionAuthority(value: unknown, plan: ExecutionPlan, at = new Date(), options: PlanValidationOptions = {}): ExecutionAuthority {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
        throw new Error("Authority validation requires a finite observation time");
    const credentialEnvironment = options.credentialEnvironment ?? process.env;
    const authorityWire = canonicalJson(value), secrets = (plan.runtime.env ?? []).map(name => credentialEnvironment[name]).filter((v): v is string => !!v);
    if (new Redactor(undefined, credentialEnvironment, secrets).scrub(authorityWire) !== authorityWire)
        throw new Error("Authority contains a detected credential; values belong only in the runtime secret channel");
    const a = record(value, "execution authority", ["schema_version", "actor", "repository", "plan_sha256", "acceptance_sha256", "actions", "budget", "granted_at", "expires_at"]);
    if (sourceFamily(plan) === "hosted" && a.schema_version !== RECORD_FAMILIES.authority.hosted && a.schema_version !== RECORD_FAMILIES.authority.local)
        throw new Error("Explicit controller-owned execution authority v1 is required; legacy routine authority does not authorize this plan");
    assertRecordFamily(plan, "authority", a.schema_version);
    if (a.plan_sha256 !== plan.plan_sha256 || a.acceptance_sha256 !== plan.acceptance_sha256 || canonicalJson(a.repository) !== canonicalJson(plan.repository))
        throw new Error("Authority is bound to a different plan, acceptance contract or source revision");
    const actions = distinct(list(a.actions, "authority.actions", v => {
        const s = text(v, "authority action");
        if (!["plan", "build", "verify", "judge", "deliver"].includes(s))
            throw new Error(`Unsupported authority action ${s}; human judgement is never delegated`);
        return s as ExecutionAuthority["actions"][number];
    }), s => s, "authority actions").sort();
    const budget = readBudget(a.budget);
    for (const key of Object.keys(budget) as (keyof ExecutionBudget)[])
        if (budget[key] > plan.budget[key])
            throw new Error(`Authority ${key} exceeds the frozen plan ceiling`);
    const granted_at = text(a.granted_at, "authority.granted_at"), expires_at = text(a.expires_at, "authority.expires_at");
    if (!Number.isFinite(Date.parse(granted_at)) || !Number.isFinite(Date.parse(expires_at)) || Date.parse(granted_at) > at.getTime() || Date.parse(expires_at) <= at.getTime() || Date.parse(expires_at) <= Date.parse(granted_at))
        throw new Error("Authority is not currently valid");
    return freezeData({ schema_version: a.schema_version as ExecutionAuthority["schema_version"], actor: text(a.actor, "authority.actor"), repository: plan.repository, plan_sha256: plan.plan_sha256, acceptance_sha256: plan.acceptance_sha256, actions, budget, granted_at, expires_at });
}
export function createExecutionAuthority(plan: ExecutionPlan, options: {
    actor: string;
    actions: ExecutionAuthority["actions"];
    expiresAt: string;
    budget?: ExecutionBudget;
    at?: Date;
}): ExecutionAuthority {
    // Minting is the approval act. Until the whole local journey is proven, no authority is minted for a local-only source.
    if (sourceFamily(plan) === "local")
        throw new Error("Approval of a local-only source is not open yet: its records are versioned, but the whole local journey has not been proven end to end. Nothing was approved or started.");
    const at = options.at ?? new Date();
    return validateExecutionAuthority({ schema_version: recordVersion(plan, "authority"), actor: options.actor, repository: plan.repository, plan_sha256: plan.plan_sha256, acceptance_sha256: plan.acceptance_sha256, actions: options.actions, budget: options.budget ?? plan.budget, granted_at: at.toISOString(), expires_at: options.expiresAt }, plan, at);
}
