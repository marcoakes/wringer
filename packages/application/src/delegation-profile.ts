import { withMaintenanceLock } from "./maintenance";
import { lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { checkIdentity, git, init, loadConfig, parseConfig, Redactor } from "@wringer/engine";
import { canonicalPlanJson, compileDeclaration, hashBytes, hashValue, type AcceptanceCriterion, type ExecutionBudget } from "@wringer/plan";
import { createLocalSourceBundle, parseRuntimePolicy, parseWorkerScope, type NetworkPolicy } from "@wringer/runtime";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { localSourceSiblings, verifyLocalSource } from "./assistant-local-source";
import { readRuntimeReadiness } from "./runtime-readiness";
import { safeWorkspaceSnapshot } from "./workspaces";
import { ACCEPTANCE_ADAPTER, readAcceptancePreparation } from "./acceptance-preparation";
export interface RoleChoice { provider: "openai" | "anthropic"; model: string }
export interface DelegationSelection {
    provisionId: string; readinessId?: string; acceptanceId?: string; worker: RoleChoice; judge: RoleChoice;
    source: { kind: "local" } | { kind: "remote"; remote: string };
    dependencies: "none" | "bun-frozen"; network: NetworkPolicy;
    writable?: string[]; outputDirectories?: string[]; gates?: string[];
    budget?: Partial<ExecutionBudget>;
}
const ceilings: ExecutionBudget = { max_sessions: 8, max_worker_turns: 4, max_judge_turns: 4, max_planner_turns: 0, wall_clock_seconds: 3600, session_timeout_seconds: 900 };
function role(choice: RoleChoice) {
    if (!choice || Object.keys(choice).some(key => !["provider", "model"].includes(key)) || !["openai", "anthropic"].includes(choice.provider) || typeof choice.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,159}$/.test(choice.model)) throw new Error("Choose an explicit provider and exact model for each role");
    return { protocol: "acp" as const, command: "bun", args: ["/opt/wringer-agents/model-launch.ts", choice.provider, choice.model], env: [choice.provider === "openai" ? "CODEX_API_KEY" : "ANTHROPIC_API_KEY"], ...(choice.provider === "openai" ? { authMethod: "api-key" } : {}) };
}
/** Reads manifests, tracked bytes and Git metadata only. No check, setup command,
 * source bundle, credential retrieval, runtime allocation or durable write. */
export async function inspectDelegationProfile(root: string, repoPath: string, selection: DelegationSelection) {
    if (!selection || Object.keys(selection).some(key => !["provisionId", "readinessId", "acceptanceId", "worker", "judge", "source", "dependencies", "network", "writable", "outputDirectories", "gates", "budget"].includes(key))) throw new Error("Unknown contained setup selection");
    const agents = { worker: role(selection.worker), judge: role(selection.judge) }, originalRepo = await realpath(repoPath);
    let repo = originalRepo;
    const distance = relative(repo, resolve(root));
    if (!distance || distance !== ".." && !distance.startsWith(`..${sep}`) && !distance.startsWith(sep)) throw new Error("Application state must stay outside the target repository");
    let source = await safeWorkspaceSnapshot(repo);
    const originalSource = source;
    if (source.root !== repo) throw new Error("Select the actual Git repository root for a contained profile");
    if (!source.head_sha || source.dirty) throw new Error("Contained setup needs a committed source. Preserve uncommitted work and explicitly prepare the intended baseline; Wringer will not commit, stash or reset it");
    const prepared = selection.acceptanceId ? await readAcceptancePreparation(root, selection.acceptanceId, repo) : null;
    if (prepared) {
        if (prepared.baseCommit !== source.head_sha) throw new Error("Acceptance preparation belongs to an older source. Review fresh tests against the new committed baseline before creating another job");
        if (selection.source?.kind !== "local") throw new Error("Inert acceptance preparation uses a local-only source bundle; it is never pushed during setup");
        repo = prepared.sourceRepo; source = await safeWorkspaceSnapshot(repo);
    }
    if (source.dirty || source.head_sha === null) throw new Error("The prepared source must remain clean and committed");
    const provision = await readAssistantRecord<any>(root, `provisions/${assistantId(selection.provisionId)}/result.json`);
    if (!selection.source || !["local", "remote"].includes(selection.source.kind)) throw new Error("Explicitly choose local-only bundle or a named remote source");
    const files = (await git(repo, ["ls-tree", "-r", "-z", "--name-only", source.head_sha])).stdout.split("\0").filter(Boolean), tracked = new Set(files);
    if (files.length > 20000) throw new Error("This guided profile supports at most 20,000 tracked paths; select a separately reviewed bounded source");
    let url: string;
    if (selection.source.kind === "local") {
        const roots = (await git(repo, ["rev-list", "--max-parents=0", source.head_sha])).stdout.trim().split("\n");
        if (roots.length !== 1 || !/^[a-f0-9]{40}$/.test(roots[0]!)) throw new Error("A local-only bundle needs a single-root history; choose a reviewed named remote for a multiple-root source");
        url = `local://${roots[0]}`;
    } else {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(selection.source.remote)) throw new Error("Select an existing Git remote name");
        url = (await git(repo, ["remote", "get-url", selection.source.remote])).stdout.trim();
    }
    const discovered = await init(repo, { dryRun: true });
    if (discovered.template_only && !prepared) throw new Error("No meaningful checks were discovered. Prepare explicit acceptance checks before contained setup");
    const config = discovered.status === "existing" ? await loadConfig(repo) : parseConfig({ version: 1, gates: discovered.template_only ? prepared!.preview.gates : discovered.gates });
    if (prepared && !discovered.template_only) {
        for (const gate of prepared.preview.gates) {
            const existing = config.gates.find(row => row.id === gate.id);
            if (existing && hashValue(existing) !== hashValue(gate)) throw new Error("Existing check definitions are not replaced; use a distinct new check ID");
            if (!existing) config.gates.push(gate);
        }
    }
    if (config.requires.length || config.services.length || config.phases.length || config.teardown.length || config.setup.length) throw new Error("This check configuration needs explicit contained service/setup adaptation. Guided setup will not drop its prerequisites or execute them on the host");
    const selected = selection.gates ?? config.gates.filter(gate => !gate.optional).map(gate => gate.id);
    if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !config.gates.some(gate => gate.id === id))) throw new Error("Select existing distinct check identifiers");
    const criteria: AcceptanceCriterion[] = [], checks = [], inputs = new Set<string>();
    for (const id of selected) {
        const gate = config.gates.find(row => row.id === id)!, identity = await checkIdentity(repo, gate);
        const checkFiles = [...new Set([...Object.keys(identity.files), ...Object.keys(identity.inputs)])].sort();
        if (!checkFiles.length || checkFiles.some(path => !tracked.has(path))) throw new Error(`Check ${id} needs declared, committed input files before approval; script names alone do not establish its dependencies`);
        if (gate.evidence && (!prepared || !tracked.has(ACCEPTANCE_ADAPTER))) throw new Error(`Check ${id} uses a standalone assertion adapter. Prepare a reviewed contained wringer-check.v1 adapter before delegation; its evidence minimum was not downgraded`);
        if (gate.evidence?.report) throw new Error(`Check ${id} uses a file reporter. Select a reviewed stdout reporter before contained preparation so stale report bytes cannot pass`);
        if (gate.evidence) checkFiles.push(ACCEPTANCE_ADAPTER);
        for (const path of checkFiles) { const info = await lstat(join(repo, path)); if (!info.isFile() || info.isSymbolicLink()) throw new Error("Acceptance inputs must be committed regular files"); inputs.add(path); }
        const requirements = prepared?.preview.gates.some(row => row.id === id) ? gate.proves : gate.evidence && gate.proves.length ? gate.proves : [id];
        for (const requirement of requirements) if (!criteria.some(row => row.id === requirement)) {
            const authored = prepared?.preview.input.requirements.find(row => row.id === requirement);
            criteria.push({ id: requirement, title: authored?.title ?? `Existing check: ${id}`, quote: authored?.quote ?? `Run the existing ${id} check successfully.`, kind: "check", required: true });
        }
        const argv = gate.evidence ? ["bun", "--no-env-file", "--no-install", "--no-macros", "--config=/dev/null", ACCEPTANCE_ADAPTER, JSON.stringify({ adapter: gate.evidence.adapter, command: gate.run, requirements, timeout: gate.timeout })] : ["/bin/sh", "-c", gate.run];
        checks.push({ id, argv, cwd: ".", timeout_seconds: gate.timeout + (gate.evidence ? gate.evidence.adapter === "playwright" ? 25 : 5 : 0), files: [...new Set(checkFiles)], criteria: requirements, ...(gate.evidence ? { evidence: { kind: "assertions", format: "wringer-check.v1" } } : {}) });
    }
    if (tracked.has(".wringer.yaml")) inputs.add(".wringer.yaml");
    if (prepared) for (const file of prepared.preview.files) inputs.add(file.path);
    const protectedPaths = [...inputs].sort();
    const proposedScope = ["src", "app", "lib"].filter(dir => files.some(path => path.startsWith(dir + "/")) && !protectedPaths.some(path => path === dir || path.startsWith(dir + "/")));
    const writable = selection.writable ?? proposedScope;
    if (!writable.length || writable.includes(".")) throw new Error("Choose specific existing writable source paths. Guided setup does not widen scope to the entire repository");
    for (const path of writable) if (!files.some(file => file === path || file.startsWith(path + "/"))) throw new Error(`Writable path ${path} is absent from committed source; prepare it explicitly first`);
    const outputs = selection.outputDirectories ?? (selection.dependencies === "bun-frozen" ? ["node_modules"] : []);
    if (outputs.some(path => files.some(file => file === path || file.startsWith(path + "/")))) throw new Error("Output directories must be empty/untracked and separate from delivered source");
    const scope = parseWorkerScope({ writable, protected: protectedPaths, writableDirectories: outputs });
    if (!["none", "bun-frozen"].includes(selection.dependencies)) throw new Error("Select dependency preparation explicitly");
    if (selection.dependencies === "bun-frozen" && (!tracked.has("bun.lock") || !outputs.includes("node_modules"))) throw new Error("Frozen Bun preparation needs a committed bun.lock and an explicitly writable node_modules directory");
    let packageRequirements: unknown = null;
    if (tracked.has("package.json")) {
        const bytes = await readFile(join(repo, "package.json")); if (bytes.length > 1024 ** 2) throw new Error("Project package manifest exceeds its inspection bound");
        const manifest = JSON.parse(bytes.toString()); packageRequirements = { packageManager: manifest.packageManager ?? null, engines: manifest.engines ?? {}, dependencyCount: Object.keys(manifest.dependencies ?? {}).length + Object.keys(manifest.devDependencies ?? {}).length };
    }
    if (!["wringer.runtime-provisioned.v1", "wringer.gvisor-provisioned.v1"].includes(provision.schema_version) || provision.id !== selection.provisionId) throw new Error("Select a completed contained runtime provision");
    const readiness = selection.readinessId ? await readRuntimeReadiness(root, selection.provisionId, selection.readinessId, provision.image) : null;
    const inventory = readiness?.inventory ?? provision.inventory;
    if (!/^24\.[0-9]+\.[0-9]+$/.test(inventory?.node) || inventory?.bun !== "1.4.2") throw new Error("This profile needs an observed Node 24/Bun 1.4.2 image inventory. Complete wring runtime measure and select its --readiness ID first");
    const env = [...new Set(Object.values(agents).flatMap(agent => agent.env))].sort();
    let runtimeSelection: Record<string, unknown> = { kind: "apple-container" };
    if (provision.schema_version === "wringer.gvisor-provisioned.v1") {
        const { plan: installation } = await readAssistantRecord<any>(root, `provisions/${selection.provisionId}/plan.json`);
        if (installation.sha256 !== provision.planSha256 || installation.context !== provision.context || installation.namespace !== provision.namespace || installation.runtimeClass !== provision.runtimeClass) throw new Error("The selected cluster installation changed");
        const secretRefs = Object.fromEntries(env.map(name => [name, installation.secretReferences[name]]));
        if (Object.values(secretRefs).some(value => !value)) throw new Error("Each selected role needs an explicit Secret reference in this provisioned namespace");
        runtimeSelection = { kind: "gvisor-kubernetes", context: provision.context, namespace: provision.namespace, runtimeClass: provision.runtimeClass, secretRefs };
        if (readiness?.report.runtime?.kind !== "gvisor-kubernetes" || readiness.report.runtime.context !== provision.context || readiness.report.runtime.namespace !== provision.namespace || readiness.report.runtime.runtimeClass !== provision.runtimeClass) throw new Error("Runtime readiness was measured in another cluster boundary");
    }
    const runtime = parseRuntimePolicy({ ...runtimeSelection, image: provision.image, cpus: 2, memoryMiB: 2048, network: selection.network, env });
    const budget = { ...ceilings, ...selection.budget };
    for (const [key, value] of Object.entries(budget)) if (!(key in ceilings) || value > ceilings[key as keyof ExecutionBudget]) throw new Error("Requested budgets exceed this catalogue's finite ceilings");
    const intent = criteria.map(row => row.quote).join("\n");
    const plan = compileDeclaration({ version: selection.source.kind === "local" ? 4 : 3, name: "Reviewed repository check profile", intent, repository: { url, commit: source.head_sha }, runtime, agents, environment: { context: ["README.md", "package.json"].filter(path => tracked.has(path)), tools: [{ name: "bun", version: inventory.bun, probe: ["bun", "--version"] }, { name: "node", version: inventory.node, probe: ["node", "-p", "process.versions.node"] }], setup: selection.dependencies === "bun-frozen" ? [{ id: "dependencies", argv: ["bun", "install", "--frozen-lockfile", "--ignore-scripts"], cwd: ".", timeout_seconds: 300 }] : [], baseline: [], writable_directories: outputs }, scope: { writable: scope.writable }, acceptance: { criteria, checks, protected_paths: protectedPaths }, budget, loop: { repeatCandidate: "stop", repeatedOutcomeWarning: 2 } });
    const after = await safeWorkspaceSnapshot(repo);
    if (after.fingerprint !== source.fingerprint || after.head_sha !== source.head_sha || after.dirty) throw new Error("Source changed during setup inspection; review a fresh proposal");
    if (prepared && (await safeWorkspaceSnapshot(originalRepo)).fingerprint !== originalSource.fingerprint) throw new Error("Original source changed during prepared profile inspection");
    const safe = new Redactor(); if (safe.scrub(JSON.stringify({ plan, packageRequirements })) !== JSON.stringify({ plan, packageRequirements })) throw new Error("A detected credential was refused from the setup proposal");
    const identity = hashValue({ repo: originalRepo, selection, plan });
    return { schema_version: "wringer.delegation-profile-preview.v1", identity, repo: originalRepo, sourceRepo: repo, selection, plan, packageRequirements, source: { commit: source.head_sha, fingerprint: source.fingerprint, transport: selection.source.kind, bundleLimitBytes: 64 * 1024 ** 2, remoteCommitAvailable: "unmeasured" }, authority: "none", readiness: { imageInventory: "observed", containment: readiness ? "measured-with-stated-limits" : "unmeasured", providerAcceptance: "unmeasured" }, eligibility: { productAcceptance: "needs-job-requirements" }, limits: ["This reusable profile records existing check behavior, not proof of a new product requirement. A job needs original words, requirement/check mappings and supported human displays before approval.", "Declared check inputs are measured; transitive dependencies are not inferred from script names. Review this coverage.", "No source bundle, setup command, check, key retrieval, runtime allocation or model prompt occurred.", "Acceptance and policy paths plus their parents remain read-only. New tests require a separately reviewed inert preparation step."] };
}
type Preview = Awaited<ReturnType<typeof inspectDelegationProfile>>;
/** Explicit setup only: source transport is Git objects, never a checkout or
 * repository command. This does not approve a job or copy any login directory. */
export async function applyDelegationProfile(root: string, preview: Preview, decision: { expectedIdentity: string; actor: string; cooperativeLocal: boolean }) {
    if (decision.cooperativeLocal !== true || !decision.actor?.trim() || decision.actor.length > 200 || new Redactor().scrub(decision.actor) !== decision.actor || decision.expectedIdentity !== preview.identity) throw new Error("Review this exact setup and explicitly select its cooperative-local approval boundary");
    const current = await inspectDelegationProfile(root, preview.repo, preview.selection);
    if (current.identity !== preview.identity) throw new Error("Source or setup selections changed; review a fresh preparation");
    return withMaintenanceLock(root, async () => {
    await createAssistantDirectory(root);
    const indexPath = `profile-index/${preview.identity}.json`;
    if (!await assistantExists(root, indexPath)) await writeAssistantRecord(root, indexPath, { schema_version: "wringer.profile-registration.v1", id: crypto.randomUUID(), identity: preview.identity });
    const index = await readAssistantRecord<any>(root, indexPath), id = assistantId(index.id);
    if (index.identity !== preview.identity) throw new Error("Profile registration identity differs from this preparation");
    const prefix = `profiles/${id}`, directory = await assistantPath(root, prefix); await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = await assistantPath(directory, "preparation.lock"), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("This profile preparation has an owner or was interrupted; inspect retained outputs before recovery"); });
    try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, identity: preview.identity })); await lock.sync();
    if (await assistantExists(root, `${prefix}/profile-record.json`)) {
        const existing = await readAssistantRecord<any>(root, `${prefix}/profile-record.json`);
        if (existing.previewIdentity !== preview.identity || hashValue(existing.plan) !== hashValue(preview.plan)) throw new Error("The retained profile differs from its registration");
        if (preview.selection.source.kind === "local") await verifyLocalSource(preview.plan, localSourceSiblings(join(directory, "profile.json")));
        return existing;
    }
    const planPath = await assistantPath(directory, "profile.json"), siblings = localSourceSiblings(planPath);
    async function once(path: string, bytes: string) {
        await assistantPath(directory, path);
        const file = await open(path, "wx", 0o600).catch(async (error: NodeJS.ErrnoException) => {
            if (error.code !== "EEXIST") throw error;
            const info = await lstat(path); if (!info.isFile() || info.size !== Buffer.byteLength(bytes) || hashBytes(await readFile(path)) !== hashBytes(bytes)) throw new Error("Interrupted profile output differs; retained evidence was not replaced");
            return null;
        });
        if (file) try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    }
    await once(planPath, canonicalPlanJson(preview.plan));
    if (preview.selection.source.kind === "local") {
        if (await assistantExists(directory, "profile.json.source.bundle")) {
            await verifyLocalSource(preview.plan, siblings).catch(() => { throw new Error("Source preparation was interrupted or changed. Inspect the retained bundle; no new bundle was silently substituted"); });
        } else {
            const source = await createLocalSourceBundle(current.sourceRepo, preview.source.commit, siblings.bundle);
            await once(siblings.record, JSON.stringify({ schema_version: "wringer.local-source.v1", planSha256: preview.plan.plan_sha256, url: source.url, commit: source.commit, rootCommit: source.rootCommit, bundleSha256: source.bundleSha256, bundleBytes: source.bundleBytes }, null, 2) + "\n");
            await verifyLocalSource(preview.plan, siblings);
        }
    }
    const value = { schema_version: "wringer.delegation-profile.v1", id, previewIdentity: preview.identity, repo: preview.repo, selection: preview.selection, plan: preview.plan, source: preview.source, actor: decision.actor, createdAt: new Date().toISOString(), boundary: { approval: "cooperative-local", execution: "contained" }, executionApproved: false, productAcceptance: "needs-job-requirements" };
    await writeAssistantRecord(root, `${prefix}/profile-record.json`, value); return value;
    } finally { await lock.close(); await unlink(lockPath); }
    });
}
