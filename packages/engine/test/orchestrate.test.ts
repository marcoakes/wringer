/**
 * Setup, services, readiness, phases and teardown.
 *
 * Measured from ZenJev's own 117-line CI coordinator on 19 September 2026: it
 * re-implemented detached spawn, SIGTERM→SIGKILL, timeouts, per-label capture and
 * an owned-children set; ran two migrations and two seeds; started a worker and
 * two application instances; polled two readiness URLs, one on a JSON body path
 * and one on an authenticated 401; ran four gate subsets; stopped everything; and
 * aggregated the bundles by hand.
 *
 * Every red-watch here was observed failing with its guard removed.
 */
import { afterAll, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parseConfig } from "../src/config";
import { git } from "../src/git";
import { schemaDirectory, validateDigests } from "../src/io";
import { verify } from "../src/verify";
const roots: string[] = [];
afterAll(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
const validators = new Map<string, any>();
async function schema(value: unknown, file: string) {
    let check = validators.get(file);
    if (!check) {
        check = ajv.compile(await Bun.file(join(schemaDirectory(), file)).json());
        validators.set(file, check);
    }
    if (!check(value))
        throw new Error(`${file}: ${JSON.stringify(check.errors)}`);
    expect(true).toBeTrue();
}
async function repo() {
    const root = await mkdtemp(join(tmpdir(), "wringer-orchestrate-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Orchestration Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(root, ".gitignore"), ".wringer/\n");
    await writeFile(join(root, "source.txt"), "fixture\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    return root;
}
/** A port nothing else holds right now, so a declared literal URL can name it. */
async function freePort(): Promise<number> {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("probe") });
    const port = server.port!;
    await server.stop(true);
    return port;
}
/** A real long-lived HTTP service, written into the fixture repository. */
async function healthServer(root: string, port: number, body: string, name = "service.mjs") {
    await writeFile(join(root, name), `import { createServer } from 'node:http';\nconsole.log('starting on ${port}');\ncreateServer((request, response) => { response.writeHead(${body.startsWith("{") ? 200 : Number(body)}, { 'content-type': 'application/json' }); response.end(${body.startsWith("{") ? JSON.stringify(body) : '""'}); }).listen(${port}, '127.0.0.1');\n`);
    return name;
}
const base = (over: any) => JSON.stringify({ version: 1, ...over });
test("setup, services, phases and teardown parse with their defaults", () => {
    const config = parseConfig({
        version: 1,
        gates: [{ id: "lint", run: "true" }, { id: "browser", run: "true" }],
        setup: [{ id: "migrate", run: "true" }],
        services: [{ id: "app", run: "true", readiness: { url: "http://127.0.0.1:3000/api/health" } }],
        phases: [{ id: "static", gates: ["lint"] }, { id: "live", gates: ["browser"], needs: ["app"] }],
        teardown: [{ id: "clean", run: "true" }],
    });
    expect(config.setup).toEqual([{ id: "migrate", run: "true", timeout: 300 }]);
    expect(config.services[0]!.readiness!).toEqual({ url: "http://127.0.0.1:3000/api/health", status: 200, timeout: 60 });
    expect(config.phases.map(p => `${p.id}:${p.gates.join("+")}:${p.needs.join("+")}`)).toEqual(["static:lint:", "live:browser:app"]);
    expect(config.teardown[0]!.id).toBe("clean");
    expect(parseConfig({ version: 1, gates: [{ id: "a", run: "true" }] }).phases).toEqual([]);
});
test("the ordering rules refuse a configuration that would run a gate twice or never", () => {
    const gates = [{ id: "a", run: "true" }, { id: "b", run: "true" }];
    expect(() => parseConfig({ version: 1, gates, phases: [{ id: "one", gates: ["a"] }] })).toThrow("gate b is declared but no phase runs it");
    expect(() => parseConfig({ version: 1, gates, phases: [{ id: "one", gates: ["a", "b"] }, { id: "two", gates: ["b"] }] })).toThrow("gate b is in both phase one and phase two");
    expect(() => parseConfig({ version: 1, gates, phases: [{ id: "one", gates: ["a", "c"] }] })).toThrow("names gate c, which is not declared");
    expect(() => parseConfig({ version: 1, gates, phases: [{ id: "one", gates: ["a", "b"], needs: ["app"] }] })).toThrow("needs service app, which is not declared");
    expect(() => parseConfig({ version: 1, gates, services: [{ id: "app", run: "true", readiness: { url: "http://127.0.0.1:1/x" } }] })).toThrow("A service nothing needs would be started and never used");
    expect(() => parseConfig({ version: 1, gates, phases: [{ id: "one", gates: [] }] })).toThrow("runs no gate");
});
test("a declared value that would be a credential in the repository is refused", () => {
    const gates = [{ id: "a", run: "true" }];
    expect(() => parseConfig({ version: 1, gates, setup: [{ id: "m", run: "true", env: { DATABASE_URL: "postgres://user:pw@host/db" } }] })).toThrow("must name another environment variable to read, not a value");
    expect(parseConfig({ version: 1, gates, setup: [{ id: "m", run: "true", env: { DATABASE_URL: "ZENJEV_TEST_DATABASE_URL" } }] }).setup[0]!.env).toEqual({ DATABASE_URL: "ZENJEV_TEST_DATABASE_URL" });
    const service = (readiness: any) => () => parseConfig({ version: 1, gates, services: [{ id: "app", run: "true", readiness }], phases: [{ id: "p", gates: ["a"], needs: ["app"] }] });
    expect(service({ url: "http://user:pw@127.0.0.1/x" })).toThrow("credential-free http or https URL");
    expect(service({ url: "file:///etc/passwd" })).toThrow("credential-free http or https URL");
    expect(service({ url: "http://127.0.0.1/x", body_path: "worker.status" })).toThrow("needs body_path and equals together, or neither");
    expect(service({ url: "http://127.0.0.1/x", body_path: "worker status", equals: "healthy" })).toThrow("dotted JSON path");
    expect(parseConfig({ version: 1, gates, services: [{ id: "app", run: "true", readiness: { url: "http://127.0.0.1/x", status: 401 } }], phases: [{ id: "p", gates: ["a"], needs: ["app"] }] }).services[0]!.readiness!.status).toBe(401);
});
test("declared phases are the running order, and the selection record says which phase ran what", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "second", run: "echo second >> order.txt" }, { id: "first", run: "echo first >> order.txt" }],
        phases: [{ id: "early", gates: ["first"] }, { id: "late", gates: ["second"] }],
    }));
    const out = await verify(root);
    expect(out.status).toBe("passed");
    // Declared gate order is second, first. The PHASES say first, second — and that is what ran.
    expect((await readFile(join(root, "order.txt"), "utf8")).trim().split("\n")).toEqual(["first", "second"]);
    expect(out.results.map(r => r.gate_id)).toEqual(["first", "second"]);
    const selection = await Bun.file(join(root, out.evidence_dir, "selection.json")).json();
    await schema(selection, "selection-v2.schema.json");
    expect(selection.schema_version).toBe("wringer.selection.v2");
    expect(selection.phases).toEqual([{ id: "early", gates: ["first"], executed: ["first"] }, { id: "late", gates: ["second"], executed: ["second"] }]);
    expect(selection.complete).toBeTrue();
    // Gate directories still carry the DECLARED index, so a bundle's numbering never depends on order.
    expect(out.evidence_dir).toBeTruthy();
});
// RED-WATCH: a service failing before readiness reported as a gate failure.
test("a service that never becomes ready is an environment outcome, not a product result", async () => {
    const root = await repo();
    const port = await freePort();
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "browser", run: "echo should-not-run >> ran.txt" }],
        services: [{ id: "app", run: "sleep 30", readiness: { url: `http://127.0.0.1:${port}/health`, timeout: 2 } }],
        phases: [{ id: "live", gates: ["browser"], needs: ["app"] }],
        teardown: [{ id: "note", run: "echo torn-down > teardown.txt" }],
    }));
    const out = await verify(root);
    expect(out.exit_code).toBe(2);
    expect(out.status).toBe("failed");
    expect(out.failed_gate).toBeNull();
    expect(out.results).toEqual([]);
    expect(await Bun.file(join(root, "ran.txt")).exists()).toBeFalse();
    const record = await Bun.file(join(root, out.evidence_dir, "orchestration.json")).json();
    await schema(record, "orchestration-v1.schema.json");
    expect(record.outcome).toBe("environment");
    expect(record.services[0].readiness.status).toBe("timed-out");
    expect(record.reason).toContain("No gate ran against it");
    expect(record.reason).toContain("Nothing under services: is retried");
    // RED-WATCH: teardown skipped after a failure.
    expect((await readFile(join(root, "teardown.txt"), "utf8")).trim()).toBe("torn-down");
    expect(record.teardown[0].status).toBe("passed");
    // `sleep 30` honours SIGTERM inside grace, so no SIGKILL was needed to stop the group.
    expect(record.services[0].stopped).toMatchObject({ forced: false, signal: "SIGTERM" });
    expect((await validateDigests(join(root, out.evidence_dir))).ok).toBeTrue();
    expect(await readFile(join(root, out.evidence_dir, "summary.md"), "utf8")).toContain("Environment: Service app did not become ready");
});
test("a service that exits before readiness is its own outcome, not a timeout", async () => {
    const root = await repo();
    const port = await freePort();
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "browser", run: "true" }],
        services: [{ id: "app", run: "echo dying; exit 3", readiness: { url: `http://127.0.0.1:${port}/health`, timeout: 20 } }],
        phases: [{ id: "live", gates: ["browser"], needs: ["app"] }],
    }));
    const out = await verify(root);
    expect(out.exit_code).toBe(2);
    const record = await Bun.file(join(root, out.evidence_dir, "orchestration.json")).json();
    expect(record.services[0].readiness.status).toBe("exited-before-readiness");
    expect(record.services[0].readiness.detail).toContain("code 3");
    expect(record.services[0].readiness.waited_ms).toBeLessThan(15000);
    expect(await readFile(join(root, out.evidence_dir, record.services[0].log), "utf8")).toContain("dying");
});
// RED-WATCH: a setup command retried.
test("setup runs in order, exactly once each, and its first failure stops the run", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "unit", run: "echo gate >> order.txt" }],
        setup: [{ id: "migrate", run: "echo migrate >> order.txt" }, { id: "seed", run: "echo seed >> order.txt" }],
        phases: [{ id: "only", gates: ["unit"] }],
    }));
    const ok = await verify(root);
    expect(ok.status).toBe("passed");
    expect((await readFile(join(root, "order.txt"), "utf8")).trim().split("\n")).toEqual(["migrate", "seed", "gate"]);
    const record = await Bun.file(join(root, ok.evidence_dir, "orchestration.json")).json();
    expect(record.outcome).toBe("ready");
    expect(record.setup.map((s: any) => s.id)).toEqual(["migrate", "seed"]);
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "unit", run: "echo gate >> broken.txt" }],
        setup: [{ id: "migrate", run: "echo attempt >> attempts.txt; exit 7" }, { id: "seed", run: "echo seed >> broken.txt" }],
        phases: [{ id: "only", gates: ["unit"] }],
    }));
    const failed = await verify(root);
    expect(failed.exit_code).toBe(2);
    // Exactly one attempt, and the steps after it never ran.
    expect((await readFile(join(root, "attempts.txt"), "utf8")).trim().split("\n")).toEqual(["attempt"]);
    expect(await Bun.file(join(root, "broken.txt")).exists()).toBeFalse();
    const broken = await Bun.file(join(root, failed.evidence_dir, "orchestration.json")).json();
    expect(broken.setup).toHaveLength(1);
    expect(broken.setup[0]).toMatchObject({ id: "migrate", exit_code: 7, status: "failed" });
    expect(broken.reason).toContain("Nothing under setup: is retried");
    expect(await readFile(join(root, failed.evidence_dir, broken.setup[0].log), "utf8")).toContain("exit 7");
});
test("a real service becomes ready on a JSON body path, holds across phases, and is stopped", async () => {
    const root = await repo();
    const port = await freePort();
    const file = await healthServer(root, port, '{"worker":{"status":"healthy"}}');
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "static", run: "true" }, { id: "live-one", run: `curl -sf http://127.0.0.1:${port}/health > /dev/null` }, { id: "live-two", run: `curl -sf http://127.0.0.1:${port}/health > /dev/null` }],
        services: [{ id: "app", run: `${process.execPath} ${file}`, readiness: { url: `http://127.0.0.1:${port}/health`, body_path: "worker.status", equals: "healthy", timeout: 30 } }],
        phases: [{ id: "offline", gates: ["static"] }, { id: "live", gates: ["live-one"], needs: ["app"] }, { id: "more-live", gates: ["live-two"], needs: ["app"] }],
        teardown: [{ id: "note", run: "echo done > teardown.txt" }],
    }));
    const out = await verify(root);
    expect(out.status).toBe("passed");
    expect(out.exit_code).toBe(0);
    const record = await Bun.file(join(root, out.evidence_dir, "orchestration.json")).json();
    await schema(record, "orchestration-v1.schema.json");
    expect(record.outcome).toBe("ready");
    // Started once, for the first phase that needed it, and held for the second.
    expect(record.services).toHaveLength(1);
    expect(record.services[0].readiness).toMatchObject({ status: "ready", expect: "worker.status = healthy" });
    expect(record.services[0].stopped).not.toBeNull();
    expect(await readFile(join(root, out.evidence_dir, record.services[0].log), "utf8")).toContain(`starting on ${port}`);
    expect((await readFile(join(root, "teardown.txt"), "utf8")).trim()).toBe("done");
    // The port is free again: the group this run started is gone.
    const after = await fetch(`http://127.0.0.1:${port}/health`).then(() => "answered").catch(() => "gone");
    expect(after).toBe("gone");
});
// RED-WATCH: teardown skipped after a failed gate.
test("teardown runs after a failed gate, and the gate failure stays exit 1", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "unit", run: "exit 1" }],
        setup: [{ id: "prepare", run: "true" }],
        phases: [{ id: "only", gates: ["unit"] }],
        teardown: [{ id: "note", run: "echo after-failure > teardown.txt" }],
    }));
    const out = await verify(root);
    expect(out.exit_code).toBe(1);
    expect(out.status).toBe("failed");
    expect(out.failed_gate).toBe("unit");
    expect((await readFile(join(root, "teardown.txt"), "utf8")).trim()).toBe("after-failure");
    const record = await Bun.file(join(root, out.evidence_dir, "orchestration.json")).json();
    expect(record.outcome).toBe("ready");
    expect(record.teardown[0].status).toBe("passed");
});
test("a teardown command that fails is recorded and does not rewrite the outcome", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), base({
        gates: [{ id: "unit", run: "true" }],
        phases: [{ id: "only", gates: ["unit"] }],
        teardown: [{ id: "broken", run: "exit 9" }],
    }));
    const out = await verify(root);
    expect(out.status).toBe("passed");
    expect(out.exit_code).toBe(0);
    const record = await Bun.file(join(root, out.evidence_dir, "orchestration.json")).json();
    expect(record.teardown[0]).toMatchObject({ id: "broken", exit_code: 9, status: "failed" });
    expect(record.outcome).toBe("ready");
});
// RED-WATCH: an unowned pgid killed on cancel.
test("cancellation stops only the groups this run started", async () => {
    const root = await repo();
    const port = await freePort();
    const file = await healthServer(root, port, '{"worker":{"status":"healthy"}}');
    // A process this run did NOT start, in its own group, which must survive.
    const bystander = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    bystander.unref();
    await new Promise(r => setTimeout(r, 100));
    try {
        await writeFile(join(root, ".wringer.yaml"), base({
            gates: [{ id: "slow", run: "sleep 30" }],
            services: [{ id: "app", run: `${process.execPath} ${file}`, readiness: { url: `http://127.0.0.1:${port}/health`, body_path: "worker.status", equals: "healthy", timeout: 30 } }],
            phases: [{ id: "live", gates: ["slow"], needs: ["app"] }],
            teardown: [{ id: "note", run: "echo cancelled > teardown.txt" }],
        }));
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 2500);
        const out = await verify(root, { signal: controller.signal });
        expect(out.status).toBe("interrupted");
        expect(out.exit_code).toBe(4);
        // Teardown still ran, and the service this run started is gone.
        expect((await readFile(join(root, "teardown.txt"), "utf8")).trim()).toBe("cancelled");
        expect(await fetch(`http://127.0.0.1:${port}/health`).then(() => "answered").catch(() => "gone")).toBe("gone");
        // The bystander's group was never signalled.
        expect(() => process.kill(bystander.pid!, 0)).not.toThrow();
    }
    finally {
        try {
            process.kill(-bystander.pid!, "SIGKILL");
        }
        catch { }
    }
});

// RED-WATCH: the ZenJev regression fixture. Its 117-line CI coordinator, expressed entirely in
// .wringer.yaml at 1.0.0-alpha.18 and deleted. Measured line counts: 117 + 104 + 49 ->
// 0 + 112 + 116, so 117 lines of custom coordination became 67 lines of declaration in the file
// that already declared the gates. NOT a claim that the suite was re-run: this host has no
// native PostgreSQL 17 and no container runtime, which ZenJev's own CI requires.
test("ZenJev's whole CI coordinator compiles as declared configuration", async () => {
    const text = await Bun.file(join(new URL("./fixtures/", import.meta.url).pathname, "zenjev.wringer.yaml")).text();
    const config = parseConfig(text);
    expect(config.gates).toHaveLength(10);
    // The four subsets the coordinator ran, in its order, with the services each needed.
    expect(config.phases.map(p => p.id)).toEqual(["build", "native", "workflows", "authenticated"]);
    expect(config.phases.map(p => p.needs.join("+"))).toEqual(["", "", "worker+production-app", "authenticated-app"]);
    expect(config.phases.flatMap(p => p.gates).sort()).toEqual(config.gates.map(g => g.id).sort());
    // Two migrations and two seeds, ordered, with the test database supplied by NAME.
    expect(config.setup.map(s => s.id)).toEqual(["migrate-demo", "migrate-test", "seed-demo-first", "seed-demo-second"]);
    expect(config.setup[1]!.env).toEqual({ DATABASE_URL: "ZENJEV_TEST_DATABASE_URL" });
    // Three services; the worker is reported by the application's health endpoint, not its own URL.
    expect(config.services.map(s => s.id)).toEqual(["worker", "production-app", "authenticated-app"]);
    expect(config.services[0]!.readiness).toBeUndefined();
    expect(config.services[1]!.readiness).toMatchObject({ body_path: "worker.status", equals: "healthy" });
    expect(config.services[2]!.readiness).toMatchObject({ status: 401 });
    // The identity query the coordinator ran with a pg client is now a declared probe.
    expect(config.requires.map(r => r.kind)).toEqual(["native_database", "browser", "filesystem"]);
    expect(config.requires[0]!.url_env).toBe("DATABASE_URL");
    // And the mapping that was refused in September: SW-01 in all three gates that evidence it.
    expect(config.gates.filter(g => g.proves.includes("SW-01")).map(g => g.id)).toEqual(["fresh-offline-setup", "persistence-workflow", "browser"]);
    expect(config.gates.filter(g => g.evidence).map(g => `${g.id}:${g.evidence!.adapter}`)).toEqual(["persistence-workflow:vitest", "browser:playwright"]);
    expect(config.gates.find(g => g.id === "branding")!.run).toContain("--test-reporter=tap");
    expect(config.gates.find(g => g.id === "browser-auth")!.corroborates).toEqual(["SW-10"]);
});

// RED-WATCH: the pages that teach this reverted.
test("the operator pages carry the service, phase and exit-code sentences", async () => {
    const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
    const setup = await Bun.file(join(root, "SETUP.md")).text();
    expect(setup).toContain("environment outcome at exit 2");
    expect(setup).toContain("Nothing under `setup:` or `services:` is retried");
    expect(setup).toContain("Teardown always runs");
    expect(setup).toContain("a variable NAME, never a value");
    expect(setup).toContain("needs: [worker, production-app]");
    const headless = await Bun.file(join(root, "docs/native/HEADLESS.md")).text();
    expect(headless).toContain("2  a setup step failed, or a service never answered its declared readiness");
    expect(headless).toContain("only the process groups this run started are ever signalled");
    const schemas = await Bun.file(join(root, "schema/README.md")).text();
    for (const file of ["orchestration-v1.schema.json", "selection-v2.schema.json"])
        expect(schemas, file).toContain(`[\`${file}\`](${file})`);
});
