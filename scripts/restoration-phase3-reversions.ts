/** Phase 3: every contained-graph guard is removed alone in an isolated copy,
 * watched red, restored and watched green before the next. No live dispatch.
 * Layered guards whose removal another guard still catches are listed in
 * `layered` with the guard that masks them, rather than claimed as caught. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const compilerTest = "packages/plan/test/contained-graph.test.ts", kernelTest = "packages/scheduler/test/contained.test.ts";
const compiler = "packages/plan/src/graph.ts", kernel = "packages/scheduler/src/contained.ts";
const adapter = "packages/application/src/graph.ts", adapterTest = "packages/application/test/graph.test.ts";
const reader = "examples/evidence/read-bundle.mjs", cli = "packages/cli/src/graph-cli.ts", cliTest = "packages/cli/test/graph-cli.test.ts";
const cases: Reversion[] = [];
const probe = (name: string, file: string, before: string, after: string, test: string, pattern: string) => cases.push({ name, file, before, after, test, pattern });

// Compiler: declaration, topology, typed inputs, required paths, allowance and grant.
probe("compiler-declaration-version", compiler, "if (value.version !== 1) fail(", "if (false) fail(", compilerTest, "legacy version");
probe("compiler-unknown-fields", compiler, "if (Object.keys(row).some(key => !fields.includes(key))) fail(", "if (false) fail(", compilerTest, "unknown host command|embedded Send");
probe("compiler-node-identity", compiler, "function id(value: unknown, label: string) { const name = text(value, label, 80); if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(", "function id(value: unknown, label: string) { const name = text(value, label, 80); if (false) fail(", compilerTest, "uppercase node identity");
probe("compiler-known-edges", compiler, "if (!nodes[next] && !SINKS.includes(next)) fail(", "if (false) fail(", compilerTest, "missing edge");
probe("compiler-acyclic", compiler, "if (active.has(name)) fail('Graph cycle", "if (active.has(name)) return; if (false) fail('Graph cycle", compilerTest, "cycle");
probe("compiler-reachable", compiler, "if (seen.size !== Object.keys(nodes).length) fail(", "if (false) fail(", compilerTest, "unreachable node|bypasses required check");
probe("compiler-entry", compiler, "if (!nodes[entry] || incoming.get(entry)!.length) fail(", "if (!nodes[entry]) fail(", compilerTest, "wrong entry");
probe("compiler-dominating-input", compiler, "if (node.input !== 'root' && !available.has(node.input)) fail(", "if (false) fail(", compilerTest, "forward source");
probe("compiler-check-candidate", compiler, "if (['check', 'delivery'].includes(node.kind) && !graphCandidateOwner({ nodes }, node.input)) fail(", "if (false) fail(", compilerTest, "noncandidate check");
probe("compiler-human-hold-candidate", compiler, "if (node.kind === 'human-hold' && node.input !== 'root' && !graphCandidateOwner({ nodes }, node.input)) fail(", "if (false) fail(", compilerTest, "noncandidate human input");
probe("compiler-router-typed-input", compiler, "if (node.kind === 'router' && node.input === 'root') fail(", "if (false) fail(", compilerTest, "router source type");
probe("compiler-router-outcomes", compiler, "if (node.kind === 'router') for (const route of node.routes) if (!graphOutcomes(nodes[node.input]!.kind).includes(route.outcome)) fail(", "if (false) fail(", compilerTest, "unknown branch outcome");
probe("compiler-router-unique-outcomes", compiler, "unique(routes.map((r: any) => r.outcome), 'Router outcomes'); ", "", compilerTest, "duplicate branch outcome");
probe("compiler-required-on-done-paths", compiler, "if (!finishes.length || finishes.some(", "if (false && finishes.some(", compilerTest, "reachable path bypasses required review");
probe("compiler-required-consequential", compiler, "for (const name of required) if (!nodes[name] || nodes[name]!.kind === 'router') fail(", "for (const name of required) if (false) fail(", compilerTest, "missing required identity|required router");
probe("compiler-required-unique", compiler, "const required = unique(value.required.map((name: unknown) => id(name, 'required node')), 'Required nodes').sort();", "const required = value.required.map((name: unknown) => id(name, 'required node')).sort();", compilerTest, "duplicate required identity");
probe("compiler-role-allowance", compiler, "if (reservations.reduce((sum, row) => sum + row.roleSessions, 0) > budget.maxRoleSessions) fail(", "if (false) fail(", compilerTest, "insufficient aggregate roles");
probe("compiler-verification-allowance", compiler, "if (reservations.reduce((sum, row) => sum + row.verificationAttempts, 0) > budget.maxVerificationAttempts) fail(", "if (false) fail(", compilerTest, "insufficient aggregate verifiers");
probe("compiler-one-root-source", compiler, "if (hashValue(plan.repository) !== hashValue(repository)) fail(", "if (false) fail(", compilerTest, "different root source");
probe("compiler-graph-acceptance-set", compiler, "&& !protectedPaths.some(protectedPath => within(path, protectedPath))) fail(", "&& false) fail(", compilerTest, "acceptance input");
probe("compiler-nondefault-branch", compiler, "if (sourceBranch === targetBranch || ['main', 'master'].includes(sourceBranch)) fail(", "if (false) fail(", compilerTest, "unsafe publication branch");
probe("compiler-credential-free-publication", compiler, "|| url!.password ||", "||", compilerTest, "ssh publication password");
probe("authority-no-send", compiler, "if (value.maySend !== false) fail(", "if (false) fail(", compilerTest, "immutable contract and finite");
probe("authority-bound-contract", compiler, "if (value.graphSha256 !== plan.sha256 || hashValue(value.repository)", "if (false || hashValue(value.repository)", compilerTest, "immutable contract and finite");
probe("authority-digest", compiler, "if (sha256 !== hashValue(body)) fail('Graph authority digest changed');", "", compilerTest, "immutable contract and finite");
probe("authority-expiry", compiler, "|| Date.parse(value.expiresAt) <= at.getTime()) fail(", ") fail(", compilerTest, "immutable contract and finite");

// Kernel: reservation, dispatch marker, reconciliation, clock and lock.
probe("kernel-reserve-charges-allowance", kernel, "            progress.reserved = next;\n", "            // allowance accounting removed\n", kernelTest, "serial workflow reserves before dispatch");
probe("kernel-dispatch-marker", kernel, "                await commit(history, marker, options);\n                await driver.dispatch(request);", "                await driver.dispatch(request);", kernelTest, "serial workflow reserves before dispatch|dispatch without a durable outcome");
probe("kernel-observe-before-redispatch", kernel, "                await commit(history, marker, options);\n                await driver.dispatch(request);\n            }", "                await commit(history, marker, options);\n            }\n            await driver.dispatch(request);", kernelTest, "dispatch without a durable outcome|completed child before parent");
probe("kernel-preflight-before-dispatch-marker", kernel, "                await driver.preflight?.(request, 'dispatch');\n                await commit(history, marker, options);", "                await commit(history, marker, options);\n                await driver.preflight?.(request, 'dispatch');", kernelTest, "refused preflight leaves work reserved");
probe("send-preflight-before-marker", kernel, "        await driver.preflight?.(request, 'send');\n        await commit(history, marker, options);", "        await commit(history, marker, options);\n        await driver.preflight?.(request, 'send');", kernelTest, "refused Send preflight");
probe("kernel-root-deadline", kernel, "at.getTime() > Date.parse(history.progress.deadline) || ", "", kernelTest, "root wall clock clips");
probe("kernel-authority-expiry", kernel, " || at.getTime() >= Date.parse(history.authority.expiresAt)", "", kernelTest, "graph authority expiry");
probe("kernel-lock", kernel, "return locked(directory, LOCK, async function advanceLocked() {", "return (async (_directory: string, _name: string, task: () => Promise<GraphState>) => task())(directory, LOCK, async function advanceLocked() {", kernelTest, "simultaneous advances");
probe("kernel-init-refuses-nonempty", kernel, "        if (present.length) fail(", "        if (false) fail(", kernelTest, "non-empty unrelated");

// Observation validation: typed outcomes and exact candidate lineage.
probe("kernel-outcome-set", kernel, " || !graphOutcomes(node.kind).includes(row.outcome)", "", kernelTest, "wrong-source, wrong-owner");
probe("kernel-loop-owner", kernel, "        if (result.candidate && result.candidate.owner !== id) fail(", "        if (false) fail(", kernelTest, "wrong-source, wrong-owner");
probe("kernel-loop-source-url", kernel, "        if (result.candidate && result.candidate.source.url !== plan.repository.url) fail(", "        if (false) fail(", kernelTest, "wrong-source, wrong-owner");
probe("kernel-check-candidate-identity", kernel, "        if (!same(result.candidate, state.reservation.input.candidate)) fail(`A check cannot replace", "        if (false) fail(`A check cannot replace", kernelTest, "a check cannot replace");
probe("kernel-delivered-needs-send", kernel, "        if (!state.sent) fail(`Delivery ${id} cannot report delivered", "        if (false) fail(`Delivery ${id} cannot report delivered", kernelTest, "delivery cannot report delivered");
probe("kernel-prepared-candidate-identity", kernel, "    if (!same(prepared.candidate, state.reservation.input.candidate)) fail(", "    if (false) fail(", kernelTest, "delivery cannot prepare");

// Routing: success edges only; a required failure stops before later effects.
probe("kernel-required-failure-stops", kernel, "    if (plan.required.includes(from) && outcome !== SUCCESS[node.kind]) return", "    if (false) return", kernelTest, "a router cannot carry");
probe("kernel-success-edge-only", kernel, "        if (target?.kind !== 'router' || target.input !== from) return", "        if (false) return", kernelTest, "non-required failed check");

// Human decisions and Send: bound to revision, held input and prepared identity.
probe("decision-graph-hold-only", kernel, "            if (node.kind !== 'human-hold') fail(", "            if (false) fail(", kernelTest, "a child hold is reported");
probe("decision-revision", kernel, "            if (decision.expectedRevision !== event.previousSha256) fail(", "            if (false) fail(", kernelTest, "stale or forged human decisions");
probe("decision-input-digest", kernel, "            if (decision.inputSha256 !== hashValue(state.reservation.input)) fail(", "            if (false) fail(", kernelTest, "stale or forged human decisions");
probe("decision-closed-choice", kernel, "    if (!['continue', 'reject'].includes(row.choice)) fail(", "    if (false) fail(", kernelTest, "stale or forged human decisions");
probe("decision-expiry", kernel, "        if (expired(history, at)) fail('The graph root wall clock or authority has expired; no decision was recorded');", "", kernelTest, "an expired graph records no decision");
probe("send-once", kernel, "            if (state.sent) fail(`Send was already recorded", "            if (false) fail(`Send was already recorded", kernelTest, "uncertain Send cannot be reissued");
probe("send-revision", kernel, "            if (send.expectedRevision !== event.previousSha256) fail(", "            if (false) fail(", kernelTest, "changed prepared Send identity");
probe("send-prepared-digest", kernel, "            if (send.preparedSha256 !== hashValue(state.prepared)) fail(", "            if (false) fail(", kernelTest, "changed prepared Send identity");
probe("send-expiry", kernel, "        if (expired(history, at)) fail('The graph root wall clock or authority has expired; nothing was sent');", "", kernelTest, "an expired graph sends nothing");

// Reader: names, sequence, chain, digest, graph binding, regular files, transitions.
probe("reader-event-names", kernel, "    names.forEach((name, index) => { if (`events/${name}` !== eventName(index)) fail(", "    names.forEach((name, index) => { if (false) fail(", kernelTest, "non-canonical event name");
probe("reader-sequence-field", kernel, "    if (row.sequence !== sequence) fail(", "    if (false) fail(", kernelTest, "forged sequence field");
probe("reader-chain", kernel, "    if (row.previousSha256 !== previous) fail(", "    if (false) fail(", kernelTest, "forged chain link");
probe("reader-digest", kernel, "    if (sha256 !== hashValue(body)) fail('Graph event digest changed');", "", kernelTest, "hash changes, missing events");
probe("reader-graph-binding", kernel, "    if (row.graphSha256 !== plan.sha256) fail(", "    if (false) fail(", kernelTest, "event from another graph");
probe("reader-regular-files", kernel, "    if (stat.isSymbolicLink() || !stat.isFile()) fail(`${name} must be a regular file`);", "    if (!stat.isFile() && !stat.isSymbolicLink()) fail(`${name} must be a regular file`);", kernelTest, "hash changes, missing events");
probe("reader-reservation-transition", kernel, "            if (!same(exact(data, 'reserve', ['reservation']).reservation, expected)) fail(", "            if (!exact(data, 'reserve', ['reservation']).reservation) fail(", kernelTest, "forged reservation");
probe("reader-single-dispatch", kernel, "            if (state.dispatched) fail(", "            if (false) fail(", kernelTest, "repeated dispatch");

// Production adapter: derivation, runtime preflight, owner binding and publication.
probe("adapter-clip-wall-clock", adapter, "const wall = Math.min(template.budget.wall_clock_seconds, remaining), session", "const wall = template.budget.wall_clock_seconds, session", adapterTest, "a serial graph runs contained children");
probe("adapter-clip-authority-expiry", adapter, "new Date(Math.min(Date.parse(request.authority.expiresAt), Date.parse(request.reservation.deadline))).toISOString()", "new Date(Date.parse(request.authority.expiresAt)).toISOString()", adapterTest, "a serial graph runs contained children");
probe("adapter-owner-tree-binding", adapter, "if (!recorded || recorded.tree !== candidate.tree || ", "if (!recorded || ", adapterTest, "a check refuses a candidate");
probe("adapter-acceptance-inputs", adapter, "if (await read(plan.repository.commit) !== await read(candidateCommit)) fail(", "if (false) fail(", adapterTest, "changed an acceptance input");
probe("adapter-observe-unstarted-is-uncertain", adapter, "                if (!await present(join(state, \"plan.json\"))) return null;\n", "", adapterTest, "observing an unstarted loop");
probe("adapter-runtime-preflight", adapter, "if (!Bun.which(binary, { PATH: process.env.PATH ?? \"\" })) fail(", "if (false) fail(", adapterTest, "missing container runtime");
probe("adapter-bare-origin", adapter, "if (result.code !== 0 || result.stdout.trim() !== \"true\") fail(", "if (false) fail(", adapterTest, "non-bare local origin");
probe("adapter-send-target-branch", adapter, "if (!await remoteBranch(delivery.publication.remote, delivery.publication.targetBranch)) fail(", "if (false) fail(", adapterTest, "absent target branch");
probe("adapter-send-existing-branch", adapter, "if (existing && existing !== prepared.evidenceCommit) fail(", "if (false) fail(", adapterTest, "existing different review branch");
probe("adapter-send-reconcile-remote", adapter, "return head === prepared.evidenceCommit ? {", "return false ? {", adapterTest, "lost Send confirmation");

// Export and independent reader: every carried byte, the chain, the graph binding and lineage.
const exported = "a serial graph runs contained children";
probe("export-portable-verification", adapter, "entry.evidence = await write(`nodes/${id}/verification.json`, JSON.stringify(portableVerification(record.value), null, 2)", "entry.evidence = await write(`nodes/${id}/verification.json`, JSON.stringify(record.value, null, 2)", adapterTest, exported);
probe("export-discloses-local-origin", adapter, "...(Object.values(state.plan.nodes).some(node => node.kind === \"delivery\" && path.isAbsolute(node.publication.remote)) ? [", "...(false ? [", adapterTest, exported);
probe("reader-graph-file-digests", reader, "for (const name of paths) insist(hash(index.files[name]) && digest(await file(root, name)) === index.files[name], `Graph evidence changed", "for (const name of paths) insist(true, `Graph evidence changed", adapterTest, exported);
probe("reader-graph-event-digest", reader, " && hashJson(withoutDigest(event)) === event.sha256, `Graph event", ", `Graph event", adapterTest, exported);
probe("reader-graph-event-chain", reader, " && event.previousSha256 === previous && event.graphSha256", " && event.graphSha256", adapterTest, exported);
probe("reader-graph-binding", reader, " && event.graphSha256 === plan.sha256 && hashJson", " && hashJson", adapterTest, exported);
probe("reader-graph-check-evidence", reader, "if (node.kind === \"check\" && result) insist(row.evidence && hashJson(await json(row.evidence)) === result.data.evidenceSha256,", "if (node.kind === \"check\" && result) insist(true,", adapterTest, exported);
probe("reader-graph-loop-derivation", reader, "&& derivation.inputSha256 === hashJson(reserve.data.reservation.input), `Loop", ", `Loop", adapterTest, exported);
probe("reader-graph-delivery-journal", reader, "insist(owner && owner.data.evidenceSha256 === manifest.journal?.sourceHeadSha256,", "insist(true,", adapterTest, exported);

// Public routes: named refusal of the retired format and one explicit choice.
probe("cli-legacy-format-named", adapter, "if (raw && typeof raw === \"object\" && ([\"budgets\"", "if (false && raw && typeof raw === \"object\" && ([\"budgets\"", cliTest, "retired host graph");
probe("cli-one-explicit-choice", cli, "if (flag(a, \"continue\") === flag(a, \"reject\")) throw", "if (false) throw", cliTest, "stale or ambiguous");

/** Guards kept as defence in depth; another listed guard catches their removal. */
export const layered = [
    { guard: "kernel event names the current cursor", maskedBy: "per-kind state checks (decision-graph-hold-only, dispatch/prepared/send require the node's own reservation)" },
    { guard: "decision/send node equals event node", maskedBy: "entry points pass the decision's node as the event node; the cursor check refuses any other" },
    { guard: "completion requires every required node to have succeeded", maskedBy: "kernel-required-failure-stops fails a required failure at once; the compiler makes every done path visit every required node" },
    { guard: "exclusive link when creating a graph record", maskedBy: "kernel-init-refuses-nonempty and kernel-lock" },
    { guard: "reservation cannot exceed the graph allowance", maskedBy: "compiler-role-allowance and compiler-verification-allowance reserve every declared leaf at compile time" },
    { guard: "derived child plan differs from its template only in source and clipped time", maskedBy: "the derivation constructs only those fields; this is a self-check on the adapter's own construction" },
    { guard: "Send confirms the exact prepared evidence commit", maskedBy: "deliverContained's own push confirmation; no fixture can make it report a different commit" },
];
const selected = (() => { const at = process.argv.indexOf("--only"); return at === -1 ? cases : cases.filter(row => row.name.startsWith(process.argv[at + 1]!)); })();
const evidenceAt = process.argv.indexOf("--evidence"), evidenceDirectory = evidenceAt === -1 ? "docs/restoration/evidence/phase-3" : process.argv[evidenceAt + 1]!;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-3 isolated reversion targets`);
else {
    try { await runReversions("restoration-phase3", [compilerTest, kernelTest, adapterTest, cliTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory, restoreEach: true }); }
    finally {
        // What each red actually observed. A changed explanation is weaker than a
        // vanished refusal and is reported as such, never merged into one count.
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
