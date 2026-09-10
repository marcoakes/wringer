import { randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import type { AcpTransport, AgentDeclaration, AgentRole } from "@wringer/acp";
import { firewallScript, quote, runtimeProvenanceVersion, validateRepository } from "./policy";
import { parseWorkerScope, repositoryPermissionsScript } from "./filesystem";
import { validateAppleImageInspection, validateAppleInspection, validateKubernetesPod, validateKubernetesNetworkPolicies } from "./observations";
import { RuntimeError, type RuntimePolicy, type RuntimeDriver, type RepositorySource, type RuntimeProvenance, type RuntimeCommandOptions, type CommandResult, type KubernetesPolicy, type WorkerScope } from "./types";
export const REPO = "/workspace/repo";
/** Apple 1.3.1 list is an array of snapshots. Unknown rows are not proof of absence. */
export function appleContainerIds(value: unknown): string[] {
    if (!Array.isArray(value)) throw new RuntimeError("Apple container list did not return a snapshot array", "cleanup-unconfirmed");
    return value.map((row: any) => {
        const id = row?.configuration?.id ?? row?.id;
        if (!row || typeof row !== "object" || typeof id !== "string" || !id || row.id !== undefined && row.configuration?.id !== undefined && row.id !== row.configuration.id)
            throw new RuntimeError("Apple container list returned an unrecognized identity; cleanup is unconfirmed", "cleanup-unconfirmed");
        return id;
    });
}
const dropPrivileges = ["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--"];
const agentEnvironment = ["env", "HOME=/home/agent", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_CONFIG_COUNT=3", "GIT_CONFIG_KEY_0=safe.directory", `GIT_CONFIG_VALUE_0=${REPO}`, "GIT_CONFIG_KEY_1=core.hooksPath", "GIT_CONFIG_VALUE_1=/dev/null", "GIT_CONFIG_KEY_2=core.fsmonitor", "GIT_CONFIG_VALUE_2=false"];
export interface Sandbox {
    provenance: RuntimeProvenance;
    exec(argv: string[], options?: RuntimeCommandOptions): Promise<CommandResult>;
    run(argv: string[], options?: RuntimeCommandOptions): Promise<CommandResult>;
    connect(agent: AgentDeclaration): Promise<AcpTransport>;
    importSource(source: RepositorySource, destination: string): Promise<void>;
    close(): Promise<void>;
}
const parse = (text: string, label: string): any => { try {
    return JSON.parse(text);
}
catch {
    throw new RuntimeError(`${label} returned unreadable JSON`);
} };
export function kubernetesNetworkPolicy(policy: KubernetesPolicy, id: string) {
    const egress: any[] = [];
    for (const rule of policy.network.allow ?? [])
        egress.push({ to: [{ ipBlock: { cidr: rule.cidr } }], ports: rule.ports.map(port => ({ protocol: "TCP", port })) });
    for (const dns of policy.network.dns ?? [])
        egress.push({ to: [{ ipBlock: { cidr: `${dns}/32` } }], ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }] });
    return { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: id, namespace: policy.namespace }, spec: { podSelector: { matchLabels: { "wringer.dev/runtime": id } }, policyTypes: ["Ingress", "Egress"], ingress: [], egress } };
}
export function kubernetesPod(policy: KubernetesPolicy, id: string, role: AgentRole | "verifier", timeoutMs: number) {
    return { apiVersion: "v1", kind: "Pod", metadata: { name: id, namespace: policy.namespace, labels: { "wringer.dev/runtime": id, "wringer.dev/role": role } }, spec: { runtimeClassName: policy.runtimeClass, automountServiceAccountToken: false, enableServiceLinks: false, hostNetwork: false, hostPID: false, hostIPC: false, restartPolicy: "Never", activeDeadlineSeconds: Math.ceil(timeoutMs / 1000) + 60, securityContext: { seccompProfile: { type: "RuntimeDefault" } }, containers: [{ name: "agent", image: policy.image, imagePullPolicy: "IfNotPresent", command: ["/bin/sh", "-c", `exec sleep ${Math.ceil(timeoutMs / 1000) + 60}`], env: [{ name: "HOME", value: "/home/agent" }, ...(policy.env ?? []).map(name => ({ name, valueFrom: { secretKeyRef: policy.secretRefs?.[name] } }))], resources: { requests: { cpu: String(policy.cpus), memory: `${policy.memoryMiB}Mi` }, limits: { cpu: String(policy.cpus), memory: `${policy.memoryMiB}Mi` } }, securityContext: { runAsUser: 0, allowPrivilegeEscalation: false, privileged: false, readOnlyRootFilesystem: true, capabilities: { drop: ["ALL"], add: ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "SETPCAP"] } }, volumeMounts: [{ name: "workspace", mountPath: "/workspace" }, { name: "input", mountPath: "/input" }, { name: "home", mountPath: "/home/agent" }, { name: "tmp", mountPath: "/tmp" }] }], volumes: [{ name: "workspace", emptyDir: { sizeLimit: "4Gi" } }, { name: "input", emptyDir: { sizeLimit: "1Gi" } }, { name: "home", emptyDir: { sizeLimit: "1Gi" } }, { name: "tmp", emptyDir: { sizeLimit: "1Gi" } }] } };
}
/** Creates a fresh named runtime. No host agent executable or repository is mounted. */
export async function openSandbox(input: {
    role: AgentRole | "verifier";
    repo: RepositorySource;
    policy: RuntimePolicy;
    timeoutMs: number;
    signal?: AbortSignal;
    driver: RuntimeDriver;
    redact: (text: string) => string;
    scope?: WorkerScope;
}): Promise<Sandbox> {
    const { role, repo, policy, driver, redact } = input, id = `wringer-${role}-${randomUUID()}`, deadline = Date.now() + input.timeoutMs;
    const observed: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}, readonly = role !== "worker";
    const scope = role === "worker" ? parseWorkerScope(input.scope) : undefined;
    for (const name of policy.env ?? []) {
        if (policy.kind === "apple-container") {
            if (!process.env[name])
                throw new RuntimeError(`Declared runtime environment ${name} is not available; no login or keychain mutation was attempted`, "credential-unavailable");
            env[name] = process.env[name];
        }
        else if (!policy.secretRefs?.[name])
            throw new RuntimeError(`Kubernetes environment ${name} needs an existing declared Secret reference`);
    }
    const command = async (argv: string[], options: RuntimeCommandOptions = {}) => { const remaining = deadline - Date.now(); if (remaining <= 0)
        throw new RuntimeError("Sandbox allocation/execution deadline expired", "timeout"); return driver.command(argv, { ...options, env: {}, signal: input.signal, timeoutMs: Math.min(options.timeoutMs ?? 30000, remaining) }); };
    const checked = async (argv: string[], options: RuntimeCommandOptions = {}) => { const result = await command(argv, options); if (result.code !== 0)
        throw new RuntimeError(`Contained runtime operation failed (${result.code}): ${redact(result.stderr || result.stdout)}`, "runtime-operation-failed"); return result; };
    let execPrefix: string[] = [], connectPrefix: string[] = [], created = false, policyCreated = false;
    const kube = policy.kind === "gvisor-kubernetes" ? [policy.binary ?? "kubectl", "--context", policy.context, "--namespace", policy.namespace] : [];
    const close = async () => {
        // Cleanup is independent of the expired/user-aborted execution deadline.
        if (created) {
            const args = policy.kind === "apple-container" ? [policy.binary ?? "container", "delete", "--force", id] : [...kube, "delete", "pod", id, "--wait=true", "--timeout=15s", "--grace-period=0", "--ignore-not-found=true"];
            let failure: string | undefined;
            try {
                const result = await driver.command(args, { timeoutMs: 15000, env: {} });
                if (result.code !== 0) failure = result.stderr || result.stdout || `exit ${result.code}`;
            } catch (error) { failure = String(error); }
            if (failure && policy.kind === "apple-container") {
                // A failed/uncertain create may leave no container, or deletion may complete
                // before its reply is lost. Only a successful exact-identity listing resolves it.
                try {
                    const listing = await driver.command([policy.binary ?? "container", "list", "--all", "--format", "json"], { timeoutMs: 15000, env: {} });
                    if (listing.code === 0 && !appleContainerIds(parse(listing.stdout, "Apple container list")).includes(id)) {
                        observed.cleanup = { runtimeId: id, reconciledAbsent: true };
                        failure = undefined;
                    }
                } catch { /* Preserve the original failure; unknown is not absence. */ }
            }
            if (failure) throw new RuntimeError(`Could not confirm cleanup of ${id}: ${redact(failure)}`, "cleanup-failed");
            created = false;
        }
        if (policyCreated) {
            const result = await driver.command([...kube, "delete", "networkpolicy", id, "--wait=false", "--ignore-not-found=true"], { timeoutMs: 15000 });
            if (result.code !== 0)
                throw new RuntimeError(`Could not confirm cleanup of network policy ${id}`, "cleanup-failed");
            policyCreated = false;
        }
    };
    const exec = async (argv: string[], options: RuntimeCommandOptions = {}) => command([
        ...execPrefix.slice(0, 2),
        ...(policy.kind === "apple-container" && options.input !== undefined ? ["--interactive"] : []),
        ...execPrefix.slice(2), ...argv,
    ], options);
    const must = async (argv: string[], options: RuntimeCommandOptions = {}) => { const result = await exec(argv, options); if (result.code !== 0)
        throw new RuntimeError(`Sandbox preparation failed (${result.code}): ${redact(result.stderr || result.stdout)}`, "sandbox-preparation-failed"); return result; };
    const importSource = async (source: RepositorySource, destination: string) => {
        validateRepository(source);
        if (!/^\/workspace\/[a-z-]+$/.test(destination))
            throw new RuntimeError("Invalid contained repository destination");
        let origin = source.url;
        if (source.bundlePath) {
            const info = await lstat(source.bundlePath);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024)
                throw new RuntimeError("Git bundle must be a regular non-symlink file no larger than 64 MiB");
            const path = `/input/${destination.split("/").at(-1)}.bundle`;
            if (policy.kind === "apple-container")
                await checked([policy.binary ?? "container", "copy", source.bundlePath, `${id}:${path}`]);
            else
                await must(["/bin/sh", "-c", `cat > ${quote(path)}`], { input: await readFile(source.bundlePath) });
            origin = path;
        }
        await must(["/bin/sh", "-c", `set -eu\ngit -c protocol.file.allow=always clone --no-checkout -- ${quote(origin)} ${quote(destination)}\ngit -C ${quote(destination)} checkout --detach ${quote(source.commit)}\ntest "$(git -C ${quote(destination)} rev-parse HEAD)" = ${quote(source.commit)}\n`]);
    };
    try {
        if (policy.kind === "apple-container") {
            const binary = policy.binary ?? "container";
            observed.clientVersion = redact((await checked([binary, "--version"])).stdout.trim());
            observed.image = validateAppleImageInspection(parse((await checked([binary, "image", "inspect", policy.image])).stdout, "Apple image inspect"), policy);
            created = true;
            // No provider values enter allocation. A digest-looking local alias may
            // resolve to different content, so validate the allocated descriptor too.
            await checked([binary, "run", "--detach", "--name", id, "--cpus", String(policy.cpus), "--memory", `${policy.memoryMiB}M`, "--cap-add", "NET_ADMIN", "--env", "HOME=/home/agent", "--entrypoint", "/bin/sh", policy.image, "-c", `exec sleep ${Math.ceil(input.timeoutMs / 1000) + 60}`]);
            execPrefix = [binary, "exec", "--workdir", "/", id];
            connectPrefix = [binary, "exec", "--interactive", "--workdir", REPO, ...(policy.env ?? []).flatMap(name => ["--env", name]), id];
            const inspection = parse((await checked([binary, "inspect", id])).stdout, "Apple container inspect");
            // Inspect can include inherited environment values; never retain the raw object.
            observed.instance = validateAppleInspection(inspection, policy, id);
            observed.credentialInjection = { phase: "agent-connection-only", names: policy.env ?? [], allocation: "HOME-only" };
            observed.networkRules = redact((await must(["/bin/sh", "-c", firewallScript(policy)])).stdout);
        }
        else {
            const runtime = parse((await checked([policy.binary ?? "kubectl", "--context", policy.context, "get", "runtimeclass", policy.runtimeClass, "-o", "json"])).stdout, "Kubernetes RuntimeClass");
            if (runtime.handler !== "runsc")
                throw new RuntimeError(`RuntimeClass ${policy.runtimeClass} does not declare the gVisor runsc handler; isolation refused`, "runtime-class-mismatch");
            observed.runtimeClass = { name: runtime.metadata?.name, uid: runtime.metadata?.uid, handler: runtime.handler };
            policyCreated = true;
            const networkDeclaration = kubernetesNetworkPolicy(policy, id), podDeclaration = kubernetesPod(policy, id, role, input.timeoutMs);
            await checked([...kube, "create", "-f", "-"], { input: JSON.stringify(networkDeclaration) });
            const inspectNetwork = async () => validateKubernetesNetworkPolicies(parse((await checked([...kube, "get", "networkpolicies", "-o", "json"])).stdout, "Kubernetes NetworkPolicies"), networkDeclaration, podDeclaration.metadata.labels);
            observed.networkPolicy = await inspectNetwork();
            created = true;
            await checked([...kube, "create", "-f", "-"], { input: JSON.stringify(podDeclaration) });
            await checked([...kube, "wait", "--for=condition=Ready", `pod/${id}`, `--timeout=${Math.max(1, Math.floor((deadline - Date.now()) / 1000))}s`], { timeoutMs: deadline - Date.now() });
            const pod = parse((await checked([...kube, "get", "pod", id, "-o", "json"])).stdout, "Kubernetes Pod");
            observed.pod = validateKubernetesPod(pod, podDeclaration, policy);
            observed.networkPolicy = await inspectNetwork();
            execPrefix = [...kube, "exec", "-i", id, "--"];
            connectPrefix = [...kube, "exec", "-i", id, "--"];
        }
        await must(["/bin/sh", "-c", "set -eu; command -v git >/dev/null; command -v setpriv >/dev/null; command -v timeout >/dev/null; command -v pkill >/dev/null; command -v pgrep >/dev/null; mkdir -p /input /workspace /home/agent; chmod 755 /input /workspace; chown 1000:1000 /home/agent"]);
        await importSource(repo, REPO);
        await must(["/bin/sh", "-c", repositoryPermissionsScript(REPO, scope)]);
        observed.filesystem = { mode: readonly ? "read-only-source" : "scoped-worker", ...(scope ? { scope } : {}), gitMetadata: "controller-owned-read-only", protectedParents: "read-only", limitation: "New siblings cannot be created in a locked parent. Declare existing scoped paths and explicit untracked output directories in the approved plan." };
        observed.executionIdentity = redact((await must([...dropPrivileges, ...agentEnvironment, "/bin/sh", "-c", "set -eu; test \"$(id -u)\" = 1000; test \"$(id -g)\" = 1000; awk '/^Cap(Eff|Bnd):/ { if ($2 !~ /^0+$/) exit 1; seen++ } /^NoNewPrivs:/ { if ($2 != \"1\") exit 1; seen++ } END { if (seen != 3) exit 1 }' /proc/self/status; id; awk '/^(Uid|Gid|CapEff|CapBnd|NoNewPrivs):/' /proc/self/status"])).stdout.trim());
        const provenance: RuntimeProvenance = { schema_version: runtimeProvenanceVersion(repo.url), runtimeId: id, role, kind: policy.kind, image: policy.image, repository: { url: repo.url, commit: repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: readonly ? "read-only" : "read-write", declared: policy, observed: JSON.parse(redact(JSON.stringify(observed))), limits: ["Platform isolation and network enforcement require the live platform release gate; configuration and inspect records are not escape-proof evidence.", "Only explicitly declared environment names cross; no host home, agent socket, login directory, or publication credential is mounted."] };
        return { provenance, exec, run: async (argv, options) => exec([...dropPrivileges, ...agentEnvironment, "/bin/sh", "-c", `cd ${quote(REPO)}; exec "$@"`, "wringer-command", ...argv], options), connect: async (agent) => driver.connect([...connectPrefix, ...dropPrivileges, ...agentEnvironment, "/bin/sh", "-c", `cd ${quote(REPO)}; exec "$@"`, "wringer-agent", agent.command, ...(agent.args ?? [])], { env, signal: input.signal, timeoutMs: deadline - Date.now() }), importSource, close };
    }
    catch (error) {
        try {
            await close();
        }
        catch (cleanup) {
            throw new RuntimeError(`${redact(String(error))}; ${String(cleanup)}`, "cleanup-failed");
        }
        throw error;
    }
}
