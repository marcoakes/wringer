import { test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcpTurn } from "@wringer/acp";
import { executeAgentRole, runContainedCommands, parseRuntimePolicy, parseWritableDirectories, kubernetesPod, kubernetesNetworkPolicy, firewallScript, prepareRepositorySource, captureCandidate, processDriver, digest, type RuntimeDriver, type RuntimePolicy, type RoleExecutionRequest, type RoleExecutionResult } from "../src/index";
const image = `registry.invalid/agent@sha256:${"a".repeat(64)}`, commit = "b".repeat(40), tree = "c".repeat(40);
const policy: RuntimePolicy = { kind: "apple-container", image, cpus: 1, memoryMiB: 512, network: { policy: "deny" } };
const source = { url: "https://example.invalid/repo.git", commit };
function fakeDriver(patch = "") {
    const calls: {
        argv: string[];
        options: any;
    }[] = [], connections: string[][] = [];
    let mismatch = false;
    const observedPod = () => {
        const declaration = calls.map(call => {
            try {
                return JSON.parse(call.options?.input);
            }
            catch {
                return null;
            }
        }).find(value => value?.kind === "Pod");
        return { ...declaration, metadata: { ...declaration.metadata, uid: "pod-uid" }, status: { containerStatuses: [{ imageID: `docker-pullable://${image}` }] } };
    };
    const driver: RuntimeDriver = { async command(argv, options) {
            calls.push({ argv, options });
            const command = argv.join(" ");
            if (argv.includes("--version"))
                return { code: 0, stdout: "container 0.11 fixture\n", stderr: "" };
            if (argv.includes("runtimeclass"))
                return { code: 0, stdout: JSON.stringify({ handler: mismatch ? "runc" : "runsc", metadata: { name: "gvisor", uid: "class-uid" } }), stderr: "" };
            if (argv.includes("inspect"))
                return { code: 0, stdout: JSON.stringify([{ id: "fixture", configuration: { environment: ["secret-not-to-be-persisted"] } }]), stderr: "" };
            if (command.includes("get pod"))
                return { code: 0, stdout: JSON.stringify(observedPod()), stderr: "" };
            if (command.includes("rev-parse HEAD^{tree}"))
                return { code: 0, stdout: `${tree}\n`, stderr: "" };
            if (command.includes("ls-tree"))
                return { code: 0, stdout: `100644 blob ${"d".repeat(40)}\tcheck.sh\0`, stderr: "" };
            if (command.includes("diff --cached"))
                return { code: 0, stdout: patch, stderr: "" };
            if (command.includes("timeout") && argv.includes("false"))
                return { code: 1, stdout: "check failed\n", stderr: "" };
            return { code: 0, stdout: "", stderr: "" };
        }, async connect(argv) {
            connections.push(argv);
            const input = new PassThrough(), output = new PassThrough();
            let buffer = "";
            input.on("data", bytes => {
                buffer += bytes;
                let at;
                while ((at = buffer.indexOf("\n")) >= 0) {
                    const p = JSON.parse(buffer.slice(0, at));
                    buffer = buffer.slice(at + 1);
                    const result = p.method === "initialize" ? { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } : p.method === "session/new" ? { sessionId: `session-${connections.length}` } : { stopReason: "end_turn" };
                    output.write(JSON.stringify({ jsonrpc: "2.0", id: p.id, result }) + "\n");
                }
            });
            return { input, output, exited: new Promise(() => { }), async terminate() { } };
        } };
    return { driver, calls, connections, wrongRuntimeClass() { mismatch = true; } };
}
const request: RoleExecutionRequest = { role: "worker", repo: source, runtime: policy, agent: { protocol: "acp", command: "test-acp-agent", args: ["--stdio"] }, prompt: "Build the requirement.", budget: { maxTurns: 1, timeoutMs: 10000 } };
test("runtime strict policy refuses host fallback, mutable images and unknown fields", () => {
    expect(() => parseRuntimePolicy({ ...policy, kind: "local" })).toThrow("no host fallback");
    expect(() => parseRuntimePolicy({ ...policy, image: "agent:latest" })).toThrow("pinned");
    expect(() => parseRuntimePolicy({ ...policy, mount: "/Users" })).toThrow("Unknown");
    expect(() => parseRuntimePolicy({ ...policy, network: { policy: "allowlist", allow: [{ cidr: "0.0.0.0/0", ports: [443] }] } })).toThrow("CIDRs");
    expect(() => parseRuntimePolicy({ ...policy, binary: "./repository-script" })).toThrow("host executable");
});
test("Apple roles clone INSIDE unique sandboxes; judge is read-only; no host mounts", async () => {
    const fake = fakeDriver();
    const worker = await executeAgentRole(request, { driver: fake.driver }), judge = await executeAgentRole({ ...request, role: "judge" }, { driver: fake.driver });
    expect(worker.provenance.runtimeId).not.toBe(judge.provenance.runtimeId);
    expect(worker.sessionId).not.toBe(judge.sessionId);
    expect(judge.provenance.repositoryAccess).toBe("read-only");
    expect(worker.provenance.hostMounts).toEqual([]);
    const text = JSON.stringify(fake.calls);
    expect(text).toContain("git -c protocol.file.allow=always clone --no-checkout");
    expect(text).toContain("chmod -R a-w");
    expect(text).not.toContain("--volume");
    expect(text).not.toContain("--mount");
    expect(JSON.stringify(worker.provenance)).not.toContain("secret-not-to-be-persisted");
    expect(fake.calls.filter(c => c.argv.includes("delete"))).toHaveLength(2);
    expect(fake.connections[0]).toContain("--no-new-privs");
});
test("role effect escalation and undeclared environment refuse before allocation", async () => {
    const fake = fakeDriver();
    await expect(executeAgentRole({ ...request, role: "judge", allowedToolKinds: ["edit"] }, { driver: fake.driver })).rejects.toThrow("authority");
    await expect(executeAgentRole({ ...request, agent: { ...request.agent, env: ["UNDECLARED_KEY"] } }, { driver: fake.driver })).rejects.toThrow("allowlist");
    expect(fake.calls).toHaveLength(0);
});
test("only selected role keys cross, never values in argv or provenance", async () => {
    process.env.WRINGER_FIXTURE_SECRET = "do-not-print-fixture-key";
    try {
        const fake = fakeDriver(), result = await executeAgentRole({ ...request, runtime: { ...policy, env: ["WRINGER_FIXTURE_SECRET"] }, agent: { ...request.agent, env: ["WRINGER_FIXTURE_SECRET"] } }, { driver: fake.driver });
        expect(JSON.stringify(fake.calls.map(c => c.argv))).not.toContain(process.env.WRINGER_FIXTURE_SECRET);
        expect(JSON.stringify(result)).not.toContain(process.env.WRINGER_FIXTURE_SECRET);
        expect(fake.calls.find(c => c.argv.includes("run"))!.options.env.WRINGER_FIXTURE_SECRET).toBe(process.env.WRINGER_FIXTURE_SECRET);
    }
    finally {
        delete process.env.WRINGER_FIXTURE_SECRET;
    }
});
test("gVisor manifest has independent empty storage, no service account or host namespaces", () => {
    const kube = { ...policy, kind: "gvisor-kubernetes" as const, context: "test", namespace: "wringer", runtimeClass: "gvisor" };
    const pod = kubernetesPod(kube, "role-id", "judge", 1000);
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(pod.spec.hostPID).toBe(false);
    expect(pod.spec.runtimeClassName).toBe("gvisor");
    expect(JSON.stringify(pod)).not.toContain("hostPath");
    expect(kubernetesNetworkPolicy(kube, "role-id").spec.egress).toEqual([]);
    expect(firewallScript(policy)).toContain("iptables -P OUTPUT DROP");
    expect(firewallScript(policy)).toContain("ip6tables -P OUTPUT DROP");
});
test("runtimeClass name alone is not gVisor; refuse wrong handler before pod creation", async () => {
    const fake = fakeDriver();
    fake.wrongRuntimeClass();
    await expect(executeAgentRole({ ...request, runtime: { ...policy, kind: "gvisor-kubernetes", context: "test", namespace: "wringer", runtimeClass: "gvisor" } }, { driver: fake.driver })).rejects.toThrow("runsc");
    expect(fake.calls.some(c => c.argv.includes("create"))).toBe(false);
});
test("Kubernetes full lifecycle verifies admitted isolation and cleans up both exact resources", async () => {
    const fake = fakeDriver(), runtime = { ...policy, kind: "gvisor-kubernetes" as const, context: "test", namespace: "wringer", runtimeClass: "gvisor" };
    const result = await executeAgentRole({ ...request, role: "judge", runtime }, { driver: fake.driver });
    expect(result.status).toBe("completed");
    expect(result.provenance.observed.runtimeClass).toEqual({ name: "gvisor", uid: "class-uid", handler: "runsc" });
    const creates = fake.calls.filter(call => call.argv.includes("create")).map(call => JSON.parse(call.options.input).kind);
    expect(creates).toEqual(["NetworkPolicy", "Pod"]);
    expect(fake.calls.filter(call => call.argv.includes("delete"))).toHaveLength(2);
    const bad = fakeDriver(), baseCommand = bad.driver.command;
    bad.driver.command = async (argv, options) => {
        const result = await baseCommand(argv, options);
        if (argv.includes("get") && argv.includes("pod")) {
            const pod = JSON.parse(result.stdout);
            pod.spec.volumes.push({ name: "injected", hostPath: { path: "/" } });
            result.stdout = JSON.stringify(pod);
        }
        return result;
    };
    await expect(executeAgentRole({ ...request, runtime }, { driver: bad.driver })).rejects.toThrow("isolation fields");
    expect(bad.connections).toHaveLength(0);
    expect(bad.calls.filter(call => call.argv.includes("delete"))).toHaveLength(2);
});
test("fresh verifier runs all checks after an ordinary failure and protects original files", async () => {
    const fake = fakeDriver();
    const result = await runContainedCommands({ repo: source, runtime: policy, acceptanceSource: source, protectedFiles: ["check.sh"], timeoutMs: 10000, commands: [{ id: "red", argv: ["false"], timeoutMs: 100 }, { id: "next", argv: ["true"], timeoutMs: 100 }] }, { driver: fake.driver });
    expect(result.results.map(r => r.code)).toEqual([1, 0]);
    expect(result.sourceTree).toBe(tree);
    expect(result.checkInputsSha256).toHaveLength(64);
    expect(result.provenance.role).toBe("verifier");
    expect(JSON.stringify(fake.calls)).toContain("chown 0:0 '/workspace/repo'");
    expect(fake.calls.filter(c => c.argv.includes("delete"))).toHaveLength(1);
});
test("verifier output directories are explicit and cannot cover acceptance or policy", async () => {
    expect(parseWritableDirectories(["node_modules", ".cache/build"], ["check.sh"])).toEqual([".cache/build", "node_modules"]);
    for (const directories of [["."], ["../output"], ["/tmp"], ["node_modules/../tests"], [".git/objects"], [".wringer/cache"], [".github"], [".agents"], ["node_modules\\escape"], ["output:*"], ["output\nname"], ["node_modules", "node_modules/cache"], ["check.sh"], ["tests/cache"]]) {
        const fake = fakeDriver();
        await expect(runContainedCommands({ repo: source, runtime: policy, acceptanceSource: source, protectedFiles: ["check.sh", "tests"], writableDirectories: directories, commands: [{ id: "setup", argv: ["fixture-install"], timeoutMs: 100 }], timeoutMs: 1000 }, { driver: fake.driver })).rejects.toThrow();
        expect(fake.calls).toHaveLength(0);
    }
});
test("dependency directories are prepared before protected parents lock; only declared untracked outputs are excluded", async () => {
    for (const [after, changed] of [["?? node_modules/pkg/index.js\0", false], ["!! node_modules/pkg/index.js\0", false], ["!! ignored-outside.txt\0", true], ["?? node_modules/pkg/index.js\0?? outside.txt\0", true], [" M node_modules/pkg/index.js\0", true], ["?? node_modules\0", true]] as const) {
        const fake = fakeDriver(), base = fake.driver.command;
        let statuses = 0;
        fake.driver.command = async (argv, options) => {
            const result = await base(argv, options);
            if (argv.includes("status")) {
                statuses++;
                return { ...result, stdout: statuses === 1 ? "" : after };
            }
            return result;
        };
        const measured = await runContainedCommands({ repo: source, runtime: policy, acceptanceSource: source, protectedFiles: ["check.sh"], writableDirectories: ["node_modules"], commands: [{ id: "setup", argv: ["fixture-install"], timeoutMs: 100 }], timeoutMs: 10000 }, { driver: fake.driver });
        expect(measured.sourceChanged).toBe(changed);
        expect(measured.provenance.observed.writableDirectories).toEqual(["node_modules"]);
        const calls = fake.calls.map(call => call.argv.join(" ")), prepare = calls.findIndex(value => value.includes("mkdir -p -- '/workspace/repo/node_modules'")), lock = calls.findIndex(value => value.includes("chown 0:0 '/workspace/repo'")), setup = calls.findIndex(value => value.includes("fixture-install"));
        expect(prepare).toBeGreaterThan(-1);
        expect(lock).toBeGreaterThan(prepare);
        expect(setup).toBeGreaterThan(lock);
        expect(calls.join("\n")).not.toContain("chmod u+rwx '/workspace/repo'");
    }
});
test("tracked or symlink output directories refuse before setup and still destroy the runtime", async () => {
    for (const mode of ["tracked", "symlink"]) {
        const fake = fakeDriver(), base = fake.driver.command;
        fake.driver.command = async (argv, options) => {
            const result = await base(argv, options);
            if (mode === "tracked" && argv.includes("ls-files"))
                return { ...result, stdout: "node_modules/owned.js\0" };
            if (mode === "symlink" && argv.some(arg => arg.includes("test ! -L '/workspace/repo/node_modules'")))
                return { ...result, code: 1, stderr: "symlink fixture" };
            return result;
        };
        await expect(runContainedCommands({ repo: source, runtime: policy, acceptanceSource: source, protectedFiles: ["check.sh"], writableDirectories: ["node_modules"], commands: [{ id: "setup", argv: ["fixture-install"], timeoutMs: 100 }], timeoutMs: 10000 }, { driver: fake.driver })).rejects.toThrow();
        expect(fake.calls.some(call => call.argv.includes("fixture-install"))).toBe(false);
        expect(fake.calls.filter(call => call.argv.includes("delete"))).toHaveLength(1);
    }
});
test("real Git ignored-directory output remains an explicitly declared verifier output", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wringer-verifier-output-"));
    const git = async (args: string[]) => {
        const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", repo, ...args]);
        if (result.code)
            throw new Error(result.stderr);
        return result.stdout;
    };
    await git(["init"]);
    await git(["config", "user.name", "Fixture"]);
    await git(["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, ".gitignore"), "node_modules/\n");
    await git(["add", ".gitignore"]);
    await git(["commit", "-m", "Synthetic output policy fixture"]);
    await mkdir(join(repo, "node_modules"));
    await writeFile(join(repo, "node_modules", "dependency.txt"), "Generated fixture output\n");
    const actual = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]);
    expect(actual).toContain("node_modules");
    const fake = fakeDriver(), base = fake.driver.command;
    let statuses = 0;
    fake.driver.command = async (argv, options) => {
        const result = await base(argv, options);
        if (argv.includes("status"))
            return { ...result, stdout: ++statuses === 1 ? "" : actual };
        return result;
    };
    const result = await runContainedCommands({ repo: source, runtime: policy, acceptanceSource: source, protectedFiles: ["check.sh"], writableDirectories: ["node_modules"], commands: [{ id: "setup", argv: ["true"], timeoutMs: 100 }], timeoutMs: 10000 }, { driver: fake.driver });
    expect(result.sourceChanged).toBe(false);
});
test("real bare Git broker exports exact source, captures agent patch and reconciles stable effect", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-source-broker-")), repo = join(root, "repo");
    const cmd = async (args: string[]) => {
        const out = await processDriver.command(args);
        if (out.code !== 0)
            throw new Error(out.stderr);
        return out.stdout.trim();
    };
    await cmd(["git", "init", repo]);
    await cmd(["git", "-C", repo, "config", "user.name", "Fixture"]);
    await cmd(["git", "-C", repo, "config", "user.email", "fixture@example.invalid"]);
    await cmd(["git", "-C", repo, "config", "commit.gpgsign", "false"]);
    await writeFile(join(repo, "product.txt"), "before\n");
    await cmd(["git", "-C", repo, "add", "product.txt"]);
    await cmd(["git", "-C", repo, "commit", "-m", "baseline"]);
    const baseCommit = await cmd(["git", "-C", repo, "rev-parse", "HEAD"]);
    const prepared = await prepareRepositorySource({ ...source, commit: baseCommit }, { controllerDir: join(root, "controller"), localRepo: repo });
    expect(await cmd(["git", "--git-dir", prepared.objectStore, "rev-parse", "--is-bare-repository"])).toBe("true");
    expect((await readFile(prepared.bundlePath!)).subarray(0, 16).toString()).toContain("git bundle");
    await writeFile(join(repo, "product.txt"), "agent-authored\n");
    const patch = (await processDriver.command(["git", "-C", repo, "diff", "--binary", "--full-index"])).stdout;
    const fake = fakeDriver(patch), result = await executeAgentRole({ ...request, repo: { ...source, commit: baseCommit } }, { driver: fake.driver });
    const candidate = await captureCandidate(result, prepared, { controllerDir: join(root, "controller"), effectId: "candidate-1" });
    expect(candidate.changedPaths).toEqual(["product.txt"]);
    expect(await cmd(["git", "--git-dir", candidate.source.objectStore, "show", `${candidate.source.commit}:product.txt`])).toBe("agent-authored");
    expect(await captureCandidate(result, prepared, { controllerDir: join(root, "controller"), effectId: "candidate-1" })).toEqual(candidate);
    const changed: RoleExecutionResult = { ...result, change: { baseCommit, patch: "different", sha256: digest("different") } };
    await expect(captureCandidate(changed, prepared, { controllerDir: join(root, "controller"), effectId: "candidate-1" })).rejects.toThrow("different");
});
test("real ACP subprocess cancellation terminates its descendant process group", async () => {
    const fixture = new URL("fixtures/acp-agent.ts", import.meta.url).pathname;
    const success = await runAcpTurn(await processDriver.connect([process.execPath, fixture]), { role: "worker", cwd: "/workspace/repo", prompt: "fixture only", timeoutMs: 2000 });
    expect(success.status).toBe("completed");
    expect(success.text).toBe("Real process protocol completed.");
    const result = await runAcpTurn(await processDriver.connect([process.execPath, fixture, "--hang"]), { role: "worker", cwd: "/workspace/repo", prompt: "fixture only", timeoutMs: 200 });
    expect(result.stopReason).toBe("timeout");
    const pid = Number(result.text);
    expect(pid).toBeGreaterThan(1);
    let alive = true;
    for (let i = 0; i < 20; i++) {
        try {
            process.kill(pid, 0);
        }
        catch {
            alive = false;
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(alive).toBe(false);
});
