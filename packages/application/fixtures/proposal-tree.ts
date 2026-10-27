/** TEST SUPPORT ONLY: a scripted proposer. It clones its evidence overlay, finds a real
 * [ACTION] line in a trajectory, writes a small cited claude-code tree under its proposal
 * directory and returns the staged change, as a worker runtime would. No model. */
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { hashBytes } from "@wringer/plan";
import { digest, processDriver, runtimeProvenanceVersion, type RoleExecutionRequest, type RoleExecutionResult } from "@wringer/runtime";

const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
async function git(cwd: string, ...args: string[]) { const r = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env }); if (r.code !== 0) throw new Error(r.stderr); return r.stdout; }
export function scriptedTreeProposer(label = "replicate-02") {
    return async (request: RoleExecutionRequest): Promise<RoleExecutionResult> => {
        const clone = await mkdtemp(join(tmpdir(), "wringer-scripted-proposer-")), directory = /Write only under (wringer\/proposals\/[a-z0-9-]+)\//.exec(request.prompt)?.[1];
        if (!directory) throw new Error("The proposer prompt names no output directory");
        await git(tmpdir(), "clone", "-q", "--no-checkout", request.repo.bundlePath!, clone); await git(clone, "checkout", "-q", "--detach", request.repo.commit);
        const lines = (await readFile(join(clone, `wringer/evidence/REPLICATES/${label}/trajectory.md`), "utf8")).split("\n"), line = lines.findIndex(text => text.includes("[ACTION]")) + 1;
        const files: Record<string, string> = { "CLAUDE.md": "# Worker\nRun scripts/wringer/run-check.sh before editing.\n", "scripts/run-check.sh": "#!/bin/sh\nset -eu\nbun test tests/acceptance.test.ts\n", "NOTES.md": `- CLAUDE.md: ${label} line ${line} — the attempt read the source before running the check.\n- scripts/run-check.sh: ${label} line ${line} — the check's expectation was never run first.\n` };
        const manifest = { schema_version: "wringer.playbook.v2", id: directory.split("/").at(-1), revision: "one", title: "Run the check before editing", role: "worker", taskFamily: "total", surface: "claude-code", files: Object.keys(files).sort().map(path => ({ path, sha256: hashBytes(files[path]!), kind: path === "CLAUDE.md" ? "always-on" : path === "NOTES.md" ? "notes" : "script" })), limits: ["Scripted fixture proposal; untested."], evaluationRefs: [] };
        for (const [path, content] of [...Object.entries(files), ["manifest.json", JSON.stringify(manifest)]] as [string, string][]) { await mkdir(dirname(join(clone, directory, path)), { recursive: true }); await writeFile(join(clone, directory, path), content); }
        await git(clone, "add", "-A");
        const patch = (await processDriver.command(["git", "-C", clone, "diff", "--cached", "--binary", "--full-index", request.repo.commit, "--"], { env })).stdout;
        return { status: "completed", text: "Proposed.", sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "scripted-proposer" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", change: { baseCommit: request.repo.commit, patch, sha256: digest(patch) }, provenance: { schema_version: runtimeProvenanceVersion(request.repo.url), runtimeId: crypto.randomUUID(), role: "worker", kind: request.runtime.kind, image: request.runtime.image, repository: { url: request.repo.url, commit: request.repo.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-write", declared: request.runtime, observed: { fixture: true }, limits: ["Scripted fixture; no runtime or provider"] } } as unknown as RoleExecutionResult;
    };
}
