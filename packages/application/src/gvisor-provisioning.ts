import { open, unlink } from "node:fs/promises";
import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { parseRuntimePolicy, processDriver, type KubernetesPolicy, type RuntimeDriver } from "@wringer/runtime";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
type Request = { id: string; context: string; runtimeClass: string; image: string; secretRefs?: KubernetesPolicy["secretRefs"] };
export function previewGvisorProvision(request: Request) {
    if (!request || Object.keys(request).some(key => !["id", "context", "runtimeClass", "image", "secretRefs"].includes(key))) throw new Error("Unsupported gVisor proposal field");
    const id = assistantId(request.id), namespace = `wringer-${id}`, secretReferences = request.secretRefs ?? {};
    const policy = parseRuntimePolicy({ kind: "gvisor-kubernetes", context: request.context, namespace, runtimeClass: request.runtimeClass, image: request.image, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: Object.keys(secretReferences).sort(), secretRefs: secretReferences });
    const labels = { "wringer.dev/provision": id, "app.kubernetes.io/managed-by": "wringer" };
    const manifests = [
        { apiVersion: "v1", kind: "Namespace", metadata: { name: namespace, labels } },
        { apiVersion: "networking.k8s.io/v1", kind: "NetworkPolicy", metadata: { name: "wringer-default-deny", namespace, labels }, spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"], ingress: [], egress: [] } },
    ];
    const body = { schema_version: "wringer.gvisor-provision-plan.v1", id, context: request.context, namespace, runtimeClass: request.runtimeClass, image: request.image, secretReferences, policy, manifests, containment: "unmeasured", maxElapsedSeconds: 600,
        prerequisites: ["The selected cluster's node administrator must install runsc and configure this existing RuntimeClass with handler runsc. This plan does not install a node service.", "The CNI must enforce NetworkPolicy; configured JSON does not prove enforcement. Run the independent egress and cleanup probes.", "The exact digest image must be available to the selected Linux x64 nodes. The local Apple image store is not a registry.", "Install only the displayed Secret names/keys in the new namespace through your cluster's secret manager. Wringer neither creates nor reads their values.", "Controller access needs get on the selected RuntimeClass and namespace, create/get/list/delete for owned pods and networkpolicies, and create on pods/exec and pods/attach. Namespace creation is a separate cluster permission. No role binding or account is installed.", "The runtime adds an exact per-instance egress policy only when approved by a job. This namespace baseline grants no network access."],
        modelPromptsSent: 0, actorRequired: "operator" };
    return { ...body, sha256: hashValue(body) };
}
type Plan = ReturnType<typeof previewGvisorProvision>;
/** Reconcile deterministic cluster object identities after a lost response. No
 * update/apply/delete and no allocation of a Pod or credential read occurs. */
export async function applyGvisorProvision(root: string, plan: Plan, decision: { expectedSha256: string; actor: string }, command: RuntimeDriver["command"] = processDriver.command, signal?: AbortSignal) {
    const scrub = new Redactor(), { sha256, ...body } = plan;
    if (sha256 !== decision.expectedSha256 || hashValue(body) !== sha256 || typeof decision.actor !== "string" || !decision.actor.trim() || decision.actor.length > 200 || scrub.scrub(decision.actor) !== decision.actor) throw new Error("Review the exact gVisor installation proposal and record its actor");
    if (previewGvisorProvision({ id: plan.id, context: plan.context, runtimeClass: plan.runtimeClass, image: plan.image, secretRefs: plan.secretReferences }).sha256 !== sha256) throw new Error("Unsupported installation declaration");
    const prefix = `provisions/${plan.id}`, record = (name: string) => `${prefix}/${name}`;
    if (await assistantExists(root, record("result.json"))) { const prior = await readAssistantRecord<any>(root, record("result.json")); if (prior.planSha256 !== sha256) throw new Error("Conflicting completed provisioning identity"); return prior; }
    await createAssistantDirectory(root); await writeAssistantRecord(root, record("plan.json"), { plan });
    const lockPath = await assistantPath(root, record("operation.lock")), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Provisioning already has an owner; inspect retained recovery state"); });
    try {
        if (!await assistantExists(root, record("approval.json"))) await writeAssistantRecord(root, record("approval.json"), { schema_version: "wringer.gvisor-provision-approval.v1", planSha256: sha256, actor: decision.actor, at: new Date().toISOString() });
        const approved = await readAssistantRecord<any>(root, record("approval.json")), deadline = Date.parse(approved.at) + plan.maxElapsedSeconds * 1000;
        if (approved.planSha256 !== sha256 || !Number.isFinite(deadline) || Date.now() >= deadline) throw new Error("The original provisioning grant expired; it was not renewed");
        async function run(args: string[], input?: unknown) {
            signal?.throwIfAborted(); if (Date.now() >= deadline) throw new Error("Provisioning deadline expired");
            const result = await command(["kubectl", "--context", plan.context, ...args], { input: input ? JSON.stringify(input) : undefined, env: {}, signal, timeoutMs: Math.min(30000, deadline - Date.now()) });
            if (result.code !== 0 || result.stdout.length > 1024 ** 2) throw new Error(`Cluster inspection/installation was not confirmed (exit ${result.code}). Retained objects were not replaced.`);
            return result.stdout.trim() ? JSON.parse(result.stdout) : null;
        }
        const runtimeClass = await run(["get", "runtimeclass", plan.runtimeClass, "-o", "json"]);
        if (runtimeClass?.kind !== "RuntimeClass" || runtimeClass.metadata?.name !== plan.runtimeClass || runtimeClass.handler !== "runsc") throw new Error("The selected RuntimeClass must be observed with handler runsc before namespace creation");
        for (const expected of plan.manifests) {
            const kind = expected.kind.toLowerCase(), namespace = kind === "namespace" ? [] : ["--namespace", plan.namespace];
            const args = [...namespace, "get", kind, expected.metadata.name, "--ignore-not-found", "-o", "json"];
            let observed = await run(args);
            const start = record(`steps/${kind}.request.json`), finish = record(`steps/${kind}.result.json`);
            if (!observed) {
                if (await assistantExists(root, start)) throw new Error("Previously requested cluster object is absent or its result uncertain; no creation was repeated");
                await writeAssistantRecord(root, start, { schema_version: "wringer.gvisor-object-request.v1", planSha256: sha256, object: expected });
                await run([...namespace, "create", "-f", "-", "-o", "json"], expected);
                observed = await run(args);
            }
            if (observed?.apiVersion !== expected.apiVersion || observed.kind !== expected.kind || observed.metadata?.name !== expected.metadata.name || observed.metadata?.labels?.["wringer.dev/provision"] !== plan.id || (kind !== "namespace" && (observed.metadata?.namespace !== plan.namespace || hashValue(observed.spec) !== hashValue(expected.spec)))) throw new Error("A foreign or changed cluster object occupies this identity; Wringer will not adopt or replace it");
            await writeAssistantRecord(root, finish, { schema_version: "wringer.gvisor-object-observation.v1", planSha256: sha256, object: expected, confirmed: true });
        }
        const result = { schema_version: "wringer.gvisor-provisioned.v1", id: plan.id, planSha256: sha256, context: plan.context, namespace: plan.namespace, runtimeClass: plan.runtimeClass, image: plan.image, configuredPolicy: "observed", containment: "unmeasured", providerAcceptance: "unmeasured", secretValuesRead: false, modelPromptsSent: 0, nextAction: "Install the declared Secret references through the cluster secret manager, then measure this exact runtime's containment and cleanup independently" };
        await writeAssistantRecord(root, record("result.json"), result); return result;
    } finally { await lock.close(); await unlink(lockPath); }
}
