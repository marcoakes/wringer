import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as application from "../src";
const roots: string[] = []; afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const request = () => ({ id: crypto.randomUUID(), context: "fixture-cluster", runtimeClass: "gvisor", image: `registry.invalid/wringer@sha256:${"a".repeat(64)}`, secretRefs: { CODEX_API_KEY: { name: "provider-key", key: "api-key" } } });
test("T21 a gVisor installation preview owns a fresh namespace and shows runsc, policy and secret prerequisites", () => {
    const preview = (application as any).previewGvisorProvision; expect(typeof preview).toBe("function");
    const r = request(), plan = preview(r);
    expect(plan.namespace).toBe(`wringer-${r.id}`); expect(plan.runtimeClass).toBe("gvisor");
    expect(plan.manifests[1].spec.egress).toEqual([]); expect(plan.manifests[1].spec.podSelector).toEqual({});
    expect(plan.manifests.some((row: any) => row.kind === "Secret")).toBeFalse(); expect(plan.secretReferences.CODEX_API_KEY.name).toBe("provider-key");
    expect(plan.containment).toBe("unmeasured");
    expect(() => preview({ ...r, namespace: "production" })).toThrow("field");
    expect(() => preview({ ...r, image: "latest" })).toThrow();
});
test("T21 ordinary cluster runtime refuses before namespace creation; no secret values are requested", async () => {
    const preview = (application as any).previewGvisorProvision, apply = (application as any).applyGvisorProvision;
    expect(typeof preview).toBe("function"); expect(typeof apply).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-gvisor-"))); roots.push(root);
    const plan = preview(request()), calls: string[][] = [];
    const command = async (argv: string[]) => { calls.push(argv); return { code: 0, stdout: JSON.stringify({ kind: "RuntimeClass", metadata: { name: "gvisor" }, handler: "runc" }), stderr: "" }; };
    await expect(apply(root, plan, { expectedSha256: plan.sha256, actor: "Automated fixture" }, command)).rejects.toThrow("runsc");
    expect(calls.every(argv => !argv.includes("create") && !argv.includes("secret"))).toBeTrue();
});
test("T21 partial installation resumes by exact read-back, never replacing foreign objects", async () => {
    const preview = (application as any).previewGvisorProvision, apply = (application as any).applyGvisorProvision;
    expect(typeof preview).toBe("function"); expect(typeof apply).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-gvisor-"))); roots.push(root);
    const plan = preview(request()), objects = new Map<string, any>(), calls: string[][] = []; let loseReply = true;
    const command = async (argv: string[], options: any) => {
        calls.push(argv);
        if (argv.includes("runtimeclass")) return { code: 0, stdout: JSON.stringify({ kind: "RuntimeClass", metadata: { name: "gvisor" }, handler: "runsc" }), stderr: "" };
        if (argv.includes("create")) {
            const value = JSON.parse(options.input), key = value.kind.toLowerCase(); objects.set(key, value);
            if (loseReply) { loseReply = false; throw new Error("Lost response after namespace creation"); }
            return { code: 0, stdout: JSON.stringify(value), stderr: "" };
        }
        const kind = argv[argv.indexOf("get") + 1]!, value = objects.get(kind);
        return { code: 0, stdout: value ? JSON.stringify(value) : "", stderr: "" };
    };
    const decision = { expectedSha256: plan.sha256, actor: "Automated fixture" };
    await expect(apply(root, plan, decision, command)).rejects.toThrow("Lost response");
    const completed = await apply(root, plan, decision, command);
    expect(completed.configuredPolicy).toBe("observed"); expect(completed.containment).toBe("unmeasured");
    expect(calls.filter(argv => argv.includes("create"))).toHaveLength(2);
    const count = calls.length; expect(await apply(root, plan, decision, command)).toEqual(completed); expect(calls).toHaveLength(count);
    const otherRoot = join(root, "other"), otherPlan = preview(request());
    for (const row of otherPlan.manifests) objects.set(row.kind.toLowerCase(), { ...row, metadata: { ...row.metadata, labels: { ...row.metadata.labels, "wringer.dev/provision": plan.id } } });
    await expect(apply(otherRoot, otherPlan, { ...decision, expectedSha256: otherPlan.sha256 }, command)).rejects.toThrow("foreign");
});
