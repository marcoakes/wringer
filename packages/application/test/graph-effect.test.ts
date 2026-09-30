/** One driver operation for an external controller, bound to the retained history's
 * durable marker and started at most once per marker. Deterministic driver only. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileContainedGraph, compileDeclaration, compileExecutionPlan, createGraphAuthority, hashValue } from "@wringer/plan";
import { advanceContainedGraph, decideContainedGraph, initializeContainedGraph, readContainedGraph, sendContainedGraph, type GraphDriver, type GraphObservation, type GraphState } from "@wringer/scheduler";
import { runGraphEffect } from "../src/graph-effect";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const template = compileExecutionPlan(await Bun.file(new URL("../../plan/examples/contained.yaml", import.meta.url)).text(), { format: "yaml" });
function declaration() {
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = template;
    const plan = compileDeclaration({ version: 3, ...raw, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === "check") } });
    return { version: 1, id: "serial", repository: plan.repository, entry: "build", required: ["build", "check", "review", "ship"],
        budget: { maxRoleSessions: plan.budget.max_sessions, maxVerificationAttempts: plan.budget.max_sessions + 2, wallClockSeconds: 3600 },
        nodes: { build: { kind: "loop", input: "root", plan, then: "check" }, check: { kind: "check", input: "build", then: "review" },
            review: { kind: "human-hold", input: "check", prompt: "Inspect this exact candidate.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: "https://example.test/repo.git", sourceBranch: "wringer/serial", targetBranch: "main" }, then: "done" } } };
}
/** A driver that records every call; the kernel's own driver never runs effects here. */
function recorder(plan: any) {
    const calls: string[] = [], observed = new Map<string, GraphObservation>();
    const candidate = { source: { ...plan.repository, commit: "b".repeat(40) }, tree: "c".repeat(40), owner: "build" };
    const driver: GraphDriver = {
        async preflight(request, operation) { calls.push(`preflight-${operation}:${request.node}`); },
        async dispatch(request) {
            calls.push(`dispatch:${request.node}`);
            const kind = plan.nodes[request.node].kind;
            observed.set(request.node, kind === "delivery" ? { kind: "prepared", candidate, evidenceSha256: hashValue("prepared") } : { kind: "complete", outcome: kind === "loop" ? "ready" : "passed", candidate, evidenceSha256: hashValue(request.node) });
        },
        async observe(request) { calls.push(`observe:${request.node}`); return observed.get(request.node) ?? null; },
        async send(request) { calls.push(`send:${request.node}`); observed.set(request.node, { kind: "complete", outcome: "delivered", candidate, evidenceSha256: hashValue("sent") }); },
    };
    return { calls, driver, observed };
}
/** Durable markers without results: the controller that wrote them stops before the effect. */
const markerOnly = (inner: GraphDriver): GraphDriver => ({ preflight: inner.preflight, dispatch: async () => { throw new Error("controller stopped after the marker"); }, observe: async () => null, send: async () => { throw new Error("controller stopped after the Send marker"); } });
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), "wringer-graph-effect-")); directories.push(dir);
    const plan = compileContainedGraph(structuredClone(declaration())), authority = createGraphAuthority(plan, { actor: "Scripted engineering fixture", expiresAt: new Date(Date.now() + 3600000).toISOString() });
    await initializeContainedGraph(dir, plan, authority);
    return { dir, plan, ...recorder(plan) };
}
const decision = (state: GraphState) => ({ node: state.cursor, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[state.cursor]!.reservation.input), choice: "continue" as const, actor: "Scripted engineering fixture", note: "Fixture checkpoint, not independent human acceptance." });

test("a preflight needs a reserved node without its marker", async () => {
    const f = await fixture();
    await expect(runGraphEffect(f.dir, "preflight-dispatch", "build", { driver: f.driver })).rejects.toThrow("build has no reservation");
    await expect(advanceContainedGraph(f.dir, markerOnly(f.driver))).rejects.toThrow("controller stopped after the marker");
    await expect(runGraphEffect(f.dir, "preflight-dispatch", "build", { driver: f.driver })).rejects.toThrow("already has a dispatch marker");
    expect(f.calls).toEqual(["preflight-dispatch:build"]);
});
test("a dispatch runs only for a durable marker, once, and never after a result", async () => {
    const f = await fixture();
    // A refused preflight leaves the node reserved without its marker: no dispatch may run.
    await expect(advanceContainedGraph(f.dir, { ...f.driver, preflight: async () => { throw new Error("runtime absent"); } })).rejects.toThrow("runtime absent");
    expect((await readContainedGraph(f.dir)).nodes.build!.dispatched).toBe(false);
    await expect(runGraphEffect(f.dir, "dispatch", "build", { driver: f.driver })).rejects.toThrow("no durable dispatch marker");
    expect(f.calls.filter(call => call.startsWith("dispatch:"))).toEqual([]);
    await expect(advanceContainedGraph(f.dir, markerOnly(f.driver))).rejects.toThrow("controller stopped after the marker");
    const outcome = await runGraphEffect(f.dir, "dispatch", "build", { driver: f.driver });
    expect(outcome.revision).toBe((await readContainedGraph(f.dir)).revision);
    await expect(runGraphEffect(f.dir, "dispatch", "build", { driver: f.driver })).rejects.toThrow("already started for this marker; it is never started twice");
    expect(f.calls.filter(call => call === "dispatch:build")).toHaveLength(1);
    expect((await runGraphEffect(f.dir, "observe", "build", { driver: f.driver })).observation).toMatchObject({ kind: "complete", outcome: "ready" });
    await advanceContainedGraph(f.dir, f.driver);
    await expect(runGraphEffect(f.dir, "dispatch", "build", { driver: f.driver })).rejects.toThrow("no durable dispatch marker without a result");
    expect(JSON.parse(await readFile(join(f.dir, ".wringer/graph-effects/build.dispatch.json"), "utf8"))).toMatchObject({ node: "build", kind: "dispatch" });
});
test("a Send runs only for its durable Send marker, once", async () => {
    const f = await fixture();
    const held = await advanceContainedGraph(f.dir, f.driver);
    await decideContainedGraph(f.dir, decision(held));
    const ready = await advanceContainedGraph(f.dir, f.driver);
    expect(ready.phase).toBe("send-hold");
    await expect(runGraphEffect(f.dir, "send", "ship", { driver: f.driver })).rejects.toThrow("no durable Send marker");
    expect(await runGraphEffect(f.dir, "preflight-send", "ship", { driver: f.driver })).toMatchObject({ operation: "preflight-send" });
    const send = { node: "ship", expectedRevision: ready.revision, preparedSha256: hashValue(ready.nodes.ship!.prepared), actor: "Scripted engineering fixture", note: "Explicit fixture Send." };
    await expect(sendContainedGraph(f.dir, send, markerOnly(f.driver))).rejects.toThrow("controller stopped after the Send marker");
    await runGraphEffect(f.dir, "send", "ship", { driver: f.driver });
    await expect(runGraphEffect(f.dir, "send", "ship", { driver: f.driver })).rejects.toThrow("already started for this marker");
    expect(f.calls.filter(call => call === "send:ship")).toHaveLength(1);
});
test("an edited history is refused before any effect runs", async () => {
    const f = await fixture();
    await expect(advanceContainedGraph(f.dir, markerOnly(f.driver))).rejects.toThrow("controller stopped after the marker");
    const path = join(f.dir, "events/0002.json"), event = JSON.parse(await readFile(path, "utf8"));
    event.at = "2026-01-01T00:00:00.000Z"; await writeFile(path, JSON.stringify(event));
    const before = [...f.calls];
    await expect(runGraphEffect(f.dir, "dispatch", "build", { driver: f.driver })).rejects.toThrow("digest changed");
    expect(f.calls).toEqual(before);
});
