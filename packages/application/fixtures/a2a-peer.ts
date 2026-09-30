/** TEST FIXTURE ONLY. A local reference A2A 1.0 peer over JSON-RPC on loopback. It
 * serves an Agent Card and answers SendMessage, GetTask and CancelTask with a
 * configured behaviour. It establishes fixture conformance only, never a real
 * peer's behaviour. */
import { hashValue } from "@wringer/plan";

export type PeerMode = "complete" | "fail" | "reject" | "input-required" | "cancel-self" | "hang" | "message-only" | "no-artifact" | "two-artifacts" | "wrong-type" | "not-a-patch";
export interface PeerOptions { mode?: PeerMode; patch?: string | (() => string); onCall?: (calls: { method: string; params: any; version: string | null }[]) => void; completeAfterPolls?: number; changeCardAfterSend?: boolean; requireVersion?: boolean }
export async function startReferencePeer(options: PeerOptions = {}) {
    const mode = options.mode ?? "complete", calls: { method: string; params: any; version: string | null }[] = [], tasks = new Map<string, any>();
    let polls = 0, sent = false;
    const cardFor = (url: string, version: string) => ({ name: "Wringer reference peer", description: "A local fixture peer; not a real agent.", version, supportedInterfaces: [{ url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }], capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ["text/plain"], defaultOutputModes: ["text/x-diff"], skills: [{ id: "repair", name: "Repair", description: "Return a patch for a bounded repair.", tags: ["fixture"] }] });
    const part = (text: string, mediaType = "text/x-diff") => ({ text, mediaType }), patch = () => typeof options.patch === "function" ? options.patch() : options.patch ?? "";
    const artifacts = () => mode === "no-artifact" ? [] : mode === "two-artifacts" ? [{ artifactId: "a", parts: [part(patch())] }, { artifactId: "b", parts: [part(patch())] }]
        : mode === "wrong-type" ? [{ artifactId: "a", parts: [part(patch(), "text/plain")] }] : mode === "not-a-patch" ? [{ artifactId: "a", parts: [part("I fixed it, trust me.")] }] : [{ artifactId: "patch", name: "Repair", parts: [part(patch())] }];
    const final = () => ({ complete: "TASK_STATE_COMPLETED", "no-artifact": "TASK_STATE_COMPLETED", "two-artifacts": "TASK_STATE_COMPLETED", "wrong-type": "TASK_STATE_COMPLETED", "not-a-patch": "TASK_STATE_COMPLETED", fail: "TASK_STATE_FAILED", reject: "TASK_STATE_REJECTED", "input-required": "TASK_STATE_INPUT_REQUIRED", "cancel-self": "TASK_STATE_CANCELED" } as Record<string, string>)[mode];
    const reply = (id: unknown, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
    const error = (id: unknown, code: number, message: string) => Response.json({ jsonrpc: "2.0", id, error: { code, message } });
    let port = 0;
    const server: ReturnType<typeof Bun.serve> = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request): Promise<Response> {
        const url = new URL(request.url), endpoint: string = `http://127.0.0.1:${port}/a2a`;
        if (request.method === "GET" && url.pathname === "/.well-known/agent-card.json") return Response.json(cardFor(endpoint, options.changeCardAfterSend && sent ? "2.0.0" : "1.0.0"));
        if (request.method !== "POST" || url.pathname !== "/a2a") return new Response("not found", { status: 404 });
        const body = await request.json() as any, version = request.headers.get("A2A-Version");
        calls.push({ method: body.method, params: body.params, version }); options.onCall?.(calls);
        if ((options.requireVersion ?? true) && version !== "1.0") return error(body.id, -32009, "A2A-Version 1.0 is required");
        if (body.method === "SendMessage") {
            sent = true;
            if (mode === "message-only") return reply(body.id, { message: { messageId: "reply", role: "ROLE_AGENT", parts: [{ text: "Done." }] } });
            const task = { id: `task-${tasks.size + 1}`, contextId: body.params.message.contextId, status: { state: "TASK_STATE_WORKING" } };
            tasks.set(task.id, task); return reply(body.id, { task });
        }
        const task = tasks.get(body.params?.id);
        if (!task) return error(body.id, -32001, "Task not found");
        if (body.method === "GetTask") {
            if (task.status.state === "TASK_STATE_WORKING" && mode !== "hang" && ++polls >= (options.completeAfterPolls ?? 1)) {
                task.status = { state: final() };
                if (task.status.state === "TASK_STATE_COMPLETED") task.artifacts = artifacts();
            }
            return reply(body.id, task);
        }
        if (body.method === "CancelTask") {
            if (task.status.state !== "TASK_STATE_WORKING") return error(body.id, -32002, "Task cannot be canceled");
            task.status = { state: "TASK_STATE_CANCELED" }; return reply(body.id, task);
        }
        return error(body.id, -32601, "Method not found");
    } });
    port = server.port!;
    const endpoint = `http://127.0.0.1:${port}/a2a`;
    return { url: endpoint, cardSha256: hashValue(cardFor(endpoint, "1.0.0")), calls, stop: () => server.stop(true), sends: () => calls.filter(call => call.method === "SendMessage").length };
}
