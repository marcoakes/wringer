import { constants } from "node:fs";
import { link, lstat, open, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonicalPlanJson, compileDeclaration, loadExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { VERSION } from "@wringer/engine";
import { assistantExists, assistantPath, readAssistantWorkspace } from "@wringer/application";
import { quote } from "./args";

type Status = "observed" | "needs-attention" | "unmeasured";
export interface AssistantSetupCheck { id: string; status: Status; detail: string }
export interface AssistantSetupAction { id: string; label: string; command?: string; page?: string; note: string }
export interface AssistantCredentialPresence {
    name: string;
    source: "environment-name" | "keychain-entry" | "runtime-secret-reference" | "not-found" | "not-inspected" | "unavailable";
    providerValidity: "not-validated";
}
export interface AssistantSetupOptions {
    root: string;
    planPath?: string;
    cooperativeLocal: boolean;
    checkKeychain?: boolean;
    command: string[];
    signal?: AbortSignal;
}
export interface AssistantSetupDependencies {
    platform: string;
    environmentNames: ReadonlySet<string>;
    which: (name: string) => string | null;
    keychainEntry: (service: string, signal?: AbortSignal) => Promise<"present" | "absent" | "unavailable">;
}
const keychainServices: Record<string, string> = { CODEX_API_KEY: "openai-api-key", OPENAI_API_KEY: "openai-api-key", ANTHROPIC_API_KEY: "anthropic-api-key" };

/** Exit-only metadata query. No password-output flag, captured output, account edit or model call. */
export async function inspectKeychainEntry(service: string, signal?: AbortSignal): Promise<"present" | "absent" | "unavailable"> {
    if (!Object.values(keychainServices).includes(service)) throw new Error("Only the declared vendor Keychain service names can be inspected.");
    signal?.throwIfAborted();
    try {
        const child = Bun.spawn(["/usr/bin/security", "find-generic-password", "-s", service, "-a", "wringer"], {
            stdin: "ignore", stdout: "ignore", stderr: "ignore",
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
        });
        const code = await child.exited;
        return code === 0 ? "present" : code === 44 ? "absent" : "unavailable";
    } catch { signal?.throwIfAborted(); return "unavailable"; }
}

/** Inspects names/entry metadata only. Resolving actual credentials belongs to execution. */
export async function inspectAssistantCredentials(plan: ExecutionPlan, checkKeychain: boolean, deps: AssistantSetupDependencies, signal?: AbortSignal): Promise<AssistantCredentialPresence[]> {
    const result: AssistantCredentialPresence[] = [], cache = new Map<string, Awaited<ReturnType<AssistantSetupDependencies["keychainEntry"]>>>();
    for (const name of [...new Set(Object.values(plan.agents).flatMap(role => role?.env ?? []))].sort()) {
        signal?.throwIfAborted();
        let source: AssistantCredentialPresence["source"];
        if (plan.runtime.kind === "gvisor-kubernetes" && plan.runtime.secretRefs?.[name]) source = "runtime-secret-reference";
        else if (deps.environmentNames.has(name)) source = "environment-name";
        else if (!keychainServices[name] || deps.platform !== "darwin") source = "not-found";
        else if (!checkKeychain) source = "not-inspected";
        else {
            const service = keychainServices[name]!;
            if (!cache.has(service)) cache.set(service, await deps.keychainEntry(service, signal));
            const state = cache.get(service)!;
            source = state === "present" ? "keychain-entry" : state === "absent" ? "not-found" : "unavailable";
        }
        result.push({ name, source, providerValidity: "not-validated" });
    }
    return result;
}

async function boundedJson(path: string): Promise<any> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { const info = await file.stat(); if (!info.isFile() || info.size > 1024 * 1024) throw new Error("Not a bounded regular file"); return JSON.parse(await file.readFile("utf8")); }
    finally { await file.close(); }
}

export async function inspectAssistantSetup(options: AssistantSetupOptions, dependencies?: AssistantSetupDependencies) {
    const deps = dependencies ?? { platform: process.platform, environmentNames: new Set(Object.keys(process.env)), which: Bun.which, keychainEntry: inspectKeychainEntry };
    const root = resolve(options.root), command = options.command.map(quote).join(" "), checks: AssistantSetupCheck[] = [], nextActions: AssistantSetupAction[] = [];
    const add = (id: string, status: Status, detail: string) => checks.push({ id, status, detail });
    options.signal?.throwIfAborted();
    try {
        await assistantPath(root, ".");
        const info = await lstat(root);
        // Match createAssistantDirectory's admission predicate without calling
        // its mkdir/fsync path or changing the selected directory's permissions.
        const owned = info.uid === process.getuid?.(), privateDirectory = info.isDirectory() && (info.mode & 0o077) === 0 && owned;
        add("controller-directory", privateDirectory ? "observed" : "needs-attention", privateDirectory ? "The existing controller is an operator-owned private directory, matching initialization's metadata policy. No permissions or files were changed." : "Initialization would refuse this controller: it must be an operator-owned private directory (mode 0700), not a file or a shared/readable folder. Setup made no permission changes.");
        if (!privateDirectory && info.isDirectory() && owned) nextActions.push({ id: "controller-permissions", label: "Make this selected controller folder private", command: `chmod 700 ${quote(root)}`, note: "This is an explicit operator repair for this exact folder, not an action performed by setup. It changes no key or controller record. Repeat setup afterwards." });
    } catch (error: any) {
        if (error.code === "ENOENT") add("controller-directory", "unmeasured", "The controller does not exist yet. Initialization will create it privately (mode 0700); setup did not create it or its parents.");
        else add("controller-directory", "needs-attention", "The controller path could not be inspected safely, or contains a symlink. Choose an operator-controlled real directory outside the target repository. No directory was created or changed.");
    }
    add("authority-boundary", options.cooperativeLocal ? "unmeasured" : "needs-attention", options.cooperativeLocal
        ? "Cooperative-local evaluation explicitly selected. This does not protect controller authority or prove human presence against another unrestricted app under this OS account."
        : "Protected delegation is not established. Setup will not select cooperative-local mode for you. An operator may explicitly choose --cooperative-local for a labelled laboratory evaluation.");
    add("bun", "observed", `This entry point is running on Bun ${Bun.version}; Wringer ${VERSION}. No Python runtime is used.`);
    if (options.command.length === 1) {
        try {
            const build = await boundedJson(join(dirname(options.command[0]!), "BUILD.json"));
            const same = build.version === VERSION && build.runtime === `Bun ${Bun.version}` && build.platform === deps.platform && build.arch === process.arch && build.python_runtime === false;
            add("source-build", same ? "unmeasured" : "needs-attention", same ? "The adjacent build metadata matches this executable. Metadata is not a signature or a clean-build attestation; keep the complete dist directory from the reviewed source build." : "The adjacent build metadata does not match this executable. Rebuild the reviewed checkout before using its connection recipe.");
        } catch { add("source-build", "needs-attention", "The adjacent BUILD.json could not be inspected safely. Keep the complete dist directory together and rebuild from the reviewed source checkout; no installer ran."); }
    } else add("source-build", "unmeasured", "Running from source. The published route is a reviewed checkout, frozen dependency install, validation and build; use its complete dist directory for the client connection. See INSTALL.md.");
    add("git", deps.which("git") ? "observed" : "needs-attention", deps.which("git") ? "Git is on PATH. No Git command, global identity change, clone or network request was made." : "Git is not on PATH. Follow INSTALL.md prerequisites; no global Git identity or forge account is required for a local bare test remote.");
    add("client", deps.which("codex") ? "unmeasured" : "needs-attention", deps.which("codex") ? "Codex is on PATH. Use connect to inspect the actual version and named connection. Presence is not client compatibility or login/provider authentication." : "Codex is not on PATH. Install the official client using its instructions linked from ASSISTANT_START.md. Do not replace existing keys or change global client permissions.");
    let plan: ExecutionPlan | null = null, existing = false;
    try {
        await assistantPath(root, ".");
        existing = await assistantExists(root, "workspace.json");
        const workspace = existing ? await readAssistantWorkspace(root) : null;
        plan = options.planPath ? await loadExecutionPlan(options.planPath) : workspace?.profile ?? null;
        if (workspace && plan && workspace.profile.plan_sha256 !== plan.plan_sha256) {
            add("profile", "needs-attention", "This root already pins a different profile. Reinitializing must refuse. Keep its work and reservations; do not create another root to escape an exhausted job allowance.");
            plan = null;
        } else add("profile", plan ? "observed" : "needs-attention", plan ? `${existing ? "Retained" : "Selected"} inert profile validated. No plan command, source clone, runtime or model was started.` : "No profile was supplied or registered. Prepare the contained profile using SETUP.md, then repeat setup with --plan and its absolute path. Setup never invents checks, a source commit or a runtime image.");
    } catch { add("profile", "needs-attention", "The profile or retained controller could not be read safely. Inspect the original file with the plan command, retain existing evidence and repair only the reported input. No parser details or file contents were echoed."); }
    let credentials: AssistantCredentialPresence[] = [];
    if (plan) {
        if (isAbsolute(plan.repository.url)) {
            const rel = relative(resolve(plan.repository.url), root);
            if (!rel || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) add("controller-location", "needs-attention", "The controller is inside the target source repository. Choose an operator-controlled directory outside that repository; worker files must not contain its authority or evidence.");
        }
        const placeholders = plan.repository.commit === "0".repeat(40) || plan.repository.url.includes("/OWNER/REPOSITORY") || plan.runtime.image.includes("example.invalid/") || /@sha256:0{64}$/.test(plan.runtime.image) || plan.environment.tools.some(tool => tool.version === "REPLACE_WITH_MEASURED_VERSION");
        add("source-and-image", placeholders ? "needs-attention" : "unmeasured", placeholders ? "Compile-only example placeholders remain. Replace them with the actual repository commit, measured tool versions and inspected image digest before initialization; runtime/README.md describes the image route." : "Source commit and image digest are declared, not remotely checked. The actual clone, image identity and runtime policy must still pass their contained checks.");
        const binary = plan.runtime.binary ?? (plan.runtime.kind === "apple-container" ? "container" : "kubectl");
        add("runtime", deps.which(binary) ? "unmeasured" : "needs-attention", deps.which(binary) ? `${plan.runtime.kind} client is available. Service readiness, image availability, resources, isolation and cleanup are not measured by this inspection.` : `${plan.runtime.kind} client is unavailable. Provision the selected contained backend through runtime/README.md; there is no host-execution fallback.`);
        add("network", "unmeasured", plan.runtime.network.policy === "deny" ? "This profile denies network access. It cannot contact an online provider or fetch remote dependencies; a real online job needs an explicitly reviewed allowlist, not a silent policy change." : "A network allowlist is declared. Reachability and enforced denial outside it still require the real-platform measurement.");
        credentials = await inspectAssistantCredentials(plan, !!options.checkKeychain, deps, options.signal);
        for (const row of credentials) {
            const detail = row.source === "environment-name" ? "The variable name exists in the launching environment. Its value was not validated or displayed; empty or invalid values remain possible."
                : row.source === "keychain-entry" ? `Existing ${keychainServices[row.name]} / wringer entry found using metadata only. Execution can reuse it; do not add the key again.`
                : row.source === "runtime-secret-reference" ? "A runtime-managed Secret reference is declared. Its existence and access were not checked; no host key is required by this declaration."
                : row.source === "not-inspected" ? "The variable name is absent from this environment. Keychain was not inspected; use --check-keychain for an exit-only entry check without retrieving a password."
                : row.source === "unavailable" ? "Keychain entry presence could not be established. Do not replace the key on this evidence; inspect Keychain access first."
                : `No available credential source was found by this inspection. ${keychainServices[row.name] ? `Expected Keychain service ${keychainServices[row.name]}, account wringer, or the declared environment variable.` : "Provide the declared variable to the launching controller through the selected runtime route."} Never paste a key into chat, a plan or client arguments.`;
            add(`credential:${row.name}`, row.source === "not-found" ? "needs-attention" : "unmeasured", `${detail} Provider validity and effective authentication are not attested.`);
        }
        add("billing", "unmeasured", `The profile limits the whole job to ${plan.budget.max_sessions} sessions and ${plan.budget.wall_clock_seconds} seconds. These are not a cash cap. Coding-app usage and worker/judge billing remain unknown until observed.`);
        if (existing) nextActions.push({ id: "status", label: "Inspect the retained work first", command: `${command} status --root ${quote(root)}`, note: "Status does not start an owner, replay an effect or renew an allowance." });
        else if (options.planPath) nextActions.push({ id: "initialize", label: "Record the reviewed profile", command: `${command} init --root ${quote(root)} --plan ${quote(options.planPath)} --cooperative-local`, note: "Only for explicitly selected cooperative-local evaluation after the issues above are settled. Choose and add --destination ABS_JSON before initialization if this run will include handover; it cannot be added to the pinned root later. This does not approve execution." });
        if (options.planPath) nextActions.push({ id: "runtime-probe", label: "Measure contained sessions before a live job", page: "SETUP.md#5-read-preflight-before-spend", note: "Use the contained doctor's --probe-agents route with this exact plan after reviewing the runtime. It may resolve existing keys and create temporary contained sessions, but sends no model prompt. A session does not validate a provider key." });
    } else nextActions.push({ id: "profile", label: "Resolve the selected profile", page: "SETUP.md", note: "Use the reviewed source and exact runtime; do not execute the compile-only example unchanged." });
    if (credentials.some(row => row.source === "not-inspected")) nextActions.push({ id: "credential-metadata", label: "Check whether existing Keychain entries can be reused", command: `${command} setup --root ${quote(root)}${options.planPath ? ` --plan ${quote(options.planPath)}` : ""}${options.cooperativeLocal ? " --cooperative-local" : ""} --check-keychain`, note: "Optional metadata query only. No key value is read or displayed, no entry is stored or replaced, and nothing is spent." });
    return { schema_version: "wringer.assistant-setup.v1" as const, outcome: checks.some(check => check.status === "needs-attention") ? "needs-attention" as const : "inspection-complete" as const, checks, credentials, nextActions, planSha256: plan?.plan_sha256 ?? null, existingWorkspace: existing, effects: { modelPrompts: 0, keychainPasswordsRead: false, configurationChanged: false, controllerCreated: false }, limits: ["Inspection is not approval, a passed containment test, validated provider authentication or a supported-client PM run.", "No plan-supplied command, installer, runtime allocation, owner launch or client configuration write was performed.", "The existing plan validator may compare already-inherited environment values for secret redaction. Setup does not retrieve Keychain passwords or expose credential values."] };
}

export function renderAssistantSetup(value: Awaited<ReturnType<typeof inspectAssistantSetup>>): string {
    return `Setup: ${value.outcome === "needs-attention" ? "needs attention before starting" : "inspection complete; live readiness is still unmeasured"}.\n${value.checks.map(check => `${check.status}: ${check.id} — ${check.detail}`).join("\n")}\n\nWhat to do next:\n${value.nextActions.map(action => `${action.label}\n${action.command ?? action.page}\n${action.note}`).join("\n\n")}\n\n${value.limits.join("\n")}`;
}

export function assistantMaintenanceRecipe(root: string, command: string[], action: "upgrade" | "uninstall") {
    const entry = command.map(quote).join(" "), base = `${entry} status --root ${quote(root)}`;
    const steps: AssistantSetupAction[] = [
        { id: "status", label: "Inspect retained and uncertain work", command: base, note: "Keep the current controller directory and its evidence. Status neither starts work nor replenishes budgets." },
        { id: "revoke", label: "Disable the connection and request shutdown", command: `${entry} revoke --root ${quote(root)}`, note: "Read whether shutdown was confirmed. Revocation preserves accepted work, evidence, reservations and keys; it is not a refund or proof that remote effects stopped." },
    ];
    if (action === "uninstall") steps.push(
        { id: "disconnect", label: "Remove only Wringer's named Codex connection", command: "codex mcp remove wringer", note: "Inspect the named entry first with codex mcp list. This affects client connection configuration, not unrelated servers, logins or the retained Wringer job." },
        { id: "retain", label: "Retain evidence before removing the source-built application", page: "ASSISTANT_START.md#reconnect-stop-and-disconnect", note: "Once owner shutdown is confirmed, the operator may archive the selected source checkout and its complete dist directory. No files are removed by this command. Keep the controller directory, any in-flight runtime state and delivered bundles; unknown effects require reconciliation, not deletion." },
    );
    else steps.push(
        { id: "build", label: "Build and validate the reviewed replacement checkout", page: "INSTALL.md", note: "Use the single frozen-lockfile source-build route. Do not overwrite a running executable or silently move an in-flight job to a changed profile. Keep the previous build until retained records have been inspected with the new version." },
        { id: "inspect", label: "Inspect the same retained controller using the new executable", command: base, note: "Run this with the new executable path if the installation moved. Unsupported records must refuse rather than be erased or silently migrated." },
        { id: "restart", label: "Restart only after checking existing pending work", command: `${entry} start --root ${quote(root)} --cooperative-local`, note: "A previously accepted pending operation may dispatch under its still-valid original approval. Do not restart merely to inspect evidence. Protected mode is not selected by this cooperative-local recipe." },
        { id: "reconnect", label: "Renew only the scoped connection and review its named client entry", command: `${entry} connect --root ${quote(root)} --client codex --renew`, note: "Use the new executable path if it changed. This does not renew execution approval, reset the job budget or overwrite Codex configuration." },
    );
    return { schema_version: "wringer.assistant-maintenance.v1" as const, action, executed: false, evidencePreserved: true, steps, text: `${action === "upgrade" ? "Upgrade" : "Uninstall"} instructions only; no setting, key, executable or evidence was changed.\n\n${steps.map(step => `${step.label}\n${step.command ?? step.page}\n${step.note}`).join("\n\n")}` };
}

/** Only fixed local Git metadata queries are allowed; no repository scripts, hooks or network. */
async function gitMetadata(repo: string, args: string[], signal?: AbortSignal, absentConfigAllowed = false): Promise<string> {
    const binary = Bun.which("git"); if (!binary) throw new Error("Git is required to measure the selected source. No profile was created.");
    const child = Bun.spawn([binary, "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "core.fsmonitorHookVersion=2", "-C", repo, ...args], {
        stdin: "ignore", stdout: "pipe", stderr: "ignore",
        env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    let bytes = 0; const chunks: Uint8Array[] = [];
    try {
        const reader = child.stdout.getReader();
        while (true) {
            const part = await reader.read(); if (part.done) break; const chunk = part.value;
            bytes += chunk.byteLength;
            if (bytes > 1024 * 1024) { child.kill(); throw new Error("Source metadata exceeds its inspection bound. No profile was created."); }
            chunks.push(chunk);
        }
        const code = await child.exited;
        if (code !== 0 && !(absentConfigAllowed && code === 1 && args[0] === "config")) throw new Error("The selected source could not be inspected as a local Git checkout. No repository output was echoed and no profile was created.");
        return Buffer.concat(chunks).toString("utf8");
    } finally { if (child.exitCode === null) { child.kill(); await child.exited; } }
}

export async function prepareAssistantProfile(options: { fromPlan: string; repo: string; sourceUrl?: string; image: string; output: string; root: string; command: string[]; signal?: AbortSignal }) {
    const previous = await loadExecutionPlan(options.fromPlan), repo = await realpath(options.repo), root = resolve(options.root), output = resolve(options.output);
    options.signal?.throwIfAborted();
    if (!/@sha256:[a-f0-9]{64}$/.test(options.image) || /@sha256:0{64}$/.test(options.image) || options.image.includes("example.invalid/")) throw new Error("Supply the actual inspected digest-qualified runtime image, not a mutable tag or example placeholder. Preparation never builds or pulls an image.");
    if (previous.environment.tools.some(tool => !tool.version.trim() || tool.version.includes("REPLACE_WITH"))) throw new Error("The selected profile still contains placeholder tool versions. Use an existing measured profile; preparation cannot infer the tools inside an image from this host.");
    const sourceUrl = options.sourceUrl ?? previous.repository.url;
    if (sourceUrl.includes("/OWNER/REPOSITORY")) throw new Error("Select the actual HTTPS/SSH source URL with --source-url; the compile-only repository placeholder cannot be used. No network request was made.");
    const insideRepo = (path: string) => { const rel = relative(repo, path); return !rel || rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel); };
    await assistantPath(dirname(output), basename(output)); await assistantPath(root, ".");
    if (insideRepo(output) || insideRepo(root)) throw new Error("The prepared profile and controller must be outside the selected source repository. Nothing was written.");
    const top = (await gitMetadata(repo, ["rev-parse", "--show-toplevel"], options.signal)).trim();
    if (await realpath(top) !== repo) throw new Error("Select the repository root, not a subdirectory. No profile was created.");
    const commit = (await gitMetadata(repo, ["rev-parse", "--verify", "HEAD^{commit}"], options.signal)).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("The selected checkout has no supported exact committed source identity.");
    // Even status can invoke a clean/process filter while refreshing file hashes.
    // Read names only (including local include files); never run or echo a filter.
    // Global/system config and inherited Git config injection are already absent.
    const filters = await gitMetadata(repo, ["config", "--includes", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|smudge|process)$"], options.signal, true);
    if (filters.trim()) throw new Error("The repository configures a Git content filter. Host-side profile preparation refuses before status can execute it. Use a separately reviewed inert profile and contained source verification; no filter was run or configuration changed.");
    // A submodule has independent configuration; never recurse into it on the
    // host. Reject both committed and newly staged gitlinks using inert metadata.
    const gitlinks = [await gitMetadata(repo, ["ls-tree", "-r", "-z", commit], options.signal), await gitMetadata(repo, ["ls-files", "--stage", "-z"], options.signal)];
    if (gitlinks.some(list => list.split("\0").some(entry => entry.startsWith("160000 ")))) throw new Error("The selected repository contains submodules. Host-side profile preparation cannot attest their separate configuration or source; use a reviewed inert profile and contained source verification. No submodule was inspected or executed.");
    if ((await gitMetadata(repo, ["status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=all"], options.signal)).trim()) throw new Error("The selected source has uncommitted or untracked work. Preparation will not silently omit it, commit it, or change it. Commit the intended test source separately, then repeat this command.");
    const files = new Set((await gitMetadata(repo, ["ls-tree", "-r", "-z", "--name-only", commit], options.signal)).split("\0").filter(Boolean));
    const requiredFiles = [...new Set([...previous.environment.context, ...previous.acceptance.checks.flatMap(check => check.files)])];
    if (requiredFiles.some(file => !files.has(file))) throw new Error("The selected profile references context or check files absent from this committed source. Choose a matching profile or revise its inert declarations; no check was invented or executed.");
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = previous;
    const plan = compileDeclaration({ version: 1, ...declaration, repository: { url: sourceUrl, commit }, runtime: { ...declaration.runtime, image: options.image } });
    // A second observation avoids publishing a profile for a checkout that moved during inspection.
    if ((await gitMetadata(repo, ["rev-parse", "--verify", "HEAD^{commit}"], options.signal)).trim() !== commit || (await gitMetadata(repo, ["status", "--porcelain=v1", "--untracked-files=normal", "--ignore-submodules=all"], options.signal)).trim()) throw new Error("The selected source changed during preparation. Nothing was written; repeat against a stable committed checkout.");
    const bytes = canonicalPlanJson(plan), temp = join(dirname(output), `.wringer-profile-${crypto.randomUUID()}.pending`), file = await open(temp, "wx", 0o600);
    let created = true;
    try {
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        try { await link(temp, output); }
        catch (error: any) {
            if (error.code !== "EEXIST") throw error;
            try { const existing = await boundedJson(output); if (canonicalPlanJson(existing) !== bytes) throw new Error("different"); }
            catch { throw new Error("The output already exists with different or unreadable data. It was not overwritten; choose a separate reviewed output."); }
            created = false;
        }
        const directory = await open(dirname(output), "r"); try { await directory.sync(); } finally { await directory.close(); }
    } finally { await unlink(temp); }
    const next = `${options.command.map(quote).join(" ")} setup --root ${quote(root)} --plan ${quote(output)} --cooperative-local`;
    return { schema_version: "wringer.assistant-profile-preparation.v1" as const, created, path: output, fromPlanSha256: previous.plan_sha256, planSha256: plan.plan_sha256, repository: plan.repository, image: plan.runtime.image, limits: plan.budget, remoteCommitAvailable: "unmeasured" as const, executed: { gitMetadataOnly: true, repositoryCommands: false, modelPrompts: 0, keychainPasswordsRead: false, controllerCreated: false, approvalCreated: false }, next, text: `${created ? "Prepared" : "Verified the existing"} pinned profile: ${output}\nSource: ${commit}. Existing role selection, checks, scope, network policy and finite session/time limits were preserved.\nNo repository script or model ran; no key, client setting or execution approval was changed. The image reference is operator-supplied, not an observed runtime test. The selected remote URL's availability and possession of this local commit remain unmeasured; source transport will check them before execution.\nThis is a separate operator profile preparation, not permission to bypass any previous job's allowance. Review the profile and handover destination before initialization.\nNext, only for a deliberately cooperative-local evaluation:\n${next}` };
}
