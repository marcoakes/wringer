import { expect, test } from "bun:test";
import * as graph from "../src/graph";
import { compileDeclaration, compileExecutionPlan, hashValue } from "../src";

export function graphFixture() {
    const parsed = compileExecutionPlan(template, { format: "yaml" });
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = parsed;
    const plan = compileDeclaration({ version: 3, ...raw, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === "check") } });
    return { version: 1, id: "serial-repair", repository: plan.repository, entry: "scope", required: ["build", "verify", "review", "ship"],
        budget: { maxRoleSessions: plan.budget.max_sessions, maxVerificationAttempts: plan.budget.max_sessions + 2, wallClockSeconds: 600 },
        nodes: { scope: { kind: "human-hold", input: "root", prompt: "Review this exact scope before work.", then: "build" },
            build: { kind: "loop", input: "root", plan, then: "verify" },
            verify: { kind: "check", input: "build", then: "route" },
            route: { kind: "router", input: "verify", routes: [{ outcome: "passed", to: "review" }], otherwise: "fail" },
            review: { kind: "human-hold", input: "verify", prompt: "Inspect the exact candidate and evidence.", then: "ship" },
            ship: { kind: "delivery", input: "review", publication: { remote: "https://example.test/repository.git", sourceBranch: "wringer/serial-repair", targetBranch: "main" }, then: "done" } } };
}
const template = await Bun.file(new URL("../examples/contained.yaml", import.meta.url)).text();
const compile = (input: unknown) => graph.compileContainedGraph(input);
const changed = (edit: (value: any) => void) => { const value = structuredClone(graphFixture()); edit(value); return value; };

test("serial graph compiles pinned leaves and typed source dependencies without mutating inputs", () => {
    const input = graphFixture(), before = structuredClone(input), plan = compile(input);
    expect(input).toEqual(before);
    expect(plan.schema_version).toBe("wringer.contained-graph-plan.v1");
    const { sha256, ...body } = plan; expect(sha256).toBe(hashValue(body));
    expect(graph.validateContainedGraph(plan)).toEqual(plan);
    expect(Object.isFrozen(plan.nodes.build)).toBe(true);
    expect(graph.graphCandidateOwner(plan, "ship")).toBe("build");
    expect(graph.graphReservation(plan, "build")).toEqual({ roleSessions: input.nodes.build.plan.budget.max_sessions, verificationAttempts: input.nodes.build.plan.budget.max_sessions + 1 });
    expect(graph.graphReservation(plan, "verify")).toEqual({ roleSessions: 0, verificationAttempts: 1 });
});

const refusals: [string, (value: any) => void, string][] = [
    ["legacy version", v => v.version = 2, "version"],
    ["unknown host command", v => v.nodes.build.command = "touch outside", "unknown"],
    ["unsafe node identity", v => { v.nodes["../worker"] = v.nodes.build; delete v.nodes.build; }, "node id"],
    ["uppercase node identity", v => { v.nodes.Build = v.nodes.build; delete v.nodes.build; v.nodes.scope.then = "Build"; v.nodes.verify.input = "Build"; v.required = v.required.map((id: string) => id === "build" ? "Build" : id); }, "invalid"],
    ["missing edge", v => v.nodes.verify.then = "missing", "edge"],
    ["cycle", v => v.nodes.verify.then = "build", "cycle"],
    ["unreachable node", v => v.nodes.orphan = { kind: "human-hold", input: "root", prompt: "No path", then: "fail" }, "unreachable"],
    ["wrong entry", v => v.entry = "build", "entry"],
    ["forward source", v => v.nodes.build.input = "verify", "available"],
    ["noncandidate check", v => { v.nodes.verify.input = "scope"; v.nodes.review.input = "build"; }, "candidate"],
    ["noncandidate human input", v => { v.nodes.review.input = "route"; v.nodes.review.then = "done"; delete v.nodes.ship; v.required = v.required.filter((id: string) => id !== "ship"); }, "candidate"],
    ["router source type", v => v.nodes.route.input = "root", "outcome"],
    ["unknown branch outcome", v => v.nodes.route.routes[0].outcome = "model-says-yes", "outcome"],
    ["duplicate branch outcome", v => v.nodes.route.routes.push(v.nodes.route.routes[0]), "duplicate"],
    ["path bypasses required check", v => v.nodes.build.then = "done", "unreachable"],
    ["reachable path bypasses required review", v => v.nodes.route.otherwise = "done", "bypasses"],
    ["missing required identity", v => v.required.push("missing"), "required"],
    ["duplicate required identity", v => v.required.push("build"), "duplicate"],
    ["required router", v => v.required.push("route"), "required"],
    ["insufficient aggregate roles", v => v.budget.maxRoleSessions--, "role"],
    ["insufficient aggregate verifiers", v => v.budget.maxVerificationAttempts--, "verification"],
    ["unbounded wall time", v => v.budget.wallClockSeconds = Infinity, "wall"],
    ["different root source", v => v.repository = { ...v.repository, commit: "f".repeat(40) }, "source"],
    ["altered leaf", v => v.nodes.build.plan.name += " changed", "digest"],
    ["unsafe publication branch", v => v.nodes.ship.publication.sourceBranch = "main", "branch"],
    ["publication credential", v => v.nodes.ship.publication.remote = "https://user:password@example.test/repository.git", "publication"],
    ["ssh publication password", v => v.nodes.ship.publication.remote = "ssh://git:secret@example.test/repository.git", "credential-free"],
    ["embedded Send", v => v.nodes.ship.send = true, "unknown"],
];
for (const [name, edit, reason] of refusals) test(`graph refuses ${name} before effects`, () => expect(() => compile(changed(edit))).toThrow(new RegExp(reason, 'i')));

test("a later loop cannot write an earlier leaf's acceptance input", () => {
    const input = graphFixture(), { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = input.nodes.build.plan as any;
    const writer = compileDeclaration({ ...raw, version: 3, scope: { writable: ["tests"] }, acceptance: { ...raw.acceptance, protected_paths: [], checks: raw.acceptance.checks.map((check: any) => ({ ...check, files: ["package.json"] })) } });
    const graphInput: any = { ...input, required: [...input.required, "rewrite"], budget: { ...input.budget, maxRoleSessions: input.budget.maxRoleSessions * 2, maxVerificationAttempts: input.budget.maxVerificationAttempts * 2 },
        nodes: { ...input.nodes, verify: { ...input.nodes.verify, then: "rewrite" }, rewrite: { kind: "loop", input: "verify", plan: writer, then: "route" }, route: { ...input.nodes.route, input: "verify" } } };
    expect(() => compile(graphInput)).toThrow("acceptance input");
});
test("graph binds its complete immutable contract and finite execution grant", () => {
    const plan = compile(graphFixture()), at = new Date("2026-09-29T12:00:00Z"), expiresAt = "2026-09-29T13:00:00Z";
    const authority = graph.createGraphAuthority(plan, { actor: "Scripted graph fixture", expiresAt, at });
    expect(authority.maySend).toBe(false);
    expect(graph.validateGraphAuthority(authority, plan, at)).toEqual(authority);
    expect(() => graph.validateContainedGraph({ ...plan, id: "changed" })).toThrow("digest");
    // Forgeries are re-signed: the self-computed digest alone proves nothing about binding.
    const resign = (value: any) => { const { sha256, ...body } = value; return { ...body, sha256: hashValue(body) }; };
    expect(() => graph.validateGraphAuthority({ ...authority, actor: "Someone else" }, plan, at)).toThrow("digest");
    expect(() => graph.validateGraphAuthority(resign({ ...authority, graphSha256: "e".repeat(64) }), plan, at)).toThrow("bound");
    expect(() => graph.validateGraphAuthority(resign({ ...authority, maySend: true }), plan, at)).toThrow("Send");
    expect(() => graph.validateGraphAuthority(authority, plan, new Date(expiresAt))).toThrow("expired");
    expect(() => graph.createGraphAuthority(plan, { actor: "", expiresAt, at })).toThrow("actor");
});
