/** Compiled public external-task journey. A separately compiled fixture binary runs a
 * local reference A2A peer and supplies the verifier for the check; the public binary
 * itself is the A2A client, over real HTTP on loopback. A local peer establishes
 * fixture conformance only: no real agent, container or remote peer is measured. */
import { chmod, copyFile, cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `graph-delegate-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), home = join(directory, "isolated-home");
await mkdir(bin, { recursive: true }); await mkdir(home);
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
await symlink("wring", join(bin, "wringer-drive"));
const node = Bun.which("node"); if (!node) throw new Error("The independent reader check needs Node.js on the host PATH");
await symlink(node, join(bin, "node"));
// No container runtime on PATH: the check must refuse before dispatch, after the delegation returned.
const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const transcript: { label: string; command: string[]; exit: number }[] = [], startedAt = new Date().toISOString();
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; cwd?: string; build?: boolean; env?: Record<string, string> } = {}) {
    const result = await runProcess(argv, { cwd: options.cwd ?? directory, env: options.build ? process.env : { ...environment, ...options.env }, timeout: 240, maxBytes: 8 * 1024 * 1024 });
    transcript.push({ label, command: argv.map(arg => arg.replaceAll(directory, "[fixture]")), exit: result.exit_code });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const json = (text: string) => JSON.parse(text), drive = join(bin, "wringer-drive"), fixture = join(bin, "graph-fixture-driver");
const sends = async () => (JSON.parse(await readFile(join(directory, "peer-calls.json"), "utf8").catch(() => "[]")) as { method: string; version: string }[]);
await execute("compile-fixture-only-driver", [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "scripts/fixtures/graph-driver.ts", "--outfile", fixture], { cwd: root, build: true });
const peerProcess = Bun.spawn([fixture, "serve-peer", directory], { stdout: "pipe", stderr: "pipe", env: environment });
try {
    const reader = peerProcess.stdout.getReader(); let line = "";
    while (!line.includes("\n")) { const { value, done } = await reader.read(); if (done) throw new Error("The reference peer exited before it served"); line += new TextDecoder().decode(value); }
    const peer = json(line.split("\n")[0]!);
    transcript.push({ label: "fixture-reference-peer-serving", command: [fixture.replaceAll(directory, "[fixture]"), "serve-peer", "[fixture]"], exit: 0 });
    const prepared = json((await execute("synthetic-delegation-repository", [fixture, "prepare-delegate", directory, peer.url, peer.cardSha256])).stdout);
    const state = join(directory, "state"), authority = join(directory, "graph-authority.json"), expires = new Date(Date.now() + 3600000).toISOString();
    const planned = await execute("public-delegate-graph-plan", [drive, "graph", "plan", prepared.graph]);
    if (!planned.stdout.includes(`external A2A task to ${new URL(peer.url).host}`) || !planned.stdout.includes("a check must verify it")) throw new Error(`Graph plan did not state the external task:\n${planned.stdout}`);
    // A changed card is refused before anything is sent.
    const changedAuthority = join(directory, "changed-authority.json"), changedState = join(directory, "changed-state");
    await execute("public-changed-card-authority", [drive, "graph", "authority", prepared.changedCard, "--actor", "Delegation fixture operator", "--expires", expires, "--output", changedAuthority]);
    const changed = await execute("public-run-refuses-changed-card-before-sending", [drive, "graph", "run", prepared.changedCard, "--authority", changedAuthority, "--state", changedState, "--source-bundle", prepared.bundle], { expected: "nonzero" });
    if (!/Agent Card changed/.test(changed.stdout + changed.stderr) || (await sends()).some(call => call.method === "SendMessage")) throw new Error("A changed Agent Card was not refused before sending");
    await execute("public-graph-authority", [drive, "graph", "authority", prepared.graph, "--actor", "Delegation fixture operator", "--expires", expires, "--output", authority]);
    // The public binary sends the task, applies the returned patch, then refuses the check without a runtime.
    const ran = await execute("public-run-delegates-then-refuses-check-without-runtime", [drive, "graph", "run", prepared.graph, "--authority", authority, "--state", state, "--source-bundle", prepared.bundle], { expected: "nonzero" });
    if (!/Containment unavailable/.test(ran.stdout + ran.stderr)) throw new Error("The check was not refused before dispatch");
    const calls = await sends();
    if (calls.filter(call => call.method === "SendMessage").length !== 1 || calls.some(call => call.version !== "1.0")) throw new Error("The public binary did not send exactly one A2A 1.0 task");
    const reserved = json((await execute("public-status-returned-and-check-reserved", [drive, "graph", "status", "--state", state, "--json"], { expected: 3 })).stdout);
    const ask = reserved.nodes.find((row: any) => row.id === "ask"), verify = reserved.nodes.find((row: any) => row.id === "verify");
    if (ask.outcome !== "returned" || ask.candidate?.owner !== "ask" || verify.state !== "reserved") throw new Error("The returned candidate was not held for its check");
    const review = json((await execute("fixture-verifier-runs-the-pinned-check", [fixture, "advance", directory, state])).stdout);
    if (review.phase !== "human-hold" || review.actions[0]?.node !== "review") throw new Error(`Graph did not reach review: ${review.phase}`);
    const delegation = JSON.parse(await readFile(join(state, "children/ask/delegation.json"), "utf8"));
    if (delegation.outcome !== "returned" || delegation.evidenceKind !== "local-peer" || JSON.stringify(delegation.artifact.changedPaths) !== JSON.stringify(["src/total.sh"])) throw new Error("The delegation record is not the returned patch");
    const decision = review.actions[0];
    await execute("public-review-decision", [drive, "graph", "decide", "--state", state, "--node", "review", "--revision", review.revision, "--input", decision.inputSha256, "--continue", "--by", "Delegation fixture operator", "--note", "Deterministic fixture checkpoint; not independent human acceptance."]);
    const sendHold = json((await execute("public-resume-prepares-graph-delivery", [drive, "graph", "resume", "--state", state, "--json"], { expected: 3 })).stdout);
    const send = sendHold.actions.find((row: any) => row.action === "send");
    if (sendHold.phase !== "send-hold" || !send) throw new Error(`Graph delivery was not prepared: ${sendHold.phase}`);
    await execute("public-explicit-send", [drive, "graph", "send", "--state", state, "--node", "ship", "--revision", sendHold.revision, "--prepared", send.preparedSha256, "--by", "Delegation fixture operator", "--note", "Explicit fixture Send to a new local bare origin."]);
    const sent = JSON.parse(await readFile(join(state, "children/ship/sent.json"), "utf8"));
    const parent = (await execute("evidence-commit-parent-is-the-returned-candidate", ["git", "--git-dir", prepared.origin, "rev-parse", `${sent.evidenceCommit}^`])).stdout.trim();
    if (parent !== delegation.candidate.commit) throw new Error("The published evidence commit does not sit on the returned candidate");
    const clone = join(directory, "fresh-clone");
    await execute("fresh-review-branch-clone", ["git", "clone", "--no-local", "--branch", "wringer/delegation-fixture", prepared.origin, clone]);
    const audited = json((await execute("literal-graph-audit-command-with-node", ["/bin/sh", "-c", sent.auditCommand], { cwd: clone })).stdout);
    if (!audited.nodes.some((row: any) => row.id === "ask" && row.kind === "delegate")) throw new Error("The carried graph evidence lost its delegation");
    const exported = join(directory, "export");
    await execute("public-graph-export", [drive, "graph", "export", "--state", state, "--output", exported]);
    const inspected = json((await execute("node-only-independent-reader", [node, join(exported, "read-bundle.mjs"), exported], { env: { PATH: "/usr/bin:/bin" } })).stdout);
    if (inspected.finished !== "done") throw new Error("Independent reader did not confirm the finished graph");
    const tampered = join(directory, "export-tampered"); await cp(exported, tampered, { recursive: true });
    const evidence = join(tampered, "nodes/ask/delegation.json"), value = JSON.parse(await readFile(evidence, "utf8")); value.evidenceKind = "live-peer"; await writeFile(evidence, JSON.stringify(value));
    await execute("node-reader-refuses-altered-delegation", [node, join(tampered, "read-bundle.mjs"), tampered], { expected: 1, env: { PATH: "/usr/bin:/bin" } });
    const binary = await readFile(join(root, "dist/wring"));
    if (binary.includes(Buffer.from("prepare-delegate")) || binary.includes(Buffer.from("Wringer reference peer"))) throw new Error("The public binary contains a fixture peer or hook");
    const result = { status: "passed", startedAt, finishedAt: new Date().toISOString(), publicCommandStages: transcript.filter(row => row.label.startsWith("public-")).length, fixtureStages: transcript.filter(row => row.label.startsWith("fixture-")).length, a2aVersion: "1.0", sendMessageCalls: 1, returnedCommit: delegation.candidate.commit, evidenceCommit: sent.evidenceCommit, realPeerMeasured: false, realContainmentMeasured: false, limits: ["The peer is a local reference fixture on loopback; it establishes fixture conformance only.", "The check's verifier came from a separately compiled fixture binary that really ran the pinned check on the exported tree.", "The review decision is a scripted engineering checkpoint, not independent human acceptance."] };
    await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(`Compiled delegation graph fixture passed: ${directory}\n${result.publicCommandStages} public stages, ${result.fixtureStages} fixture stages. A real peer, containment and human acceptance remain unmeasured.`);
} finally { peerProcess.kill(); await peerProcess.exited; }
