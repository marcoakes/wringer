import { test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcpTurn } from "@wringer/acp";
import { validateAppleImageInspection, validateAppleInspection } from "../src/observations";
import { unitPng } from "./fixtures/png";
import { openSandbox, executeAgentRole, preflightAgentRole, runContainedCommands, parseRuntimePolicy, parseWritableDirectories, kubernetesPod, kubernetesNetworkPolicy, firewallScript, createLocalSourceBundle, prepareRepositorySource, captureCandidate, processDriver, digest, type RuntimeDriver, type RuntimePolicy, type RoleExecutionRequest, type RoleExecutionResult } from "../src/index";
const image = `registry.invalid/agent@sha256:${"a".repeat(64)}`, commit = "b".repeat(40), tree = "c".repeat(40);
const policy: RuntimePolicy = { kind: "apple-container", image, cpus: 1, memoryMiB: 512, network: { policy: "deny" } };
const source = { url: "https://example.invalid/repo.git", commit };
function fakeDriver(patch = "") {
    const calls: {
        argv: string[];
        options: any;
    }[] = [], connections: string[][] = [], connectionOptions: any[] = [], packets: any[] = [];
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
        return { ...declaration, metadata: { ...declaration.metadata, uid: "pod-uid" }, status: { containerStatuses: [{ name: "agent", imageID: `docker-pullable://${image}` }] } };
    };
    const driver: RuntimeDriver = { async command(argv, options) {
            calls.push({ argv, options });
            const command = argv.join(" ");
            if (argv.includes("--version"))
                return { code: 0, stdout: "container 0.11 fixture\n", stderr: "" };
            if (argv.includes("runtimeclass"))
                return { code: 0, stdout: JSON.stringify({ handler: mismatch ? "runc" : "runsc", metadata: { name: "gvisor", uid: "class-uid" } }), stderr: "" };
            if (argv[1] === "image" && argv[2] === "inspect")
                return { code: 0, stdout: JSON.stringify([{ configuration: { name: image, descriptor: { digest: image.split("@")[1] } } }]), stderr: "" };
            if (argv[1] === "inspect")
                return { code: 0, stdout: JSON.stringify([{ id: argv.at(-1), status: { state: "running", networks: [] }, configuration: { id: argv.at(-1), image: { reference: image, descriptor: { digest: image.split("@")[1] } }, resources: { cpus: 1, memoryInBytes: 512 * 1024 * 1024 }, mounts: [], publishedPorts: [], publishedSockets: [], ssh: false, virtualization: false, runtimeHandler: "container-runtime-linux", environment: ["secret-not-to-be-persisted"] } }]), stderr: "" };
            if (argv.includes("get") && argv.includes("networkpolicies")) {
                const items = calls.filter(call => call.argv.includes("create")).map(call => JSON.parse(call.options.input)).filter(value => value.kind === "NetworkPolicy");
                return { code: 0, stdout: JSON.stringify({ items }), stderr: "" };
            }
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
        }, async connect(argv, options) {
            connections.push(argv);
            connectionOptions.push(options);
            const input = new PassThrough(), output = new PassThrough();
            let buffer = "";
            input.on("data", bytes => {
                buffer += bytes;
                let at;
                while ((at = buffer.indexOf("\n")) >= 0) {
                    const p = JSON.parse(buffer.slice(0, at));
                    buffer = buffer.slice(at + 1);
                    packets.push(p);
                    const result = p.method === "initialize" ? { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } : p.method === "session/new" ? { sessionId: `session-${connections.length}` } : { stopReason: "end_turn" };
                    output.write(JSON.stringify({ jsonrpc: "2.0", id: p.id, result }) + "\n");
                }
            });
            return { input, output, exited: new Promise(() => { }), async terminate() { } };
        } };
    return { driver, calls, connections, connectionOptions, packets, wrongRuntimeClass() { mismatch = true; } };
}
const request: RoleExecutionRequest = { role: "worker", repo: source, runtime: policy, agent: { protocol: "acp", command: "test-acp-agent", args: ["--stdio"] }, scope: { writable: ["src"], protected: ["check.sh"] }, prompt: "Build the requirement.", budget: { maxTurns: 1, timeoutMs: 10000 } };
test("declared visual outputs are captured after success before cleanup with no verifier credentials", async () => {
    const fake = fakeDriver(), original = fake.driver.command, png = unitPng();
    fake.driver.command = async (argv, options) => { const result = await original(argv, options); return argv.some(arg => arg.includes("head -c 4194305")) ? { code: 0, stdout: png + "\n", stderr: "" } : result; };
    const result = await runContainedCommands({ repo: source, runtime: policy, commands: [{ id: "show", argv: ["true"], timeoutMs: 1000 }], writableDirectories: ["outputs"], captureArtifacts: [{ id: "desktop", path: "outputs/desktop.png", mimeType: "image/png", width: 1, height: 1 }], timeoutMs: 10000 }, { driver: fake.driver });
    expect(result.artifacts).toEqual([{ id: "desktop", path: "outputs/desktop.png", mimeType: "image/png", width: 1, height: 1, bytes: Buffer.from(png, "base64").length, sha256: digest(Buffer.from(png, "base64")), base64: png }]);
    const stop = fake.calls.findIndex(row => row.argv.some(arg => arg.includes("pkill -KILL -u 1000"))), capture = fake.calls.findIndex(row => row.argv.some(arg => arg.includes("head -c 4194305"))), close = fake.calls.findIndex(row => row.argv[1] === "delete");
    expect(stop).toBeGreaterThan(0); expect(capture).toBeGreaterThan(stop); expect(close).toBeGreaterThan(capture);
    const script = fake.calls[capture]!.argv.at(-1)!;
    expect(script).toContain("test ! -L '/workspace/repo/outputs'"); expect(script).toContain("test ! -L '/workspace/repo/outputs/desktop.png'"); expect(script).toContain("stat -c %h"); expect(script).toContain("realpath -e"); expect(script).toContain("test -f");
    expect(fake.connections).toHaveLength(0); expect(result.provenance.declared.env ?? []).toEqual([]);
});
test("unsafe visual declarations refuse before allocation", async () => {
    for (const bad of [{ id: "desktop", path: "/tmp/secret.png", mimeType: "image/png" }, { id: "desktop", path: "outputs/../private.png", mimeType: "image/png" }, { id: "desktop", path: "outputs/a.svg", mimeType: "image/svg+xml" }, { id: "desktop", path: "src/a.png", mimeType: "image/png" }, { path: "outputs/a.png", mimeType: "image/png" }, { id: "desktop", path: "outputs/a.png", mimeType: "image/png", width: 0 }]) {
        const fake = fakeDriver();
        await expect(runContainedCommands({ repo: source, runtime: policy, commands: [{ id: "show", argv: ["true"], timeoutMs: 1000 }], writableDirectories: ["outputs"], captureArtifacts: [bad as any], timeoutMs: 10000 }, { driver: fake.driver })).rejects.toThrow("Visual captures");
        expect(fake.calls).toHaveLength(0);
    }
});
test("failed show never exports pixels; missing, non-PNG and mismatched images close the verifier and refuse", async () => {
    for (const scenario of ["failed-show", "missing", "html", "dimensions"] as const) {
        const fake = fakeDriver(), original = fake.driver.command;
        fake.driver.command = async (argv, options) => { const result = await original(argv, options); return argv.some(arg => arg.includes("head -c 4194305")) ? { code: scenario === "missing" ? 1 : 0, stdout: scenario === "html" ? Buffer.from("<html>not evidence</html>").toString("base64") : unitPng(), stderr: "" } : result; };
        const attempt = runContainedCommands({ repo: source, runtime: policy, commands: [{ id: "show", argv: [scenario === "failed-show" ? "false" : "true"], timeoutMs: 1000 }], writableDirectories: ["outputs"], captureArtifacts: [{ id: "desktop", path: "outputs/a.png", mimeType: "image/png", width: scenario === "dimensions" ? 2 : 1, height: 1 }], timeoutMs: 10000 }, { driver: fake.driver });
        if (scenario === "failed-show") { expect((await attempt).artifacts).toEqual([]); expect(fake.calls.some(row => row.argv.some(arg => arg.includes("head -c 4194305")))).toBe(false); }
        else await expect(attempt).rejects.toThrow();
        expect(fake.calls.at(-1)!.argv[1]).toBe("delete");
    }
});
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
test("Apple command stdin requires interactive exec without allocating a TTY", async () => {
    const fake = fakeDriver(), sandbox = await openSandbox({ role: "judge", repo: source, policy, driver: fake.driver, redact: value => value, timeoutMs: 10000 });
    try {
        await sandbox.exec(["cat"], { input: "controller-owned bytes\n" });
        const call = fake.calls.at(-1)!;
        expect(call.argv.slice(0, 3)).toEqual(["container", "exec", "--interactive"]);
        expect(call.argv).not.toContain("--tty");
        expect(call.options.input).toBe("controller-owned bytes\n");
        await sandbox.exec(["true"]);
        expect(fake.calls.at(-1)!.argv).not.toContain("--interactive");
    } finally { await sandbox.close(); }
});
test("Apple failed allocation cleanup reconciles only a successful recognizable absence", async () => {
    for (const scenario of ["absent", "present", "unrecognized", "unavailable"] as const) {
        const fake = fakeDriver(), original = fake.driver.command;
        let id = "";
        fake.driver.command = async (argv, options) => {
            const result = await original(argv, options);
            if (argv[1] === "run") { id = argv[argv.indexOf("--name") + 1]!; return { code: 1, stdout: "", stderr: "fixture create interrupted" }; }
            if (argv[1] === "delete") return { code: 1, stdout: "", stderr: "fixture delete reply unavailable" };
            if (argv[1] === "list") return { code: scenario === "unavailable" ? 1 : 0, stdout: JSON.stringify(scenario === "absent" ? [] : scenario === "present" ? [{ configuration: { id } }] : [{ unexpected: id }]), stderr: "" };
            return result;
        };
        await expect(openSandbox({ role: "judge", repo: source, policy, driver: fake.driver, redact: value => value, timeoutMs: 10000 })).rejects.toThrow(scenario === "absent" ? "Contained runtime operation failed" : "Could not confirm cleanup");
        expect(fake.calls.some(call => call.argv[1] === "list")).toBe(true);
        expect(fake.connections).toHaveLength(0);
    }
});
test("role effect escalation and undeclared environment refuse before allocation", async () => {
    const fake = fakeDriver();
    await expect(executeAgentRole({ ...request, role: "judge", allowedToolKinds: ["edit"] }, { driver: fake.driver })).rejects.toThrow("authority");
    await expect(executeAgentRole({ ...request, agent: { ...request.agent, env: ["UNDECLARED_KEY"] } }, { driver: fake.driver })).rejects.toThrow("allowlist");
    expect(fake.calls).toHaveLength(0);
});
test("Apple selected role keys cross only on validated agent connection, never allocation, setup or cleanup", async () => {
    process.env.WRINGER_FIXTURE_SECRET = "do-not-print-fixture-key";
    try {
        const fake = fakeDriver(), result = await executeAgentRole({ ...request, runtime: { ...policy, env: ["WRINGER_FIXTURE_SECRET"] }, agent: { ...request.agent, env: ["WRINGER_FIXTURE_SECRET"] } }, { driver: fake.driver });
        expect(JSON.stringify(fake.calls.map(c => c.argv))).not.toContain(process.env.WRINGER_FIXTURE_SECRET);
        expect(JSON.stringify(fake.connections)).not.toContain(process.env.WRINGER_FIXTURE_SECRET);
        expect(JSON.stringify(result)).not.toContain(process.env.WRINGER_FIXTURE_SECRET);
        expect(fake.calls.every(c => !c.options?.env?.WRINGER_FIXTURE_SECRET)).toBe(true);
        expect(fake.calls.find(c => c.argv[1] === "run")!.argv).not.toContain("WRINGER_FIXTURE_SECRET");
        expect(fake.connections[0]).toContain("WRINGER_FIXTURE_SECRET");
        expect(fake.connections[0]![fake.connections[0]!.indexOf("WRINGER_FIXTURE_SECRET") - 1]).toBe("--env");
        expect(fake.connectionOptions[0].env.WRINGER_FIXTURE_SECRET).toBe(process.env.WRINGER_FIXTURE_SECRET);
        const inventory = fake.calls.findIndex(c => c.argv[1] === "image" && c.argv[2] === "inspect"), allocation = fake.calls.findIndex(c => c.argv[1] === "run"), inspection = fake.calls.findIndex(c => c.argv[1] === "inspect"), guest = fake.calls.findIndex(c => c.argv[1] === "exec");
        expect(inventory).toBeLessThan(allocation);
        expect(allocation).toBeLessThan(inspection);
        expect(inspection).toBeLessThan(guest);
        expect(result.provenance.observed.instance).toMatchObject({ imageDigest: image.split("@")[1] });
        expect(result.provenance.observed.image).toMatchObject({ imageDigest: image.split("@")[1] });
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
    await expect(executeAgentRole({ ...request, runtime }, { driver: bad.driver })).rejects.toThrow("storage differs");
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
    const bundlePath = join(root, "source.bundle");
    await createLocalSourceBundle(repo, baseCommit, bundlePath);
    const prepared = await prepareRepositorySource({ ...source, commit: baseCommit, bundlePath }, { controllerDir: join(root, "controller") });
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
    let failedOnce = false;
    const interrupted: RuntimeDriver = { ...processDriver, async command(argv, options) {
        if (!failedOnce && argv.includes("write-tree")) { failedOnce = true; throw new Error("Injected capture interruption after the index changed"); }
        return processDriver.command(argv, options);
    } };
    await expect(captureCandidate(result, prepared, { controllerDir: join(root, "controller"), effectId: "partial", driver: interrupted })).rejects.toThrow("Injected capture interruption");
    const reserved = JSON.parse(await readFile(join(root, "controller/candidates/partial/reservation.json"), "utf8"));
    expect(reserved.patch_sha256).toBe(result.change!.sha256);
    await expect(captureCandidate(changed, prepared, { controllerDir: join(root, "controller"), effectId: "partial" })).rejects.toThrow("different");
    const reconciled = await captureCandidate(result, prepared, { controllerDir: join(root, "controller"), effectId: "partial" });
    expect(reconciled.source.commit).toBe(candidate.source.commit);
    expect(reconciled.tree).toBe(candidate.tree);
    expect((await readdir(join(root, "controller/candidates/partial"))).filter(name => name.startsWith("attempt-"))).toHaveLength(2);
    expect(await captureCandidate(result, prepared, { controllerDir: join(root, "controller"), effectId: "partial" })).toEqual(reconciled);
}, 20000);

test("worker filesystem authority is mandatory before allocation; source capture is supervisor-owned", async () => {
    const missing = fakeDriver();
    await expect(executeAgentRole({ ...request, scope: undefined }, { driver: missing.driver })).rejects.toThrow("filesystem scope");
    expect(missing.calls).toHaveLength(0);
    const fake = fakeDriver();
    const result = await executeAgentRole({ ...request, scope: { writable: ["src"], protected: ["tests/check.sh"], writableDirectories: ["node_modules"] } }, { driver: fake.driver });
    expect(result.provenance.observed.filesystem).toMatchObject({ mode: "scoped-worker", gitMetadata: "controller-owned-read-only" });
    const commands = fake.calls.map(call => call.argv.join(" "));
    const capture = commands.find(value => value.includes("diff --cached"))!;
    expect(capture).not.toContain("setpriv");
    expect(capture).toContain("GIT_CONFIG_GLOBAL=/dev/null");
    expect(capture).toContain(":(exclude,literal)node_modules");
    const stop = commands.findIndex(value => value.includes("pkill -KILL -u 1000"));
    expect(stop).toBeGreaterThan(-1);
    expect(commands.findIndex(value => value.includes("diff --cached"))).toBeGreaterThan(stop);
    expect((await processDriver.command(["/bin/sh", "-n"], { input: fake.calls[stop]!.argv.at(-1)! })).code).toBe(0);
});

test("contained preflight opens only the selected role session, never sends task work or captures a patch", async () => {
    const fake = fakeDriver();
    process.env.WRINGER_SYNTHETIC_PREFLIGHT = "synthetic-key-no-provider";
    try {
        const result = await preflightAgentRole({ ...request, runtime: { ...policy, env: ["WRINGER_SYNTHETIC_PREFLIGHT"] }, agent: { ...request.agent, env: ["WRINGER_SYNTHETIC_PREFLIGHT"] } }, { driver: fake.driver });
        expect(result.status).toBe("completed");
        expect(result.authentication.sessionOpened).toBe(true);
        expect(result.authLine).toContain("Provider-key validity and effective credential are not attested");
        expect(result.promptSent).toBe(false);
        expect(result.providerCredentialValidated).toBe(false);
        expect(result.usage).toBeUndefined();
        expect(result.change).toBeUndefined();
        expect(fake.packets.map(packet => packet.method)).toEqual(["initialize", "session/new"]);
        expect(fake.calls.some(call => call.argv.join(" ").includes("diff --cached"))).toBe(false);
        expect(fake.calls.filter(call => call.argv.includes("delete"))).toHaveLength(1);
        expect(JSON.stringify(result)).not.toContain(process.env.WRINGER_SYNTHETIC_PREFLIGHT);
    } finally { delete process.env.WRINGER_SYNTHETIC_PREFLIGHT; }
});

test("admitted Kubernetes mutations and overlapping allow policies refuse before agent connection", async () => {
    const runtime = { ...policy, kind: "gvisor-kubernetes" as const, context: "test", namespace: "wringer", runtimeClass: "gvisor" };
    const mutations: Array<(pod: any) => void> = [
        pod => { pod.metadata.labels = {}; },
        pod => { pod.spec.containers[0].envFrom = [{ secretRef: { name: "undeclared-secret" } }]; },
        pod => { pod.spec.containers[0].env.push({ name: "UNDECLARED", value: "fixture" }); },
        pod => { pod.spec.containers[0].securityContext.capabilities.add.push("SYS_ADMIN"); },
        pod => { pod.spec.securityContext.seccompProfile.type = "Unconfined"; },
        pod => { pod.spec.containers[0].volumeMounts[0].mountPath = "/home/agent"; },
        pod => { pod.spec.activeDeadlineSeconds += 1000; },
        pod => { pod.spec.containers[0].lifecycle = { postStart: { exec: { command: ["unapproved"] } } }; },
    ];
    for (const mutate of mutations) {
        const fake = fakeDriver(), original = fake.driver.command;
        fake.driver.command = async (argv, options) => { const result = await original(argv, options); if (argv.includes("get") && argv.includes("pod")) { const pod = JSON.parse(result.stdout); mutate(pod); result.stdout = JSON.stringify(pod); } return result; };
        await expect(executeAgentRole({ ...request, runtime }, { driver: fake.driver })).rejects.toThrow();
        expect(fake.connections).toHaveLength(0);
        expect(fake.calls.filter(call => call.argv.includes("delete"))).toHaveLength(2);
    }
    for (const mode of ["own-selector", "foreign-allow"]) {
        const fake = fakeDriver(), original = fake.driver.command;
        fake.driver.command = async (argv, options) => { const result = await original(argv, options); if (argv.includes("get") && argv.includes("networkpolicies")) { const list = JSON.parse(result.stdout); if (mode === "own-selector") list.items[0].spec.podSelector = {}; else list.items.push({ metadata: { name: "namespace-allow-all", namespace: runtime.namespace }, spec: { podSelector: {}, policyTypes: ["Egress"], egress: [{}] } }); result.stdout = JSON.stringify(list); } return result; };
        await expect(executeAgentRole({ ...request, runtime }, { driver: fake.driver })).rejects.toThrow();
        expect(fake.connections).toHaveLength(0);
        expect(fake.calls.filter(call => call.argv.includes("create"))).toHaveLength(1);
    }
});

test("Apple inspect rejects wrong identity, image, resource limits and host forwarding", async () => {
    const mutations: Array<(instance: any) => void> = [
        row => { row.configuration.id = "another-runtime"; },
        row => { row.id = "another-runtime"; },
        row => { row.configuration.image.reference = image.replaceAll("a", "f"); },
        row => { row.configuration.image.descriptor.digest = `sha256:${"f".repeat(64)}`; },
        row => { row.configuration.image.descriptor.digest = "sha256:malformed"; },
        row => { delete row.configuration.image.descriptor; },
        row => { row.configuration.resources.cpus = 64; },
        row => { delete row.configuration.resources; },
        row => { row.configuration.mounts = [{ source: "/Users", destination: "/host" }]; },
        row => { row.configuration.ssh = true; },
        row => { row.status.state = "stopped"; },
        row => { row.status = "running"; },
    ];
    for (const mutate of mutations) {
        const fake = fakeDriver(), original = fake.driver.command;
        fake.driver.command = async (argv, options) => { const result = await original(argv, options); if (argv[1] === "inspect") { const instances = JSON.parse(result.stdout); mutate(instances[0]); result.stdout = JSON.stringify(instances); } return result; };
        await expect(executeAgentRole(request, { driver: fake.driver })).rejects.toThrow("Apple inspect");
        expect(fake.connections).toHaveLength(0);
        expect(fake.calls.some(call => call.argv[1] === "exec")).toBe(false);
        expect(fake.calls.filter(call => call.argv.includes("delete"))).toHaveLength(1);
    }
});
test("Apple local image aliases cannot bypass preallocation descriptor validation", async () => {
    const mutations: Array<(rows: any[]) => void> = [
        rows => { rows[0].configuration.descriptor.digest = `sha256:${"f".repeat(64)}`; },
        rows => { rows[0].configuration.descriptor.digest = "sha256:malformed"; },
        rows => { delete rows[0].configuration.descriptor; },
        rows => { rows[0].configuration.name = "agent:mutable"; },
        rows => { rows.push(structuredClone(rows[0])); },
        rows => { rows.length = 0; },
    ];
    for (const mutate of mutations) {
        const fake = fakeDriver(), original = fake.driver.command;
        fake.driver.command = async (argv, options) => {
            const result = await original(argv, options);
            if (argv[1] === "image" && argv[2] === "inspect") {
                const rows = JSON.parse(result.stdout); mutate(rows); result.stdout = JSON.stringify(rows);
            }
            return result;
        };
        await expect(executeAgentRole(request, { driver: fake.driver })).rejects.toThrow("Apple");
        expect(fake.connections).toHaveLength(0);
        expect(fake.calls.some(call => ["run", "exec", "delete"].includes(call.argv[1]!))).toBe(false);
    }
});
test("Apple rejects content changed after inventory before any guest command or credential delivery", async () => {
    process.env.WRINGER_DIGEST_RACE_FIXTURE = "synthetic-secret-no-provider";
    try {
        const fake = fakeDriver(), original = fake.driver.command;
        fake.driver.command = async (argv, options) => {
            const result = await original(argv, options);
            if (argv[1] === "inspect") {
                const rows = JSON.parse(result.stdout);
                // Keep the convincing digest-qualified reference, change actual content.
                rows[0].configuration.image.descriptor.digest = `sha256:${"f".repeat(64)}`;
                result.stdout = JSON.stringify(rows);
            }
            return result;
        };
        await expect(executeAgentRole({ ...request, runtime: { ...policy, env: ["WRINGER_DIGEST_RACE_FIXTURE"] }, agent: { ...request.agent, env: ["WRINGER_DIGEST_RACE_FIXTURE"] } }, { driver: fake.driver })).rejects.toThrow("descriptor");
        expect(fake.calls.some(call => call.argv[1] === "run")).toBe(true);
        expect(fake.calls.some(call => call.argv[1] === "exec")).toBe(false);
        expect(fake.calls.filter(call => call.argv[1] === "delete")).toHaveLength(1);
        expect(fake.calls.every(call => !call.options?.env?.WRINGER_DIGEST_RACE_FIXTURE)).toBe(true);
        expect(JSON.stringify(fake.calls)).not.toContain(process.env.WRINGER_DIGEST_RACE_FIXTURE);
        expect(fake.connections).toHaveLength(0);
    } finally { delete process.env.WRINGER_DIGEST_RACE_FIXTURE; }
});
test("Apple 1.3.1 captured status shape and canonical reference retain descriptor authority", () => {
    // Shape and digest captured by the root's credential-free 2026-09-07 inspection.
    // The capture was stopped; changing state below tests parsing, not a live pass.
    const imageDigest = "sha256:fd8ced35d1d3bf52a519fbf4e48ca4229dd624a7b9a648751f0932386ad284e5";
    const requested = `wringer-agents:alpha3-arm64@${imageDigest}`, actual = `docker.io/library/wringer-agents@${imageDigest}`;
    const approved = { ...policy, image: requested };
    const capture = [{ configuration: { id: "wringer-inspection-alpha3", image: { descriptor: { digest: imageDigest, mediaType: "application/vnd.oci.image.index.v1+json", size: 375 }, reference: actual }, resources: { cpuOverhead: 1, cpus: 1, memoryInBytes: 536870912 }, mounts: [], publishedPorts: [], publishedSockets: [], ssh: false, virtualization: false, runtimeHandler: "container-runtime-linux", rosetta: false }, id: "wringer-inspection-alpha3", status: { networks: [], state: "stopped" } }];
    expect(() => validateAppleInspection(capture, approved, capture[0]!.id)).toThrow("identity/status");
    capture[0]!.status.state = "running";
    expect(validateAppleInspection(capture, approved, capture[0]!.id)).toMatchObject({ status: "running", requestedImageReference: requested, imageReference: actual, imageDigest });
    expect(validateAppleImageInspection([{ configuration: { name: actual, descriptor: { digest: imageDigest } } }], approved)).toEqual({ requestedImageReference: requested, imageReference: actual, imageDigest });
    capture[0]!.configuration.image.descriptor.digest = `sha256:${"0".repeat(64)}`;
    expect(() => validateAppleInspection(capture, approved, capture[0]!.id)).toThrow("descriptor");
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
