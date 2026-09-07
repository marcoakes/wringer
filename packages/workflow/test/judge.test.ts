import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bundle } from "../../engine/src/io";
import { judge } from "./legacy/judge";
import { normalizeResponse, prepareRequest } from "./legacy/providers";
import { draftSpec } from "./legacy/draft";
import { WorkflowError } from "../src/storage";
async function fixture(human = false, passed = true) {
    const repo = await mkdtemp(join(tmpdir(), "wringer-judge-"));
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "test", run: "bun test" }], judge: { endpoint: "http://127.0.0.1:1/v1/chat/completions", model: "fixture", rubric: "rubric.yaml" } }));
    const criteria = [{ id: "machine", title: "The patch implements the requested total", required: true, human: false }, ...(human ? [{ id: "human", title: "PERSON_ONLY_PRIVATE_CRITERION", required: true, human: true }] : [])];
    await writeFile(join(repo, "rubric.yaml"), JSON.stringify({ schema_version: "wringer.rubric.v1", title: "Fixture rubric", criteria }));
    const output = ".wringer/runs/fixture";
    const bundle = await new Bundle(join(repo, output)).prepare();
    await bundle.json("manifest.json", { schema_version: "wringer.evidence.v1", run_id: "fixture", started_at: new Date().toISOString(), repo: { root: ".", head_sha: "1".repeat(40), branch: "fixture", dirty: true }, result: { status: passed ? "passed" : "failed", failed_gate: passed ? null : "test" } });
    await bundle.json("gates/001_test/result.json", { gate_id: "test", command: "bun test", exit_code: passed ? 0 : 1, duration_ms: 5, timed_out: false, stdout_truncated: false, stderr_truncated: false, optional: false, status: passed ? "passed" : "failed" });
    await bundle.write("diff.patch", "-return 4;\n+return 5;\n");
    await bundle.write("gates/001_test/stdout.log", "GATE_OUTPUT_MUST_NOT_BE_IN_PACKET");
    await bundle.seal();
    await mkdir(join(repo, ".wringer/loops/fixture/iterations/1"), { recursive: true });
    await writeFile(join(repo, ".wringer/loops/fixture/iterations/1/worker.stdout"), "WORKER_SENTINEL_MUST_NEVER_REACH_JUDGE");
    return { repo, output };
}
const response = (met: boolean | null = true) => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ criteria: [{ id: "machine", met, reason: "The recorded diff makes the requested change." }], note: "Fixture judgement" }) } }] });
test("judge dry run writes frozen request and verdict without invoking transport or worker prose", async () => {
    const { repo, output } = await fixture();
    let calls = 0;
    const result = await judge(repo, { evidenceDir: output, transport: async () => { calls++; return response(); } });
    expect(result.status).toBe("dry-run");
    expect(result.verdict.verdict).toBeNull();
    expect(result.verdict.criteria).toEqual([]);
    expect(calls).toBe(0);
    const request = await readFile(join(repo, result.evidenceDir, "request.json"), "utf8");
    expect(request).not.toContain("WORKER_SENTINEL");
    expect(request).not.toContain("GATE_OUTPUT_MUST_NOT_BE_IN_PACKET");
    expect(request).toContain("return 5");
});
test("judge pass/fail/null outcomes are distinct and malformed reply is never a failure", async () => {
    const { repo, output } = await fixture();
    expect((await judge(repo, { evidenceDir: output, send: true, transport: async () => response(true) })).exit_code).toBe(0);
    expect((await judge(repo, { evidenceDir: output, send: true, transport: async () => response(false) })).exit_code).toBe(1);
    expect((await judge(repo, { evidenceDir: output, send: true, transport: async () => response(null) })).exit_code).toBe(5);
    const invalid = await judge(repo, { evidenceDir: output, send: true, transport: async () => ({ garbage: true }) });
    expect(invalid.status).toBe("needs_human");
    expect(invalid.verdict.criteria).toEqual([]);
    expect(invalid.exit_code).toBe(5);
});
test("human criteria never travel and remain unscored even when the model passes", async () => {
    const { repo, output } = await fixture(true);
    const result = await judge(repo, { evidenceDir: output, send: true, transport: async (request) => { expect(JSON.stringify(request)).not.toContain("PERSON_ONLY_PRIVATE_CRITERION"); return response(); } });
    expect(result.status).toBe("needs_human");
    expect(result.verdict.criteria.find(c => c.id === "human")!.met).toBeNull();
});
test("failed deterministic gates refuse before any request directory or transport", async () => {
    const { repo, output } = await fixture(false, false);
    let calls = 0;
    try {
        await judge(repo, { evidenceDir: output, send: true, transport: async () => { calls++; return response(); } });
        throw new Error("Expected refusal");
    }
    catch (error) {
        expect(error).toBeInstanceOf(WorkflowError);
        expect((error as WorkflowError).stop.reason).toBe("judge-gates-not-passed");
    }
    expect(calls).toBe(0);
    expect(await Bun.file(join(repo, ".wringer/verdicts")).exists()).toBe(false);
});
test("Messages adapter emits native body and normalizes native stop and usage", () => {
    const prepared = prepareRequest("https://example.test/v1/messages", { model: "declared-model", max_tokens: 1234, temperature: 0, messages: [{ role: "system", content: "system words" }, { role: "user", content: "user words" }] });
    expect(prepared.body).toEqual({ model: "declared-model", max_tokens: 1234, system: "system words", messages: [{ role: "user", content: "user words" }] });
    expect(prepared.keyHeader).toBe("x-api-key");
    expect(prepared.headers["anthropic-version"]).toBe("2023-06-01");
    expect(normalizeResponse({ content: [{ type: "text", text: "answer" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 4 } })).toEqual({ choices: [{ finish_reason: "stop", message: { content: "answer" } }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } });
});
test("pre-aborted draft never invokes transport and writes a durable recovery command", async () => {
    const repo = await mkdtemp(join(tmpdir(), "wringer-abort-"));
    await writeFile(join(repo, "PRD.md"), "Implement one requirement.");
    let calls = 0;
    try {
        await draftSpec({ repo, prdPath: "PRD.md", endpoint: "http://127.0.0.1:1/v1/messages", model: "fixture", send: true, signal: AbortSignal.abort(), transport: async () => { calls++; return {}; } });
        throw new Error("Expected stop");
    }
    catch (error) {
        expect(error).toBeInstanceOf(WorkflowError);
        expect((error as WorkflowError).stop.reason).toBe("interrupted");
        expect((error as WorkflowError).stop.next_move).toContain("wringer-drive resume");
    }
    expect(calls).toBe(0);
});
