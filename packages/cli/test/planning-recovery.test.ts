import { expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile, readdir, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileExecutionPlan } from "@wringer/plan";
import { proposeContainedPlan } from "@wringer/workflow";
import * as intake from "../src/intake";
import { parseArgs } from "../src/args";
import { dispatch } from "../src/app";

async function fixture(reply: string) {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "wringer-planning-cli-recovery-")));
    const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, acceptance, ...raw } = structuredClone(compileExecutionPlan(template, { format: "yaml" }));
    raw.agents.planner = { ...raw.agents.judge, env: [] };
    raw.runtime.env = []; raw.agents.worker.env = []; raw.agents.judge.env = [];
    raw.budget.max_sessions = 1; raw.budget.max_planner_turns = 1;
    await writeFile(join(repo, "template.yaml"), JSON.stringify({ version: 1, ...raw }));
    await writeFile(join(repo, "intent.md"), raw.intent);
    const expires = new Date(Date.now() + 3600000).toISOString();
    const argv = ["propose", "template.yaml", "--intent", "intent.md", "--actor", "PM", "--expires", expires, "--state", "state", "--output", "plan.json"];
    let calls = 0, preparations = 0;
    const dependencies = {
        prepareSource: async (source: any) => { preparations++; return { ...source, objectStore: join(repo, "fixture.git") }; },
        propose: (options: Parameters<typeof proposeContainedPlan>[0]) => proposeContainedPlan({ ...options, executeRole: async request => {
            calls++;
            return { status: "completed", text: reply, sessionId: crypto.randomUUID(), stopReason: "end_turn", protocolVersion: 1, agentInfo: { name: "fixture" }, capabilities: {}, authMethods: [], authentication: { methodAttempted: null, sessionOpened: true }, events: [], stderr: "", provenance: { schema_version: "wringer.runtime.v1", runtimeId: crypto.randomUUID(), role: "planner", kind: request.runtime.kind, image: request.runtime.image, repository: request.repo, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: request.runtime, observed: {}, limits: ["Synthetic, no provider/runtime"] } };
        } }),
    };
    return { repo, argv, expires, dependencies, calls: () => calls, preparations: () => preparations };
}
test("spent planning stops print a fresh-grant path, not an impossible retry loop", async () => {
    const f = await fixture("malformed JSON");
    const reply = await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    expect(reply.text).not.toContain("--retry-stopped");
    expect(reply.text).toContain("planning-new-grant");
    await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    expect(f.preparations()).toBe(1); expect(f.calls()).toBe(1);
});
test("planning questions and status read frozen results without new keys, source preparation or paid work", async () => {
    const f = await fixture('```json\n{"questions":["Choose A or B?"],"note":"No answer was invented."}\n```');
    await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    const before = await readdir(join(f.repo, "state/.wringer/planning/events"));
    for (const command of ["planning-status", "planning-questions"]) {
        const reply = await (intake as any).planningStatusCommand(parseArgs([command, "--state", "state"]), f.repo, {});
        expect(reply.text).toContain("Choose A or B?");
        expect(reply.text).toContain("No answer was invented.");
        expect(reply.text).toContain("--intent");
        expect(reply.text).not.toContain("--retry-uncertain");
    }
    for (const command of ["status", "planning-status", "planning-questions", "planning-new-grant"]) {
        const reply = await dispatch([command, "--repo", f.repo, "--state", "state", "--json"], "wringer-drive");
        expect(reply.text).toContain("Choose A or B?");
        if (command === "planning-new-grant") expect(reply.exit ?? 0).toBe(0);
    }
    expect(await readdir(join(f.repo, "state/.wringer/planning/events"))).toEqual(before);
    expect(f.preparations()).toBe(1); expect(f.calls()).toBe(1);
});
test("a new planning grant requires confirmation and a new state, retaining old request and reservations", async () => {
    const f = await fixture('{"questions":["Choose A or B?"],"note":"Decision required"}');
    await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    const old = await readFile(join(f.repo, "state/.wringer/planning/authority.json"), "utf8");
    const argv = ["planning-new-grant", "--state", "state", "--new-state", "fresh", "--expires", f.expires, "--output", "fresh-plan.json"];
    const run = (a: ReturnType<typeof parseArgs>) => (intake as any).planningNewGrantCommand(a, f.repo, {}, f.dependencies);
    expect((await run(parseArgs(argv))).text).toContain("nothing was approved");
    expect(f.calls()).toBe(1);
    await writeFile(join(f.repo, "revised.md"), "Return the total as 5. Choose A.");
    const confirmed = parseArgs([...argv, "--intent", "revised.md"]); confirmed.flags.set("confirm-new-grant", true);
    await run(confirmed);
    expect(f.calls()).toBe(2);
    const originalRequest = JSON.parse(await readFile(join(f.repo, "state/.wringer/planning/request.json"), "utf8"));
    const newRequest = JSON.parse(await readFile(join(f.repo, "fresh/.wringer/planning/request.json"), "utf8"));
    expect(newRequest.budget).toEqual(originalRequest.budget);
    expect(newRequest.runtime).toEqual(originalRequest.runtime);
    expect(newRequest.scope).toEqual(originalRequest.scope);
    expect(await readFile(join(f.repo, "state/.wringer/planning/authority.json"), "utf8")).toBe(old);
    await expect(run(confirmed)).rejects.toThrow("new");
    expect(f.calls()).toBe(2);
});
test("confirmed planning grants refuse nested old-state paths and symlink parents before any effect", async () => {
    const f = await fixture("malformed JSON");
    await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    const old = await readFile(join(f.repo, "state/.wringer/planning/authority.json"), "utf8");
    await symlink(join(f.repo, "state"), join(f.repo, "alias"));
    const external = await realpath(await mkdtemp(join(tmpdir(), "wringer-planning-target-")));
    await symlink(external, join(f.repo, "external-alias"));
    for (const [state, output] of [["state/new", "outside.json"], ["fresh", "state/injected.json"], ["alias/new", "outside.json"], ["fresh", "alias/injected.json"], ["external-alias/fresh", "outside.json"], ["fresh", "external-alias/out.json"]]) {
        const args = parseArgs(["planning-new-grant", "--state", "state", "--new-state", state!, "--expires", f.expires, "--output", output!]);
        args.flags.set("confirm-new-grant", true);
        await expect((intake as any).planningNewGrantCommand(args, f.repo, {}, f.dependencies)).rejects.toThrow();
    }
    expect(f.calls()).toBe(1); expect(f.preparations()).toBe(1);
    expect(await readFile(join(f.repo, "state/.wringer/planning/authority.json"), "utf8")).toBe(old);
    expect(await readdir(external)).toEqual([]);
});
test("cached proposals after expiry offer a working read-only next step without more planning spend", async () => {
    const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
    const acceptance = compileExecutionPlan(template, { format: "yaml" }).acceptance;
    const f = await fixture(JSON.stringify({ acceptance, questions: [], note: "An unapproved proposal." }));
    const first = await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    expect(first.text).toContain("Next: wringer-drive authority");
    const originalAuthority = await readFile(join(f.repo, "state/.wringer/planning/authority.json"), "utf8");
    const realNow = Date.now;
    try {
        Date.now = () => Date.parse(f.expires) + 1;
        const recovered = await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
        expect(recovered.text).toContain("Next: wringer-drive plan");
        expect(recovered.text).not.toContain("Next: wringer-drive authority");
        expect(recovered.text).toContain("future expiry");
        const inspected = await dispatch(["plan", "plan.json", "--repo", f.repo], "wringer-drive");
        expect(inspected.exit ?? 0).toBe(0);
    } finally { Date.now = realNow; }
    expect(f.calls()).toBe(1); expect(f.preparations()).toBe(1);
    expect(await readFile(join(f.repo, "state/.wringer/planning/authority.json"), "utf8")).toBe(originalAuthority);
});
test("cached proposal never suggests overwriting an existing execution authority", async () => {
    const template = await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8");
    const acceptance = compileExecutionPlan(template, { format: "yaml" }).acceptance;
    const f = await fixture(JSON.stringify({ acceptance, questions: [], note: "An unapproved proposal." }));
    await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    const path = join(f.repo, "state/execution-authority.json"), original = '{"retained":"existing authority"}\n';
    await writeFile(path, original);
    const recovered = await intake.proposalCommand(parseArgs(f.argv), f.repo, {}, f.dependencies);
    expect(recovered.text).toContain("Next: wringer-drive plan");
    expect(recovered.text).not.toContain("Next: wringer-drive authority");
    expect(recovered.text).toContain("new output");
    expect(await readFile(path, "utf8")).toBe(original);
    expect(f.calls()).toBe(1); expect(f.preparations()).toBe(1);
});
