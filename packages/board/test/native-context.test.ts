import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveFacts, deriveNextAction, deriveRail, loadBoard, renderHtml, renderMarkdown } from "../src";
const scratch = await mkdtemp(join(tmpdir(), "wringer-native-board-"));
afterAll(() => rm(scratch, { recursive: true, force: true }));
const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${stable(value)}`).join(",")}}` : JSON.stringify(v);
const hash = (v: any) => createHash("sha256").update(typeof v === "string" ? v : stable(v)).digest("hex");
let serial = 0;
async function fixture() {
    const repo = join(scratch, String(++serial));
    const selected = ".wringer/runs/later-verify", buildRun = ".wringer/runs/build-run", journey = "journey-one";
    const put = async (path: string, data: unknown) => { const target = join(repo, path); await mkdir(join(target, ".."), { recursive: true }); await Bun.write(target, typeof data === "string" ? data : JSON.stringify(data)); };
    const spec = { schema_version: "wringer.spec.v1", approved: true, title: "Native context", intent: "A person sees the enabled feature.", criteria: [{ id: "clear", title: "A person sees the enabled feature", required: true, human: true }], tasks: [{ id: "build", objective: "Enable the feature", brief: "brief.md" }] };
    const manifest = { schema_version: "wringer.evidence.v1", run_id: "later-verify", started_at: "2026-09-06T12:00:00Z", repo: { root: ".", head_sha: "a".repeat(40), branch: "main", dirty: true }, result: { status: "passed", failed_gate: null } };
    await put(`${selected}/manifest.json`, manifest);
    await put(`${selected}/wringer.spec.yaml`, spec);
    await put(`${selected}/wringer.sources.yaml`, { schema_version: "wringer.sources.v1", sources: { clear: spec.intent } });
    await put(`${selected}/gates/001_check/result.json`, { gate_id: "check", command: "node check.mjs", exit_code: 0, duration_ms: 1, timed_out: false, stdout_truncated: false, stderr_truncated: false, optional: false, status: "passed" });
    await put(`${selected}/acceptance.json`, { schema_version: "wringer.acceptance.v3", counts: { evidenced: 0, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 1 }, criteria: [{ criterion: "clear", title: spec.criteria[0]!.title, required: true, state: "human", gate: null, command: null, receipt: null, reason: "A person decides", refuses: false, witness: null, cause: null, demonstrated_able_to_fail: null, judgement: { verdict: "met", by: "Fixture operator", at: "2026-09-06T11:59:59Z", stale: false, note: "The fixture clearly displays the feature." } }], limits: ["One", "Two", "Three", "Four"] });
    await cp(join(repo, selected), join(repo, buildRun), { recursive: true });
    await put(`${buildRun}/manifest.json`, { ...manifest, run_id: "build-run", started_at: "2026-09-06T11:59:50Z" });
    const source = `.wringer/workflow/sources/${hash(spec.intent)}.md`;
    await put(source, spec.intent);
    const events: any[] = [{ type: "draft-readiness", source }];
    const attempts: string[] = [];
    for (const section of ["requirements", "decisions", "tasks"]) {
        const attempt = `.wringer/workflow/drafts/${"f".repeat(64)}/${section}-${"b".repeat(24)}/001`;
        const request = { messages: [{ role: "user", content: spec.intent }] };
        const response = { choices: [], usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 } };
        await put(`${attempt}/request.json`, request);
        await put(`${attempt}/response.json`, response);
        await put(`${attempt}/receipt.json`, { schema_version: "wringer.draft-call.v1", section, request_sha256: hash(request), response_sha256: hash(response), status: "complete", usage: { prompt: 40, completion: 20, total: 60 } });
        events.push({ type: "draft-call", section, request: `${attempt}/request.json` });
        attempts.push(attempt);
    }
    events.push({ type: "draft-finished", calls: 3 });
    events.push({ type: "build-finished", status: "passed", runId: "build-run", evidenceDir: buildRun });
    const writeJourney = async () => {
        let previous: string | null = null;
        const lines = events.map((event, i) => { const line = JSON.stringify({ ...event, at: "2026-09-06T11:59:50Z", sequence: i + 1, previous_sha256: previous }); previous = hash(line); return line; });
        await put(`.wringer/workflow/journeys/${journey}/events.jsonl`, lines.join("\n") + "\n");
        await put(`.wringer/workflow/journeys/${journey}/journey.json`, { schema_version: "wringer.workflow-journey.v1", id: journey, started_at: "2026-09-06T11:59:00Z", events: lines.length, last_event_hash: previous, build: { status: "finished", result: { status: "passed", runId: "build-run", evidenceDir: buildRun } } });
    };
    await writeJourney();
    return { repo, selected, buildRun, journey, attempts, events, spec, put, writeJourney };
}
test("native request receipts report 3 calls and 180 tokens while independent verification keeps honest build context", async () => {
    const f = await fixture(), model = await loadBoard(f.repo, f.selected);
    expect(model.usage[0]).toMatchObject({ calls: 3, tokens: 180, cost: null });
    expect(model.usage[0]!.basis).toContain("not independently verified");
    expect(model.facts.built).toBeNull();
    expect(model.buildContext?.runId).toBe("build-run");
    expect(model.rail[0]!.detail).toContain("A build completed in journey");
    expect(model.rail[0]!.detail).toContain("unchanged build lineage is not established");
    expect(renderMarkdown(model)).toContain("180 tokens; 3 recorded call(s)");
    expect(renderHtml(model)).toContain("180 tokens");
    expect(model.facts.readyToDeliver).toBe(true);
});
test("redacted request bytes limit request identity without discarding matching response usage", async () => {
    const f = await fixture();
    await f.put(`${f.attempts[0]}/request.json`, { messages: [{ role: "user", content: "[REDACTED]" }] });
    const model = await loadBoard(f.repo, f.selected);
    expect(model.usage[0]!.tokens).toBe(180);
    expect(model.usage[0]!.basis).toContain("1 stored request hash(es) differ");
});
test("uncertain, missing, inconsistent and tampered responses do not become zero or a complete usage total", async () => {
    for (const scenario of ["uncertain", "missing", "tampered", "invented-usage"]) {
        const f = await fixture(), path = `${f.attempts[0]}/receipt.json`;
        const receipt = await Bun.file(join(f.repo, path)).json();
        if (scenario === "uncertain")
            await f.put(path, { ...receipt, status: "uncertain" });
        if (scenario === "missing")
            await rm(join(f.repo, path));
        if (scenario === "tampered")
            await f.put(`${f.attempts[0]}/response.json`, { usage: { total_tokens: 1 } });
        if (scenario === "invented-usage")
            await f.put(path, { ...receipt, usage: { prompt: 40, completion: 20, total: 1 } });
        const model = await loadBoard(f.repo, f.selected);
        expect(model.usage[0]).toMatchObject({ calls: 3, tokens: null, cost: null });
        expect(model.usage[0]!.basis).toContain("120 tokens are reported by the remaining receipts, not a complete total");
        expect(model.facts.readyToDeliver).toBe(true);
    }
});
test("a tampered journey, unrelated frozen spec or escaped receipt path never supplies trustworthy attribution", async () => {
    for (const scenario of ["chain", "spec", "path"]) {
        const f = await fixture();
        if (scenario === "chain")
            await f.put(`.wringer/workflow/journeys/${f.journey}/events.jsonl`, "{}\n");
        if (scenario === "spec")
            await f.put(`${f.buildRun}/wringer.spec.yaml`, { ...f.spec, intent: "Unrelated work." });
        if (scenario === "path") {
            f.events[1].request = "../../outside/request.json";
            await f.writeJourney();
        }
        const model = await loadBoard(f.repo, f.selected);
        expect(model.usage[0]!.tokens).toBeNull();
        expect(model.facts.built).toBeNull();
        if (scenario !== "path")
            expect(model.buildContext).toBeUndefined();
    }
});
test("publication replaces preview action and both shared views distinguish base, source and publication commits", async () => {
    const f = await fixture(), model = await loadBoard(f.repo, f.selected);
    expect(model.nextAction.command).toBe("wring deliver");
    model.delivery = { id: "delivery-real-id", mode: "live", commit: "b".repeat(40), pushed: true };
    model.facts = deriveFacts({ ...model, built: model.facts.built });
    model.rail = deriveRail(model.facts);
    model.nextAction = deriveNextAction(model);
    expect(model.nextAction.command).toBe("wring audit --delivery 'delivery-real-id' --repo .\nwring verify --falsify --delivery 'delivery-real-id' --repo .");
    expect(model.nextAction.description).toContain("root of a fresh clone");
    for (const output of [renderMarkdown(model), renderHtml(model)]) {
        expect(output).toContain("Verification base commit");
        expect(output).toContain("Source change commit");
        expect(output).toContain("Evidence publication commit");
        expect(output).toContain("a".repeat(40));
        expect(output).toContain("b".repeat(40));
        expect(output).not.toContain("evidence is ready for a delivery preview");
    }
});
