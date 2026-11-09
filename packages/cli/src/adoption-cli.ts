import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applicationDirectory, inspectWorkspaceSetup, registerWorkspace, readWorkspace, listWorkspaces, createVerificationJob, readVerificationJob, verificationStatus, assistantId, assistantInventory, type RegisteredWorkspace } from "@wringer/application";
import { allowed, flag, number, required, string, values, positionals, quote, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";
import { createVerificationOwner } from "./verification-owner";
import { readAssistantConnection } from "./assistant-transport";
import { applyDelegationProfile, checkDelegationAgents, inspectDelegationProfile, type DelegationSelection } from "@wringer/application";
import { assistantExists, createDelegationJob, readDelegationJob, delegationJobIdentity, delegationJobStatus, inspectDelegationLoop, inspectDelegationTrajectories } from "@wringer/application";
import { renderLoopTrajectory } from "@wringer/workflow";
import { createDelegationOwner } from "./delegation-owner";
import { inspectDelegationImprovements } from "@wringer/application";
import { compactVerificationStatus } from "@wringer/application";
import { applyAcceptancePreparation, inspectAcceptancePreparation } from "@wringer/application";
import { parseMcpJson } from "@wringer/mcp";
import { clientRecipe, parseMcpClient, type McpClient } from "./client-recipes";
import { renderClientRecipe } from "./client-recipes";
import { inspectWorkspaceRecovery, applyWorkspaceRecovery } from "@wringer/application";
import { inspectVerificationSendRecovery, applyVerificationSendRecovery } from "@wringer/application";
import { inspectVerificationRecovery, applyVerificationRecovery } from "@wringer/application";
import { inspectOwnedStorage, previewPreparationArchive, archivePreparation, previewArchiveRemoval, removePreparationArchive, type PreparationSelection } from "@wringer/application";
import { inspectDelegationRecovery, applyDelegationRecovery } from "@wringer/application";
import { inspectLockRecovery, applyLockRecovery, type LockSelection } from "@wringer/application";
import { previewDiagnostics, exportDiagnostics } from "@wringer/application";
import { previewClientConnection, applyClientConnection, detectClient, probeRestrictedConnection, type ClientSelection } from "./client-adapters";
import { closeOwner } from "./owner-close";

export const ADOPTION_HELP = `Wringer workspace setup and retained jobs

  wring setup --repo PATH --client CLIENT [--mode verification|delegation] [--dry-run --json]
  wring setup --repo PATH --client CLIENT --mode verification --apply
  wring setup --repo PATH --prepare-acceptance INPUT.json [--dry-run --json]
  wring setup --repo PATH --prepare-acceptance INPUT.json --apply --expected HASH --actor NAME
  wring setup --repo PATH --client CLIENT --mode delegation --runtime trusted-local
      --worker-adapter claude-agent-acp|codex-acp --judge-adapter claude-agent-acp|codex-acp
      --source local|remote [--source-remote NAME] --dependencies none|bun-frozen
      [--writable PATH] [--output-dir PATH] [--acceptance UUID] [--remote NAME --base BRANCH] --dry-run --json
      Trusted-local runs your coding agents on this computer under your account,
      each role in a fresh clone; nothing is contained and protected mode refuses it.
  wring setup --repo PATH --client CLIENT --mode delegation --provision UUID
      --worker-provider openai|anthropic --worker-model MODEL
      --judge-provider openai|anthropic --judge-model MODEL
      --source local|remote [--source-remote NAME] --dependencies none|bun-frozen
      --network deny|allowlist [--egress CIDR@PORT,PORT] [--dns IPV4]
      [--writable PATH] [--output-dir PATH] [--readiness UUID] [--acceptance UUID] [--remote NAME --base BRANCH] --dry-run --json
  Repeat the same contained selections with --apply --expected IDENTITY
      --actor NAME --cooperative-local to keep the reviewed profile and source.
  wring job new --workspace ID --intent 'Original request' [--gate ID] [--repetitions 3] [--run-seconds 300] [--elapsed-seconds 3600]
  wring job list [--workspace ID] [--offset 0] [--limit 50]
  wring job status --job ID
  wring job loop --job ID [--json]
  wring job loop --job ID --trajectory [--effect ID] [--json]
  wring job improvements --job ID [--json]
  wring job check --workspace ID      Start each coding agent and open a session; no model prompt
  wring job open --workspace ID [--job ID] [--print]
  wring job serve --workspace ID
  wring job close --workspace ID      Stop the owner that job open left running; jobs and evidence are kept
  wring connect --workspace ID --client CLIENT --scope project|user [--dry-run --json]
      CLIENT: claude-code, codex, cursor, gemini-cli, generic, kimi, vscode or windsurf (none is a default).
      claude-code and codex can be applied with review; the others print their documented recipe.
  wring connect ... --apply --expected DIGEST [--replace] [--auto-approve]
  wring connect ... --remove [--apply --expected DIGEST]
  wring connect ... --verify-client
  wring connect ... --probe-tools
  wring recover --job ID --send [--apply --expected HASH --actor NAME]
  wring recover --job ID [--operation ID] [--apply --expected HASH --actor NAME]
  wring recover --lock-kind KIND --lock-id ID [--workspace ID] [--dry-run --json]
  wring recover --lock-kind KIND --lock-id ID [--workspace ID] --apply --expected HASH --actor NAME
  wring recover --workspace ID [--dry-run --json]
  wring recover --workspace ID --apply --expected HASH --actor NAME
  wring storage [--dry-run --json]
  wring storage --kind acceptance|profile --id ID [--apply --expected HASH --actor NAME]
  wring storage --remove-archive HASH [--apply --expected HASH --actor NAME]
  wring diagnostics --workspace ID [--offset 0] [--dry-run --json]
  wring diagnostics --workspace ID --output NEW_DIRECTORY --apply --expected HASH

--app-dir ABS_PATH overrides the user-owned application directory (WRINGER_HOME).
Setup inspection executes no project code and retrieves no credentials. Applying
setup creates only the displayed configuration and workspace registration. Opening
the operator page starts no job by itself. Verification runs repository commands
on this computer, under a finite operator grant. Delegation never falls back to
this computer; --runtime trusted-local is its own explicit, stamped choice.
An approval, human acceptance, and sending are separate decisions.
`;
export function installedLauncher(executable = process.execPath, modulePath = import.meta.url) {
    return modulePath.includes("/$bunfs/") || modulePath.includes("B:/~BUN/") ? [executable] : [executable, "--no-env-file", "--no-install", "--no-macros", "--config=/dev/null", fileURLToPath(new URL("./launcher.ts", import.meta.url))];
}
async function ownerLocation(root: string, workspace: string) {
    const owner = JSON.parse(await readFile(join(root, "owners", assistantId(workspace), "operator.json"), "utf8"));
    if (owner.schema_version !== "wringer.operator-location.v1" || !Number.isInteger(owner.pid) || typeof owner.url !== "string" || !/^http:\/\/127\.0\.0\.1:[0-9]+\/#token=[a-f0-9]{64}$/.test(owner.url)) throw new Error("Owner location is invalid; inspect retained state");
    try { process.kill(owner.pid, 0); } catch { throw new Error("The recorded owner is not running. Explicit recovery must preserve uncertain operations before restart."); }
    return owner as { pid: number; url: string };
}
/** A destination is chosen beside the reviewed profile, not inside it: its absence is only felt at Send, after the work is done.
 * The preview shows the destination apply will record on the workspace (N1), outside the profile's identity. */
function withDestinationLimit<T extends { limits: string[] }>(preview: T, a: Args): T & { destination: { remote: string; base: string; recorded: string } | null } {
    const remote = string(a, "remote"), base = string(a, "base");
    return remote && base ? { ...preview, destination: { remote, base, recorded: `Applying records this on the workspace: a finished job can be sent to remote ${remote}, base ${base}, only after the person's Send.` } } : { ...preview, destination: null, limits: [...preview.limits, "No handover destination is selected, so a finished job could not be sent. Repeat with --remote NAME --base BRANCH to keep one."] };
}
const destinationLine = (preview: { destination: { remote: string; base: string } | null }) => preview.destination ? `Destination: remote ${preview.destination.remote}, base ${preview.destination.base}; a finished job is sent there only after the person's Send.` : "Destination: none selected, so a finished job could be accepted but not sent.";
export async function adoptionCommand(a: Args, context: DispatchContext): Promise<Answer> {
    if (flag(a, "help")) return { text: ADOPTION_HELP };
    const root = applicationDirectory(string(a, "app-dir")), repo = resolve(string(a, "repo", process.cwd())!);
    if (a.command === "storage") {
        allowed(a, ["app-dir", "kind", "id", "remove-archive", "dry-run", "apply", "expected", "actor"]); positionals(a, 0);
        if (flag(a, "apply") && flag(a, "dry-run")) throw new Error("Choose storage preview or apply");
        if (string(a, "remove-archive")) {
            if (string(a, "kind") || string(a, "id")) throw new Error("Select one storage action");
            return { value: flag(a, "apply") ? await removePreparationArchive(root, required(a, "remove-archive"), required(a, "expected"), required(a, "actor")) : await previewArchiveRemoval(root, required(a, "remove-archive")) };
        }
        if (string(a, "kind") || string(a, "id")) {
            const selected: PreparationSelection = { kind: required(a, "kind") as PreparationSelection["kind"], id: required(a, "id") };
            return { value: flag(a, "apply") ? await archivePreparation(root, selected, required(a, "expected"), required(a, "actor")) : await previewPreparationArchive(root, selected) };
        }
        if (flag(a, "apply")) throw new Error("Select one owned storage action before applying it");
        return { value: await inspectOwnedStorage(root) };
    }
    if (a.command === "diagnostics") {
        allowed(a, ["app-dir", "workspace", "offset", "output", "dry-run", "apply", "expected"]); positionals(a, 0);
        if (flag(a, "apply") && flag(a, "dry-run")) throw new Error("Choose diagnostic preview or export");
        const workspace = required(a, "workspace"), offset = number(a, "offset", 0);
        return { value: flag(a, "apply") ? await exportDiagnostics(root, workspace, resolve(required(a, "output")), required(a, "expected"), offset) : await previewDiagnostics(root, workspace, offset) };
    }
    if (a.command === "recover") {
        allowed(a, ["app-dir", "workspace", "job", "operation", "send", "lock-kind", "lock-id", "dry-run", "apply", "expected", "actor"]); positionals(a, 0);
        if (flag(a, "apply") && flag(a, "dry-run")) throw new Error("Choose recovery preview or apply");
        if ((flag(a, "send") || string(a, "operation")) && !string(a, "job")) throw new Error("Select the exact --job for domain or Send recovery");
        if (string(a, "job")) {
            if (string(a, "lock-kind") || flag(a, "send") && string(a, "operation")) throw new Error("Select one recovery operation");
            if (flag(a, "send")) return { value: flag(a, "apply") ? await applyVerificationSendRecovery(root, required(a, "job"), required(a, "expected"), required(a, "actor")) : await inspectVerificationSendRecovery(root, required(a, "job")) };
            if (await assistantExists(root, `verification-jobs/${assistantId(required(a, "job"))}/creation.json`) || await assistantExists(root, `verification-jobs/${assistantId(required(a, "job"))}/job.json`)) return { value: flag(a, "apply") ? await applyVerificationRecovery(root, required(a, "job"), string(a, "operation"), required(a, "expected"), required(a, "actor")) : await inspectVerificationRecovery(root, required(a, "job"), string(a, "operation")) };
            return { value: flag(a, "apply") ? await applyDelegationRecovery(root, required(a, "job"), string(a, "operation"), required(a, "expected"), required(a, "actor")) : await inspectDelegationRecovery(root, required(a, "job"), string(a, "operation")) };
        }
        if (string(a, "lock-kind")) {
            const selected: LockSelection = { kind: required(a, "lock-kind") as LockSelection["kind"], id: required(a, "lock-id"), ...(string(a, "workspace") ? { workspaceId: string(a, "workspace") } : {}) };
            return { value: flag(a, "apply") ? await applyLockRecovery(root, selected, required(a, "expected"), required(a, "actor")) : await inspectLockRecovery(root, selected) };
        }
        const workspace = required(a, "workspace");
        return { value: flag(a, "apply") ? await applyWorkspaceRecovery(root, workspace, { expectedIdentity: required(a, "expected"), actor: required(a, "actor") }) : await inspectWorkspaceRecovery(root, workspace) };
    }
    if (a.command === "setup") {
        allowed(a, ["app-dir", "client", "mode", "dry-run", "apply", "remote", "base", "profile", "runtime", "worker-adapter", "judge-adapter", "provision", "readiness", "acceptance", "prepare-acceptance", "worker-provider", "worker-model", "judge-provider", "judge-model", "source", "source-remote", "dependencies", "network", "egress", "dns", "writable", "output-dir", "gate", "expected", "actor", "cooperative-local"]); positionals(a, 0);
        if (flag(a, "apply") && flag(a, "dry-run")) throw new Error("Choose preview or apply, not both");
        if (string(a, "prepare-acceptance")) {
            const input = await readFile(resolve(required(a, "prepare-acceptance")), "utf8");
            if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("Acceptance input exceeds its byte limit");
            const preparation = await inspectAcceptancePreparation(root, repo, parseMcpJson(input) as any);
            return { value: flag(a, "apply") ? await applyAcceptancePreparation(root, preparation, { expectedIdentity: required(a, "expected"), actor: required(a, "actor") }) : preparation };
        }
        // R-7: any named MCP client; those Wringer cannot manage are registered as generic.
        const named = parseMcpClient(required(a, "client")), client = (["claude-code", "codex"].includes(named) ? named : "generic") as RegisteredWorkspace["client"], mode = string(a, "mode") as RegisteredWorkspace["mode"] | undefined;
        const preview = await inspectWorkspaceSetup(repo, mode, client);
        if (mode === "delegation" && string(a, "runtime") === "trusted-local") {
            // R-1: an explicit operator choice to run on this computer; nothing is contained.
            if (["provision", "readiness", "network", "egress", "dns", "worker-provider", "worker-model", "judge-provider", "judge-model"].some(key => string(a, key) !== undefined || values(a, key) !== undefined)) throw new Error("A trusted-local profile names ACP adapters, not providers, models, a provision or a network policy: it runs on this computer under your account, where none of those is enforced");
            const source = required(a, "source"); if (!["local", "remote"].includes(source)) throw new Error("Choose --source local or remote explicitly");
            const selection: DelegationSelection = { runtime: "trusted-local", ...(string(a, "acceptance") ? { acceptanceId: string(a, "acceptance") } : {}), worker: { adapter: required(a, "worker-adapter") as any }, judge: { adapter: required(a, "judge-adapter") as any }, source: source === "local" ? { kind: "local" } : { kind: "remote", remote: required(a, "source-remote") }, dependencies: required(a, "dependencies") as any, ...(values(a, "writable") ? { writable: values(a, "writable") } : {}), ...(values(a, "output-dir") ? { outputDirectories: values(a, "output-dir") } : {}), ...(values(a, "gate") ? { gates: values(a, "gate") } : {}) };
            const reviewed = await inspectDelegationProfile(root, repo, selection), trusted = withDestinationLimit(reviewed, a);
            if (!flag(a, "apply")) return { value: trusted, text: `${JSON.stringify(trusted, null, 2)}\nIts roles and checks will run on this computer under your account; nothing is contained.\n${destinationLine(trusted)}\nRepeat with --apply --expected ${trusted.identity} --actor NAME --cooperative-local to keep this profile.` };
            const remote = string(a, "remote"), base = string(a, "base"); if (!!remote !== !!base) throw new Error("Select both --remote and --base, or neither");
            const profile = await applyDelegationProfile(root, reviewed, { expectedIdentity: required(a, "expected"), actor: required(a, "actor"), cooperativeLocal: flag(a, "cooperative-local") });
            const workspace = await registerWorkspace(root, { repo, mode, client, execution: "trusted-local", applyChecks: false, profileId: profile.id, credentialReferences: profile.plan.runtime.env, ...(remote && base ? { destination: { remote, base } } : {}) });
            return { value: { workspace, profile }, text: `Registered trusted-local workspace ${workspace.id} and reviewed profile ${profile.id}.\nIts roles and checks will run on this computer under your account; nothing is contained.\nNo work or Send was approved. Next: wring job check --workspace ${workspace.id}, then wring job new --workspace ${workspace.id} --intent 'YOUR REQUEST'` };
        }
        if (mode === "delegation") {
            if (string(a, "runtime") !== undefined && string(a, "runtime") !== "contained") throw new Error("Choose --runtime contained (the default, by provision) or --runtime trusted-local");
            if (!string(a, "provision")) {
                if (flag(a, "apply")) throw new Error("Select the completed --provision and explicit role/source choices before applying contained setup. Run wring runtime catalogue and provision first");
                return { value: { ...preview, nextAction: "Choose a runtime. Contained: inspect wring runtime catalogue, preview a provision, then select its ID plus explicit worker/judge providers, models, source transport, dependencies and network. Or --runtime trusted-local with --worker-adapter and --judge-adapter (claude-agent-acp or codex-acp): it runs on this computer under your account and nothing is contained. See wring setup --help." } };
            }
            const source = required(a, "source"); if (!["local", "remote"].includes(source)) throw new Error("Choose --source local or remote explicitly");
            const network = required(a, "network"); if (!["deny", "allowlist"].includes(network)) throw new Error("Choose an explicit deny or allowlist network policy");
            const allow = (values(a, "egress") ?? []).map(value => { const [cidr, ports, extra] = value.split("@"); if (!cidr || !ports || extra !== undefined || !/^\d+(,\d+)*$/.test(ports)) throw new Error("Use --egress IPv4_CIDR@PORT,PORT with explicit ports"); return { cidr, ports: ports.split(",").map(Number) }; });
            const selection: DelegationSelection = { provisionId: required(a, "provision"), ...(string(a, "acceptance") ? { acceptanceId: string(a, "acceptance") } : {}), ...(string(a, "readiness") ? { readinessId: string(a, "readiness") } : {}), worker: { provider: required(a, "worker-provider") as any, model: required(a, "worker-model") }, judge: { provider: required(a, "judge-provider") as any, model: required(a, "judge-model") }, source: source === "local" ? { kind: "local" } : { kind: "remote", remote: required(a, "source-remote") }, dependencies: required(a, "dependencies") as any, network: { policy: network as any, allow, dns: values(a, "dns") ?? [] }, ...(values(a, "writable") ? { writable: values(a, "writable") } : {}), ...(values(a, "output-dir") ? { outputDirectories: values(a, "output-dir") } : {}), ...(values(a, "gate") ? { gates: values(a, "gate") } : {}) };
            const contained = await inspectDelegationProfile(root, repo, selection);
            if (!flag(a, "apply")) return { value: withDestinationLimit(contained, a) };
            const remote = string(a, "remote"), base = string(a, "base"); if (!!remote !== !!base) throw new Error("Select both --remote and --base, or neither");
            const profile = await applyDelegationProfile(root, contained, { expectedIdentity: required(a, "expected"), actor: required(a, "actor"), cooperativeLocal: flag(a, "cooperative-local") });
            const workspace = await registerWorkspace(root, { repo, mode, client, applyChecks: false, profileId: profile.id, credentialReferences: profile.plan.runtime.env, ...(remote && base ? { destination: { remote, base } } : {}) });
            return { value: { workspace, profile }, text: `Registered contained workspace ${workspace.id} and reviewed profile ${profile.id}.\nNo work or Send was approved. Next: wring job new --workspace ${workspace.id} --intent 'YOUR REQUEST'` };
        }
        if (!flag(a, "apply")) {
            const remote = string(a, "remote"), base = string(a, "base"), shown = { ...preview, destination: remote && base ? { remote, base, recorded: `Applying records this on the workspace: a finished job can be sent to remote ${remote}, base ${base}, only after the person's Send.` } : null };
            return { value: shown, text: JSON.stringify(shown, null, 2) + `\n${destinationLine(shown)}\nReview these changes; repeat with the chosen --mode and --apply to register.` };
        }
        if (!mode) throw new Error("Choose verification or delegation explicitly before applying setup");
        const remote = string(a, "remote"), base = string(a, "base");
        if (!!remote !== !!base) throw new Error("Select both --remote and --base, or neither");
        const value = await registerWorkspace(root, { repo, mode, client, applyChecks: true, ...(remote && base ? { destination: { remote, base } } : {}), profileId: string(a, "profile") });
        return { value, text: `Registered ${mode} workspace ${value.id}. No job was approved.\nNext: wring job new --workspace ${value.id} --intent 'YOUR REQUEST'\nApplication state: ${root}` };
    }
    if (a.command === "connect") {
        allowed(a, ["app-dir", "workspace", "client", "scope", "dry-run", "apply", "expected", "replace", "remove", "auto-approve", "verify-client", "probe-tools"]); positionals(a, 0);
        const workspace = await readWorkspace(root, required(a, "workspace")), client = parseMcpClient(required(a, "client"));
        const connectionPath = join(root, "owners", workspace.id, "connection.json");
        const command = [...installedLauncher(), "mcp", "--connection", connectionPath];
        // R-7: Claude Code and Codex have reviewed, scoped configuration management; every
        // other client gets its documented recipe to apply by hand.
        if (!["claude-code", "codex", "generic"].includes(client)) {
            if (["apply", "remove", "replace", "auto-approve", "verify-client", "probe-tools"].some(key => flag(a, key))) throw new Error(`${client} gets a printed recipe only; Wringer does not edit its configuration. Apply the recipe yourself, or use claude-code or codex for scoped management`);
            const recipe = clientRecipe(client as Exclude<McpClient, "codex">, command);
            return { value: { schema_version: "wringer.connection-proposal.v1", workspaceId: workspace.id, ...recipe, applied: false, compatibility: "unmeasured" }, text: `${renderClientRecipe(recipe)}\nStart the owner with wring job open before connecting. No client configuration was read or changed.` };
        }
        if (client === "generic") {
            if (["apply", "remove", "replace", "auto-approve", "verify-client", "probe-tools"].some(key => flag(a, key))) throw new Error("Generic STDIO provides a recipe only; select a supported client for scoped management");
            return { value: { schema_version: "wringer.connection-proposal.v1", workspaceId: workspace.id, client, command: command[0], args: command.slice(1), applied: false, compatibility: "unmeasured" }, text: `Generic STDIO recipe:\n${command.map(quote).join(" ")}\nStart the owner with wring job open before connecting. No client compatibility is implied.` };
        }
        if (flag(a, "dry-run") && (flag(a, "apply") || flag(a, "probe-tools") || flag(a, "verify-client"))) throw new Error("A dry run only inspects configuration; select apply or a client/protocol probe separately");
        const input: ClientSelection = { client: client as ClientSelection["client"], scope: required(a, "scope") as ClientSelection["scope"], repo: workspace.repo, workspaceId: workspace.id, mode: workspace.mode, launcher: installedLauncher(), remove: flag(a, "remove"), replace: flag(a, "replace"), autoApprove: flag(a, "auto-approve") };
        const value = flag(a, "apply") ? await applyClientConnection(root, input, required(a, "expected")) : await previewClientConnection(root, input);
        const result = { ...value, ...(flag(a, "verify-client") ? { detection: await detectClient(input.client) } : {}), ...(flag(a, "probe-tools") ? { discovery: await probeRestrictedConnection(installedLauncher(), connectionPath, workspace.mode) } : {}) };
        // Beta gate run 2: a warning sat only inside the JSON (F13), and a removal printed connect's
        // next step (F14).
        const warnings = ((result as { warnings?: string[] }).warnings ?? []).map(row => `\nWarning: ${row}`).join("") + ((result as { repositoryFiles?: { advice: string } }).repositoryFiles ? `\nRepository: ${(result as { repositoryFiles: { advice: string } }).repositoryFiles.advice}` : "");
        const next = !input.remove ? "Start the operator owner with wring job open, then reload the client and inspect its MCP tools. Client trust and live job acceptance are separate observations."
            : (result as { applied?: boolean }).applied ? `Removed. Reload the client: it no longer offers Wringer's tools. Jobs, evidence and the operator owner are unchanged; wring job close --workspace ${workspace.id} stops the owner.`
            : "Nothing was removed yet. Review the exact removal above, then repeat with --apply --expected IDENTITY.";
        return { value: result, text: JSON.stringify(result, null, 2) + warnings + "\n" + next };
    }
    if (a.command !== "job") throw new Error("Unknown adoption command");
    const verb = a.words[0]; positionals(a, 1);
    if (verb === "list") {
        allowed(a, ["app-dir", "workspace", "offset", "limit"]);
        const offset = number(a, "offset", 0), limit = number(a, "limit", 50); if (limit < 1 || limit > 100) throw new Error("Page limit is 1–100");
        const workspace = string(a, "workspace"), jobs = [];
        for (const id of await assistantInventory(root, "verification-jobs")) { const job = await readVerificationJob(root, id); if (!workspace || job.workspaceId === workspace) jobs.push({ jobId: job.id, workspaceId: job.workspaceId, mode: job.mode, intent: job.intent, parentJobId: job.parentJobId }); }
        // W7 (alpha.44): one row per job, under the ID wring job new printed. A revised request is shown
        // as that job's revision, never as a job of its own.
        const seen = new Set<string>();
        for (const name of await assistantInventory(root, "delegation-jobs")) {
            if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
            const { job, rootJobId, currentJobId, revision } = await delegationJobIdentity(root, name.slice(0, -5));
            if ((workspace && job.workspaceId !== workspace) || seen.has(rootJobId)) continue;
            seen.add(rootJobId);
            jobs.push({ jobId: rootJobId, workspaceId: job.workspaceId, mode: job.mode, intent: job.intent, parentJobId: job.parentJobId, ...(revision > 1 ? { requestRevision: { number: revision, recordedAs: currentJobId } } : {}) });
        }
        return { value: { schema_version: "wringer.job-list.v1", jobs: jobs.slice(offset, offset + limit), nextOffset: offset + limit < jobs.length ? offset + limit : null } };
    }
    if (verb === "new") {
        allowed(a, ["app-dir", "workspace", "intent", "gate", "repetitions", "run-seconds", "elapsed-seconds", "parent", "idempotency-key"]);
        const workspace = await readWorkspace(root, required(a, "workspace"));
        if (workspace.mode === "delegation") {
            if (["gate", "repetitions", "run-seconds", "elapsed-seconds"].some(key => string(a, key) !== undefined)) throw new Error("Delegation check selection and ceilings belong in the typed proposal under its reviewed profile");
            const value = await createDelegationJob(root, workspace.id, { intent: required(a, "intent"), idempotencyKey: string(a, "idempotency-key", crypto.randomUUID())!, parentJobId: string(a, "parent") });
            return { value, text: `Prepared unapproved delegation job ${value.id}. Nothing is proposed or approved yet.\nTell your coding assistant your request and name this job, for example: "Please delegate this to Wringer on prepared job ${value.id}: YOUR REQUEST"\nOpen: wring job open --workspace ${workspace.id} --job ${value.id}` };
        }
        const selection = values(a, "gate"), parentJobId = string(a, "parent");
        const value = await createVerificationJob(root, required(a, "workspace"), { intent: required(a, "intent"), ...(selection !== undefined ? { selection } : {}), repetitions: number(a, "repetitions", 3), runSeconds: number(a, "run-seconds", 300), elapsedSeconds: number(a, "elapsed-seconds", 3600), ...(parentJobId !== undefined ? { parentJobId } : {}), idempotencyKey: string(a, "idempotency-key", crypto.randomUUID())! });
        return { value, text: `Prepared unapproved verification job ${value.id}.\nOpen: wring job open --workspace ${value.workspaceId} --job ${value.id}` };
    }
    if (verb === "improvements") { allowed(a, ["app-dir", "job"]); return { value: await inspectDelegationImprovements(root, assistantId(required(a, "job"))) }; }
    if (verb === "loop") {
        allowed(a, ["app-dir", "job", "trajectory", "effect"]);
        if (string(a, "effect") !== undefined && !flag(a, "trajectory")) throw new Error("--effect selects one session's trajectory; add --trajectory");
        if (flag(a, "trajectory")) {
            const trajectories = await inspectDelegationTrajectories(root, assistantId(required(a, "job")), string(a, "effect"));
            return { value: { trajectories }, text: trajectories.map(renderLoopTrajectory).join("\n\n") || "No role session has been reserved yet." };
        }
        return { value: await inspectDelegationLoop(root, assistantId(required(a, "job"))) };
    }
    if (verb === "status") { allowed(a, ["app-dir", "job"]); const id = assistantId(required(a, "job")); return { value: (await assistantExists(root, `verification-jobs/${id}/job.json`) || await assistantExists(root, `verification-jobs/${id}/creation.json`)) ? compactVerificationStatus(await verificationStatus(root, id)) : await delegationJobStatus(root, id) }; }
    if (verb === "check") {
        allowed(a, ["app-dir", "workspace"]);
        const workspace = required(a, "workspace"), value = await checkDelegationAgents(root, workspace, { signal: context.signal });
        return { value, exit: value.ready ? 0 : 3, text: `${value.roles.map(row => `${row.role}: ${row.detail}`).join("\n")}\n${value.limit}\nNext: ${value.ready ? `wring job new --workspace ${workspace} --intent 'YOUR REQUEST'` : `fix what stopped it, then run wring job check --workspace ${workspace} again`}` };
    }
    if (verb === "serve") {
        allowed(a, ["app-dir", "workspace"]); const workspace = await readWorkspace(root, required(a, "workspace"));
        const owner = workspace.mode === "verification" ? await createVerificationOwner(root, workspace.id) : await createDelegationOwner(root, workspace.id);
        process.stdout.write(`Wringer operator page ready. Connection: ${owner.connectionPath}\nUse wring job open --workspace ${required(a, "workspace")} to open your private page.\n`);
        try { await new Promise<void>(resolve => { if (context.signal?.aborted) resolve(); else context.signal?.addEventListener("abort", () => resolve(), { once: true }); }); }
        finally { await owner.stop(); }
        return { text: "Owner stopped; evidence and grants retained." };
    }
    if (verb === "close") {
        allowed(a, ["app-dir", "workspace"]);
        return closeOwner(root, await readWorkspace(root, required(a, "workspace")));
    }
    if (verb === "open") {
        allowed(a, ["app-dir", "workspace", "job", "print"]); const workspace = await readWorkspace(root, required(a, "workspace"));
        let id = string(a, "job");
        if (id) {
            const job = workspace.mode === "verification" ? await readVerificationJob(root, assistantId(id)) : await readDelegationJob(root, assistantId(id)); if (job.workspaceId !== workspace.id) throw new Error("Job belongs to another workspace");
            // W7 (alpha.44): a revision's ID opens its job, under the ID wring job new printed.
            if (workspace.mode === "delegation") id = (await delegationJobIdentity(root, id)).rootJobId;
        }
        let location;
        try { location = await ownerLocation(root, workspace.id); }
        catch (error: any) {
            if (error.code !== "ENOENT") throw error;
            const command = [...installedLauncher(), "job", "serve", "--app-dir", root, "--workspace", workspace.id];
            const child = spawn(command[0]!, command.slice(1), { detached: true, stdio: "ignore", env: process.env }); child.unref();
            for (let n = 0; n < 100; n++) { await Bun.sleep(100); try { location = await ownerLocation(root, workspace.id); break; } catch {} }
            if (!location) throw new Error("Owner startup was not confirmed. Run job serve in a terminal to inspect its refusal; no job was automatically approved.");
        }
        const url = new URL(location.url);
        if (id) url.searchParams.set("jobId", id);
        // Beta gate run 1: only the default browser could be unlocked, so a person or tester
        // using another browser had no way in. Printing is the person's explicit choice.
        if (flag(a, "print")) return { value: { opened: false, printed: true, url: url.href, workspaceId: workspace.id, jobId: id ?? null }, text: `Private operator link for this computer:\n${url.href}\nAnyone who opens it can act as you on this page, so keep it out of chat, tickets and screenshots. Opening it does not approve work, accept it, or send it.` };
        const command = process.platform === "darwin" ? ["open", url.href] : ["xdg-open", url.href];
        const opened = Bun.spawnSync(command, { stdout: "ignore", stderr: "pipe" });
        if (opened.exitCode) throw new Error("The operating system could not open the private page. Run job serve and inspect the private operator location locally; no authority was sent to the assistant.");
        return { value: { opened: true, workspaceId: workspace.id, jobId: id ?? null }, text: `Opened the operator page. Opening does not approve work, accept it, or send it.\nIts owner keeps running in the background; wring job close --workspace ${workspace.id} stops it.` };
    }
    throw new Error(ADOPTION_HELP);
}
