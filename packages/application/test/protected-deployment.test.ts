import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashValue } from "@wringer/plan";
import { createProtectedDeploymentPlan, inspectProtectedDeployment, inspectProtectedPath, validateProtectedDeploymentPlan, type ProtectedDeploymentInput, type ProtectedPathPolicy } from "../src/protected-deployment";

const scratchDirectories: string[] = [];
afterEach(async () => { for (const path of scratchDirectories.splice(0)) await rm(path, { recursive: true, force: true }); });
async function scratch() { const path = await realpath(await mkdtemp(join(tmpdir(), "wringer-protected-deployment-"))); scratchDirectories.push(path); return path; }
function input(): ProtectedDeploymentInput {
    const assistantUid = process.getuid?.() || 501, assistantGids = process.getgroups?.() || [20];
    let controllerGid = 498; while (assistantGids.includes(controllerGid)) controllerGid--;
    return { deploymentId: "68b44e08-53a4-49d3-904a-c4ea16c7d218", controllerUid: assistantUid === 498 ? 497 : 498, controllerGid, assistantUid, assistantGids,
        artifacts: { controller: { source: "/source/dist/wringer-assistant", sha256: "a".repeat(64) }, confirmation: { source: "/source/dist/wringer-confirm", sha256: "b".repeat(64) }, runtime: { source: "/source/runtime/container", sha256: "c".repeat(64) } } };
}
function rehash(value: ReturnType<typeof createProtectedDeploymentPlan>) { const { sha256, ...body } = value; return { ...body, sha256: hashValue(body) }; }
async function policyForFile(path: string, digest: string): Promise<ProtectedPathPolicy> {
    const info = await lstat(path);
    return { id: "fixture-binary", path, kind: "file", uid: info.uid, gid: info.gid, mode: info.mode & 0o7777, assistantAccess: "read-only", sha256: digest };
}

describe("protected deployment artifacts never self-authorize", () => {
    test("deterministic plan binds source digests, protected identities and fixed destinations", () => {
        const one = createProtectedDeploymentPlan(input()), two = createProtectedDeploymentPlan(input());
        expect(one).toEqual(two);
        expect(validateProtectedDeploymentPlan(JSON.parse(JSON.stringify(one)))).toEqual(one);
        expect(one.paths).toHaveLength(11);
        expect(one.paths.find(p => p.id === "credentials")).toMatchObject({ kind: "directory", mode: 0o700, assistantAccess: "none" });
        expect(one.paths.filter(p => p.id.endsWith("-binary")).every(p => p.uid === 0 && p.mode === 0o755 && p.sha256)).toBe(true);
        expect(one.paths.find(p => p.id === "controller-public-key")).toMatchObject({ uid: 0, gid: 0, mode: 0o644, assistantAccess: "read-only" });
        expect(one.paths.find(p => p.id === "confirmation-signing-policy")).toMatchObject({ uid: 0, gid: 0, mode: 0o644, assistantAccess: "read-only" });
        expect(one.service.installable).toBe(false);
        expect(one.service.entrypoint).toBeNull();
        expect(one.activation).toBe("unavailable");
    });
    test("same-user private files and a shared private group cannot be called protected", () => {
        const base = input();
        expect(() => createProtectedDeploymentPlan({ ...base, controllerUid: base.assistantUid })).toThrow("cannot share an OS identity");
        expect(() => createProtectedDeploymentPlan({ ...base, controllerGid: 20, assistantGids: [20] })).toThrow("private group");
        for (const id of [0, -1, 1.5, NaN, Infinity]) expect(() => createProtectedDeploymentPlan({ ...base, controllerUid: id })).toThrow("non-root");
    });
    test("artifact source is inert and normalized; command/secret/ready fields are not accepted", () => {
        const base = input();
        for (const source of ["relative", "/source/../elsewhere", "/source/\ncmd", "/source/\0cmd"]) {
            expect(() => createProtectedDeploymentPlan({ ...base, artifacts: { ...base.artifacts, controller: { source, sha256: "a".repeat(64) } } })).toThrow("normalized absolute path");
        }
        expect(() => createProtectedDeploymentPlan({ ...base, approved: true } as any)).toThrow("unknown field");
        expect(() => createProtectedDeploymentPlan({ ...base, artifacts: { ...base.artifacts, controller: { ...base.artifacts.controller, command: "anything" } } } as any)).toThrow("unknown field");
        expect(() => createProtectedDeploymentPlan({ ...base, artifacts: { ...base.artifacts, controller: { source: "/source/controller", sha256: "latest" } } })).toThrow("exact SHA-256");
    });
    test("changed paths, claims, service commands and ownership refuse even after attacker recomputes the hash", () => {
        const mutations: Array<(value: ReturnType<typeof createProtectedDeploymentPlan>) => void> = [
            v => { v.paths[0]!.path = "/Users/attacker/controller"; },
            v => { v.paths.find(p => p.id === "credentials")!.mode = 0o755; },
            v => { v.service.entrypoint = ["serve", "--cooperative-local"] as any; },
            v => { v.service.installable = true as any; },
            v => { v.activation = "ready" as any; },
            v => { v.account.loginAllowed = true as any; },
            v => { v.limitation = "Protection proven"; },
            v => { v.removal = []; },
        ];
        for (const mutate of mutations) {
            const value = createProtectedDeploymentPlan(input()); mutate(value);
            expect(() => validateProtectedDeploymentPlan(rehash(value))).toThrow("compiled policy");
        }
    });
    test("uninstall preserves evidence and keys; the plan cannot invoke an installer", () => {
        const plan = createProtectedDeploymentPlan(input());
        expect(plan.removal.map(s => s.id)).toEqual(["revoke", "stop-service", "retain"]);
        expect(plan.removal.at(-1)!.action).toContain("does not delete journals, keys");
        expect(plan.installation.find(s => s.id === "private-state")!.action).toContain("alternate copy");
        expect(plan.installation.find(s => s.id === "runtime")!.action).toContain("control sockets");
        expect(plan.installation.find(s => s.id === "measure")!.action).toContain("fresh-root budget bypass");
    });
    test("another or privileged inspecting principal cannot supply the app's access evidence", async () => {
        const base = input(), alternate = base.assistantUid + 1000;
        const report = await inspectProtectedDeployment(createProtectedDeploymentPlan({ ...base, assistantUid: alternate }));
        expect(report.paths).toEqual([]);
        expect(report.blockers.some(v => v.includes("different principal"))).toBe(true);
        expect(report.protectedReady).toBe(false);
        expect(report.outcome).toBe("not-ready");
        expect(report.mutations).toBe(0);
        expect(report.providerCalls).toBe(0);
    });
    test("read-only deployment checks cannot claim native presence or real-client/runtime isolation", async () => {
        const report = await inspectProtectedDeployment(createProtectedDeploymentPlan(input()));
        expect(report.protectedReady).toBe(false);
        expect(report.blockers.some(v => v.includes("confirmation provider"))).toBe(true);
        expect(report.blockers.some(v => v.includes("alternate credentials"))).toBe(true);
        expect(report.blockers.some(v => v.includes("Restart"))).toBe(true);
        expect(report.blockers.some(v => v.includes("daemon entrypoint"))).toBe(true);
    });
});

describe("protected path inspection uses observations rather than chmod narratives", () => {
    test("a private same-user directory is writable and fails; contents remain untouched", async () => {
        const path = await scratch(), info = await lstat(path), marker = join(path, "retained-evidence");
        await writeFile(marker, "retained fixture, not a credential");
        const result = await inspectProtectedPath({ id: "fixture-state", path, kind: "directory", uid: info.uid, gid: info.gid, mode: 0o700, assistantAccess: "none", sha256: null });
        expect(result.access.write).toBe("allowed"); expect(result.outcome).toBe("refused");
        expect(result.reasons.some(v => v.includes("Private controller"))).toBe(true);
        expect(await readdir(path)).toEqual(["retained-evidence"]);
        expect(await readFile(marker, "utf8")).toBe("retained fixture, not a credential");
    });
    test("chmod on a leaf cannot hide replacement through its writable parent", async () => {
        const path = join(await scratch(), "binary"); await writeFile(path, "fixture executable"); await chmod(path, 0o444);
        const digest = createHash("sha256").update("fixture executable").digest("hex");
        const result = await inspectProtectedPath(await policyForFile(path, digest));
        expect(result.observed?.sha256).toBe(digest);
        expect(result.outcome).toBe("refused");
        expect(result.reasons.some(v => v.includes("ancestor is writable"))).toBe(true);
    });
    test("modified artifact bytes are a refusal, even if the declared version is unchanged", async () => {
        const path = join(await scratch(), "binary"); await writeFile(path, "changed bytes");
        const result = await inspectProtectedPath(await policyForFile(path, "a".repeat(64)));
        expect(result.reasons.some(v => v.includes("approved digest"))).toBe(true);
        expect(result.outcome).toBe("refused");
    });
    test("a missing path is not successful access denial", async () => {
        const path = join(await scratch(), "absent");
        const result = await inspectProtectedPath({ id: "absent", path, kind: "directory", uid: 498, gid: 498, mode: 0o700, assistantAccess: "none", sha256: null });
        expect(result.outcome).not.toBe("matches-file-policy"); expect(result.observed).toBeNull();
        expect(result.access.read).not.toBe("denied");
        expect(result.reasons.some(v => v.includes("absence is not access-denial"))).toBe(true);
    });
    test("neither leaf nor ancestor symlinks are followed", async () => {
        const path = await scratch(), file = join(path, "target"), leaf = join(path, "leaf"), ancestor = join(path, "ancestor");
        await writeFile(file, "not to be read via a link"); await symlink(file, leaf); await symlink(path, ancestor);
        const policy = await policyForFile(file, "a".repeat(64));
        for (const linked of [leaf, join(ancestor, "target")]) {
            const result = await inspectProtectedPath({ ...policy, path: linked });
            expect(result.outcome).not.toBe("matches-file-policy"); expect(result.observed).toBeNull();
        }
    });
    test("special files and ownership/mode mismatch never become binary evidence", async () => {
        const path = await scratch(), info = await lstat(path);
        const result = await inspectProtectedPath({ id: "not-a-binary", path, kind: "file", uid: info.uid + 1, gid: info.gid, mode: 0o755, assistantAccess: "read-only", sha256: null });
        expect(result.outcome).toBe("refused"); expect(result.reasons.some(v => v.includes("differs from the fixed"))).toBe(true);
    });
});
