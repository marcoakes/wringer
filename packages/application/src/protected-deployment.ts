import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { hashValue } from "@wringer/plan";

/** These paths are product-owned installation targets, never assistant input. */
export const PROTECTED_INSTALL_ROOT = "/Library/Application Support/Wringer";
export const PROTECTED_DAEMON_PATH = "/Library/LaunchDaemons/com.wringer.controller.plist";
export const PROTECTED_SERVICE_ACCOUNT = "_wringer";
export const PROTECTED_CONTROLLER_PIN = join(PROTECTED_INSTALL_ROOT, "confirmation", "controller-public-key.bin");
export const PROTECTED_SIGNING_POLICY = join(PROTECTED_INSTALL_ROOT, "confirmation", "signing-policy.json");
export const PROTECTED_DEPLOYMENT_LIMITATION = "A read-only installation inspection is not proof of a protected running service. Native confirmation enrollment, denied alternate credential/runtime routes, actual-client adversarial tests and lifecycle measurements remain separate requirements.";

export type ProtectedArtifactRole = "controller" | "confirmation" | "runtime";
export interface ProtectedArtifact { source: string; sha256: string }
export interface ProtectedDeploymentInput {
    controllerUid: number;
    controllerGid: number;
    assistantUid: number;
    assistantGids: number[];
    artifacts: Record<ProtectedArtifactRole, ProtectedArtifact>;
    deploymentId?: string;
}
export interface ProtectedPathPolicy {
    id: string;
    path: string;
    kind: "file" | "directory";
    uid: number;
    gid: number;
    mode: number;
    assistantAccess: "read-only" | "none";
    sha256: string | null;
}
export interface ProtectedInstallationStep {
    id: string;
    requiresAdministrator: boolean;
    action: string;
    targets: string[];
}
export interface ProtectedDeploymentPlan {
    schema_version: "wringer.protected-deployment-plan.v1";
    deploymentId: string;
    platform: "darwin";
    account: { name: typeof PROTECTED_SERVICE_ACCOUNT; uid: number; gid: number; loginAllowed: false };
    assistant: { uid: number; gids: number[] };
    artifacts: Record<ProtectedArtifactRole, ProtectedArtifact>;
    paths: ProtectedPathPolicy[];
    installation: ProtectedInstallationStep[];
    removal: ProtectedInstallationStep[];
    service: { label: "com.wringer.controller"; manifestPath: typeof PROTECTED_DAEMON_PATH; entrypoint: null; installable: false };
    activation: "unavailable";
    limitation: string;
    sha256: string;
}

function insist(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function exact(value: unknown, fields: string[], label: string): asserts value is Record<string, unknown> {
    insist(value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must be an object`);
    insist(Object.keys(value).every(key => fields.includes(key)), `${label} contains an unknown field; deployment claims are not accepted as input`);
}
function uid(value: unknown, label: string): number {
    insist(Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647, `${label} must be a non-root numeric identity`);
    return value as number;
}
function artifact(value: unknown): ProtectedArtifact {
    exact(value, ["source", "sha256"], "Artifact");
    insist(typeof value.source === "string" && value.source.length <= 4096 && isAbsolute(value.source) && resolve(value.source) === value.source && !/[\x00-\x1f\x7f]/.test(value.source), "Artifact source must be one normalized absolute path");
    insist(typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256), "Artifact requires its exact SHA-256, not a release label");
    return { source: value.source, sha256: value.sha256 };
}

/** Produces an auditable plan only. It neither creates accounts nor installs a service. */
export function createProtectedDeploymentPlan(input: ProtectedDeploymentInput): ProtectedDeploymentPlan {
    exact(input, ["controllerUid", "controllerGid", "assistantUid", "assistantGids", "artifacts", "deploymentId"], "Deployment input");
    const controllerUid = uid(input.controllerUid, "Controller UID"), controllerGid = uid(input.controllerGid, "Controller GID"), assistantUid = uid(input.assistantUid, "Assistant UID");
    insist(controllerUid !== assistantUid, "The controller and unrestricted assistant cannot share an OS identity");
    insist(Array.isArray(input.assistantGids) && input.assistantGids.length > 0 && input.assistantGids.length <= 128 && input.assistantGids.every(g => Number.isSafeInteger(g) && g >= 0 && g <= 2147483647), "Assistant groups must be measured numeric identities");
    insist(!input.assistantGids.includes(controllerGid), "The unrestricted assistant cannot belong to the controller's private group");
    exact(input.artifacts, ["controller", "confirmation", "runtime"], "Artifacts");
    const artifacts = { controller: artifact(input.artifacts.controller), confirmation: artifact(input.artifacts.confirmation), runtime: artifact(input.artifacts.runtime) };
    const deploymentId = input.deploymentId ?? randomUUID();
    insist(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(deploymentId), "Deployment ID must be a UUID");
    const directory = (id: string, owner: number, group: number, mode: number, visibility: ProtectedPathPolicy["assistantAccess"]): ProtectedPathPolicy => ({ id, path: id === "installation" ? PROTECTED_INSTALL_ROOT : join(PROTECTED_INSTALL_ROOT, id), kind: "directory", uid: owner, gid: group, mode, assistantAccess: visibility, sha256: null });
    const paths: ProtectedPathPolicy[] = [
        directory("installation", 0, 0, 0o755, "read-only"), directory("bin", 0, 0, 0o755, "read-only"),
        directory("confirmation", 0, 0, 0o755, "read-only"),
        ...["controller", "credentials", "runtime"].map(id => directory(id, controllerUid, controllerGid, 0o700, "none")),
        ...(["controller", "confirmation", "runtime"] as const).map(role => ({ id: `${role}-binary`, path: join(PROTECTED_INSTALL_ROOT, "bin", role === "controller" ? "wringer-assistant" : role === "confirmation" ? "wringer-confirm" : "container"), kind: "file" as const, uid: 0, gid: 0, mode: 0o755, assistantAccess: "read-only" as const, sha256: artifacts[role].sha256 })),
        { id: "controller-public-key", path: PROTECTED_CONTROLLER_PIN, kind: "file", uid: 0, gid: 0, mode: 0o644, assistantAccess: "read-only", sha256: null },
        { id: "confirmation-signing-policy", path: PROTECTED_SIGNING_POLICY, kind: "file", uid: 0, gid: 0, mode: 0o644, assistantAccess: "read-only", sha256: null },
    ];
    const body: Omit<ProtectedDeploymentPlan, "sha256"> = {
        schema_version: "wringer.protected-deployment-plan.v1", deploymentId, platform: "darwin",
        account: { name: PROTECTED_SERVICE_ACCOUNT, uid: controllerUid, gid: controllerGid, loginAllowed: false },
        assistant: { uid: assistantUid, gids: [...new Set(input.assistantGids)].sort((a, b) => a - b) }, artifacts, paths,
        installation: [
            { id: "identity", requiresAdministrator: true, action: "Verify that the selected UID/GID are unused or already belong to this exact deployment; create a non-login service identity without altering the operator account or global permissions.", targets: [PROTECTED_SERVICE_ACCOUNT] },
            { id: "artifacts", requiresAdministrator: true, action: "Verify source artifact digests, signing identity and hardened-runtime requirements; stage and reverify root-owned installed bytes and all ancestor directories. A user-writable source checkout must not remain the executable.", targets: paths.filter(p => p.id === "installation" || p.id === "bin" || p.id.endsWith("-binary")).map(p => p.path) },
            { id: "private-state", requiresAdministrator: true, action: "Create private controller, credential and runtime storage for the service identity. Never copy grants or reset reservations when upgrading. Credential enrollment must not leave an assistant-readable alternate copy of a managed worker key.", targets: paths.filter(p => p.assistantAccess === "none").map(p => p.path) },
            { id: "runtime", requiresAdministrator: true, action: "Provision Apple Container under the protected identity, pin its image and isolate administration/control sockets. Clone repositories into role containers; never mount operator homes, runtime sockets or publication credentials into them.", targets: [join(PROTECTED_INSTALL_ROOT, "runtime")] },
            { id: "confirmation", requiresAdministrator: true, action: "Enroll a genuine human-presence-gated signing provider after verifying the trusted display and application identity. Independently verify and pin the controller public key and bind the confirmation provider public key to this deployment; file permissions alone do not establish either key's provenance. A browser token, actor field or self-signed JSON assertion does not meet this requirement.", targets: [join(PROTECTED_INSTALL_ROOT, "bin", "wringer-confirm"), join(PROTECTED_INSTALL_ROOT, "confirmation"), PROTECTED_CONTROLLER_PIN] },
            { id: "service", requiresAdministrator: true, action: "Register only an implemented protected service entrypoint. The current plan deliberately supplies no runnable daemon: cooperative-local serve must never be registered and labelled protected.", targets: [PROTECTED_DAEMON_PATH] },
            { id: "measure", requiresAdministrator: false, action: "Measure the named coding app's direct shell/filesystem/browser capabilities against controller writes, keys, runtime administration, fresh-root budget bypass and forged approvals. Repeat across restart, revocation and update before activating.", targets: [PROTECTED_INSTALL_ROOT] },
        ],
        removal: [
            { id: "revoke", requiresAdministrator: false, action: "Revoke assistant connections and stop future dispatch. Preserve pending effects, original reservations and uncertain outcomes; revocation does not refund or undo provider acceptance.", targets: [join(PROTECTED_INSTALL_ROOT, "controller")] },
            { id: "stop-service", requiresAdministrator: true, action: "Verify the exact deployment identity, unload only its registered service and wait for bounded shutdown. Do not kill guessed processes or another deployment.", targets: [PROTECTED_DAEMON_PATH] },
            { id: "retain", requiresAdministrator: true, action: "Retain service-owned evidence, credentials and account until separately authorized export or removal. Uninstall does not delete journals, keys, source repositories or unrelated client configuration.", targets: [PROTECTED_INSTALL_ROOT, PROTECTED_SERVICE_ACCOUNT] },
        ],
        service: { label: "com.wringer.controller", manifestPath: PROTECTED_DAEMON_PATH, entrypoint: null, installable: false },
        activation: "unavailable", limitation: PROTECTED_DEPLOYMENT_LIMITATION,
    };
    return { ...body, sha256: hashValue(body) };
}

/** Reconstruct every derived field. A recomputed hash cannot bless altered policy. */
export function validateProtectedDeploymentPlan(value: unknown): ProtectedDeploymentPlan {
    exact(value, ["schema_version", "deploymentId", "platform", "account", "assistant", "artifacts", "paths", "installation", "removal", "service", "activation", "limitation", "sha256"], "Deployment plan");
    const input = value as unknown as ProtectedDeploymentPlan;
    const canonical = createProtectedDeploymentPlan({ controllerUid: input.account?.uid, controllerGid: input.account?.gid, assistantUid: input.assistant?.uid, assistantGids: input.assistant?.gids, artifacts: input.artifacts, deploymentId: input.deploymentId });
    insist(hashValue(value) === hashValue(canonical), "Deployment plan differs from the compiled policy; a local hash or ready flag cannot approve installation");
    return canonical;
}

export type ProtectedObservation = "denied" | "allowed" | "missing" | "unavailable";
export interface ProtectedPathInspection {
    id: string;
    path: string;
    outcome: "matches-file-policy" | "refused" | "unmeasured";
    observed: { uid: number; gid: number; mode: number; kind: string; sha256: string | null } | null;
    access: { read: ProtectedObservation; write: ProtectedObservation; traverse: ProtectedObservation | null };
    reasons: string[];
}
/** macOS ACL rights include delete/delete_child, not just POSIX write. Until an
 * explicit ACL policy exists, fail closed on any ACL instead of treating mode
 * 0755 as a complete description. Output is bounded and is never returned. */
function noMacAcl(path: string): boolean {
    if (process.platform !== "darwin") return true;
    const result = spawnSync("/bin/ls", ["-lde", path], { encoding: "utf8", timeout: 2000, maxBuffer: 64 * 1024, env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } });
    if (result.error || result.status !== 0) return false;
    const lines = result.stdout.trimEnd().split("\n");
    return lines.length === 1 && /^[bcdlps-][rwxstST-]{9}[ @]/.test(lines[0] ?? "");
}
async function observeAccess(path: string, mode: number): Promise<ProtectedObservation> {
    try { await access(path, mode); return "allowed"; }
    catch (error: any) { return ["EACCES", "EPERM"].includes(error.code) ? "denied" : error.code === "ENOENT" ? "missing" : "unavailable"; }
}
async function fileDigest(path: string): Promise<string> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await file.stat();
        insist(before.isFile() && before.size <= 512 * 1024 * 1024, "Installed artifact is not a bounded regular file");
        const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(64 * 1024);
        let position = 0;
        while (position < before.size) { const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position); insist(bytesRead > 0, "Artifact changed during inspection"); hash.update(buffer.subarray(0, bytesRead)); position += bytesRead; }
        const after = await file.stat();
        insist(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, "Artifact changed during inspection");
        return hash.digest("hex");
    } finally { await file.close(); }
}

/** Metadata and access checks never read credential contents or write probe files. */
export async function inspectProtectedPath(policy: ProtectedPathPolicy): Promise<ProtectedPathInspection> {
    insist(isAbsolute(policy.path) && resolve(policy.path) === policy.path && !/[\x00-\x1f\x7f]/.test(policy.path), "Inspection requires one normalized absolute path");
    const result: ProtectedPathInspection = { id: policy.id, path: policy.path, outcome: "unmeasured", observed: null, access: { read: "unavailable", write: "unavailable", traverse: null }, reasons: [] };
    // Do not follow an ancestor link, even when the final path itself looks safe.
    const chain = [policy.path]; while (chain.at(-1) !== "/") chain.push(dirname(chain.at(-1)!));
    try {
        for (const path of chain.reverse()) {
            const info = await lstat(path);
            insist(!info.isSymbolicLink(), "A symlink in the installation path prevents a trustworthy inspection");
            if (!noMacAcl(path)) result.reasons.push("An ACL is present or could not be measured; POSIX modes alone do not establish the installation boundary.");
            if (path !== policy.path) {
                insist(info.isDirectory(), "An ancestor is not a directory");
                if (await observeAccess(path, constants.W_OK) === "allowed") result.reasons.push("An ancestor is writable by the inspecting identity; replacing the protected child remains possible.");
            }
        }
        const info = await lstat(policy.path), kind = info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
        result.observed = { uid: info.uid, gid: info.gid, mode: info.mode & 0o7777, kind, sha256: null };
        result.access = { read: await observeAccess(policy.path, constants.R_OK), write: await observeAccess(policy.path, constants.W_OK), traverse: kind === "directory" ? await observeAccess(policy.path, constants.X_OK) : null };
        if (kind !== policy.kind || info.uid !== policy.uid || info.gid !== policy.gid || (info.mode & 0o7777) !== policy.mode) result.reasons.push("Observed type, owner, group or mode differs from the fixed installation policy.");
        if (result.access.write !== "denied") result.reasons.push("Write denial was not measured for the inspecting identity.");
        if (policy.assistantAccess === "none" && (result.access.read !== "denied" || result.access.traverse !== "denied")) result.reasons.push("Private controller, credential or runtime access was not denied.");
        if (policy.sha256) {
            insist(policy.kind === "file" && /^[a-f0-9]{64}$/.test(policy.sha256), "Only a pinned regular artifact may be hashed");
            result.observed.sha256 = await fileDigest(policy.path);
            if (result.observed.sha256 !== policy.sha256) result.reasons.push("Installed artifact bytes do not match the approved digest.");
        }
        result.outcome = result.reasons.length ? "refused" : "matches-file-policy";
    } catch (error: any) {
        result.reasons.push(error.code === "ENOENT" ? "Required installation path is missing; absence is not access-denial evidence."
            : ["EACCES", "EPERM"].includes(error.code) ? "Metadata could not be inspected; a separate trusted installer measurement is needed."
            : "The path could not be inspected safely; no protection was inferred.");
        result.outcome = result.reasons.some(reason => reason.includes("writable")) ? "refused" : "unmeasured";
    }
    return result;
}

export async function inspectProtectedDeployment(value: unknown) {
    const plan = validateProtectedDeploymentPlan(value);
    const identity = { uid: process.getuid?.() ?? null, effectiveUid: process.geteuid?.() ?? null, gids: [...new Set(process.getgroups?.() ?? [])].sort((a, b) => a - b) };
    const sameIdentity = identity.uid === plan.assistant.uid && identity.effectiveUid === plan.assistant.uid && hashValue(identity.gids) === hashValue(plan.assistant.gids);
    const paths = process.platform === "darwin" && sameIdentity ? await Promise.all(plan.paths.map(inspectProtectedPath)) : [];
    const blockers = [
        ...(process.platform !== "darwin" ? ["This deployment target is macOS; another platform cannot establish its installation."] : []),
        ...(!sameIdentity ? ["The inspecting process is not the declared assistant UID and group set; its access checks would test a different principal."] : []),
        ...(paths.some(p => p.outcome !== "matches-file-policy") ? ["One or more installed file boundaries are missing, unsafe or unmeasured."] : []),
        "No implemented protected daemon entrypoint is registered by this installation plan.",
        "A trusted confirmation provider must be enrolled and its exact-decision, presence and replay boundaries measured independently.",
        "Runtime-control sockets, service administration, alternate credentials and fresh-root budget bypass have not been tested with the named coding app.",
        "Restart, revocation and upgrade measurements must preserve the same protected identity, authority and outstanding reservations.",
    ];
    return { schema_version: "wringer.protected-deployment-inspection.v1", planSha256: plan.sha256, observedAt: new Date().toISOString(), platform: process.platform, identity, paths, outcome: "not-ready" as const, protectedReady: false as const, mutations: 0, providerCalls: 0, blockers, limitation: PROTECTED_DEPLOYMENT_LIMITATION };
}
