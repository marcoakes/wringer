/** Compiled assistant connection/lifecycle proof. Inert proposals only: no real
 * coding client, model, container, human approval or delivery claim. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileExecutionPlan, hashValue } from "../packages/plan/src/index";
import { runProcess } from "../packages/engine/src/index";

const repo = resolve(import.meta.dir, ".."), directory = join(repo, ".wringer", `assistant-smoke-${crypto.randomUUID()}`), root = join(directory, "controller");
await mkdir(directory, { recursive: true, mode: 0o700 });
const binary = join(repo, "dist/wringer-assistant"), transcript: unknown[] = [], began = Date.now();
let ownerStarted = false, failed = false;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function cli(args: string[], retain = true, expected = 0) {
    const result = await runProcess([binary, ...args, "--json"], { cwd: repo, timeout: 30, maxBytes: 256 * 1024 });
    if (retain) transcript.push({ command: ["wringer-assistant", ...args.map(v => v.replaceAll(directory, "FIXTURE"))], exit: result.exit_code, output: result.stdout.replaceAll(directory, "FIXTURE"), error: result.stderr.replaceAll(directory, "FIXTURE") });
    assert(result.exit_code === expected, `Compiled command ${args[0]} failed (exit ${result.exit_code})`);
    return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}
async function chat(messages: object[]) {
    const input = messages.map(m => JSON.stringify(m)).join("\n") + "\n";
    const child = Bun.spawn([binary, "mcp", "--connection", join(root, "connection.json")], { cwd: repo, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
        child.stdin.write(input); child.stdin.end();
        const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        assert(exit === 0 && stderr === "", "Compiled MCP process did not close cleanly using protocol-only stdout");
        const responses = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
        transcript.push({ surface: "compiled MCP stdio", requests: messages, responses });
        return responses;
    } finally { clearTimeout(timer); }
}
const initialize = () => [
    { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "Wringer compiled fixture (not Codex)", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
];
const tool = (id: string, name: string, args: object) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const value = (responses: any[], id: string) => responses.find(r => r.id === id)?.result?.structuredContent;
try {
    const planPath = join(repo, "packages/plan/examples/contained.yaml"), plan = compileExecutionPlan(await readFile(planPath, "utf8"), { format: "yaml" });
    await cli(["init", "--root", root, "--plan", planPath], true, 3);
    const initialized = await cli(["init", "--root", root, "--plan", planPath, "--cooperative-local"]);
    assert(initialized.created === true, "New fixture workspace was not registered");
    const repeated = await cli(["init", "--root", root, "--plan", planPath, "--cooperative-local"]);
    assert(repeated.created === false && repeated.workspaceId === initialized.workspaceId, "Setup was not idempotent");
    const ready = await cli(["start", "--root", root, "--cooperative-local"]); ownerStarted = true;
    assert(ready.outcome === "ready", "Independent compiled daemon did not become ready");
    const connectionBefore = JSON.parse(await readFile(join(root, "connection.json"), "utf8"));
    const discovery = await chat([...initialize(), tool("setup", "wringer.inspect_setup", {})]);
    const inspected = value(discovery, "setup");
    assert(inspected.workspaceId === initialized.workspaceId && inspected.availability.workerAuthentication === "not-probed", "Setup invented credentials or lost workspace identity");
    const responses = await chat([...initialize(), tool("proposal", "wringer.propose", { workspaceId: initialized.workspaceId, idempotencyKey: crypto.randomUUID(), intent: plan.intent, plan: inspected.template, assumptions: ["Compile-only fixture: no provisioned runtime or real customer job"], questions: [] })]);
    const proposed = value(responses, "proposal");
    assert(proposed.outcome === "awaiting-approval" && proposed.usage.development.cost === null, "Inert proposal was not held for approval with unknown cost");
    const denied = await chat([...initialize(), tool("start", "wringer.start", { jobId: proposed.jobId, idempotencyKey: crypto.randomUUID(), expectedRevision: proposed.revision, expectedCandidateTree: null }), tool("judge", "wringer.record_human_verdict", { jobId: proposed.jobId }), tool("status", "wringer.get_status", { jobId: proposed.jobId })]);
    assert(value(denied, "start").code === "not-approved", "Unapproved start was not refused");
    assert(denied.find(r => r.id === "judge")?.error || denied.find(r => r.id === "judge")?.result?.isError, "Forbidden human verdict was exposed");
    assert(value(denied, "status").operations.length === 0, "Refused calls reserved work");
    const operator = await cli(["status", "--root", root, "--operator"], false);
    const wrongCapability = await fetch(new URL(operator.operatorUrl).origin + "/api/jobs", { headers: { Authorization: `Bearer ${connectionBefore.token}` } });
    assert(wrongCapability.status === 401, "Assistant capability entered the operator channel");
    transcript.push({ check: "assistant capability denied by operator console", status: wrongCapability.status });
    const status = await cli(["status", "--root", root]);
    assert(status.outcome === "live" && status.jobs.length === 1 && !Object.hasOwn(status, "operatorUrl"), "Client closure killed the owner, lost the job or leaked the operator URL");
    const secondStart = await cli(["start", "--root", root, "--cooperative-local"]);
    assert(secondStart.alreadyRunning === true, "Repeated startup did not reattach to existing owner");
    await cli(["connect", "--root", root, "--client", "codex"]);
    await cli(["stop", "--root", root]); ownerStarted = false;
    const stopped = await cli(["status", "--root", root]);
    assert(stopped.outcome === "absent", "Shutdown left an owner in the inert fixture");
    await cli(["start", "--root", root, "--cooperative-local"]); ownerStarted = true;
    const connectionAfter = JSON.parse(await readFile(join(root, "connection.json"), "utf8"));
    assert(connectionAfter.token === connectionBefore.token, "Explicit restart silently minted a new capability");
    const reconnected = await chat([...initialize(), tool("status", "wringer.get_status", { jobId: proposed.jobId })]);
    assert(value(reconnected, "status").revision === proposed.revision && hashValue(value(reconnected, "status").usage) === hashValue(proposed.usage), "Restart changed authority, facts or unknown usage");
    await cli(["revoke", "--root", root]); ownerStarted = false;
    const result = { status: "passed", fixture: "compiled-assistant-connection-lifecycle", workspaceId: initialized.workspaceId, jobId: proposed.jobId, paidCalls: 0, approvedJobs: 0, realClientMeasured: false, realContainmentMeasured: false, humanJudgement: "none", checks: ["protected-default-refusal", "idempotent-init", "compiled-independent-owner", "stdio-connect-disconnect", "unapproved-start-refusal", "no-human-pen-tool", "operator-capability-denial", "duplicate-owner-reattach", "connection-recipe-read-only", "explicit-stop-restart", "revision-and-usage-preserved", "revoke"], wallMs: Date.now() - began };
    await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify({ directory, ...result }, null, 2));
} catch (error) {
    failed = true; transcript.push({ stop: error instanceof Error ? error.message : "Unknown fixture failure" }); throw error;
} finally {
    if (ownerStarted) { try { await cli(["stop", "--root", root]); } catch { transcript.push({ cleanup: "Owner shutdown not confirmed; retained state requires inspection" }); } }
    await writeFile(join(directory, "transcript.json"), JSON.stringify({ fixture: true, failed, transcript }, null, 2) + "\n");
}
