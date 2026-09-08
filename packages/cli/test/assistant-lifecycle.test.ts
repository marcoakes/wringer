import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assistantCommand } from "../src/assistant-cli";
import { readAssistantConnection, callAssistantConnection } from "../src/assistant-transport";
import { createAssistantService } from "@wringer/application";

const roots: string[] = [], owners = new Set<number>();
const entry = new URL("../src/assistant-cli.ts", import.meta.url).pathname, example = new URL("../../plan/examples/contained.yaml", import.meta.url).pathname;
afterEach(async () => {
    for (const root of roots) { try { await assistantCommand(["stop", "--root", root]); } catch {} }
    for (const pid of owners) { try { process.kill(pid, "SIGTERM"); } catch {} }
    owners.clear();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function cli(root: string, ...args: string[]) {
    const child = Bun.spawn([process.execPath, entry, ...args, "--root", root, "--json"], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, CODEX_HOME: join(root, "isolated-codex-config") } });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (code !== 0) throw new Error(`Assistant fixture command failed (${code}): ${stderr}`);
    return JSON.parse(stdout);
}
async function protocol(connectionPath: string, request: { name: string; arguments: Record<string, unknown> }) {
    const child = Bun.spawn([process.execPath, entry, "mcp", "--connection", connectionPath], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    for (const message of [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "process-fixture", version: "1" } } }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: request }]) child.stdin.write(JSON.stringify(message) + "\n");
    child.stdin.end();
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(0); expect(stderr).toBe("");
    const responses = stdout.trim().split("\n").map(line => JSON.parse(line)); expect(responses).toHaveLength(2);
    return responses[1].result;
}

describe("assistant HTTP and independent process lifecycle (no models)", () => {
    test("chat closure, duplicate daemon start, restart, revocation and reconnect retain one inert job", async () => {
        const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-lifecycle-"))); roots.push(root);
        const initialized = await cli(root, "init", "--plan", example, "--cooperative-local");
        const started = await cli(root, "start", "--cooperative-local"); expect(started.outcome).toBe("ready");
        const service = await createAssistantService(root), owner = (await service.runner.status()).owner!; owners.add(owner.pid);
        const path = started.connectionPath, firstConnection = await readAssistantConnection(path);
        expect(Object.keys(firstConnection).sort()).toEqual(["endpoint", "schema_version", "token"]);
        expect(JSON.stringify(started)).not.toContain("#token="); expect(JSON.stringify(started)).not.toContain(firstConnection.token);
        const duplicate = await cli(root, "start", "--cooperative-local"); expect(duplicate.alreadyRunning).toBeTrue(); expect((await service.runner.status()).owner?.pid).toBe(owner.pid);
        const proposed = await protocol(path, { name: "wringer.propose", arguments: { workspaceId: initialized.workspaceId, idempotencyKey: crypto.randomUUID(), intent: "Preserve this person's exact request — including uncertainty.", questions: ["Which outcome should be demonstrated?"] } });
        expect(proposed.isError).toBeFalse(); const jobId = proposed.structuredContent.jobId; expect(proposed.structuredContent.outcome).toBe("needs-decision");
        expect((await service.runner.status()).ownerState).toBe("live");
        const reconnect = await protocol(path, { name: "wringer.get_status", arguments: {} }); expect(reconnect.structuredContent.jobs.map((job: any) => job.jobId)).toEqual([jobId]);
        const view = await service.status(jobId), refused = await protocol(path, { name: "wringer.start", arguments: { jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: view.revision, expectedCandidateTree: null } });
        expect(refused.isError).toBeTrue(); expect(await service.runner.list()).toEqual([]);
        const privateStatus = await cli(root, "status", "--operator"); expect(privateStatus.operatorUrl).toContain("#token=");
        const publicStatus = await cli(root, "status"); expect(JSON.stringify(publicStatus)).not.toContain("#token="); expect(JSON.stringify(publicStatus)).not.toContain(firstConnection.token);
        expect((await cli(root, "stop")).outcome).toBe("stopped"); owners.delete(owner.pid);
        await expect(callAssistantConnection(path, "wringer.get_status", {})).rejects.toThrow(); expect((await service.runner.status()).ownerState).toBe("absent");
        await cli(root, "start", "--cooperative-local"); const nextOwner = (await service.runner.status()).owner!; owners.add(nextOwner.pid); expect(nextOwner.token).not.toBe(owner.token);
        expect((await readAssistantConnection(path)).token).toBe(firstConnection.token);
        expect((await protocol(path, { name: "wringer.get_status", arguments: {} })).structuredContent.jobs[0].jobId).toBe(jobId);
        const proposalBefore = await readFile(join(root, "jobs", jobId, "proposal.json"), "utf8");
        expect((await cli(root, "revoke")).revoked).toBeTrue(); owners.delete(nextOwner.pid);
        await cli(root, "start", "--cooperative-local"); const lastOwner = (await service.runner.status()).owner!; owners.add(lastOwner.pid);
        expect((await protocol(path, { name: "wringer.get_status", arguments: {} })).isError).toBeTrue();
        const renewed = await cli(root, "connect", "--client", "codex", "--renew"); expect(renewed.client).toBe("codex");
        expect((await readAssistantConnection(path)).token).not.toBe(firstConnection.token);
        expect((await protocol(path, { name: "wringer.get_status", arguments: {} })).structuredContent.jobs[0].jobId).toBe(jobId);
        expect(await readFile(join(root, "jobs", jobId, "proposal.json"), "utf8")).toBe(proposalBefore); expect(await service.runner.list()).toEqual([]);
    }, 30000);
});
