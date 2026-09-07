import { RuntimeError, type ApplePolicy, type KubernetesPolicy } from "./types";

const canonical = (value: unknown): string => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const refuse = (message: string): never => { throw new RuntimeError(message, "runtime-observation-mismatch"); };
const cpu = (value: unknown) => typeof value === "string" && /^\d+m$/.test(value) ? Number(value.slice(0, -1)) / 1000 : Number(value);
const memory = (value: unknown) => { const match = typeof value === "string" && /^(\d+)(Ki|Mi|Gi|Ti)?$/.exec(value); return match ? Number(match[1]) * ({ Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1024 * 1024 }[match[2] ?? ""] ?? 1 / (1024 * 1024)) : NaN; };

const appleImageDigest = (descriptor: any, policy: ApplePolicy): string => {
    const expected = /@(sha256:[0-9a-f]{64})$/.exec(policy.image)?.[1];
    if (!expected || descriptor?.digest !== expected) return refuse("Apple inspect image descriptor differs from the pinned sha256 digest");
    return expected;
};
const appleImageIdentity = (reference: unknown, descriptor: any, policy: ApplePolicy) => {
    const imageDigest = appleImageDigest(descriptor, policy);
    // Apple canonicalizes registry/library names and removes tags on digest refs.
    // The independently observed descriptor, not an alias spelling, is authority.
    if (typeof reference !== "string" || !/^\S+@sha256:[0-9a-f]{64}$/.test(reference) || reference.startsWith("-") || !reference.endsWith(`@${imageDigest}`))
        refuse("Apple inspect image reference differs from the pinned image digest");
    return { requestedImageReference: policy.image, imageReference: reference, imageDigest };
};

/** Apple 1.3.1 ImageResource: aliases are names, not proof of descriptor identity. */
export function validateAppleImageInspection(value: any, policy: ApplePolicy) {
    if (!Array.isArray(value) || value.length !== 1) refuse("Apple image inspect must resolve exactly one pinned local image");
    const config = value[0]?.configuration;
    return appleImageIdentity(config?.name, config?.descriptor, policy);
}

/** Validate real read-back fields before any repository or agent operation; never save raw env. */
export function validateAppleInspection(value: any, policy: ApplePolicy, id: string) {
    if (!Array.isArray(value) || value.length !== 1) refuse("Apple inspect must resolve exactly one named runtime");
    const instance = value[0], config = instance?.configuration;
    if (!config || config.id !== id || instance.id !== undefined && instance.id !== id || instance.status?.state !== "running") refuse("Apple inspect identity/status differs from the allocated runtime");
    const imageIdentity = appleImageIdentity(config.image?.reference, config.image?.descriptor, policy);
    if (config.resources?.cpus !== policy.cpus || config.resources?.memoryInBytes !== policy.memoryMiB * 1024 * 1024) refuse("Apple inspect CPU/memory differs from the approved limits");
    if (![config.mounts, config.publishedPorts, config.publishedSockets].every(value => Array.isArray(value) && value.length === 0) || config.ssh !== false || config.virtualization !== false || config.runtimeHandler !== "container-runtime-linux") refuse("Apple inspect contains host mounts, forwarding, virtualization, or an unverified runtime handler");
    return { id: config.id, status: instance.status.state, ...imageIdentity, resources: { cpus: config.resources.cpus, memoryInBytes: config.resources.memoryInBytes }, hostMounts: [], publishedPorts: [], publishedSockets: [], ssh: false, virtualization: false, runtimeHandler: config.runtimeHandler };
}

export function validateKubernetesPod(pod: any, expected: any, policy: KubernetesPolicy) {
    if (pod?.metadata?.name !== expected.metadata.name || pod.metadata?.namespace !== policy.namespace || !same(pod.metadata?.labels, expected.metadata.labels)) refuse("Admitted Pod identity/labels differ from the network-policy selector");
    const spec = pod.spec;
    if (!spec || spec.runtimeClassName !== policy.runtimeClass || spec.automountServiceAccountToken !== false || spec.enableServiceLinks !== false || spec.hostNetwork || spec.hostPID || spec.hostIPC || spec.shareProcessNamespace || spec.initContainers?.length || spec.ephemeralContainers?.length || spec.containers?.length !== 1) refuse("Admitted Pod isolation fields differ from the declared policy");
    if (spec.activeDeadlineSeconds !== expected.spec.activeDeadlineSeconds || spec.restartPolicy !== "Never" || !same(spec.securityContext, expected.spec.securityContext) || !same(spec.volumes, expected.spec.volumes)) refuse("Admitted Pod lifetime, security context or storage differs from policy");
    const actual = spec.containers[0], wanted = expected.spec.containers[0];
    for (const key of ["name", "image", "imagePullPolicy", "command", "env", "volumeMounts", "securityContext"])
        if (!same(actual[key], wanted[key])) refuse(`Admitted Pod container ${key} differs from policy`);
    for (const key of ["envFrom", "args", "ports", "volumeDevices"])
        if (actual[key] !== undefined && (!Array.isArray(actual[key]) || actual[key].length)) refuse(`Admitted Pod contains undeclared ${key}`);
    for (const key of ["lifecycle", "livenessProbe", "readinessProbe", "startupProbe"])
        if (actual[key] !== undefined) refuse(`Admitted Pod contains an undeclared executable ${key}`);
    if (actual.workingDir || actual.stdin || actual.stdinOnce || actual.tty) refuse("Admitted Pod contains undeclared process settings");
    for (const kind of ["requests", "limits"]) {
        const quantities = actual.resources?.[kind];
        if (!quantities || Object.keys(quantities).some(key => !["cpu", "memory"].includes(key)) || cpu(quantities.cpu) !== policy.cpus || memory(quantities.memory) !== policy.memoryMiB) refuse("Admitted Pod resource requests/limits differ from policy");
    }
    const statuses = pod.status?.containerStatuses;
    if (!Array.isArray(statuses) || statuses.length !== 1 || statuses[0]?.name !== "agent" || typeof statuses[0].imageID !== "string" || !statuses[0].imageID.endsWith(policy.image.split("@")[1]!)) refuse("Observed Pod image does not match the pinned image digest");
    return { uid: pod.metadata.uid, runtimeClassName: spec.runtimeClassName, nodeName: spec.nodeName, imageID: statuses[0].imageID, labels: pod.metadata.labels, validatedPolicy: true };
}

function selects(selector: any, labels: Record<string, string>): boolean {
    if (!selector || typeof selector !== "object" || Array.isArray(selector) || Object.keys(selector).some(key => !["matchLabels", "matchExpressions"].includes(key))) refuse("Cannot establish the effective Kubernetes NetworkPolicy selector");
    if (selector.matchLabels && Object.entries(selector.matchLabels).some(([key, value]) => labels[key] !== value)) return false;
    if (selector.matchExpressions !== undefined && !Array.isArray(selector.matchExpressions)) refuse("Cannot read NetworkPolicy selector expressions");
    for (const row of selector.matchExpressions ?? []) {
        if (!row || typeof row.key !== "string" || !["In", "NotIn", "Exists", "DoesNotExist"].includes(row.operator)) refuse("Unsupported NetworkPolicy selector expression");
        const has = Object.hasOwn(labels, row.key), included = Array.isArray(row.values) && row.values.includes(labels[row.key]);
        if (row.operator === "In" && (!has || !included) || row.operator === "NotIn" && included || row.operator === "Exists" && !has || row.operator === "DoesNotExist" && has) return false;
    }
    return true;
}
/** Kubernetes policies are additive: a second selecting allow policy defeats a local deny. */
export function validateKubernetesNetworkPolicies(list: any, expected: any, labels: Record<string, string>) {
    if (!Array.isArray(list?.items)) refuse("Cannot enumerate effective Kubernetes NetworkPolicies; execution refused");
    const owned = list.items.filter((item: any) => item?.metadata?.name === expected.metadata.name);
    if (owned.length !== 1 || owned[0].metadata.namespace !== expected.metadata.namespace || !same(owned[0].spec, expected.spec)) refuse("Observed Wringer NetworkPolicy differs from the declared selector/rules");
    const selecting: string[] = [];
    for (const item of list.items) {
        if (item.metadata?.namespace !== expected.metadata.namespace) refuse("NetworkPolicy listing contains an unexpected namespace");
        if (!selects(item.spec?.podSelector, labels)) continue;
        selecting.push(item.metadata.name);
        if (item.metadata.name === expected.metadata.name) continue;
        const types = item.spec.policyTypes ?? ["Ingress", ...(item.spec.egress !== undefined ? ["Egress"] : [])];
        if (!Array.isArray(types) || types.some((value: string) => !["Ingress", "Egress"].includes(value))) refuse("Cannot establish NetworkPolicy directions");
        if (types.includes("Ingress") && (item.spec.ingress?.length ?? 0) > 0 || types.includes("Egress") && (item.spec.egress?.length ?? 0) > 0) refuse(`Selecting NetworkPolicy ${item.metadata.name} grants additional network access; use a controlled namespace with no overlapping allow policies`);
    }
    return { selectingPolicies: selecting.sort(), declaredRulesVerified: true, caveat: "Read-back is a point-in-time policy check; CNI enforcement and privileged cluster policy changes require the live platform gate and a controlled namespace." };
}
