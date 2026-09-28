import { cp, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { hashBytes, hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { inspectRuntime, processDriver, type RuntimeDriver } from "@wringer/runtime";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
const ASSETS = ["Containerfile", "package.json", "bun.lock", "base-images.lock.json", "os-snapshot.lock.json", "prepare-os.ts", "model-launch.ts", "smoke-acp.ts", "network-probe.ts", "probe.ts"];
type Host = Awaited<ReturnType<typeof inspectRuntime>>;
export interface AppleProvisionPlan {
    schema_version: "wringer.runtime-provision-plan.v1"; id: string; kind: "apple-container"; platform: "linux/arm64";
    catalogue: string; startService: boolean; imageTag: string; inputs: { path: string; sha256: string; bytes: number }[];
    baseImages: { bun: { reference: string; compressedBytes: number }; node: { reference: string; compressedBytes: number } };
    downloadBytes: number; minimumFreeBytes: number; maxElapsedSeconds: number; steps: string[]; limits: string[]; sha256: string;
}
async function inputInventory(assets: string) {
    const rows = [];
    for (const path of ASSETS) {
        const file = await assistantPath(assets, path), info = await lstat(file);
        if (!info.isFile() || info.nlink !== 1 || info.size > 4 * 1024 * 1024) throw new Error("Runtime build inputs must be bounded, unlinked regular files");
        const bytes = await readFile(file); rows.push({ path, sha256: hashBytes(bytes), bytes: bytes.length });
    }
    return rows;
}
/** Pure preview over reviewed distribution assets and a read-only host observation. */
export async function previewAppleProvision(assets: string, request: { idempotencyKey: string; startService: boolean }, host: Host): Promise<AppleProvisionPlan> {
    const id = assistantId(request.idempotencyKey), inputs = await inputInventory(assets);
    if (host.kind !== "apple-container" || host.host.os !== "darwin" || host.host.arch !== "arm64" || host.platform !== "linux/arm64") throw new Error("Select the measured macOS arm64 Apple runtime; no platform fallback was chosen");
    if (typeof request.startService !== "boolean") throw new Error("Choose explicitly whether this proposal may start the runtime service");
    const lock = JSON.parse(await readFile(join(assets, "base-images.lock.json"), "utf8")), selected = lock.platforms?.[host.platform];
    if (lock.schema_version !== "wringer.runtime-base-lock.v1" || typeof lock.catalogue !== "string" || !selected || !/^docker.io\/oven\/bun@sha256:[a-f0-9]{64}$/.test(selected.bun?.reference) || !/^docker.io\/library\/node@sha256:[a-f0-9]{64}$/.test(selected.node?.reference) || [selected.bun, selected.node].some(row => !Number.isSafeInteger(row.compressedBytes) || row.compressedBytes < 1 || row.compressedBytes > 2 * 1024 ** 3)) throw new Error("The selected platform has no valid measured base-image lock");
    const downloadBytes = selected.bun.compressedBytes + selected.node.compressedBytes;
    const body = { schema_version: "wringer.runtime-provision-plan.v1" as const, id, kind: "apple-container" as const, platform: "linux/arm64" as const, catalogue: lock.catalogue as string, startService: request.startService, imageTag: `wringer-runtime:provision-${id}`, inputs, baseImages: { bun: { reference: selected.bun.reference as string, compressedBytes: selected.bun.compressedBytes as number }, node: { reference: selected.node.reference as string, compressedBytes: selected.node.compressedBytes as number } }, downloadBytes,
        minimumFreeBytes: Math.max(6 * 1024 ** 3, downloadBytes * 4 + 3 * 1024 ** 3), maxElapsedSeconds: 3600,
        steps: [...(request.startService ? ["start-service"] : []), "pull-bun", "pull-node", "build-image", "inspect-image", "register-digest-alias", "inspect-alias", "measure-inventory"],
        limits: ["Base download bytes come from measured compressed manifests; unpacking, packages and build cache require extra space. The free-space threshold is a conservative allowance, not a size measurement.", "No provider credential, source repository, host home or agent login is mounted into the build or inventory runtime.", "An image build and inventory do not establish containment, an ACP session, provider acceptance or model work.", "OS archive metadata and the npm lock are pinned. Build output and actual installed inventory still need measurement; no bit-for-bit image claim is made.", "An interrupted step is retained and never automatically repeated. Completed steps can be observed on resume."] };
    return { ...body, sha256: hashValue(body) };
}
interface ProvisionDependencies { inspect: () => Promise<Host>; command: RuntimeDriver["command"] }
interface ProvisionResult {
    schema_version: "wringer.runtime-provisioned.v1"; id: string; planSha256: string; image: string; platform: "linux/arm64";
    inventory: { node: string; bun: string; packages: Record<string, string>; lock: string; osPackages: string; osPackagesSha256: string };
    containment: "unmeasured"; providerAcceptance: "unmeasured"; modelPromptsSent: 0; nextAction: string;
}
/** Operator-only application service. The exact plan is reviewed before any
 * durable allocation or host action. MCP has no route to this method. */
export async function applyAppleProvision(root: string, assets: string, plan: AppleProvisionPlan, decision: { expectedSha256: string; actor: string }, dependencies?: ProvisionDependencies, signal?: AbortSignal): Promise<ProvisionResult> {
    const { sha256, ...body } = plan, scrub = new Redactor();
    if (plan.schema_version !== "wringer.runtime-provision-plan.v1" || decision.expectedSha256 !== sha256 || hashValue(body) !== sha256 || typeof decision.actor !== "string" || !decision.actor.trim() || decision.actor.length > 200 || scrub.scrub(decision.actor) !== decision.actor) throw new Error("Provisioning requires the exact reviewed proposal and a recorded actor");
    assistantId(plan.id);
    const prefix = `provisions/${plan.id}`, record = (name: string) => `${prefix}/${name}`;
    if (await assistantExists(root, record("result.json"))) {
        const retained = await readAssistantRecord<ProvisionResult>(root, record("result.json"));
        if (retained.planSha256 !== sha256 || retained.id !== plan.id) throw new Error("The retained provisioning result belongs to another proposal");
        return retained;
    }
    if (hashValue(await inputInventory(assets)) !== hashValue(plan.inputs)) throw new Error("The reviewed runtime inputs changed; inspect and review a new proposal");
    const deps = dependencies ?? { inspect: () => inspectRuntime({ kind: "apple-container" }), command: processDriver.command }, host = await deps.inspect();
    const canonical = await previewAppleProvision(assets, { idempotencyKey: plan.id, startService: plan.startService }, host);
    if (canonical.sha256 !== sha256) throw new Error("The reviewed provisioning declaration no longer matches its supported recipe");
    if (host.installation.state !== "observed" || host.version !== "1.3.1") throw new Error("Install the measured Apple Container 1.3.1 client before applying this provisioning recipe");
    if (host.host.freeBytes < plan.minimumFreeBytes) throw new Error("Free storage is below the reviewed provisioning allowance; no cleanup or download was attempted");
    if (host.service.state !== "observed" && !plan.startService) throw new Error("The runtime service is unavailable. Review a proposal explicitly permitting service startup");
    await createAssistantDirectory(root);
    await writeAssistantRecord(root, record("plan.json"), { plan });
    if (!await assistantExists(root, record("approval.json"))) await writeAssistantRecord(root, record("approval.json"), { schema_version: "wringer.runtime-provision-approval.v1", planSha256: sha256, actor: decision.actor, at: new Date().toISOString() });
    const lockPath = await assistantPath(root, record("operation.lock")), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Provisioning is active or its owner was interrupted. Inspect retained operations before recovery"); });
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, identity: sha256 })); await lock.sync();
        const storedApproval = await readAssistantRecord<any>(root, record("approval.json"));
        if (storedApproval.schema_version !== "wringer.runtime-provision-approval.v1" || storedApproval.planSha256 !== sha256 || !Number.isFinite(Date.parse(storedApproval.at))) throw new Error("The retained provisioning approval is invalid");
        const deadline = Date.parse(storedApproval.at) + plan.maxElapsedSeconds * 1000;
        const context = await assistantPath(root, record("context")); await mkdir(join(context, "runtime"), { recursive: true, mode: 0o700 });
        for (const row of plan.inputs) {
            const target = await assistantPath(context, `runtime/${row.path}`);
            if (!await Bun.file(target).exists()) await cp(join(assets, row.path), target, { errorOnExist: true, force: false });
            const info = await lstat(target);
            if (!info.isFile() || info.nlink !== 1 || info.size !== row.bytes) throw new Error("Retained build inputs must be bounded, unlinked regular files");
            if (hashBytes(await readFile(target)) !== row.sha256) throw new Error("Retained build context changed; no runtime action was repeated");
        }
        async function command(argv: string[], timeoutMs = 900000) {
            signal?.throwIfAborted(); if (Date.now() >= deadline) throw new Error("The original provisioning deadline is exhausted; it was not renewed");
            const result = await deps.command(argv, { env: {}, signal, timeoutMs: Math.min(timeoutMs, deadline - Date.now()) });
            if (result.code !== 0) throw new Error(`Runtime command exited ${result.code}: ${scrub.scrub(result.stderr || result.stdout).slice(0, 8000)}`);
            if (result.stdout.length > 1024 * 1024) throw new Error("Runtime observation exceeds its bounded capture");
            return result.stdout;
        }
        async function step<T>(id: string, effect: () => Promise<T>): Promise<T> {
            const started = record(`steps/${id}.request.json`), completed = record(`steps/${id}.result.json`);
            if (await assistantExists(root, completed)) return (await readAssistantRecord<any>(root, completed)).value as T;
            if (await assistantExists(root, started)) throw new Error(`Provisioning step ${id} is uncertain or failed. Inspect its retained evidence; it was not repeated`);
            await writeAssistantRecord(root, started, { schema_version: "wringer.runtime-provision-step.v1", id, planSha256: sha256, at: new Date().toISOString() });
            try {
                const value = await effect(); await writeAssistantRecord(root, completed, { schema_version: "wringer.runtime-provision-result.v1", id, planSha256: sha256, value }); return value;
            } catch (error) {
                await writeAssistantRecord(root, record(`steps/${id}.failure.json`), { schema_version: "wringer.runtime-provision-failure.v1", id, at: new Date().toISOString(), message: scrub.scrub(error instanceof Error ? error.message : "Unconfirmed provisioning effect").slice(0, 8000), replayed: false }); throw error;
            }
        }
        if (plan.startService) await step("start-service", async () => { await command(["container", "system", "start"], 120000); if ((await deps.inspect()).service.state !== "observed") throw new Error("Service startup could not be observed"); return { service: "observed" }; });
        for (const kind of ["bun", "node"] as const) await step(`pull-${kind}`, async () => { await command(["container", "image", "pull", "--platform", plan.platform, plan.baseImages[kind].reference]); return { reference: plan.baseImages[kind].reference, platform: plan.platform }; });
        await step("build-image", async () => { await command(["container", "build", "--platform", plan.platform, "--cpus", "2", "--memory", "2G", "--file", join(context, "runtime/Containerfile"), "--tag", plan.imageTag, "--build-arg", `BUN_BASE_IMAGE=${plan.baseImages.bun.reference}`, "--build-arg", `NODE_BASE_IMAGE=${plan.baseImages.node.reference}`, context]); return { tag: plan.imageTag, inputIdentity: hashValue(plan.inputs) }; });
        async function inspectImage(reference: string) {
            const rows = JSON.parse(await command(["container", "image", "inspect", reference], 15000)), config = rows?.[0]?.configuration;
            if (!Array.isArray(rows) || rows.length !== 1 || typeof config?.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,511}$/.test(config.name) || !/^sha256:[a-f0-9]{64}$/.test(config.descriptor?.digest)) throw new Error("Built image has no exact observed descriptor");
            return { reference: config.name as string, digest: config.descriptor.digest as string };
        }
        const image = await step("inspect-image", () => inspectImage(plan.imageTag)), pinned = `${image.reference.split("@")[0]}@${image.digest}`;
        await step("register-digest-alias", async () => { await command(["container", "image", "tag", image.reference, pinned], 15000); return { reference: pinned }; });
        await step("inspect-alias", async () => { const observed = await inspectImage(pinned); if (observed.digest !== image.digest || observed.reference !== pinned) throw new Error("The registered image alias does not resolve to the observed build digest"); return observed; });
        const inventory = await step("measure-inventory", async () => {
            const script = 'const fs=require("fs"), crypto=require("crypto"); const p=JSON.parse(fs.readFileSync("/opt/wringer-agents/package.json","utf8")); console.log(JSON.stringify({node:process.versions.node,bun:fs.readFileSync("/opt/wringer-agents/bun-version.txt","utf8").trim(),osPackages:fs.readFileSync("/opt/wringer-agents/os-packages.txt","utf8"),packages:Object.fromEntries(Object.keys(p.dependencies).map(n=>[n,JSON.parse(fs.readFileSync("/opt/wringer-agents/node_modules/"+n+"/package.json","utf8")).version])),lock:crypto.createHash("sha256").update(fs.readFileSync("/opt/wringer-agents/bun.lock")).digest("hex")}));';
            const result = JSON.parse(await command(["container", "run", "--rm", "--name", `wringer-inventory-${plan.id}`, "--cpus", "1", "--memory", "1G", "--entrypoint", "node", pinned, "-e", script], 120000));
            const expected = JSON.parse(await readFile(join(assets, "package.json"), "utf8")).dependencies;
            if (hashValue(result.packages) !== hashValue(expected) || result.lock !== plan.inputs.find(row => row.path === "bun.lock")!.sha256 || !/^24\.[0-9]+\.[0-9]+$/.test(result.node) || result.bun !== "1.4.2" || typeof result.osPackages !== "string" || !result.osPackages.trim() || result.osPackages.length > 512 * 1024) throw new Error("The resulting image inventory differs from its reviewed lock or tool requirements");
            return { node: result.node as string, bun: result.bun as string, packages: result.packages as Record<string, string>, lock: result.lock as string, osPackages: result.osPackages as string, osPackagesSha256: hashBytes(result.osPackages) };
        });
        const result: ProvisionResult = { schema_version: "wringer.runtime-provisioned.v1", id: plan.id, planSha256: sha256, image: pinned, platform: plan.platform, inventory, containment: "unmeasured", providerAcceptance: "unmeasured", modelPromptsSent: 0, nextAction: "Run bounded containment and cleanup probes on this exact image before relying on the selected runtime" };
        await writeAssistantRecord(root, record("result.json"), result); return result;
    } finally { await lock.close(); await unlink(lockPath); }
}
