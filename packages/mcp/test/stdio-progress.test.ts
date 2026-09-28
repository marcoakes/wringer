import { expect, test } from "bun:test";

const frame = (id: number, name: string, args: object = {}) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: `wringer.${name}`, arguments: args } }) + "\n";
async function fixture() {
    const proc = Bun.spawn([process.execPath, new URL("fixtures/wait-stdio.ts", import.meta.url).pathname], { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", TMPDIR: process.env.TMPDIR ?? "/tmp" } });
    const replies: any[] = []; let entered = 0, exited = 0;
    async function lines(stream: ReadableStream<Uint8Array>, visit: (line: string) => void) {
        const decoder = new TextDecoder(); let pending = "";
        const reader = stream.getReader();
        while (true) {
            const { done, value: chunk } = await reader.read();
            if (done) break;
            pending += decoder.decode(chunk, { stream: true });
            let end: number;
            while ((end = pending.indexOf("\n")) >= 0) { visit(pending.slice(0, end)); pending = pending.slice(end + 1); }
        }
        if (pending) throw new Error("Unterminated protocol fixture output");
    }
    const reads = [lines(proc.stdout, line => replies.push(JSON.parse(line))), lines(proc.stderr, line => { if (line === "wait-entered") entered++; else if (line === "wait-exited") exited++; else throw new Error("Unexpected fixture diagnostic"); })];
    async function until<T>(read: () => T | undefined): Promise<T> {
        const deadline = Date.now() + 2500;
        while (Date.now() < deadline) { const value = read(); if (value !== undefined) return value; await Bun.sleep(5); }
        throw new Error("STDIO made no progress while a long poll was pending");
    }
    const send = (line: string) => { proc.stdin.write(line); proc.stdin.flush(); };
    const reply = (id: number) => until(() => replies.find(row => row.id === id));
    const close = async () => { proc.kill(); await proc.exited; await Promise.all(reads); };
    send(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } }) + "\n");
    await reply(0);
    send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    return { send, reply, close, replies, waitEntered: (count = 1) => until(() => entered >= count ? true : undefined), waitExited: () => until(() => exited > 0 ? true : undefined) };
}
test("T12 real STDIO handles status and durable cancellation during a long poll", async () => {
    const f = await fixture();
    try {
        f.send(frame(1, "wait_for_update", { jobId: "job_fixture", timeoutSeconds: 25 }));
        await f.waitEntered();
        f.send(frame(2, "get_status", { jobId: "job_fixture" }));
        expect((await f.reply(2)).result.structuredContent).toMatchObject({ waits: 1, cancelledJobs: 0 });
        f.send(frame(3, "cancel", { jobId: "job_fixture", idempotencyKey: crypto.randomUUID(), expectedRevision: "a".repeat(64), expectedCandidateTree: null }));
        expect((await f.reply(3)).result.structuredContent).toMatchObject({ cancelledJobs: 1 });
        expect(f.replies.some(row => row.id === 1)).toBeFalse();
    } finally { await f.close(); }
}, 10000);
test("T12 transport cancellation releases only its wait, never the durable job", async () => {
    const f = await fixture();
    try {
        f.send(frame(1, "wait_for_update", { jobId: "job_fixture", timeoutSeconds: 25 }));
        await f.waitEntered();
        f.send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } }) + "\n");
        await f.waitExited();
        f.send(frame(2, "get_status", { jobId: "job_fixture" }));
        expect((await f.reply(2)).result.structuredContent).toMatchObject({ waits: 0, cancelledJobs: 0 });
        expect(f.replies.some(row => row.id === 1)).toBeFalse();
    } finally { await f.close(); }
}, 10000);
test("T12 long-poll overload is bounded and leaves capacity for status", async () => {
    const f = await fixture();
    try {
        for (let id = 1; id <= 12; id++) f.send(frame(id, "wait_for_update", { jobId: "job_fixture", timeoutSeconds: 25 }));
        await f.waitEntered(12);
        f.send(frame(13, "wait_for_update", { jobId: "job_fixture", timeoutSeconds: 25 }));
        expect((await f.reply(13)).result.structuredContent).toMatchObject({ outcome: "refused", code: "wait-limit" });
        f.send(frame(14, "get_status", { jobId: "job_fixture" }));
        expect((await f.reply(14)).result.structuredContent).toMatchObject({ waits: 12, cancelledJobs: 0 });
    } finally { await f.close(); }
}, 10000);
