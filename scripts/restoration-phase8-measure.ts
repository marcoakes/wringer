/** Phase 8 measure-first (bun scripts/restoration-phase8-measure.ts OUTPUT): the
 * interfaces Wringer actually exercises today, read from the source and the
 * compiler rather than assumed, and what an external A2A task needs that the
 * graph cannot express. No model, container, network or external peer is used. */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { compileContainedGraph } from "../packages/plan/src";
import { graphFixture } from "../packages/plan/test/graph-fixtures";

const root = resolve(import.meta.dir, ".."), output = resolve(process.argv[2] ?? "build/restoration/phase-8/measurements");
const source = async (path: string) => readFile(join(root, path), "utf8");
const all = async (directory: string) => (await Promise.all((await readdir(join(root, directory))).filter(name => name.endsWith(".ts")).map(name => source(join(directory, name))))).join("\n");
const record: Record<string, unknown> = { schema_version: "wringer.restoration-phase8-measurement.v1", kind: "static reading of the source and one compiler probe; no model, container, network or external peer" };

// 1. ACP: the methods the client sends and the callbacks it offers an agent.
const acp = await all("packages/acp/src");
const methods = [...new Set(acp.match(/"(initialize|authenticate|session\/[a-z_]+)"/g) ?? [])].map(row => row.slice(1, -1)).sort();
const capabilities = /clientCapabilities: (\{[^}]*\})/.exec(acp)?.[1] ?? null;
record.acp = { methods, clientCapabilities: capabilities, fileOrTerminalCallbacksOffered: capabilities === "{}" ? "none" : "some",
    reading: "The client advertises no file or terminal capability, so an agent works only with its own tools inside the contained runtime. ACP carries work to a local contained agent; it is not containment and not external delegation." };

// 2. MCP: the assistant's tools, and whether any can approve or publish.
const mcp = await all("packages/mcp/src");
const tools = [...new Set(mcp.match(/name: "wringer\.[a-z_]+"/g) ?? [])].map(row => row.slice(7, -1)).sort();
record.mcp = { tools, count: tools.length, approvalOrPublicationTools: tools.filter(name => /approve|send|publish|merge|decide|adopt/.test(name)),
    reading: "The assistant surface inspects, proposes, starts approved work and prepares handovers. No tool approves a plan, records a verdict, sends, merges or adopts." };

// 3. Execution and identity dependencies declared by the plan contract.
const planTypes = await all("packages/plan/src");
record.dependencies = {
    runtimes: [...new Set(planTypes.match(/'(apple-container|gvisor-kubernetes)'|"(apple-container|gvisor-kubernetes)"/g) ?? [])].map(row => row.slice(1, -1)).sort(),
    agentProtocol: "acp", modelSelection: "by the agent command and its declared credential names in the plan; the harness names no model",
    identity: "an actor string recorded on grants, decisions and Sends; not authenticated", gateway: "none", memory: "none: no agent state persists between sessions beyond the repository and retained evidence",
};

// 4. A2A today: the graph cannot express an external task.
const delegate = (() => { const raw: any = structuredClone(graphFixture()); raw.nodes.build = { kind: "delegate", input: "root", peer: { url: "https://peer.example/a2a" }, then: "verify" }; try { compileContainedGraph(raw); return "accepted"; } catch (error) { return (error as Error).message; } })();
const a2aMentions = (await all("packages/application/src")).match(/A2A|a2a/g)?.length ?? 0;
record.a2a = { graphRefusal: delegate, implementationMentions: a2aMentions, pinnedSpecification: { version: "1.0", read: "2026-09-30", methods: ["SendMessage", "GetTask", "CancelTask"], versionHeader: "A2A-Version", agentCard: "/.well-known/agent-card.json", taskStates: ["TASK_STATE_SUBMITTED", "TASK_STATE_WORKING", "TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED", "TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"], errors: { taskNotFound: -32001, taskNotCancelable: -32002, unsupportedOperation: -32004, contentTypeNotSupported: -32005, versionNotSupported: -32009 } },
    reading: "No A2A client exists and the compiler refuses any external task node. An external result has no route into a graph, and nothing could distinguish it from a locally contained agent." };

// 5. The concrete integration chosen, and its capability and failure matrix.
record.integration = { choice: "Delegate one bounded source change to an external A2A agent that returns a patch artifact; apply it to the exact input source in controller storage; verify it afresh in a contained verifier before anything can hold, route or deliver it.",
    matrix: [
        { case: "peer completes with a patch artifact", expected: "a candidate owned by the delegation, verified afresh by a following check" },
        { case: "peer unreachable before sending", expected: "refused in preflight; nothing sent; the node stays reserved" },
        { case: "agent card differs from the pinned digest", expected: "refused before sending; a changed identity after completion makes the outcome unavailable" },
        { case: "peer reports failed, rejected or input/auth required", expected: "a failed outcome with the peer's state, no candidate" },
        { case: "peer or operator cancels, or the declared timeout passes", expected: "CancelTask is sent once; outcome canceled; no candidate" },
        { case: "duplicate or repeated terminal response", expected: "the first terminal state is recorded once; repeats change nothing" },
        { case: "malformed artifact: missing, several, wrong media type, not a patch, touches protected paths or does not apply", expected: "unavailable with a named reason; no candidate" },
        { case: "crash after sending, before the task id is retained", expected: "uncertain; never re-sent" },
    ],
    limits: ["Only JSON-RPC over HTTP(S), no streaming or push notifications.", "No peer authentication scheme beyond the pinned card digest and an HTTPS endpoint; a loopback endpoint is accepted only for local fixtures.", "An Agent Card and a completion claim grant nothing; only the local verification counts."] };

await mkdir(output, { recursive: true });
await writeFile(join(output, "phase8-baseline.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
