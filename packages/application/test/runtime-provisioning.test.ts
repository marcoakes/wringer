import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as application from "../src/index";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-provision-"))); roots.push(root);
    const assets = join(root, "assets"); await cp(new URL("../../../runtime/", import.meta.url), assets, { recursive: true });
    const host = { schema_version: "wringer.runtime-inspection.v1", kind: "apple-container", platform: "linux/arm64", version: "1.3.1", host: { os: "darwin", arch: "arm64", freeBytes: 12 * 1024 ** 3 }, installation: { state: "observed" }, service: { state: "observed" } };
    return { root, assets, app: join(root, "application"), host };
}
test("T20 a provisioning preview pins measured inputs and estimates space without creating state or running a command", async () => {
    const f = await fixture(), preview = (application as any).previewAppleProvision; expect(typeof preview).toBe("function");
    const request = { idempotencyKey: crypto.randomUUID(), startService: false };
    const plan = await preview(f.assets, request, f.host);
    expect(plan.platform).toBe("linux/arm64"); expect(plan.baseImages.bun.reference).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(plan.minimumFreeBytes).toBeGreaterThan(plan.downloadBytes); expect(plan.inputs.some((row: any) => row.path === "bun.lock")).toBeTrue();
    expect(await Bun.file(join(f.app, "plan.json")).exists()).toBeFalse();
    expect((await preview(f.assets, request, f.host)).sha256).toBe(plan.sha256);
});
test("T20 changed recipe bytes and unreviewed proposals refuse before provisioning effects", async () => {
    const f = await fixture(), preview = (application as any).previewAppleProvision, apply = (application as any).applyAppleProvision;
    expect(typeof preview).toBe("function"); expect(typeof apply).toBe("function");
    const plan = await preview(f.assets, { idempotencyKey: crypto.randomUUID(), startService: false }, f.host); let commands = 0;
    const dependencies = { inspect: async () => f.host, command: async () => { commands++; return { code: 0, stdout: "", stderr: "" }; } };
    await expect(apply(f.app, f.assets, plan, { expectedSha256: "0".repeat(64), actor: "Automated fixture" }, dependencies)).rejects.toThrow("reviewed");
    await writeFile(join(f.assets, "Containerfile"), (await readFile(join(f.assets, "Containerfile"), "utf8")) + "\nRUN false\n");
    await expect(apply(f.app, f.assets, plan, { expectedSha256: plan.sha256, actor: "Automated fixture" }, dependencies)).rejects.toThrow("inputs changed");
    expect(commands).toBe(0);
});
async function transaction(f: Awaited<ReturnType<typeof fixture>>) {
    const plan = await application.previewAppleProvision(f.assets, { idempotencyKey: crypto.randomUUID(), startService: false }, f.host as any);
    const calls: string[][] = [], digest = `sha256:${"a".repeat(64)}`, pinned = `${plan.imageTag}@${digest}`;
    const dependencies = { inspect: async () => f.host as any, command: async (argv: string[]) => {
        calls.push(argv);
        let value: unknown = "";
        if (argv[1] === "image" && argv[2] === "inspect") value = [{ configuration: { name: argv[3], descriptor: { digest } } }];
        if (argv[1] === "run") value = { node: "24.19.0", bun: "1.4.2", osPackages: "bash\t5.2\ngit\t2.39\n", packages: JSON.parse(await readFile(join(f.assets, "package.json"), "utf8")).dependencies, lock: plan.inputs.find(row => row.path === "bun.lock")!.sha256 };
        return { code: 0, stdout: typeof value === "string" ? value : JSON.stringify(value), stderr: "" };
    } };
    const decision = { expectedSha256: plan.sha256, actor: "Automated engineering fixture" };
    return { plan, calls, pinned, dependencies, decision, apply: () => application.applyAppleProvision(f.app, f.assets, plan, decision, dependencies) };
}
test("T20 a successful provisioning transaction observes exact alias and inventory; completed replay has zero host actions", async () => {
    const f = await fixture(), t = await transaction(f), result = await t.apply();
    expect(result.image).toBe(t.pinned); expect(result.modelPromptsSent).toBe(0);
    expect(result.containment).toBe("unmeasured"); expect(t.calls.filter(argv => argv[1] === "build")).toHaveLength(1);
    expect(t.calls.every(argv => !argv.includes("--volume") && !argv.includes("--mount"))).toBeTrue();
    const length = t.calls.length;
    t.dependencies.inspect = async () => { throw new Error("The old host is offline; completed evidence remains observable"); };
    expect(await t.apply()).toEqual(result); expect(t.calls).toHaveLength(length);
});
test("T20 interrupted build remains uncertain on resume; corrupt approval cannot leave a new owner lock", async () => {
    const f = await fixture(), t = await transaction(f), command = t.dependencies.command;
    t.dependencies.command = async argv => { if (argv[1] === "build") { t.calls.push(argv); throw new Error("Connection lost after build dispatch"); } return command(argv); };
    await expect(t.apply()).rejects.toThrow("Connection lost");
    await expect(t.apply()).rejects.toThrow("uncertain"); expect(t.calls.filter(argv => argv[1] === "build")).toHaveLength(1);
    await writeFile(join(f.app, "provisions", t.plan.id, "approval.json"), "{}");
    await expect(t.apply()).rejects.toThrow("identity changed");
    expect(await Bun.file(join(f.app, "provisions", t.plan.id, "operation.lock")).exists()).toBeFalse();
});
test("T20 a retained build input symlink refuses before commands even when its bytes match", async () => {
    const f = await fixture(), t = await transaction(f), context = join(f.app, "provisions", t.plan.id, "context/runtime");
    await mkdir(context, { recursive: true, mode: 0o700 });
    await symlink(join(f.assets, "Containerfile"), join(context, "Containerfile"));
    await expect(t.apply()).rejects.toThrow(/symlink|regular file/); expect(t.calls).toHaveLength(0);
});
test("T20 a changed image alias or mismatched runtime inventory cannot become a provisioned result", async () => {
    for (const fault of ["alias", "inventory"]) {
        const f = await fixture(), t = await transaction(f), command = t.dependencies.command;
        t.dependencies.command = async argv => {
            const result = await command(argv);
            if (fault === "alias" && argv[2] === "inspect" && argv[3]!.includes("@")) result.stdout = JSON.stringify([{ configuration: { name: argv[3], descriptor: { digest: `sha256:${"b".repeat(64)}` } } }]);
            if (fault === "inventory" && argv[1] === "run") result.stdout = JSON.stringify({ ...JSON.parse(result.stdout), bun: "0.0.0" });
            return result;
        };
        await expect(t.apply()).rejects.toThrow(fault === "alias" ? "alias" : "inventory");
        expect(await Bun.file(join(f.app, "provisions", t.plan.id, "result.json")).exists()).toBeFalse();
    }
});
test("T20 storage and service prerequisites refuse before downloads, with no silent service startup", async () => {
    for (const fault of ["storage", "service"]) {
        const f = await fixture(), t = await transaction(f);
        t.dependencies.inspect = async () => ({ ...f.host, host: { ...f.host.host, freeBytes: fault === "storage" ? 1000 : f.host.host.freeBytes }, service: { state: fault === "service" ? "unavailable" : "observed" } } as any);
        await expect(t.apply()).rejects.toThrow(fault === "storage" ? "storage" : "service");
        expect(t.calls).toHaveLength(0);
    }
});
