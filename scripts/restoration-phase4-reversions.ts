/** Phase 4: every fork/join guard is removed alone in an isolated copy, watched
 * red, restored and watched green. Effects are classified; layered guards are
 * listed with the guard that masks them rather than claimed as caught. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const compilerTest = "packages/plan/test/contained-graph-v2.test.ts", kernelTest = "packages/scheduler/test/contained-parallel.test.ts", adapterTest = "packages/application/test/graph-parallel.test.ts";
const compiler = "packages/plan/src/graph.ts", kernel = "packages/scheduler/src/contained.ts", adapter = "packages/application/src/graph.ts", reader = "examples/evidence/read-bundle.mjs";
const cases: Reversion[] = [];
const probe = (name: string, file: string, before: string, after: string, test: string, pattern: string) => cases.push({ name, file, before, after, test, pattern });

// Compiler: declaration, fork/join pairing, private branches, wait-all dominance, allowance.
probe("compiler-parallelism-bound", compiler, "if (parallelism !== undefined && parallelism > 8) fail(", "if (false) fail(", compilerTest, "unbounded parallelism");
probe("compiler-fork-branch-count", compiler, "row.branches.length < 2 || row.branches.length > 8", "row.branches.length > 8", compilerTest, "a fork with one branch");
probe("compiler-branch-reads-its-fork", compiler, "for (const branch of node.branches) if (!nodes[branch] || graphInput(nodes[branch]!) !== name) fail(", "for (const branch of node.branches) if (!nodes[branch]) fail(", compilerTest, "a branch entry not fed by its fork");
probe("compiler-branch-joins-before-done", compiler, "if (next === 'done') fail(`Branch", "if (false) fail(`Branch", compilerTest, "a branch that finishes the graph");
probe("compiler-no-nested-fork", compiler, "if (inner.kind === 'fork') fail(", "if (false) fail(", compilerTest, "a nested fork");
probe("compiler-no-delivery-in-branch", compiler, "if (inner.kind === 'delivery') fail(", "if (false) fail(", compilerTest, "a delivery inside a branch");
probe("compiler-branches-disjoint", compiler, "if (branchOf.has(next)) fail(`Branches must not share", "if (false) fail(`Branches must not share", compilerTest, "branches sharing a node");
probe("compiler-branch-closed", compiler, "if (!(branchOf.get(parent)?.entry === where.entry || parent === where.fork && name === where.entry)) fail(", "if (false) fail(", compilerTest, "a branch reached from outside");
probe("compiler-branch-reads-inside", compiler, "if (!(read === where.fork || branchOf.get(read)?.entry === where.entry)) fail(", "if (false) fail(", compilerTest, "a branch node reading before its fork");
probe("compiler-only-join-reads-branches", compiler, "if (read && branchOf.has(read)) fail(", "if (false) fail(", compilerTest, "a later node reading a branch");
probe("compiler-branch-own-candidate", compiler, "if (!owner || branchOf.get(owner)?.entry !== where.entry) fail(", "if (false) fail(", compilerTest, "a branch without its own candidate");
probe("compiler-router-arrival-reads-input", compiler, "const arriving = nodes[parent]?.kind === 'router' ? (nodes[parent] as Extract<ContainedGraphNode, { kind: 'router' }>).input : parent;", "const arriving = parent;", compilerTest, "reach its join through a router");
probe("compiler-join-wait-all-dominance", compiler, "for (const parent of paths.length ? [...paths[0]!].filter(candidate => paths.every(path => path.has(candidate))) : []) available.add(parent);", "", compilerTest, "private branch regions");
probe("compiler-no-router-over-fork", compiler, "if (node.kind === 'router' && nodes[read]?.kind === 'fork') fail(", "if (false) fail(", compilerTest, "a router over a fork");
probe("compiler-no-check-after-join", compiler, "if (node.kind === 'check' && nodes[graphCandidateOwner({ nodes }, read)!]?.kind === 'join') fail(", "if (false) fail(", compilerTest, "a check repeating its join");
probe("compiler-join-reserves-branch-checks", compiler, "return { roleSessions: 0, verificationAttempts: fork?.kind === 'fork' ? fork.branches.length : 0 }; }", "return { roleSessions: 0, verificationAttempts: 0 }; }", compilerTest, "private branch regions|too little allowance");

// Kernel: cursors, ceiling, preflight, reconciliation, arrivals, cancellation, join outcomes.
probe("kernel-fork-opens-branches", kernel, "} else if (node.kind === 'fork') progress.active.push(...(expected.branches ?? []));", "}", kernelTest, "branches run concurrently");
probe("kernel-join-waits-for-every-branch", kernel, "if (arrivals.length === fork.branches.length) progress.active.push(expected.to);", "progress.active.push(expected.to);", kernelTest, "cannot finish leaves the join");
probe("kernel-parallelism-ceiling", kernel, "effects.filter(id => !history.progress.nodes[id]!.dispatched).slice(0, parallelism)", "effects.filter(id => !history.progress.nodes[id]!.dispatched)", kernelTest, "ceiling of one");
probe("kernel-every-preflight-before-any-marker", kernel, "                for (const id of ready) await driver.preflight?.(request(id), 'dispatch');\n                for (const id of ready) await append(history, 'dispatch', id, {}, options, at);", "                for (const id of ready) { await driver.preflight?.(request(id), 'dispatch'); await append(history, 'dispatch', id, {}, options, at); }", kernelTest, "refused branch preflight");
probe("kernel-record-others-before-throwing", kernel, "            let observed = false;\n", "            if (failure) throw failure;\n            let observed = false;\n", kernelTest, "lost branch completion");
probe("kernel-failure-cancels-open-branches", kernel, "progress.cancelled = [...progress.active]; progress.active = [];", "progress.active = [];", kernelTest, "open nodes as cancelled");
probe("kernel-join-owns-integration", kernel, "if (result.candidate && result.candidate.owner !== id) fail(`Candidate owner must be the integrating join", "if (false) fail(`Candidate owner must be the integrating join", kernelTest, "candidate from outside the join");
probe("kernel-conflict-has-no-candidate", kernel, "if (result.outcome === 'conflict' && result.candidate) fail(", "if (false) fail(", kernelTest, "conflict outcome that names a candidate");
probe("kernel-parallel-event-version", kernel, "plan.schema_version === 'wringer.contained-graph-plan.v2' ? 'wringer.contained-graph-event.v2' : 'wringer.contained-graph-event.v1'", "'wringer.contained-graph-event.v1'", kernelTest, "version 2 event record");

// Adapter: deterministic integration, conflict, fresh verification against every branch plan.
probe("adapter-conflict-is-an-outcome", adapter, "if (code !== \"0\") { conflicts = [...new Set(paths)].sort(); break; }", "if (false) { conflicts = [...new Set(paths)].sort(); break; }", adapterTest, "overlapping edits");
probe("adapter-join-verifies-afresh", adapter, "if (record.status === \"merged\") for (const row of await joinVerifications(request, directory, record)) await row.services.verifyCandidate(row.verification);", "", adapterTest, "shared rule");
probe("adapter-join-reports-failed-checks", adapter, "verifications.some(row => row.status === \"failed\") ? \"failed\" :", "", adapterTest, "shared rule");
probe("adapter-join-verifies-every-branch-plan", adapter, "        return Promise.all(record.branches.map(async (row, index) => {", "        return Promise.all(record.branches.slice(0, 1).map(async (row, index) => {", adapterTest, "shared rule");

// Reader: join evidence and join-owned delivery.
probe("reader-join-evidence", reader, "insist(carried && hashJson(carried) === result.data.evidenceSha256, `Join", "insist(carried, `Join", adapterTest, "publish the graph's own evidence");
probe("reader-join-delivery-carries-export", reader, "if (prepared && plan.nodes[prepared.data.candidate.owner]?.kind !== \"join\") {", "if (prepared) {", adapterTest, "publish the graph's own evidence");

export const layered = [
    { guard: "fork names its own join; join names its own fork", maskedBy: "each other and the branch-region rule: removing either alone still refuses a mismatched pair (measured: both not red alone)" },
    { guard: "event names an active node", maskedBy: "per-kind state checks and route validation refuse the same forgeries" },
    { guard: "one arrival per branch; arrival only from the join's own branches", maskedBy: "the compiler's closed branch regions and route validation; an acyclic branch has one path to its join" },
    { guard: "join branch inputs in declared order", maskedBy: "results are recorded in a fixed node order, so arrivals are already deterministic" },
    { guard: "each branch candidate descends from the fork's source", maskedBy: "each branch child is derived from the fork's input; no fixture can produce another base" },
    { guard: "review branch is not the remote default branch", maskedBy: "the compiler refuses main/master and any branch equal to the target" },
];
const selected = (() => { const at = process.argv.indexOf("--only"); return at === -1 ? cases : cases.filter(row => row.name.startsWith(process.argv[at + 1]!)); })();
const evidenceAt = process.argv.indexOf("--evidence"), evidenceDirectory = evidenceAt === -1 ? "docs/restoration/evidence/phase-4" : process.argv[evidenceAt + 1]!;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-4 isolated reversion targets`);
else {
    try { await runReversions("restoration-phase4", [compilerTest, kernelTest, adapterTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory, restoreEach: true }); }
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
