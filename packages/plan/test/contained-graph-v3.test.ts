import { expect, test } from "bun:test";
import * as graph from "../src/graph";
import { hashValue } from "../src";
import { parallelFixture, prosecutorPlan, tournamentFixture } from "./graph-fixtures";

const compile = (input: unknown) => graph.compileContainedGraph(input);
const changed = (edit: (value: any) => void) => { const value = structuredClone(tournamentFixture()); edit(value); return value; };

test("a version 3 graph closes a fork with a tournament that owns the selected candidate", () => {
    const input = tournamentFixture(), before = structuredClone(input), plan = compile(input);
    expect(input).toEqual(before);
    expect(plan.schema_version).toBe("wringer.contained-graph-plan.v3"); expect(plan.parallelism).toBe(3);
    const { sha256, ...body } = plan; expect(sha256).toBe(hashValue(body));
    expect(graph.validateContainedGraph(plan)).toEqual(plan);
    expect(graph.graphCandidateOwner(plan, "ship")).toBe("pick");
    expect(graph.graphInput(plan.nodes.pick!)).toBeNull();
    expect(graph.graphOutcomes("tournament")).toEqual(["selected", "no-winner", "unavailable"]);
    // One prosecutor session; one control validation, and a challenge run and a final evaluation per candidate.
    expect(graph.graphReservation(plan, "pick")).toEqual({ roleSessions: 1, verificationAttempts: 1 + 2 * 3 });
    expect(graph.graphRegions(plan)).toEqual({ split: { "build-a": ["build-a"], "build-b": ["build-b"], "build-c": ["build-c"] } });
});
test("version 1 and 2 graphs are unchanged and a tournament needs version 3", () => {
    expect(compile(parallelFixture()).schema_version).toBe("wringer.contained-graph-plan.v2");
    expect(() => compile({ ...tournamentFixture(), version: 2 })).toThrow("version 3");
});
test("a tournament can route no-winner to a hold instead of failing", () => {
    const plan = compile(changed(v => { v.nodes.pick.then = "after"; v.nodes.after = { kind: "router", input: "pick", routes: [{ outcome: "selected", to: "review" }, { outcome: "no-winner", to: "decide" }], otherwise: "fail" }; v.nodes.decide = { kind: "human-hold", input: "root", prompt: "No candidate survived.", then: "fail" }; }));
    expect(plan.nodes.after!.kind).toBe("router");
});
const refusals: [string, (value: any) => void, string][] = [
    ["a prosecutor that may write a candidate file", v => { v.nodes.pick.prosecutor.plan = v.nodes["build-a"].plan; }, "may write only"],
    ["a prosecutor pinned to another source", v => { v.nodes.pick.prosecutor.plan = prosecutorPlan("b".repeat(40)); }, "same root source"],
    ["too many challenges", v => { v.nodes.pick.prosecutor.maxChallenges = 17; }, "at most 16"],
    ["too many controls", v => { v.nodes.pick.controls = ["a", "b", "c", "d", "e"].map(id => ({ id: `control-${id}`, commit: id.repeat(40) })); }, "at most 4"],
    ["a control that is not an exact commit", v => { v.nodes.pick.controls[0].commit = "main"; }, "exact commit"],
    ["a duplicate control", v => { v.nodes.pick.controls.push({ ...v.nodes.pick.controls[0] }); }, "duplicate"],
    ["no final evaluator", v => { v.nodes.pick.evaluator = []; }, "1–8"],
    ["an evaluator file outside the tree", v => { v.nodes.pick.evaluator[0].files[0].path = "../hidden.sh"; }, "safe relative"],
    ["an evaluator path pinned two ways", v => { v.nodes.pick.evaluator.push({ ...v.nodes.pick.evaluator[0], id: "other", files: [{ path: "evaluator/hidden.sh", content: "exit 1\n" }] }); }, "two different contents"],
    ["an unbounded evaluator timeout", v => { v.nodes.pick.evaluator[0].timeout_seconds = 4000; }, "at most 3600"],
    ["an undeclared tie rule", v => { v.nodes.pick.tie = "random"; }, "no-winner or tree-order"],
    ["a required tournament branch", v => { v.required.push("build-a"); }, "cannot be required"],
    ["a check after a tournament", v => { v.nodes.pick.then = "recheck"; v.nodes.recheck = { kind: "check", input: "pick", then: "review" }; v.nodes.review.input = "recheck"; v.budget.maxVerificationAttempts++; }, "cannot follow a tournament"],
    ["a tournament closing another fork", v => { v.nodes.pick.fork = "review"; }, "must name"],
    ["too little allowance for the prosecutor", v => { v.budget.maxRoleSessions -= 1; }, "role allowance"],
    ["too little allowance for the challenge runs", v => { v.budget.maxVerificationAttempts -= 1; }, "verification allowance"],
];
for (const [name, edit, message] of refusals) test(`refuses ${name}`, () => { expect(() => compile(changed(edit))).toThrow(message); });
