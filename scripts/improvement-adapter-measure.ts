/** Phase A measurement: what each pinned ACP adapter actually puts in the session
 * updates Wringer retains. One small live worker session per adapter, on the
 * trusted-local runtime, against a throwaway repository with one failing check.
 * Records an inventory of update kinds and fields with byte counts, never the
 * content itself: a trajectory view may only promise what an adapter sends.
 *   bun scripts/improvement-adapter-measure.ts claude-agent-acp|codex-acp OUTPUT.json
 * This spends one live session on the operator's own coding-agent plan. */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAgentRole } from "../packages/runtime/src";

const PINNED: Record<string, string> = { "claude-agent-acp": "@agentclientprotocol/claude-agent-acp@0.65.0", "codex-acp": "@agentclientprotocol/codex-acp@1.10.0" };
const [adapter, output] = process.argv.slice(2);
if (!adapter || !PINNED[adapter] || !output) throw new Error("Usage: bun scripts/improvement-adapter-measure.ts claude-agent-acp|codex-acp OUTPUT.json");
const git = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Measurement fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Measurement fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (run.exitCode) throw new Error(run.stderr.toString());
    return run.stdout.toString().trim();
};
const root = await mkdtemp(join(tmpdir(), "wringer-adapter-measure-")), repo = join(root, "repo");
try {
    await mkdir(join(repo, "src"), { recursive: true }); git(root, "init", "--initial-branch=main", repo);
    await writeFile(join(repo, "README.md"), "A measurement fixture. `sh check.sh` must exit 0.\n");
    await writeFile(join(repo, "src/value.js"), "export const expected = false;\n");
    await writeFile(join(repo, "check.sh"), "grep -q 'expected = true' src/value.js || { echo 'value is still false' >&2; exit 1; }\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "Measurement fixture");
    const commit = git(repo, "rev-parse", "HEAD"), bundlePath = join(root, "source.bundle"); git(repo, "bundle", "create", bundlePath, "HEAD", "main");
    const started = Date.now();
    const result = await executeAgentRole({ role: "worker", repo: { url: "https://example.invalid/measurement.git", commit, bundlePath }, runtime: { kind: "trusted-local", network: { policy: "unenforced" }, env: [] } as any,
        agent: { protocol: "acp", command: "npx", args: ["-y", PINNED[adapter]!], env: [] }, scope: { writable: ["src"], protected: ["check.sh"] },
        prompt: "Read README.md, run `sh check.sh` and look at its output, then edit src/value.js so the check passes, and run the check again. Reply in one sentence.",
        budget: { maxTurns: 1, timeoutMs: 300000 } });
    const updates = result.events.filter(e => e.type === "acp.update").map(e => (e as any).update as Record<string, any>);
    const inventory: Record<string, { count: number; fields: Record<string, { present: number; bytes: number }>; contentItemTypes: Record<string, number> }> = {};
    for (const update of updates) {
        const kind = String(update.sessionUpdate), row = inventory[kind] ??= { count: 0, fields: {}, contentItemTypes: {} };
        row.count++;
        for (const [field, value] of Object.entries(update)) {
            if (field === "sessionUpdate") continue;
            const cell = row.fields[field] ??= { present: 0, bytes: 0 };
            cell.present++; cell.bytes += Buffer.byteLength(JSON.stringify(value) ?? "");
            if (field === "_meta" && value && typeof value === "object") for (const [meta, inner] of Object.entries(value as Record<string, unknown>)) {
                const sub = row.fields[`_meta.${meta}`] ??= { present: 0, bytes: 0 }; sub.present++; sub.bytes += Buffer.byteLength(JSON.stringify(inner) ?? "");
            }
        }
        if (Array.isArray(update.content)) for (const item of update.content) { const type = `${item?.type ?? "?"}${item?.content?.type ? `/${item.content.type}` : ""}`; row.contentItemTypes[type] = (row.contentItemTypes[type] ?? 0) + 1; }
    }
    const toolUpdates = updates.filter(u => u.sessionUpdate === "tool_call_update");
    const record = { schema_version: "wringer.adapter-update-inventory.v1", adapter, package: PINNED[adapter], agentInfo: result.agentInfo, measuredAt: new Date().toISOString(), status: result.status, stopReason: result.stopReason, wallClockMs: Date.now() - started,
        changedPatch: !!result.change?.patch, eventCount: result.events.length, updateCount: updates.length, retainedEventBytes: Buffer.byteLength(JSON.stringify(result.events)), inventory,
        toolOutput: { toolCallUpdates: toolUpdates.length, withContent: toolUpdates.filter(u => Array.isArray(u.content) && u.content.length).length, withRawOutput: toolUpdates.filter(u => u.rawOutput !== undefined).length, withTerminalOutputMeta: toolUpdates.filter(u => u._meta?.terminal_output !== undefined).length },
        limits: ["Field names, counts and byte sizes only; no update content is kept in this record.", "One live session on a throwaway repository; adapter behaviour on other tasks, versions or settings is not measured."] };
    await writeFile(output, JSON.stringify(record, null, 2) + "\n");
    console.log(JSON.stringify({ adapter, status: result.status, stopReason: result.stopReason, updates: updates.length, kinds: Object.fromEntries(Object.entries(inventory).map(([k, v]) => [k, v.count])), toolOutput: record.toolOutput }, null, 1));
} finally { await rm(root, { recursive: true, force: true }); }
