/** The trusted-local runtime: explicit, stamped, and run in fresh temporary clones on
 * this computer. Real git, real host processes, a fixture ACP agent; no model. */
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAgentRole, parseRuntimePolicy, provenanceMatchesRuntime, runContainedCommands, TRUSTED_LOCAL_SENTENCE, type RoleExecutionRequest } from "../src";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); delete process.env.WRINGER_TL_FIXTURE_KEY; delete process.env.WRINGER_TL_UNDECLARED; delete process.env.GIT_DIR_FIXTURE; });
const policy = { kind: "trusted-local", network: { policy: "unenforced" } } as const;
const agentScript = join(import.meta.dir, "fixtures/host-agent.ts");
function git(cwd: string, ...args: string[]) {
    const result = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (result.exitCode) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
}
async function repository() {
    const root = await mkdtemp(join(tmpdir(), "wringer-tl-test-")); directories.push(root);
    const repo = join(root, "source"); await mkdir(join(repo, "src"), { recursive: true });
    git(root, "init", "--initial-branch=main", repo);
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "test \"$(sed -n '1p' src/value.js)\" = 'export const expected = true;'\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "Fixture baseline");
    const commit = git(repo, "rev-parse", "HEAD"), bundlePath = join(root, "source.bundle");
    git(repo, "bundle", "create", bundlePath, "HEAD", "main");
    return { root, repo, commit, source: { url: "https://example.test/fixture.git", commit, bundlePath } };
}
const request = (source: any, role: "worker" | "judge" = "worker", extra: Partial<RoleExecutionRequest> = {}): RoleExecutionRequest => ({ role, repo: source, runtime: policy as any, agent: { protocol: "acp", command: process.execPath, args: [agentScript, ...(role === "judge" ? ["--read-only"] : [])] }, prompt: "Make the check pass.", budget: { maxTurns: 1, timeoutMs: 20000 }, ...(role === "worker" ? { scope: { writable: ["src/value.js", "NEW_FILE.md"], protected: ["check.sh"] } } : {}), ...extra });

test("trusted-local is an explicit policy whose network cannot be restricted, and carries no container settings", () => {
    expect(parseRuntimePolicy(policy)).toEqual({ kind: "trusted-local", network: { policy: "unenforced" }, env: [] });
    expect(() => parseRuntimePolicy({ kind: "trusted-local", network: { policy: "deny" } })).toThrow("Network policy deny cannot be enforced on a trusted-local runtime");
    expect(() => parseRuntimePolicy({ kind: "trusted-local", network: { policy: "allowlist", allow: [] } })).toThrow("cannot be enforced");
    expect(() => parseRuntimePolicy({ ...policy, image: "x@sha256:" + "a".repeat(64) })).toThrow("A trusted-local runtime has no image");
    expect(() => parseRuntimePolicy({ ...policy, env: ["PATH"] })).toThrow("cannot forward host/runtime/shell/Git control variables");
    expect(() => parseRuntimePolicy({ kind: "host" })).toThrow("no host fallback exists");
});
test("a worker runs in a fresh clone on this computer; its change is captured and the clone removed", async () => {
    const fixture = await repository();
    const result = await executeAgentRole(request(fixture.source));
    expect(result.status).toBe("completed");
    const report = JSON.parse(result.text.trim());
    expect(report.cwd).not.toBe(fixture.repo);
    expect(existsSync(report.cwd)).toBe(false);
    expect(result.change!.baseCommit).toBe(fixture.commit);
    expect(result.change!.patch).toContain("+export const expected = true;");
    expect(result.change!.patch).toContain("NEW_FILE.md");
    expect(await readFile(join(fixture.repo, "src/value.js"), "utf8")).toBe("export const expected = false;\n");
    const p = result.provenance as any;
    expect(p).toMatchObject({ schema_version: "wringer.runtime.v3", kind: "trusted-local", boundary: "trusted-local", established: "none", workspace: "fresh-temporary-clone", repositoryAccess: "read-write", repository: { url: fixture.source.url, commit: fixture.commit } });
    expect(p.limits).toContain(TRUSTED_LOCAL_SENTENCE);
    expect(p.image).toBeUndefined(); expect(p.clonedInside).toBeUndefined();
    // The temporary clone's location is never recorded (the agent's own command path may be anywhere).
    expect(JSON.stringify(p)).not.toContain(report.cwd); expect(JSON.stringify(p)).not.toContain(report.cwd.split("/").at(-2));
});
test("a trusted-local record matches only a trusted-local runtime, and only when it says nothing was contained", async () => {
    const fixture = await repository();
    const p = (await executeAgentRole(request(fixture.source))).provenance as any;
    const contained = { kind: "apple-container", image: "registry.example/agent@sha256:" + "a".repeat(64) };
    expect(provenanceMatchesRuntime(p, policy)).toBe(true);
    expect(provenanceMatchesRuntime(p, contained)).toBe(false);
    for (const forged of [{ ...p, limits: p.limits.filter((l: string) => l !== TRUSTED_LOCAL_SENTENCE) }, { ...p, image: contained.image }, { ...p, clonedInside: true }, { ...p, hostMounts: [] }, { ...p, established: "apple-container" }, { ...p, schema_version: "wringer.runtime.v2" }, { ...p, workspace: "host-checkout" }])
        expect(provenanceMatchesRuntime(forged, policy)).toBe(false);
    // A contained record claiming the trusted-local schema is not contained evidence either.
    const containedRecord = { kind: "apple-container", schema_version: "wringer.runtime.v2", image: contained.image, clonedInside: true, hostMounts: [] };
    expect(provenanceMatchesRuntime(containedRecord, contained)).toBe(true);
    expect(provenanceMatchesRuntime({ ...containedRecord, schema_version: "wringer.runtime.v3" }, contained)).toBe(false);
    expect(provenanceMatchesRuntime(containedRecord, policy)).toBe(false);
});
test("only the account's identity and declared names reach the agent; a missing declared name refuses", async () => {
    const fixture = await repository();
    process.env.WRINGER_TL_FIXTURE_KEY = "fixture-value-123";
    process.env.WRINGER_TL_UNDECLARED = "never-forwarded"; process.env.GIT_DIR_FIXTURE = "/nowhere";
    const declared = await executeAgentRole(request(fixture.source, "judge", { runtime: { ...policy, env: ["WRINGER_TL_FIXTURE_KEY"] } as any, agent: { protocol: "acp", command: process.execPath, args: [agentScript, "--read-only"], env: ["WRINGER_TL_FIXTURE_KEY"] } }));
    const env = JSON.parse(declared.text.trim()).env as string[];
    expect(env).toContain("WRINGER_TL_FIXTURE_KEY"); expect(env).toContain("HOME");
    expect(env.some(name => /^(GIT_|NODE_OPTIONS|BUN_OPTIONS|KUBECONFIG|SSH_AUTH_SOCK)/.test(name))).toBe(false);
    expect(env).not.toContain("WRINGER_TL_UNDECLARED"); expect(env).not.toContain("GIT_DIR_FIXTURE");
    expect(declared.change).toBeUndefined();
    expect(declared.provenance.repositoryAccess).toBe("read-only");
    delete process.env.WRINGER_TL_FIXTURE_KEY;
    await expect(executeAgentRole(request(fixture.source, "judge", { runtime: { ...policy, env: ["WRINGER_TL_FIXTURE_KEY"] } as any, agent: { protocol: "acp", command: process.execPath, args: [agentScript, "--read-only"], env: ["WRINGER_TL_FIXTURE_KEY"] } }))).rejects.toThrow("Declared runtime environment WRINGER_TL_FIXTURE_KEY is not available");
});
test("design references need a contained runtime", async () => {
    const fixture = await repository();
    await expect(executeAgentRole(request(fixture.source, "judge", { design: { snapshotPath: "design/snapshot.json", snapshotSha256: "a".repeat(64), referenceIds: ["r"] } }))).rejects.toThrow("Design references need a contained runtime");
});
test("checks run in a fresh clone of the candidate; failures, timeouts and source changes are observed", async () => {
    const fixture = await repository();
    git(fixture.repo, "checkout", "-b", "candidate");
    await writeFile(join(fixture.repo, "src/value.js"), "export const expected = true;\n");
    git(fixture.repo, "commit", "-am", "Candidate");
    const candidate = git(fixture.repo, "rev-parse", "HEAD"), bundlePath = join(fixture.root, "candidate.bundle");
    git(fixture.repo, "bundle", "create", bundlePath, "candidate");
    const source = { url: fixture.source.url, commit: candidate, bundlePath };
    const measured = await runContainedCommands({ repo: source, runtime: policy as any, acceptanceSource: fixture.source, protectedFiles: ["check.sh"], commands: [
        { id: "acceptance/pass", argv: ["sh", "check.sh"], timeoutMs: 5000 },
        { id: "acceptance/fail", argv: ["sh", "-c", "exit 3"], timeoutMs: 5000 },
        { id: "acceptance/slow", argv: ["sh", "-c", "sleep 5"], timeoutMs: 300 },
    ], timeoutMs: 20000 });
    expect(measured.results.map(row => [row.id, row.code])).toEqual([["acceptance/pass", 0], ["acceptance/fail", 3], ["acceptance/slow", 124]]);
    expect(measured.sourceChanged).toBe(false);
    expect(measured.sourceTree).toBe(git(fixture.repo, "rev-parse", "HEAD^{tree}"));
    expect(measured.checkInputsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(measured.provenance).toMatchObject({ schema_version: "wringer.runtime.v3", role: "verifier", boundary: "trusted-local", established: "none", repositoryAccess: "read-only" });
    const dirty = await runContainedCommands({ repo: source, runtime: policy as any, commands: [{ id: "acceptance/edits", argv: ["sh", "-c", "echo changed >> src/value.js"], timeoutMs: 5000 }], timeoutMs: 20000 });
    expect(dirty.sourceChanged).toBe(true);
    expect(await readFile(join(fixture.repo, "src/value.js"), "utf8")).toBe("export const expected = true;\n");
});
test("a candidate that changed a pinned check input is refused before any check runs", async () => {
    const fixture = await repository();
    git(fixture.repo, "checkout", "-b", "cheat");
    await writeFile(join(fixture.repo, "check.sh"), "exit 0\n");
    git(fixture.repo, "commit", "-am", "Weaken the check");
    const cheat = git(fixture.repo, "rev-parse", "HEAD"), bundlePath = join(fixture.root, "cheat.bundle");
    git(fixture.repo, "bundle", "create", bundlePath, "cheat");
    await expect(runContainedCommands({ repo: { url: fixture.source.url, commit: cheat, bundlePath }, runtime: policy as any, acceptanceSource: fixture.source, protectedFiles: ["check.sh"], commands: [{ id: "acceptance/pass", argv: ["sh", "check.sh"], timeoutMs: 5000 }], timeoutMs: 20000 })).rejects.toThrow("Candidate changed the pinned acceptance inputs");
});
