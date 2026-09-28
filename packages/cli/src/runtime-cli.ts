import { dirname, join, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import { applicationDirectory, applyAppleProvision, applyGvisorProvision, assistantId, previewAppleProvision, previewGvisorProvision, readAssistantRecord, writeAssistantRecord } from "@wringer/application";
import { inspectRuntime } from "@wringer/runtime";
import { allowed, flag, number, positionals, quote, required, string, values, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";
export const RUNTIME_HELP = `Contained runtime preparation

  wring runtime catalogue
  wring runtime inspect --kind apple-container|gvisor-kubernetes [--image REF]
  wring runtime provision --kind apple-container [--id UUID] [--start-service] --dry-run --json
  wring runtime provision --kind apple-container --id UUID --expected SHA256 --actor NAME [--start-service] --apply
  wring runtime measure --provision UUID --address LOCAL_IPV4
  wring runtime provision --kind gvisor-kubernetes --context CONTEXT --runtime-class CLASS --image DIGEST_REF [--secret-ref ENV=NAME:KEY] [--id UUID]
  wring runtime provision --kind gvisor-kubernetes --id UUID --expected SHA256 --actor NAME --apply [same preview options on first application]
  wring runtime measure --provision GVISOR_UUID --address OWNED_CONTROL_IPV4 --port TCP_PORT

Review the exact proposal before --apply. Reuse its --id, --expected, and service
choice. Applying may download images and allocate a bounded build. --start-service
explicitly permits starting Apple Container's service. Completed operations are
observed on resume; uncertain effects are retained and never blindly repeated.
measure allocates contained no-model probes and a temporary local TCP control.
Inspection, image build, containment, ACP, and provider acceptance are separate.
No host-worker fallback, credential retrieval, login, or model prompt is provided.
--app-dir selects private Wringer state outside target repositories.
`;
export async function runtimeAssets() {
    return import.meta.url.includes("/$bunfs/") || import.meta.url.includes("B:/~BUN/") ? join(dirname(await realpath(process.execPath)), "runtime") : resolve(import.meta.dir, "../../../runtime");
}
export async function runtimeCommand(a: Args, context: DispatchContext): Promise<Answer> {
    if (flag(a, "help")) return { text: RUNTIME_HELP };
    positionals(a, 1); const verb = a.words[0], root = applicationDirectory(string(a, "app-dir"));
    if (verb === "catalogue") {
        allowed(a, []);
        const profiles = ["apple-container", "gvisor-kubernetes"].map(kind => ({ id: `node-bun-2026-09-27/${kind}`, kind, platform: kind === "apple-container" ? "macOS arm64" : "Linux x64", tools: { bun: "1.4.2", node: "24" }, adapters: { openai: { package: "@agentclientprotocol/codex-acp", version: "1.10.0" }, anthropic: { package: "@agentclientprotocol/claude-agent-acp", version: "0.65.0" } }, modelSelection: "explicit", executionBoundary: "contained", roles: "Separate writable storage, sessions, and runtime identities", image: "Build recipe with pinned inputs; no published image claimed", providerAcceptance: "unmeasured", containment: "Requires this host's independent readiness report", prerequisites: ["Reviewed clean Git source", "Explicit writable source and protected acceptance inputs", "Explicit network policy and credential reference names"] }));
        return { value: { schema_version: "wringer.runtime-catalogue.v1", profiles } };
    }
    if (verb === "inspect") {
        allowed(a, ["app-dir", "kind", "image", "context", "namespace", "runtime-class"]);
        const value = await inspectRuntime({ kind: required(a, "kind") as any, ...(string(a, "image") ? { image: string(a, "image") } : {}), ...(string(a, "context") ? { context: string(a, "context"), namespace: required(a, "namespace"), runtimeClass: required(a, "runtime-class") } : {}) });
        return { value };
    }
    if (verb === "provision") {
        allowed(a, ["app-dir", "kind", "id", "start-service", "dry-run", "apply", "expected", "actor", "image", "context", "runtime-class", "secret-ref"]);
        const kind = required(a, "kind");
        if (!["apple-container", "gvisor-kubernetes"].includes(kind)) throw new Error("Select a contained runtime; no host fallback");
        if (flag(a, "apply") && flag(a, "dry-run")) throw new Error("Choose dry-run or apply");
        const id = assistantId(flag(a, "apply") ? required(a, "id") : string(a, "id", crypto.randomUUID()));
        const expected = flag(a, "apply") ? required(a, "expected") : null, actor = flag(a, "apply") ? required(a, "actor") : null;
        if (kind === "gvisor-kubernetes") {
            if (flag(a, "start-service")) throw new Error("Cluster node provisioning is an administrator action; this plan installs no service");
            let plan;
            try { plan = (await readAssistantRecord<any>(root, `provisions/${id}/plan.json`)).plan; }
            catch (error: any) { if (error.code !== "ENOENT") throw error; }
            if (!plan) {
                const secretRefs: Record<string, { name: string; key: string }> = {};
                for (const value of values(a, "secret-ref") ?? []) {
                    const match = /^([A-Z_][A-Z0-9_]*)=([a-z0-9.-]+):([A-Za-z0-9_.-]+)$/.exec(value);
                    if (!match || Object.hasOwn(secretRefs, match[1]!)) throw new Error("Use distinct --secret-ref ENV=SECRET_NAME:KEY references, never values");
                    secretRefs[match[1]!] = { name: match[2]!, key: match[3]! };
                }
                plan = previewGvisorProvision({ id, context: required(a, "context"), runtimeClass: required(a, "runtime-class"), image: required(a, "image"), secretRefs });
            }
            if (expected) return { value: await applyGvisorProvision(root, plan, { expectedSha256: expected, actor: actor! }, undefined, context.signal) };
            const apply = ["wring", "runtime", "provision", "--kind", kind, "--app-dir", root, "--id", id, "--expected", plan.sha256, "--context", plan.context, "--runtime-class", plan.runtimeClass, "--image", plan.image, ...Object.entries(plan.secretReferences as Record<string, { name: string; key: string }>).flatMap(([name, reference]) => ["--secret-ref", `${name}=${reference.name}:${reference.key}`]), "--actor", "YOUR_NAME", "--apply"].map(quote).join(" ");
            return { value: { ...plan, apply } };
        }
        const assets = await runtimeAssets();
        // A completed operation remains observable without contacting an old host.
        if (expected) {
            try { const { plan } = await readAssistantRecord<any>(root, `provisions/${id}/plan.json`); return { value: await applyAppleProvision(root, assets, plan, { expectedSha256: expected, actor: actor! }, undefined, context.signal) }; }
            catch (error: any) { if (error.code !== "ENOENT") throw error; }
        }
        const host = await inspectRuntime({ kind: "apple-container" }), plan = await previewAppleProvision(assets, { idempotencyKey: id, startService: flag(a, "start-service") }, host);
        if (!expected) return { value: { ...plan, host, apply: ["wring", "runtime", "provision", "--kind", "apple-container", "--app-dir", root, "--id", id, "--expected", plan.sha256, ...(plan.startService ? ["--start-service"] : []), "--actor", "YOUR_NAME", "--apply"].map(quote).join(" ") } };
        return { value: await applyAppleProvision(root, assets, plan, { expectedSha256: expected, actor: actor! }, undefined, context.signal) };
    }
    if (verb === "measure") {
        allowed(a, ["app-dir", "provision", "address", "port"]);
        const id = assistantId(required(a, "provision")), result = await readAssistantRecord<any>(root, `provisions/${id}/result.json`);
        if (!["wringer.runtime-provisioned.v1", "wringer.gvisor-provisioned.v1"].includes(result.schema_version) || result.id !== id) throw new Error("No completed exact provisioning result");
        const output = join(root, "provisions", id, `readiness-${crypto.randomUUID()}`);
        async function retain(report: any) {
            const inventory = report.rows?.find((row: any) => row.id === "runtime-inventory" && row.status === "pass")?.detail;
            const measurementId = assistantId(output.split("readiness-").at(-1));
            await writeAssistantRecord(root, `provisions/${id}/readiness/${measurementId}.json`, { schema_version: "wringer.runtime-readiness.v1", id: measurementId, provisionId: id, image: result.image, status: report.status, inventory: inventory ?? null, measuredAt: report.finished, reportPath: `readiness-${measurementId}/report.json`, reportSha256: (await import("@wringer/plan")).hashValue(report), providerAcceptance: "unmeasured", modelPromptsSent: 0 });
            return measurementId;
        }
        if (result.schema_version === "wringer.gvisor-provisioned.v1") {
            const { runtimeSmoke, parseSmokeProfile } = await import("../../../scripts/runtime-smoke");
            const profile = parseSmokeProfile({ runtime: { kind: "gvisor-kubernetes", image: result.image, context: result.context, namespace: result.namespace, runtimeClass: result.runtimeClass, cpus: 1, memoryMiB: 512, network: { policy: "deny" }, env: [], secretRefs: {} }, networkProbe: { address: required(a, "address"), port: number(a, "port", 0) }, timeoutMs: 600000 });
            const report = await runtimeSmoke(profile, output, context.signal);
            return { value: { report, directory: output, readinessId: await retain(report) }, exit: report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2 };
        }
        const { runtimeSmokeLocal } = await import("../../../scripts/runtime-smoke-local");
        const value = await runtimeSmokeLocal({ image: result.image, address: required(a, "address"), output }, context.signal);
        return { value: { ...value, readinessId: await retain(value.report) }, exit: value.report.status === "pass" ? 0 : value.report.status === "fail" ? 1 : 2 };
    }
    throw new Error(RUNTIME_HELP);
}
