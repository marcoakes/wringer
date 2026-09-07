import { randomUUID } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import type { AcpTransport, AgentDeclaration, AgentRole } from "@wringer/acp";
import { firewallScript, quote, validateRepository } from "./policy";
import { RuntimeError, type RuntimePolicy, type RuntimeDriver, type RepositorySource, type RuntimeProvenance, type RuntimeCommandOptions, type CommandResult, type KubernetesPolicy } from "./types";
export const REPO = "/workspace/repo";
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
const cpuQuantity = (value: unknown) => typeof value === "string" && /^\d+m$/.test(value) ? Number(value.slice(0, -1)) / 1000 : Number(value);
const memoryQuantity = (value: unknown) => { if (typeof value !== "string")
    return NaN; const match = /^(\d+)(Ki|Mi|Gi|Ti)?$/.exec(value); return match ? Number(match[1]) * ({ Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1024 * 1024 }[match[2] ?? ""] ?? 1 / (1024 * 1024)) : NaN; };
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
}): Promise<Sandbox> {
    const { role, repo, policy, driver, redact } = input, id = `wringer-${role}-${randomUUID()}`, deadline = Date.now() + input.timeoutMs;
    const observed: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = {}, readonly = role === "planner" || role === "judge";
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
        throw new RuntimeError("Sandbox allocation/execution deadline expired", "timeout"); return driver.command(argv, { ...options, env, signal: input.signal, timeoutMs: Math.min(options.timeoutMs ?? 30000, remaining) }); };
    const checked = async (argv: string[], options: RuntimeCommandOptions = {}) => { const result = await command(argv, options); if (result.code !== 0)
        throw new RuntimeError(`Contained runtime operation failed (${result.code}): ${redact(result.stderr || result.stdout)}`, "runtime-operation-failed"); return result; };
    let execPrefix: string[] = [], connectPrefix: string[] = [], created = false, policyCreated = false;
    const kube = policy.kind === "gvisor-kubernetes" ? [policy.binary ?? "kubectl", "--context", policy.context, "--namespace", policy.namespace] : [];
    const close = async () => {
        // Cleanup is independent of the expired/user-aborted execution deadline.
        if (created) {
            const args = policy.kind === "apple-container" ? [policy.binary ?? "container", "delete", "--force", id] : [...kube, "delete", "pod", id, "--wait=false", "--ignore-not-found=true"];
            const result = await driver.command(args, { timeoutMs: 15000, env });
            if (result.code !== 0)
                throw new RuntimeError(`Could not confirm cleanup of ${id}: ${redact(result.stderr)}`, "cleanup-failed");
            created = false;
        }
        if (policyCreated) {
            const result = await driver.command([...kube, "delete", "networkpolicy", id, "--wait=false", "--ignore-not-found=true"], { timeoutMs: 15000 });
            if (result.code !== 0)
                throw new RuntimeError(`Could not confirm cleanup of network policy ${id}`, "cleanup-failed");
            policyCreated = false;
        }
    };
    const exec = async (argv: string[], options: RuntimeCommandOptions = {}) => command([...execPrefix, ...argv], options);
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
            created = true;
            await checked([binary, "run", "--detach", "--name", id, "--cpus", String(policy.cpus), "--memory", `${policy.memoryMiB}M`, "--cap-add", "NET_ADMIN", "--env", "HOME=/home/agent", ...(policy.env ?? []).flatMap(name => ["--env", name]), "--entrypoint", "/bin/sh", policy.image, "-c", `exec sleep ${Math.ceil(input.timeoutMs / 1000) + 60}`]);
            execPrefix = [binary, "exec", "--workdir", "/", id];
            connectPrefix = [binary, "exec", "--interactive", "--workdir", REPO, id];
            observed.networkRules = redact((await must(["/bin/sh", "-c", firewallScript(policy)])).stdout);
            const inspection = parse((await checked([binary, "inspect", id])).stdout, "Apple container inspect");
            // Inspect can include inherited environment values; never retain the raw object.
            const instance = Array.isArray(inspection) ? inspection[0] : inspection;
            observed.instance = { id: instance?.configuration?.id ?? instance?.id ?? id, status: instance?.status ?? null, imageReference: instance?.configuration?.image?.reference ?? null };
        }
        else {
            const runtime = parse((await checked([policy.binary ?? "kubectl", "--context", policy.context, "get", "runtimeclass", policy.runtimeClass, "-o", "json"])).stdout, "Kubernetes RuntimeClass");
            if (runtime.handler !== "runsc")
                throw new RuntimeError(`RuntimeClass ${policy.runtimeClass} does not declare the gVisor runsc handler; isolation refused`, "runtime-class-mismatch");
            observed.runtimeClass = { name: runtime.metadata?.name, uid: runtime.metadata?.uid, handler: runtime.handler };
            policyCreated = true;
            await checked([...kube, "create", "-f", "-"], { input: JSON.stringify(kubernetesNetworkPolicy(policy, id)) });
            created = true;
            await checked([...kube, "create", "-f", "-"], { input: JSON.stringify(kubernetesPod(policy, id, role, input.timeoutMs)) });
            await checked([...kube, "wait", "--for=condition=Ready", `pod/${id}`, `--timeout=${Math.max(1, Math.floor((deadline - Date.now()) / 1000))}s`], { timeoutMs: deadline - Date.now() });
            const pod = parse((await checked([...kube, "get", "pod", id, "-o", "json"])).stdout, "Kubernetes Pod");
            if (pod.spec?.runtimeClassName !== policy.runtimeClass || pod.spec?.automountServiceAccountToken !== false || pod.spec?.hostNetwork || pod.spec?.hostPID || pod.spec?.hostIPC || pod.spec?.shareProcessNamespace || pod.spec?.volumes?.length !== 4 || (pod.spec?.volumes ?? []).some((volume: any) => !volume.emptyDir || Object.keys(volume).some(key => !["name", "emptyDir"].includes(key))) || pod.spec?.containers?.length !== 1 || pod.spec?.initContainers?.length || pod.spec?.ephemeralContainers?.length)
                throw new RuntimeError("Observed Pod isolation fields differ from the declared policy", "runtime-observation-mismatch");
            const actualContainer = pod.spec.containers[0];
            if (actualContainer.image !== policy.image || actualContainer.securityContext?.privileged !== false || actualContainer.securityContext?.allowPrivilegeEscalation !== false || actualContainer.securityContext?.readOnlyRootFilesystem !== true || cpuQuantity(actualContainer.resources?.limits?.cpu) !== policy.cpus || memoryQuantity(actualContainer.resources?.limits?.memory) !== policy.memoryMiB)
                throw new RuntimeError("Observed Pod image/security/resource limits differ from policy", "runtime-observation-mismatch");
            const actualImage = pod.status?.containerStatuses?.[0]?.imageID;
            if (typeof actualImage !== "string" || !actualImage.includes(policy.image.split("@")[1]!))
                throw new RuntimeError("Observed Pod image does not match the pinned image digest", "runtime-image-mismatch");
            observed.pod = { uid: pod.metadata?.uid, runtimeClassName: pod.spec.runtimeClassName, nodeName: pod.spec.nodeName, imageID: actualImage };
            execPrefix = [...kube, "exec", "-i", id, "--"];
            connectPrefix = [...kube, "exec", "-i", id, "--"];
        }
        await must(["/bin/sh", "-c", "set -eu; command -v git >/dev/null; command -v setpriv >/dev/null; command -v timeout >/dev/null; mkdir -p /input /workspace /home/agent; chmod 755 /input /workspace; chown 1000:1000 /home/agent"]);
        await importSource(repo, REPO);
        await must(["/bin/sh", "-c", readonly ? `chmod -R a-w ${quote(REPO)}; chown -R 0:0 ${quote(REPO)}` : `chown -R 1000:1000 ${quote(REPO)}`]);
        observed.executionIdentity = redact((await must([...dropPrivileges, ...agentEnvironment, "/bin/sh", "-c", "set -eu; test \"$(id -u)\" = 1000; test \"$(id -g)\" = 1000; awk '/^Cap(Eff|Bnd):/ { if ($2 !~ /^0+$/) exit 1; seen++ } /^NoNewPrivs:/ { if ($2 != \"1\") exit 1; seen++ } END { if (seen != 3) exit 1 }' /proc/self/status; id; awk '/^(Uid|Gid|CapEff|CapBnd|NoNewPrivs):/' /proc/self/status"])).stdout.trim());
        const provenance: RuntimeProvenance = { schema_version: "wringer.runtime.v1", runtimeId: id, role, kind: policy.kind, image: policy.image, repository: { url: repo.url, commit: repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: readonly ? "read-only" : "read-write", declared: policy, observed: JSON.parse(redact(JSON.stringify(observed))), limits: ["Platform isolation and network enforcement require the live platform release gate; configuration and inspect records are not escape-proof evidence.", "Only explicitly declared environment names cross; no host home, agent socket, login directory, or publication credential is mounted."] };
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
