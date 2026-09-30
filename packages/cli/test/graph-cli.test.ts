/** Public contained-graph routes. No container, provider or network: the root
 * graph holds before any loop, and the runtime is kept off PATH. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { dispatch } from "../src/app";

const root = resolve(import.meta.dir, "../../.."), example = join(root, "examples/graphs/serial-repair/graph.yaml"), legacy = join(root, "examples/graphs/issue-to-mr.yaml");
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const ajv = addFormats(new Ajv2020({ strict: false }));
const schema = async (name: string) => ajv.compile(await Bun.file(join(root, "schema", name)).json());
const drive = (...argv: string[]) => dispatch(["graph", ...argv], "wringer-drive");
async function refused(action: Promise<unknown>) { return action.then(() => { throw new Error("expected a refusal"); }, (error: any) => error); }
async function started() {
    const dir = await mkdtemp(join(tmpdir(), "wringer-graph-cli-")); directories.push(dir);
    const authority = join(dir, "authority.json"), state = join(dir, "state");
    await drive("authority", example, "--actor", "Scripted engineering fixture", "--expires", new Date(Date.now() + 3600000).toISOString(), "--output", authority);
    const run = await drive("run", example, "--authority", authority, "--state", state);
    return { dir, authority, state, run };
}

test("graph plan pins every leaf and shows the allowance without any effect", async () => {
    const result: any = await drive("plan", example), validate = await schema("contained-graph-plan-v1.schema.json");
    expect(validate(result.value)).toBe(true);
    expect(result.value.nodes.build.plan.schema_version).toBe("wringer.execution-plan.v3");
    expect(result.text).toContain("No agent, container or repository command ran");
    expect((await drive("--help") as any).text).toContain("wringer-drive graph run GRAPH.yaml");
});
test("a retired host graph is refused by name and stays readable through the legacy reader", async () => {
    const error = await refused(drive("plan", legacy));
    expect(error.exit_code).toBe(2); expect(error.message).toContain("retired host-execution graph"); expect(error.message).toContain("wring graph show");
    expect(((await dispatch(["graph", "show", legacy])) as any).text).toContain("read-intent: intent");
    const retired = await refused(dispatch(["graph", "run", legacy]));
    expect(retired.exit_code).toBe(2); expect(retired.next_move).toBe("wringer-drive graph --help");
});
test("graph run holds at the root scope before any loop and every record matches its schema", async () => {
    const f = await started(), view: any = f.run.value;
    expect(f.run.exit).toBe(3); expect(view.phase).toBe("human-hold"); expect(view.next.action).toBe("decide"); expect(view.next.command).toContain(`--revision ${view.revision}`);
    expect((await schema("contained-graph-status-v1.schema.json"))(view)).toBe(true);
    const authority = JSON.parse(await readFile(f.authority, "utf8")); expect((await schema("contained-graph-authority-v1.schema.json"))(authority)).toBe(true); expect(authority.maySend).toBe(false);
    const events = (await readdir(join(f.state, "events"))).sort(), validate = await schema("contained-graph-event-v1.schema.json");
    for (const name of events) expect(validate(JSON.parse(await readFile(join(f.state, "events", name), "utf8")))).toBe(true);
    expect(events).toEqual(["0000.json", "0001.json"]);
    expect((await schema("contained-graph-plan-v1.schema.json"))(JSON.parse(await readFile(join(f.state, "plan.json"), "utf8")))).toBe(true);
    const again = await refused(drive("run", example, "--authority", f.authority, "--state", f.state));
    expect(again.message).toContain("not empty");
}, 60000);
test("decisions bind the exact revision and input; a stale or ambiguous one records nothing", async () => {
    const f = await started(), view: any = f.run.value, base = ["--state", f.state, "--node", "scope", "--input", view.next.inputSha256, "--by", "Scripted engineering fixture", "--note", "Fixture checkpoint, not human acceptance."];
    const stale = await refused(drive("decide", ...base, "--revision", "a".repeat(64), "--continue"));
    expect(stale.message).toContain("revision"); expect((await readdir(join(f.state, "events"))).length).toBe(2);
    const ambiguous = await refused(drive("decide", ...base, "--revision", view.revision, "--continue", "--reject"));
    expect(ambiguous.exit_code).toBe(2); expect((await readdir(join(f.state, "events"))).length).toBe(2);
    const decided: any = await drive("decide", ...base, "--revision", view.revision, "--continue");
    expect(decided.exit).toBe(0); expect(decided.value.cursor).toBe("build");
}, 60000);
test("resume refuses a missing container runtime before dispatch; the loop stays reserved", async () => {
    const f = await started(), view: any = f.run.value, path = process.env.PATH;
    await drive("decide", "--state", f.state, "--node", "scope", "--revision", view.revision, "--input", view.next.inputSha256, "--continue", "--by", "Scripted engineering fixture", "--note", "Fixture checkpoint.");
    process.env.PATH = "/usr/bin:/bin";
    let error: any; try { error = await refused(drive("resume", "--state", f.state)); } finally { process.env.PATH = path; }
    expect(error.message).toContain("Containment unavailable"); expect(error.next_move).toContain("graph status");
    const status: any = await drive("status", "--state", f.state);
    expect(status.value.nodes.find((row: any) => row.id === "build").state).toBe("reserved"); expect(status.exit).toBe(3);
}, 60000);
test("the public graph route exposes no fixture driver, clock or crash hook", async () => {
    const source = await readFile(join(root, "packages/cli/src/graph-cli.ts"), "utf8");
    for (const hook of ["executeRole", "runCommands", "checkpoint", "now:", "FIXTURE"]) expect(source.includes(hook)).toBe(false);
});
test("the tournament example compiles as a version 3 graph and states its selection policy", async () => {
    const result: any = await drive("plan", join(root, "examples/graphs/tournament/graph.yaml")), validate = await schema("contained-graph-plan-v3.schema.json");
    expect(validate(result.value)).toBe(true); expect(result.value.schema_version).toBe("wringer.contained-graph-plan.v3");
    expect(result.value.nodes.pick.prosecutor.plan.scope.writable).toEqual(["wringer/challenges.json"]);
    expect(result.text).toContain("1 prosecutor, 1 trusted control, 1 final evaluator gate, ties → tree-order");
    expect(result.text).toContain("reserve 25/25 role sessions");
});
test("the external-task example compiles as a version 4 graph and states the delegation", async () => {
    const result: any = await drive("plan", join(root, "examples/graphs/external-task/graph.yaml")), validate = await schema("contained-graph-plan-v4.schema.json");
    expect(validate(result.value)).toBe(true); expect(result.value.schema_version).toBe("wringer.contained-graph-plan.v4");
    expect(result.text).toContain("external A2A task to agents.example.com (skill repair"); expect(result.text).toContain("a check must verify it");
});
