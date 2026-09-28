import { statfs } from "node:fs/promises";
import { processDriver } from "./driver";
import type { RuntimeDriver, RuntimePolicy } from "./types";
export interface RuntimeInspectionInput { kind: RuntimePolicy["kind"]; image?: string; context?: string; namespace?: string; runtimeClass?: string }
export interface RuntimeInspectionDependencies {
    platform: string; arch: string; freeBytes: number;
    which: (name: string) => string | null;
    command: RuntimeDriver["command"];
}
type Observation = { state: "observed" | "unavailable" | "unmeasured"; detail: string };
const unmeasured = (detail: string): Observation => ({ state: "unmeasured", detail });
const name = (value: string) => /^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,511}$/.test(value) && !value.includes("..");
export async function inspectRuntime(input: RuntimeInspectionInput, dependencies?: RuntimeInspectionDependencies) {
    if (!["apple-container", "gvisor-kubernetes"].includes(input.kind)) throw new Error("Select a contained runtime explicitly");
    if (Object.keys(input).some(key => !["kind", "image", "context", "namespace", "runtimeClass"].includes(key))) throw new Error("Unknown runtime inspection field");
    if (Object.entries(input).some(([key, value]) => key !== "kind" && (typeof value !== "string" || !name(value)))) throw new Error("Use bounded runtime identifiers without credentials or command arguments");
    if (input.image?.includes("@") && !/^[^@]+@sha256:[a-f0-9]{64}$/.test(input.image)) throw new Error("Use an image identifier without embedded credentials");
    const storage = dependencies ? null : await statfs("/");
    const deps = dependencies ?? { platform: process.platform, arch: process.arch, freeBytes: storage!.bavail * storage!.bsize, which: Bun.which, command: processDriver.command };
    const platform = deps.arch === "arm64" ? "linux/arm64" : deps.arch === "x64" ? "linux/amd64" : null;
    const supported = input.kind === "apple-container" ? deps.platform === "darwin" && deps.arch === "arm64" : deps.platform === "linux" && deps.arch === "x64";
    const binary = deps.which(input.kind === "apple-container" ? "container" : "kubectl");
    const installation: Observation = binary && supported ? { state: "observed", detail: "Client executable is present on the selected host architecture" } : { state: "unavailable", detail: !supported ? "This host does not match the selected runtime target" : "The selected runtime client is not installed" };
    let version: string | null = null, service = unmeasured("No runtime service was contacted"), image = unmeasured("No exact image was inspected"), configuredPolicy = unmeasured("Runtime policy has not been measured");
    let imageIdentity: { reference: string; digest: string } | null = null;
    const command: RuntimeDriver["command"] = async (argv, options) => {
        try { const result = await deps.command(argv, { ...options, timeoutMs: 5000, env: {} }); if (result.stdout.length + result.stderr.length > 1024 * 1024) throw new Error("Inspection output exceeds its bound"); return result; }
        catch { return { code: 1, stdout: "", stderr: "" }; }
    };
    if (binary && supported) {
        if (input.kind === "apple-container") {
            const observedVersion = await command([binary, "--version"]);
            version = /^container CLI version ([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)/.exec(observedVersion.stdout)?.[1] ?? null;
            const observedService = await command([binary, "system", "status"]);
            service = { state: observedService.code === 0 ? "observed" : "unavailable", detail: observedService.code === 0 ? "The client reports a running API service. No runtime was allocated" : "The API service is stopped, unavailable, or not registered. Starting it is a separate provisioning decision" };
            if (input.image && observedService.code === 0) {
                const inspected = await command([binary, "image", "inspect", input.image]);
                try {
                    const rows = JSON.parse(inspected.stdout), config = rows?.[0]?.configuration, digest = config?.descriptor?.digest;
                    if (inspected.code || !Array.isArray(rows) || rows.length !== 1 || typeof config?.name !== "string" || !name(config.name) || !/^sha256:[a-f0-9]{64}$/.test(digest) || input.image.includes("@") && !input.image.endsWith(`@${digest}`)) throw new Error("No exact image identity");
                    imageIdentity = { reference: config.name, digest }; image = { state: "observed", detail: "The local image descriptor was read. It has not established execution, role separation, or provider authentication" };
                } catch { image = { state: "unavailable", detail: "The selected local image did not resolve to one valid descriptor" }; }
            }
        } else {
            const observedVersion = await command([binary, "version", "--client", "-o", "json"]);
            try { const value = JSON.parse(observedVersion.stdout).clientVersion.gitVersion; if (/^v[0-9]+\.[0-9]+\.[0-9]+[A-Za-z0-9.+-]*$/.test(value)) version = value; } catch { /* Unknown is not a compatible version. */ }
            if (input.context && input.namespace && input.runtimeClass) {
                const observed = await command([binary, "--context", input.context, "get", "runtimeclass", input.runtimeClass, "-o", "json"]);
                service = { state: observed.code === 0 ? "observed" : "unavailable", detail: observed.code === 0 ? "The explicitly selected cluster answered the RuntimeClass query" : "The selected cluster or RuntimeClass could not be read" };
                try { const value = JSON.parse(observed.stdout); if (observed.code || value.kind !== "RuntimeClass" || value.metadata?.name !== input.runtimeClass || value.handler !== "runsc") throw new Error("Not runsc"); configuredPolicy = { state: "observed", detail: "RuntimeClass declares the runsc handler. Actual workload isolation and NetworkPolicy enforcement remain unmeasured" }; }
                catch { configuredPolicy = { state: "unavailable", detail: "No exact runsc RuntimeClass was established; an ordinary Pod cannot substitute for gVisor" }; }
            } else service = unmeasured("Select the cluster context, namespace and RuntimeClass before cluster inspection");
        }
    }
    return { schema_version: "wringer.runtime-inspection.v1", kind: input.kind, host: { os: deps.platform, arch: deps.arch, freeBytes: deps.freeBytes }, platform, version, installation, service, image, imageIdentity, configuredPolicy,
        containment: unmeasured("Run the bounded filesystem, resource, egress and cleanup probes on this exact image and runtime"), agentSession: unmeasured("No ACP session was opened"), providerAcceptance: unmeasured("No provider credential was retrieved or validated"), completedModelWork: unmeasured("No model prompt was sent"), executionBoundary: "contained-required", sideEffects: [],
        nextAction: installation.state !== "observed" || service.state !== "observed" ? "Review wring runtime provision for this selected backend. There is no host-worker fallback." : "Review an exact provisioning/image proposal, then run the independent containment probes before delegating work." };
}
