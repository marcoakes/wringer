import { expect, test } from "bun:test";
import * as graph from "../src/graph";
import { hashValue } from "../src";
import { delegateFixture, prosecutorPlan, tournamentFixture } from "./graph-fixtures";

const compile = (input: unknown) => graph.compileContainedGraph(input);
const changed = (edit: (value: any) => void) => { const value = structuredClone(delegateFixture()); edit(value); return value; };

test("a version 4 graph pins an external peer and owns the returned candidate at the delegate", () => {
    const input = delegateFixture(), before = structuredClone(input), plan = compile(input);
    expect(input).toEqual(before);
    expect(plan.schema_version).toBe("wringer.contained-graph-plan.v4");
    const { sha256, ...body } = plan; expect(sha256).toBe(hashValue(body)); expect(graph.validateContainedGraph(plan)).toEqual(plan);
    expect(graph.graphCandidateOwner(plan, "ship")).toBe("ask"); expect(graph.graphCandidateOwner(plan, "verify")).toBe("ask");
    expect(graph.graphOutcomes("delegate")).toEqual(["returned", "failed", "canceled", "unavailable"]);
    expect(graph.graphReservation(plan, "ask")).toEqual({ roleSessions: 1, verificationAttempts: 0 });
});
test("a loopback peer is accepted for local fixtures; earlier versions keep their meaning", () => {
    expect(compile(changed(v => { v.nodes.ask.peer.url = "http://127.0.0.1:4567/a2a"; })).nodes.ask!.kind).toBe("delegate");
    expect(compile(tournamentFixture()).schema_version).toBe("wringer.contained-graph-plan.v3");
    expect(compile({ ...tournamentFixture(), version: 4 }).schema_version).toBe("wringer.contained-graph-plan.v4");
});
const refusals: [string, (value: any) => void, string][] = [
    ["a delegate in a version 3 graph", v => { v.version = 3; }, "version 4"],
    ["a plain HTTP peer", v => { v.nodes.ask.peer.url = "http://agents.example.test/a2a"; }, "HTTPS"],
    ["a peer URL carrying credentials", v => { v.nodes.ask.peer.url = "https://user:secret@agents.example.test/a2a"; }, "credential-free"],
    ["a peer without a pinned card", v => { v.nodes.ask.peer.cardSha256 = "latest"; }, "Agent Card"],
    ["a verification plan on another source", v => { v.nodes.ask.verify = prosecutorPlan("b".repeat(40)); }, "same root source"],
    ["an unbounded timeout", v => { v.nodes.ask.timeoutSeconds = 100000; }, "at most 86400"],
    ["a hold that reads the returned candidate before a check", v => { v.nodes.review.input = "ask"; v.nodes.ask.then = "review"; delete v.nodes.verify; delete v.nodes.route; v.required = ["ask", "review", "ship"]; v.budget.maxVerificationAttempts = 0; }, "before a check verifies it"],
    ["a delivery that reads the returned candidate before a check", v => { v.nodes.ship.input = "ask"; v.nodes.ask.then = "ship"; delete v.nodes.verify; delete v.nodes.route; delete v.nodes.review; v.required = ["ask", "ship"]; v.budget.maxVerificationAttempts = 0; }, "before a check verifies it"],
    ["too little allowance for the external task", v => { v.budget.maxRoleSessions = 0; }, "role allowance"],
];
for (const [name, edit, message] of refusals) test(`refuses ${name}`, () => { expect(() => compile(changed(edit))).toThrow(message); });
test("refuses a delegate inside a branch", () => {
    const raw: any = structuredClone(tournamentFixture()); raw.version = 4;
    raw.nodes["build-a"] = { kind: "delegate", input: "split", peer: { url: "https://agents.example.test/a2a", cardSha256: "c".repeat(64), skill: "repair" }, instruction: "Try.", verify: raw.nodes["build-b"].plan, timeoutSeconds: 60, then: "pick" };
    expect(() => compile(raw)).toThrow("cannot run inside branch");
});
