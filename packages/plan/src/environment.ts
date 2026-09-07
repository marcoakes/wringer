import { resolve } from "node:path";
import { Redactor } from "@wringer/engine";
import { freezeData, hashBytes, hashValue } from "./canonical";
import { validateExecutionPlan } from "./compile";
import type { EnvironmentMap, EnvironmentObservation, ExecutionPlan } from "./types";
async function git(repo: string, args: string[]): Promise<string> {
    const child = Bun.spawn(["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: repo, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0)
        throw new Error(`Cannot read repository identity: ${new Redactor().scrub(stderr).slice(0, 2000)}`);
    if (Buffer.byteLength(stdout) > 32 * 1024 * 1024)
        throw new Error("Repository inventory exceeds the bounded environment-map size");
    return stdout;
}
async function cleanSource(repo: string, commit: string) {
    if ((await git(repo, ["rev-parse", "--is-bare-repository"])).trim() === "true") {
        if ((await git(repo, ["rev-parse", "--verify", `${commit}^{commit}`])).trim() !== commit)
            throw new Error("Bare source store does not contain the plan's exact commit");
        return;
    }
    const head = (await git(repo, ["rev-parse", "--verify", "HEAD"])).trim();
    if (head !== commit)
        throw new Error("Environment map requires the plan's exact committed source revision; choose the intended commit explicitly");
    if ((await git(repo, ["status", "--porcelain=v1", "--untracked-files=normal"])).trim())
        throw new Error("Environment map requires a clean source checkout; uncommitted inputs cannot silently enter a pinned plan");
}
/** Reads Git objects only. Declared repo tools/setup/baselines are never run on the controller. */
export async function discoverEnvironment(repo: string, rawPlan: ExecutionPlan, options: {
    observations?: EnvironmentObservation[];
} = {}): Promise<EnvironmentMap> {
    repo = resolve(repo);
    const plan = validateExecutionPlan(rawPlan);
    const redactor = new Redactor(undefined, process.env, (plan.runtime.env ?? []).map(name => process.env[name]).filter((v): v is string => !!v));
    await cleanSource(repo, plan.repository.commit);
    const tree = (await git(repo, ["rev-parse", `${plan.repository.commit}^{tree}`])).trim();
    const listing = await git(repo, ["ls-tree", "-rz", "--full-tree", plan.repository.commit]);
    const files = listing.split("\0").filter(Boolean).map(row => { const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(row); if (!match)
        throw new Error("Unrecognized Git tree entry"); return { path: match[4]!, mode: match[1]!, blob: match[3]! }; }).sort((a, b) => a.path.localeCompare(b.path));
    if (files.length > 100000)
        throw new Error("Repository has more than 100,000 source entries; explicitly scope or split it");
    for (const path of plan.acceptance.checks.flatMap(c => c.files))
        if (!files.some(f => f.path === path && ["100644", "100755"].includes(f.mode)))
            throw new Error(`Pinned acceptance input ${path} is absent or not a regular source file`);
    const automatic = ["AGENTS.md", "README.md", "ARCHITECTURE.md", "CODEOWNERS", ".github/CODEOWNERS", "package.json", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "Cargo.toml", "Cargo.lock", "go.mod", "go.sum"];
    const requested = [...new Set([...plan.environment.context, ...automatic.filter(path => files.some(f => f.path === path))])].sort();
    const context: EnvironmentMap["context"] = [];
    for (const path of requested) {
        const file = files.find(f => f.path === path);
        if (!file)
            throw new Error(`Declared context ${path} is absent from the pinned source`);
        if (!["100644", "100755"].includes(file.mode))
            throw new Error(`Context ${path} is not a regular source blob; symbolic links/submodules are not followed`);
        const content = await git(repo, ["cat-file", "blob", file.blob]);
        if (content.includes("\0") || Buffer.byteLength(content) > 1024 * 1024)
            throw new Error(`Context ${path} is binary or exceeds 1 MiB; no partial map is claimed complete`);
        if (redactor.scrub(content) !== content)
            throw new Error(`Context ${path} contains a detected credential; remove it before capture`);
        context.push({ path, blob: file.blob, text: content, sha256: hashBytes(content) });
    }
    const observations = options.observations ?? [];
    if (new Set(observations.map(o => `${o.kind}:${o.id}`)).size !== observations.length)
        throw new Error("Duplicate environment observations");
    const observation = (kind: EnvironmentObservation["kind"], id: string, command: unknown) => {
        const row = observations.find(o => o.kind === kind && o.id === id);
        if (!row)
            return null;
        if (row.source_commit !== plan.repository.commit || row.image !== plan.runtime.image || !row.runtime_id || row.command_sha256 !== hashValue(command))
            throw new Error(`Environment observation ${id} is not bound to the declared source/image/command`);
        if (!["passed", "failed", "unavailable"].includes(row.status) || !((row.exit_code === null && row.status === "unavailable") || (Number.isInteger(row.exit_code) && ((row.status === "passed") === (row.exit_code === 0)))))
            throw new Error(`Contradictory environment observation ${id}`);
        return redactor.deep(row);
    };
    for (const row of observations)
        if (!(row.kind === "tool" && plan.environment.tools.some(t => t.name === row.id)) && !(row.kind === "baseline" && plan.environment.baseline.some(t => t.id === row.id)))
            throw new Error(`Unknown environment observation ${row.kind}:${row.id}`);
    const counts = new Map<string, number>();
    for (const f of files) {
        const component = f.path.includes("/") ? f.path.split("/")[0]! : ".";
        counts.set(component, (counts.get(component) ?? 0) + 1);
    }
    const data: Omit<EnvironmentMap, "map_sha256"> = { schema_version: "wringer.environment-map.v1", repository: plan.repository, plan_sha256: plan.plan_sha256, source_tree: tree, inventory_sha256: hashValue(files), files, context, components: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([path, files]) => ({ path, files })), tools: plan.environment.tools.map(t => ({ ...t, observation: observation("tool", t.name, t.probe) })), baseline: plan.environment.baseline.map(declaration => ({ declaration, observation: observation("baseline", declaration.id, declaration) })), protected_paths: plan.acceptance.protected_paths, writable_paths: plan.scope.writable, limits: ["Repository context is source-linked, not a claim that a model understood it.", "Null observations mean not measured. No repository tool, baseline or setup command was executed on the host to build this map.", "Check files and declared dependency inputs are pinned; unlisted transitive dependencies are not inferred.", "Baseline observations are accepted only from the injected controller supervisor, never parsed from agent prose."] };
    if (redactor.scrub(JSON.stringify(data)) !== JSON.stringify(data))
        throw new Error("Environment inventory contains a detected credential; no altered source map was retained");
    await cleanSource(repo, plan.repository.commit);
    return freezeData({ ...data, map_sha256: hashValue(data) });
}
export async function assertEnvironmentFresh(repo: string, map: EnvironmentMap): Promise<void> {
    const { map_sha256, ...data } = map;
    if (map.schema_version !== "wringer.environment-map.v1" || hashValue(data) !== map_sha256 || hashValue(map.files) !== map.inventory_sha256)
        throw new Error("Environment map contents or digest changed");
    await cleanSource(resolve(repo), map.repository.commit);
    const tree = (await git(repo, ["rev-parse", `${map.repository.commit}^{tree}`])).trim();
    if (tree !== map.source_tree)
        throw new Error("Environment map source tree is stale");
}

/** Incorporate controller observations without re-reading or executing repository code. */
export function ingestEnvironmentObservations(map: EnvironmentMap, rawPlan: ExecutionPlan, observations: EnvironmentObservation[]): EnvironmentMap {
    const plan = validateExecutionPlan(rawPlan), { map_sha256, ...data } = map;
    if (map_sha256 !== hashValue(data) || map.inventory_sha256 !== hashValue(map.files) || map.plan_sha256 !== plan.plan_sha256 || hashValue(map.repository) !== hashValue(plan.repository))
        throw new Error("Observations cannot update an altered or stale environment map");
    if (hashValue(map.tools.map(({ observation, ...tool }) => tool)) !== hashValue(plan.environment.tools) || hashValue(map.baseline.map(row => row.declaration)) !== hashValue(plan.environment.baseline) || hashValue(map.protected_paths) !== hashValue(plan.acceptance.protected_paths) || hashValue(map.writable_paths) !== hashValue(plan.scope.writable))
        throw new Error("Environment declarations differ from the approved tool, baseline or scope policy");
    if (!Array.isArray(observations) || observations.length > 4096 || new Set(observations.map(o => `${o.kind}:${o.id}`)).size !== observations.length)
        throw new Error("Environment observations must have bounded unique identities");
    const redactor = new Redactor(undefined, process.env, (plan.runtime.env ?? []).map(name => process.env[name]).filter((v): v is string => !!v));
    const index = new Map<string, EnvironmentObservation>();
    if (redactor.scrub(JSON.stringify(data)) !== JSON.stringify(data))
        throw new Error("Environment map contains a detected credential; no altered map was retained");
    for (const row of observations) {
        const declaration = row.kind === "tool" ? plan.environment.tools.find(t => t.name === row.id)?.probe : row.kind === "baseline" ? plan.environment.baseline.find(c => c.id === row.id) : undefined;
        if (!declaration || row.command_sha256 !== hashValue(declaration) || row.source_commit !== plan.repository.commit || row.image !== plan.runtime.image || typeof row.runtime_id !== "string" || !row.runtime_id.trim() || typeof row.output !== "string" || Buffer.byteLength(row.output) > 1024 * 1024)
            throw new Error("Environment observation lacks exact source, command, runtime or bounded output identity");
        if (!["passed", "failed", "unavailable"].includes(row.status) || (row.status === "unavailable" ? row.exit_code !== null : !Number.isInteger(row.exit_code) || (row.status === "passed") !== (row.exit_code === 0)) || (row.status === "failed" && [124, 126, 127, 137, 143].includes(row.exit_code!)))
            throw new Error("Environment observation status contradicts measured command availability");
        index.set(`${row.kind}:${row.id}`, redactor.deep(row));
    }
    const updated = { ...data, tools: map.tools.map(t => ({ ...t, observation: index.get(`tool:${t.name}`) ?? t.observation })), baseline: map.baseline.map(b => ({ ...b, observation: index.get(`baseline:${b.declaration.id}`) ?? b.observation })) };
    return freezeData({ ...updated, map_sha256: hashValue(updated) });
}

/** Probe success and declared-version agreement are distinct facts. */
export function environmentReadiness(map: EnvironmentMap, plan: ExecutionPlan) {
    ingestEnvironmentObservations(map, plan, [...map.tools.flatMap(t => t.observation ? [t.observation] : []), ...map.baseline.flatMap(b => b.observation ? [b.observation] : [])]);
    const tools = map.tools.map(t => ({ name: t.name, declaredVersion: t.version, observedVersion: t.observation?.output.trim() ?? null, status: !t.observation ? "unmeasured" : t.observation.status !== "passed" ? "unavailable" : t.observation.output.trim() !== t.version ? "mismatch" : "ready" }));
    return { ready: tools.every(t => t.status === "ready"), tools, baseline: map.baseline.map(b => ({ id: b.declaration.id, status: b.observation?.status ?? "unmeasured" })), limits: ["Version agreement compares the complete trimmed probe output with the declared version, not an inferred semver range.", "Baseline failures remain measured failures; they are not a successful test result."] };
}
