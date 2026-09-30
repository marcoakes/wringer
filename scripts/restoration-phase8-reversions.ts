/** Phase 8: every external-task guard is removed alone in an isolated copy, watched
 * red, restored and watched green. Effects are classified; layered guards are listed
 * with the guard that masks them rather than claimed as caught. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const compilerTest = "packages/plan/test/contained-graph-v4.test.ts", kernelTest = "packages/scheduler/test/contained-delegate.test.ts", adapterTest = "packages/application/test/graph-delegate.test.ts";
const compiler = "packages/plan/src/graph.ts", kernel = "packages/scheduler/src/contained.ts", task = "packages/application/src/external-task.ts", adapter = "packages/application/src/graph.ts", reader = "examples/evidence/read-bundle.mjs";
const cases: Reversion[] = [];
const probe = (name: string, file: string, before: string, after: string, test: string, pattern: string) => cases.push({ name, file, before, after, test, pattern });

// Compiler: version, pinned peer, verification plan, bounded time, check before use.
probe("compiler-delegate-needs-version-4", compiler, "if (DELEGATE_KINDS.includes(kind) && version !== 4) fail(", "if (false) fail(", compilerTest, "version 3 graph");
probe("compiler-peer-https-or-loopback", compiler, "if (!(parsed!.protocol === 'https:' || loopback) || parsed!.username", "if (parsed!.username", compilerTest, "plain HTTP peer");
probe("compiler-peer-no-credentials", compiler, "|| loopback) || parsed!.username || parsed!.password || parsed!.search || parsed!.hash) fail(", "|| loopback)) fail(", compilerTest, "carrying credentials");
probe("compiler-peer-card-pinned", compiler, "if (typeof row.cardSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.cardSha256)) fail(", "if (typeof row.cardSha256 !== 'string') fail(", compilerTest, "without a pinned card");
probe("compiler-verify-plan-same-source", compiler, "fail('A delegate needs a measured v3/v4 verification plan');\n    if (hashValue(plan.repository) !== hashValue(repository)) fail(", "fail('A delegate needs a measured v3/v4 verification plan');\n    if (false) fail(", compilerTest, "verification plan on another source");
probe("compiler-delegate-timeout-bound", compiler, "if (seconds > 86400) fail(", "if (false) fail(", compilerTest, "unbounded timeout");
probe("compiler-check-before-use", compiler, "if (!verified) fail(`Node ${name} reads delegate", "if (false) fail(`Node ${name} reads delegate", compilerTest, "before a check");
probe("compiler-no-delegate-in-branch", compiler, "if (inner.kind === 'delegate') fail(", "if (false) fail(", compilerTest, "delegate inside a branch");
probe("compiler-delegate-reservation", compiler, "    if (node.kind === 'delegate') return { roleSessions: 1, verificationAttempts: 0 };\n", "", compilerTest, "allowance for the external task");
probe("compiler-delegate-owns-candidate", compiler, "if (node.kind === 'loop' || node.kind === 'delegate' || closesFork(node)) return cursor;", "if (node.kind === 'loop' || closesFork(node)) return cursor;", compilerTest, "owns the returned candidate");

// Kernel: ownership, no candidate unless returned, event version.
probe("kernel-delegate-owns-candidate", kernel, "if (result.outcome === 'returned' && (!result.candidate || result.candidate.owner !== id)) fail(", "if (result.outcome === 'returned' && !result.candidate) fail(", kernelTest, "must own");
probe("kernel-no-candidate-unless-returned", kernel, "if (result.outcome !== 'returned' && result.candidate) fail(`Delegate", "if (false) fail(`Delegate", kernelTest, "carries no candidate");
probe("kernel-version-4-events", kernel, "plan.schema_version === 'wringer.contained-graph-plan.v4' ? 'wringer.contained-graph-event.v4' : ", "", kernelTest, "only its check first");

// External task: identity before and after, artifact contract, cancellation, reconciliation.
probe("task-preflight-card-pinned", task, "if (sha256 !== node.peer.cardSha256) fail(`The peer's Agent Card changed:", "if (false) fail(`The peer's Agent Card changed:", adapterTest, "unreachable peer or a changed");
probe("task-preflight-peer-reachable", task, "catch (error) { fail(`The peer at ${node.peer.url} is unavailable", "catch (error) { return; fail(`The peer at ${node.peer.url} is unavailable", adapterTest, "unreachable peer or a changed");
probe("task-card-rechecked-at-completion", task, "        if (sha256 !== node.peer.cardSha256) fail(\"The peer's Agent Card changed during the task\");\n", "", adapterTest, "changes during the task");
probe("task-exactly-one-artifact", task, "if (!Array.isArray(artifacts) || artifacts.length !== 1) fail(", "if (!Array.isArray(artifacts)) fail(", adapterTest, "malformed artifacts");
probe("task-patch-media-type", task, "if (mediaType !== PATCH_MEDIA_TYPE || typeof part.text !== \"string\") fail(", "if (typeof part.text !== \"string\") fail(", adapterTest, "malformed artifacts");
probe("task-artifact-is-a-patch", task, "if (!patch.trim() || Buffer.byteLength(patch) > 1024 * 1024 || !/^diff --git /m.test(patch)) fail(", "if (!patch.trim()) fail(", adapterTest, "malformed artifacts");
probe("task-patch-within-scope", task, "if (outside.length) fail(", "if (false) fail(", adapterTest, "malformed artifacts");
probe("task-cancel-at-deadline", task, "\"CancelTask\", { id: taskId }", "\"GetTask\", { id: taskId }", adapterTest, "past its deadline");
probe("task-message-is-not-a-task", task, "if (!reply?.task) return finish(", "if (false) return finish(", adapterTest, "failed, rejected");
probe("task-reconciles-by-reading", task, "try { current = task(await a2aCall(node.peer.url, \"GetTask\", { id: sent.taskId }, 10000)); } catch { return null; }", "return null;", adapterTest, "interrupted delegation");

// Adapter and reader: the check uses the delegate's plan; delivery and export evidence.
probe("adapter-check-uses-delegate-plan", adapter, "const from = request.plan.nodes[candidate.owner]?.kind === \"delegate\" ? await delegateOwner(request.directory, candidate, request.plan) : await loopOwner(request.directory, candidate);", "const from = await loopOwner(request.directory, candidate);", adapterTest, "returned patch is a candidate");
probe("adapter-delegate-owner", adapter, "    if (plan?.nodes[candidate.owner]?.kind === \"delegate\") return delegateOwner(directory, candidate, plan);\n", "", adapterTest, "returned patch is a candidate");
probe("reader-binds-delegation-evidence", reader, "insist(carried && hashJson(carried) === result.data.evidenceSha256, `Delegate", "insist(carried, `Delegate", adapterTest, "returned patch is a candidate");
probe("reader-envelope-only-for-loops", reader, "if (prepared && plan.nodes[prepared.data.candidate.owner]?.kind === \"loop\") {", "if (prepared && plan.nodes[prepared.data.candidate.owner]?.kind !== \"join\") {", adapterTest, "returned patch is a candidate");

export const layered = [
    { guard: "the request is durable before it is sent", maskedBy: "structural order; the reconciliation test shows a retained task id is read, never re-sent" },
    { guard: "every non-completed terminal state maps to failed", maskedBy: "removing one mapping leaves the task non-terminal until its deadline; the cancellation test covers that path, too slowly to probe each state" },
    { guard: "the reader checks the delegation names its plan's peer", maskedBy: "the record's digest binding refuses the same edits first" },
    { guard: "a redirect or an over-large response is refused", maskedBy: "unmeasured: the reference peer never redirects or over-answers" },
];
const selected = (() => { const at = process.argv.indexOf("--only"); return at === -1 ? cases : cases.filter(row => row.name.startsWith(process.argv[at + 1]!)); })();
const evidenceAt = process.argv.indexOf("--evidence"), evidenceDirectory = evidenceAt === -1 ? "docs/restoration/evidence/phase-8" : process.argv[evidenceAt + 1]!;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-8 isolated reversion targets`);
else {
    try { await runReversions("restoration-phase8", [compilerTest, kernelTest, adapterTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory, restoreEach: true }); }
    finally {
        const effects = [];
        for (const row of selected) {
            const log = await Bun.file(`${evidenceDirectory}/revert-${row.name}.log`).text().catch(() => "");
            const effect = !log ? "not-run" : /Received promise that resolved|did not throw/.test(log) ? "refusal-vanished"
                : /Received message: "expect\(received\)/.test(log) ? "recorded-state-changed"
                : /Received message:/.test(log) ? /undefined is not|is not a function|is not iterable|Cannot read/.test(log) ? "named-refusal-became-crash" : "different-guard-refused"
                : /\(fail\)/.test(log) ? "recorded-state-changed" : "not-red";
            effects.push({ name: row.name, effect });
        }
        await Bun.write(`${evidenceDirectory}/effects.json`, JSON.stringify({ layered, effects }, null, 2) + "\n");
        const counts: Record<string, number> = {};
        for (const row of effects) counts[row.effect] = (counts[row.effect] ?? 0) + 1;
        console.log(JSON.stringify(counts));
    }
}
