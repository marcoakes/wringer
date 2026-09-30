import { expect, test } from "bun:test";
import * as graph from "../src/graph";
import { hashValue } from "../src";
import { graphFixture, parallelFixture } from "./graph-fixtures";

const compile = (input: unknown) => graph.compileContainedGraph(input);
const changed = (edit: (value: any) => void) => { const value = structuredClone(parallelFixture()); edit(value); return value; };

test("a parallel graph compiles private branch regions, a candidate-owning join and one ceiling", () => {
    const input = parallelFixture(), before = structuredClone(input), plan = compile(input);
    expect(input).toEqual(before);
    expect(plan.schema_version).toBe("wringer.contained-graph-plan.v2"); expect(plan.parallelism).toBe(2);
    const { sha256, ...body } = plan; expect(sha256).toBe(hashValue(body));
    expect(graph.validateContainedGraph(plan)).toEqual(plan);
    expect(graph.graphCandidateOwner(plan, "ship")).toBe("merge");
    expect(graph.graphCandidateOwner(plan, "build-a")).toBe("build-a");
    expect(graph.graphReservation(plan, "merge")).toEqual({ roleSessions: 0, verificationAttempts: 2 });
    expect(graph.graphReservation(plan, "split")).toEqual({ roleSessions: 0, verificationAttempts: 0 });
    expect(graph.graphRegions(plan)).toEqual({ split: { "build-a": ["build-a"], "build-b": ["build-b"] } });
    expect(graph.graphOutcomes("join")).toEqual(["integrated", "failed", "conflict", "unavailable"]);
});
test("a serial version 1 graph keeps its exact bytes and has no parallelism field", () => {
    const plan = compile(graphFixture());
    expect(plan.schema_version).toBe("wringer.contained-graph-plan.v1"); expect("parallelism" in plan).toBe(false);
    expect(() => compile({ ...graphFixture(), parallelism: 2 })).toThrow("unknown");
});
const withCheck = (v: any) => { v.nodes["build-a"].then = "check-a"; v.nodes["check-a"] = { kind: "check", input: "build-a", then: "merge" }; v.budget.maxVerificationAttempts++; };
const refusals: [string, (value: any) => void, string][] = [
    ["an unknown declaration version", v => v.version = 4, "version"],
    ["missing parallelism", v => delete v.parallelism, "missing parallelism"],
    ["unbounded parallelism", v => v.parallelism = 9, "parallelism"],
    ["a fork with one branch", v => { v.nodes.split.branches = ["build-a"]; delete v.nodes["build-b"]; v.required = v.required.filter((id: string) => id !== "build-b"); v.budget.maxRoleSessions /= 2; }, "branches"],
    ["a duplicate branch", v => v.nodes.split.branches = ["build-a", "build-a"], "duplicate"],
    ["a branch entry not fed by its fork", v => v.nodes["build-b"].input = "root", "fork"],
    ["a join naming another fork", v => v.nodes.merge.fork = "review", "fork"],
    ["a fork naming a non-join", v => v.nodes.split.join = "review", "join"],
    ["a branch that finishes the graph", v => v.nodes["build-b"].then = "done", "join"],
    ["branches sharing a node", v => { withCheck(v); v.nodes["build-b"].then = "check-a"; }, "share"],
    ["a branch reached from outside", v => { withCheck(v); v.entry = "pre"; v.nodes.pre = { kind: "loop", input: "root", plan: v.nodes["build-a"].plan, then: "gate" }; v.nodes.gate = { kind: "router", input: "pre", routes: [{ outcome: "ready", to: "split" }], otherwise: "check-a" }; v.nodes.split.input = "pre"; v.budget.maxRoleSessions *= 2; v.budget.maxVerificationAttempts *= 2; }, "outside"],
    ["a nested fork", v => { const plan = v.nodes["build-a"].plan; v.nodes["build-a"].then = "inner"; Object.assign(v.nodes, { inner: { kind: "fork", input: "build-a", branches: ["x", "y"], join: "inner-join" }, x: { kind: "loop", input: "inner", plan, then: "inner-join" }, y: { kind: "loop", input: "inner", plan, then: "inner-join" }, "inner-join": { kind: "join", fork: "inner", then: "merge" } }); v.budget.maxRoleSessions *= 3; v.budget.maxVerificationAttempts *= 3; }, "nested"],
    ["a delivery inside a branch", v => { v.nodes["build-a"].then = "early"; v.nodes.early = { kind: "delivery", input: "build-a", publication: { remote: "https://example.test/r.git", sourceBranch: "wringer/early", targetBranch: "main" }, then: "merge" }; }, "delivery"],
    ["a branch without its own candidate", v => { v.nodes["build-b"] = { kind: "human-hold", input: "split", prompt: "No work.", then: "merge" }; v.budget.maxRoleSessions /= 2; }, "own candidate"],
    ["a later node reading a branch", v => v.nodes.review.input = "build-a", "join"],
    ["a branch node reading before its fork", v => { withCheck(v); v.entry = "pre"; v.nodes.pre = { kind: "loop", input: "root", plan: v.nodes["build-a"].plan, then: "split" }; v.nodes.split.input = "pre"; v.nodes["check-a"].input = "pre"; v.budget.maxRoleSessions *= 2; v.budget.maxVerificationAttempts *= 2; }, "reads outside its branch"],
    ["a router over a fork", v => { withCheck(v); v.nodes["build-a"].then = "pick"; v.nodes.pick = { kind: "router", input: "split", routes: [{ outcome: "forked", to: "check-a" }], otherwise: "fail" }; }, "router"],
    ["a check repeating its join", v => { v.nodes.merge.then = "again"; v.nodes.again = { kind: "check", input: "merge", then: "review" }; v.budget.maxVerificationAttempts++; }, "repeats its join"],
    ["too little allowance for integration checks", v => v.budget.maxVerificationAttempts -= 1, "verification"],
    ["a required branch node bypassed", v => { withCheck(v); v.nodes["build-a"].then = "route-a"; v.nodes["route-a"] = { kind: "router", input: "build-a", routes: [{ outcome: "ready", to: "check-a" }], otherwise: "merge" }; v.required.push("check-a"); }, "bypasses"],
];
for (const [name, edit, reason] of refusals) test(`a parallel graph refuses ${name} before effects`, () => expect(() => compile(changed(edit))).toThrow(new RegExp(reason, "i")));
test("a join may route its typed outcome into a repair loop that owns the next candidate", () => {
    const plan = compile(changed(v => { v.nodes.merge.then = "after"; v.nodes.after = { kind: "router", input: "merge", routes: [{ outcome: "integrated", to: "review" }, { outcome: "failed", to: "repair" }], otherwise: "fail" }; v.nodes.repair = { kind: "loop", input: "merge", plan: v.nodes["build-a"].plan, then: "review" }; v.nodes.review.input = "merge"; v.budget.maxRoleSessions += v.nodes["build-a"].plan.budget.max_sessions; v.budget.maxVerificationAttempts += v.nodes["build-a"].plan.budget.max_sessions + 1; }));
    expect(graph.graphCandidateOwner(plan, "repair")).toBe("repair");
});
test("a branch may reach its join through a router over its own loop", () => {
    const plan = compile(changed(v => { v.nodes["build-a"].then = "route-a"; v.nodes["route-a"] = { kind: "router", input: "build-a", routes: [{ outcome: "ready", to: "merge" }], otherwise: "fail" }; }));
    expect(graph.graphRegions(plan).split!["build-a"]).toEqual(["build-a", "route-a"]);
});
