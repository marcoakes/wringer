import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorkerScope, repositoryPermissionsScript, processDriver, quote, validateKubernetesNetworkPolicies, kubernetesNetworkPolicy, parseRuntimePolicy, runtimeDeepRedact, runtimeRedactor, type KubernetesPolicy } from "../src/index";

test("credential forwarding rejects executable environment and redacts decoded JSON strings", () => {
    const base = { kind: "apple-container", image: "fixture@sha256:" + "a".repeat(64), cpus: 1, memoryMiB: 512, network: { policy: "deny" } };
    for (const name of ["PATH", "GIT_CONFIG_COUNT", "GIT_INDEX_FILE", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "BASH_ENV", "KUBECONFIG", "SSH_AUTH_SOCK"])
        expect(() => parseRuntimePolicy({ ...base, env: [name] })).toThrow("control variables");
    expect(parseRuntimePolicy({ ...base, env: ["CODEX_API_KEY"] }).env).toEqual(["CODEX_API_KEY"]);
    process.env.WRINGER_SYNTHETIC_ESCAPED_SECRET = 'fixture-"quoted"-\\-secret';
    try {
        const value = { nested: [{ text: `prefix ${process.env.WRINGER_SYNTHETIC_ESCAPED_SECRET} suffix` }] };
        const redacted = runtimeDeepRedact(JSON.parse(JSON.stringify(value)), runtimeRedactor(["WRINGER_SYNTHETIC_ESCAPED_SECRET"]));
        expect(redacted.nested[0].text).toBe("prefix [REDACTED] suffix");
    } finally { delete process.env.WRINGER_SYNTHETIC_ESCAPED_SECRET; }
});

test("scope paths are exact, protected, symlink-guarded and never inferred", () => {
    for (const writable of [["../escape"], ["/workspace"], ["src/../tests"], ["src\nname"], [".git"], ["tests/check.sh"], []])
        expect(() => parseWorkerScope({ writable, protected: ["tests"] })).toThrow();
    expect(() => parseWorkerScope({ writable: ["src"], protected: ["tests"], writableDirectories: ["tests/cache"] })).toThrow();
    const script = repositoryPermissionsScript("/workspace/repo", { writable: ["src"], protected: ["src/checks/test.sh"] });
    expect(script).toContain("test ! -L '/workspace/repo/src/checks/test.sh'");
    expect(script).toContain("chown -R 0:0 '/workspace/repo/.git'");
    expect(script).toContain("chown 0:0 '/workspace/repo/src'; chmod a-w '/workspace/repo/src'");
    expect(script.indexOf("chown -R 1000:1000 '/workspace/repo/src'")).toBeLessThan(script.indexOf("chown -R 0:0 '/workspace/repo/src/checks/test.sh'"));
    const verifier = repositoryPermissionsScript("/workspace/repo");
    expect(verifier).toContain("chown -R 0:0");
    expect(verifier).toContain("chmod -R a-w");
    expect(verifier).not.toContain("1000:1000");
});

test("effective policy accepts independent default deny, rejects selecting allow including expressions", () => {
    const policy: KubernetesPolicy = { kind: "gvisor-kubernetes", image: "fixture@sha256:" + "a".repeat(64), cpus: 1, memoryMiB: 512, network: { policy: "deny" }, context: "fixture", namespace: "wringer", runtimeClass: "gvisor" };
    const owned = kubernetesNetworkPolicy(policy, "fixture"), labels = { "wringer.dev/runtime": "fixture" };
    const other = { metadata: { name: "default-deny", namespace: "wringer" }, spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"], ingress: [], egress: [] as any[] } };
    expect(validateKubernetesNetworkPolicies({ items: [owned, other] }, owned, labels).declaredRulesVerified).toBe(true);
    const extra = { ...other, spec: { ...other.spec, egress: [{}], podSelector: { matchExpressions: [{ key: "wringer.dev/runtime", operator: "Exists" }] } } };
    expect(() => validateKubernetesNetworkPolicies({ items: [owned, extra] }, owned, labels)).toThrow("additional network access");
    extra.spec.podSelector.matchExpressions[0]!.operator = "DoesNotExist";
    expect(validateKubernetesNetworkPolicies({ items: [owned, extra] }, owned, labels).selectingPolicies).toEqual(["fixture"]);
});

// This executable DAC adversary requires a Linux root test environment, not a fake runtime.
// It is deliberately skipped on macOS; manifest/protocol tests do not replace it or live gates.
const realLinuxDac = process.platform === "linux" && process.getuid?.() === 0 && !!Bun.which("setpriv");
(realLinuxDac ? test : test.skip)("real Linux DAC denies out-of-scope, protected rename and verifier tracked writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "wringer-dac-")), repo = join(root, "repo");
    await chmod(root, 0o755);
    for (const dir of ["src", "tests", ".git", "outside"]) await mkdir(join(repo, dir), { recursive: true });
    for (const file of ["src/code.txt", "tests/check.sh", ".git/config", "outside/secret.txt"]) await writeFile(join(repo, file), "original\n");
    const run = async (script: string) => processDriver.command(["/bin/sh", "-c", script]);
    expect((await run(repositoryPermissionsScript(repo, { writable: ["src"], protected: ["tests/check.sh"] }))).code).toBe(0);
    const asAgent = async (script: string) => processDriver.command(["setpriv", "--reuid=1000", "--regid=1000", "--clear-groups", "--bounding-set=-all", "--inh-caps=-all", "--ambient-caps=-all", "--no-new-privs", "--", "/bin/sh", "-c", script]);
    expect((await asAgent(`printf changed > ${quote(join(repo, "src/code.txt"))}`)).code).toBe(0);
    expect((await asAgent(`printf new > ${quote(join(repo, "src/new.txt"))}`)).code).toBe(0);
    for (const file of ["tests/check.sh", ".git/config", "outside/secret.txt"]) expect((await asAgent(`printf attack > ${quote(join(repo, file))}`)).code).not.toBe(0);
    expect((await asAgent(`mv ${quote(join(repo, "src/new.txt"))} ${quote(join(repo, "tests/check.sh"))}`)).code).not.toBe(0);
    expect(await readFile(join(repo, "tests/check.sh"), "utf8")).toBe("original\n");
    expect((await run(repositoryPermissionsScript(repo))).code).toBe(0);
    expect((await asAgent(`printf transient > ${quote(join(repo, "src/code.txt"))}`)).code).not.toBe(0);
});
