import { test, expect, afterEach } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir, symlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openReader } from "../../records/src/read";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { parseConfig, parseYaml, init, verify, run, doctor, explain, snapshot, runProcess, git, sha256, criterionDigest, Bundle, Redactor, validateDigests, schemaDirectory, containerArgv, armScript, workerAuth, humanSourceFingerprint } from "../src/index";
const roots: string[] = [];
async function scratch() { const path = await mkdtemp(join(tmpdir(), "wringer-native-engine-")); roots.push(path); await git(path, ["init", "-b", "main"]); await git(path, ["config", "user.name", "Wringer Test"]); await git(path, ["config", "user.email", "test@example.invalid"]); await git(path, ["config", "commit.gpgsign", "false"]); await writeFile(join(path, ".gitignore"), ".wringer/\n"); await writeFile(join(path, "source.txt"), "broken\n"); await git(path, ["add", "."]); await git(path, ["commit", "-m", "fixture"]); return path; }
async function config(path: string, gates: any[], more: any = {}) { await writeFile(join(path, ".wringer.yaml"), JSON.stringify({ version: 1, gates, ...more })); }
async function spec(path: string, criteria: any[]) { await writeFile(join(path, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Fixture", intent: "Build the feature.", criteria, open_questions: [], tasks: [{ id: "build", brief: "briefs/build.md", objective: "Build the feature." }], gates: [] })); }
const ajv = addFormats(new Ajv2020({ strict: false, allErrors: true }));
const validators = new Map<string, any>();
async function validate(value: any, schemaFile: string) {
    let check = validators.get(schemaFile);
    if (!check) {
        check = ajv.compile(await Bun.file(join(schemaDirectory(), schemaFile)).json());
        validators.set(schemaFile, check);
    }
    const ok = check(value);
    if (!ok)
        throw new Error(`${schemaFile}: ${JSON.stringify(check.errors)}`);
    expect(ok).toBe(true);
}
async function schema(bundle: string, name: string, schemaFile: string) { await validate(JSON.parse(await readFile(join(bundle, name), "utf8")), schemaFile); }
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
test("strict YAML rejects duplicate keys, unknown keys/tags, aliases beyond budget and boolean commands", () => {
    for (const source of ["version: 1\nversion: 1\ngates: []", "version: 1\ngates: [{id: test, run: true}]", "version: 1\ngtaes: []", "version: 1\ngates: !!python/object []"]) {
        expect(() => parseConfig(source)).toThrow();
    }
    expect(() => parseConfig({ version: 1, gates: [{ id: "../../escape", run: "true" }] })).toThrow();
    expect(() => parseConfig({ version: 1, gates: [{ id: "test", run: "true", optional: true, required: false }] })).toThrow();
    expect(() => parseConfig({ version: 1, gates: [{ id: "test", run: "true" }], run: { worker: "thing {unknown}" } })).toThrow();
    expect(parseConfig("version: 1\ngates:\n - id: test\n   run: 'echo yes: no # on'\n   proves: requirement").gates[0]?.proves).toEqual(["requirement"]);
});
test("unsupported evidence includes refuse instead of promising uncaptured files", () => {
    const base = { version: 1, gates: [{ id: "test", run: "true" }] };
    expect(() => parseConfig({ ...base, evidence: { include: ["README.md"] } })).toThrow("those files would not be captured");
    expect(() => parseConfig({ ...base, evidence: { include: ["**/*.json"] } })).toThrow("Nonempty evidence.include");
    expect(() => parseConfig({ ...base, evidence: { include: "README.md" } })).toThrow("list of strings");
    expect(parseConfig({ ...base, evidence: { include: [] } }).evidence.include).toEqual([]);
    expect(parseConfig(base).evidence.include).toEqual([]);
});
test("local execution refuses every container-only setting even false or empty values", () => {
    const base = { version: 1, gates: [{ id: "test", run: "true" }] };
    for (const [key, value] of Object.entries({ image: "local/checks", runtime: "docker", network: false, env: [], user: "1000:1000" })) {
        expect(() => parseConfig({ ...base, execution: { backend: "local", [key]: value } })).toThrow(`container-only settings: ${key}`);
    }
    expect(() => parseConfig({ ...base, execution: { backend: "local", network: null } })).toThrow("container-only settings: network");
    expect(parseConfig({ ...base, execution: { backend: "local" } }).execution).toEqual({ backend: "local" });
    expect(parseConfig({ ...base, execution: { backend: "container", image: "local/checks", network: false, env: [] } }).execution?.backend).toBe("container");
});
test("unused workspace declarations refuse with an explicit native repository route", () => {
    const base = { version: 1, gates: [{ id: "test", run: "true" }] };
    for (const workspace of ["/tmp/jobs", {}, null, false, undefined]) {
        expect(() => parseConfig({ ...base, workspace })).toThrow("workspace declarations are not supported");
    }
    try {
        parseConfig({ ...base, workspace: "/tmp/jobs" });
        throw new Error("Expected workspace refusal");
    }
    catch (error) {
        expect((error as Error).message).toContain("--repo DIRECTORY");
        expect((error as {
            next_move?: string;
        }).next_move).toBe("wring get --help");
    }
    expect(parseConfig(base).gates).toHaveLength(1);
});
test("init detects actual package scripts, never overwrites configuration", async () => {
    const root = await scratch();
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "bun test", lint: "bun lint" } }));
    const result = await init(root);
    expect(result.gates.map(g => g.id)).toEqual(["lint", "test"]);
    await expect(init(root)).rejects.toThrow("already exists");
});
test("verification refuses an approved plan that does not satisfy the frozen specification schema", async () => {
    const root = await scratch();
    await config(root, [{ id: "test", run: "touch should-not-run" }]);
    await spec(root, [{ id: "works", title: "It works" }]);
    const document = await Bun.file(join(root, "wringer.spec.yaml")).json();
    document.tasks = [];
    await writeFile(join(root, "wringer.spec.yaml"), JSON.stringify(document));
    await expect(verify(root)).rejects.toThrow("does not satisfy wringer.spec.v1");
    expect(await Bun.file(join(root, "should-not-run")).exists()).toBe(false);
    document.tasks = [{ id: "build", brief: "briefs/build.md", objective: "Build the feature." }];
    document.criteria[0].unknown = "ignored?";
    await writeFile(join(root, "wringer.spec.yaml"), JSON.stringify(document));
    await expect(verify(root)).rejects.toThrow("additional properties");
});
test("placeholder declares explicitly that a passing run proves nothing", async () => {
    const root = await scratch();
    await init(root);
    const result = await verify(root);
    expect(result.status).toBe("passed");
    expect(result.template_only).toBe(true);
    expect(await readFile(join(root, result.evidence_dir, "summary.md"), "utf8")).toContain("proved nothing");
});
test("bound checks all record red after first required failure; unbound gates remain skipped", async () => {
    const root = await scratch();
    await config(root, [{ id: "lint", run: "exit 1" }, { id: "costly", run: "echo should-not-run" }, { id: "a", run: "echo assertion; exit 1", proves: "req-a" }, { id: "b", run: "exit 2", proves: ["req-b"] }]);
    const out = await verify(root);
    expect(out.failed_gate).toBe("lint");
    expect(out.results.map(r => r.gate_id)).toEqual(["lint", "a", "b"]);
    const names = (await readdir(join(root, out.evidence_dir, "gates"))).sort();
    expect(names).toEqual(["001_lint", "003_a", "004_b"]);
    for (const name of ["manifest", "checks", "execution", "untracked", "digests"])
        await schema(join(root, out.evidence_dir), `${name}.json`, name === "untracked" ? "untracked-v2.schema.json" : `${name}.schema.json`);
    for (const line of (await readFile(join(root, out.evidence_dir, "evidence.jsonl"), "utf8")).trim().split("\n"))
        await validate(JSON.parse(line), "evidence-event.schema.json");
    for (const dir of names)
        await schema(join(root, out.evidence_dir, "gates", dir), "result.json", "gate-result.schema.json");
    expect((await validateDigests(join(root, out.evidence_dir))).ok).toBe(true);
});
test("single gate keeps declared numbering and optional failures do not fail a run", async () => {
    const root = await scratch();
    await config(root, [{ id: "one", run: "true" }, { id: "two", run: "false", optional: true }, { id: "three", run: "true" }]);
    const out = await verify(root, { gate: "two" });
    expect(out.status).toBe("passed");
    expect(await readdir(join(root, out.evidence_dir, "gates"))).toEqual(["002_two"]);
});
test("secrets are scrubbed in all captured text before seal, including command and both streams", async () => {
    const root = await scratch();
    const key = "secret-value-4bb20600a9";
    process.env.WRINGER_TEST_API_KEY = key;
    try {
        await config(root, [{ id: "test", run: `echo '${key}'; echo "$WRINGER_TEST_API_KEY" >&2; exit 1` }]);
        const out = await verify(root);
        for (const name of ["summary.md", "evidence.jsonl", ".wringer.yaml", "gates/001_test/stdout.log", "gates/001_test/stderr.log", "gates/001_test/result.json"]) {
            const text = await readFile(join(root, out.evidence_dir, name), "utf8");
            expect(text).not.toContain(key);
        }
        expect((await validateDigests(join(root, out.evidence_dir))).ok).toBe(true);
    }
    finally {
        delete process.env.WRINGER_TEST_API_KEY;
    }
});
test("real timeout reaps grandchild process group, even when shell traps TERM", async () => {
    const root = await scratch();
    const r = await runProcess("trap '' TERM; sleep 30 & echo $!; wait", { cwd: root, timeout: 0.15 });
    expect(r.timed_out).toBe(true);
    expect(r.duration_ms).toBeLessThan(2000);
    const pid = Number(r.stdout.trim());
    expect(pid).toBeGreaterThan(1);
    let alive = false;
    try {
        process.kill(pid, 0);
        alive = true;
    }
    catch { }
    expect(alive).toBe(false);
});
test("orphan-held pipes do not hang after the shell exits", async () => {
    const root = await scratch();
    const r = await runProcess("sleep 30 & echo done; exit 0", { cwd: root, timeout: 5 });
    expect(r.duration_ms).toBeLessThan(2000);
    expect(r.stdout).toContain("done");
});
test("abort leaves no invented gate.finished result and exits interrupted", async () => {
    const root = await scratch();
    await config(root, [{ id: "long", run: "sleep 30" }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const out = await verify(root, { signal: controller.signal });
    expect(out.status).toBe("interrupted");
    expect(out.exit_code).toBe(4);
    const events = (await readFile(join(root, out.evidence_dir, "evidence.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(events.map(e => e.type)).toEqual(["run.started", "git.status", "gate.started", "run.finished"]);
});
test("declared concurrent groups run together, serialize remainder and record contention", async () => {
    const root = await scratch();
    await config(root, [{ id: "a", run: "sleep 0.2", concurrent: true }, { id: "b", run: "sleep 0.2", concurrent: true }, { id: "c", run: "true" }]);
    const out = await verify(root);
    const c = JSON.parse(await readFile(join(root, out.evidence_dir, "concurrency.json"), "utf8"));
    expect(c.gates).toEqual([{ gate_id: "a", group: 1, beside: ["b"] }, { gate_id: "b", group: 1, beside: ["a"] }]);
    await schema(join(root, out.evidence_dir), "concurrency.json", "concurrency.schema.json");
    const serial = await verify(root, { serial: true });
    expect(await Bun.file(join(root, serial.evidence_dir, "concurrency.json")).exists()).toBe(false);
});
test("flaky observations stop the build without giving nondeterminism to a worker", async () => {
    const root = await scratch();
    await config(root, [{ id: "flaky", run: "if test -e .wringer/flipped; then exit 0; else touch .wringer/flipped; exit 1; fi", stability: { attempts: 2 } }], { run: { worker: "touch worker-ran", max_iterations: 2 } });
    const out = await run(root);
    expect(out.reason).toBe("flaky_gate");
    expect(await Bun.file(join(root, "worker-ran")).exists()).toBe(false);
    await schema(join(root, out.final!.evidence_dir), "stability.json", "stability.schema.json");
});
test("red-first evidence requires the same check and genuine failure, source wording frozen", async () => {
    const root = await scratch();
    await writeFile(join(root, "check.sh"), "test \"$(cat source.txt)\" = fixed\n");
    await config(root, [{ id: "accept", run: "sh check.sh", proves: "works" }]);
    await spec(root, [{ id: "works", title: "It works", required: true }, { id: "unbound", title: "Also required", required: true }]);
    const red = await verify(root);
    expect(red.acceptance.counts["gate-failed"]).toBe(1);
    await writeFile(join(root, "source.txt"), "fixed\n");
    const green = await verify(root);
    expect(green.acceptance.criteria[0].state).toBe("evidenced");
    expect(green.acceptance.criteria[0].receipt.bundle).toBe(red.evidence_dir);
    expect(green.acceptance.criteria[1].refuses).toBe(true);
    await schema(join(root, green.evidence_dir), "acceptance.json", "acceptance-v3.schema.json");
    await schema(join(root, green.evidence_dir), "coverage.json", "coverage-v1.schema.json");
    expect(await Bun.file(join(root, green.evidence_dir, "wringer.spec.yaml")).exists()).toBe(true);
    await writeFile(join(root, "check.sh"), "true\n");
    const weakened = await verify(root);
    expect(weakened.acceptance.criteria[0].state).toBe("unevidenced");
});
test("tampered red receipt and exit-127 environmental failure cannot establish proof", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "test -e fixed", proves: "works" }]);
    await spec(root, [{ id: "works", title: "It works" }]);
    const red = await verify(root);
    await writeFile(join(root, red.evidence_dir, "gates/001_check/stdout.log"), "tampered");
    await writeFile(join(root, "fixed"), "");
    const green = await verify(root);
    expect(green.acceptance.criteria[0].state).toBe("unevidenced");
    expect(await Bun.file(join(root, green.evidence_dir, "history-notices.json")).exists()).toBe(true);
});
test("human words and note preserved, stale judgement refuses after wording change", async () => {
    const root = await scratch();
    await config(root, [{ id: "base", run: "true" }], { show: { visual: "echo display" } });
    const c = { id: "visual", title: "Looks clear", human: true };
    await spec(root, [c]);
    await writeFile(join(root, "wringer.judgements.yaml"), JSON.stringify({ schema_version: "wringer.judgement.v2", judgements: [{ criterion: c.id, verdict: "met", by: "Marc", at: new Date().toISOString(), criterion_digest: criterionDigest(c), note: "Yes: my own words # kept." }] }));
    const entry = JSON.parse(await readFile(join(root, "wringer.judgements.yaml"), "utf8")).judgements[0];
    const unbound = await verify(root);
    expect(unbound.acceptance.criteria[0].refuses).toBe(true);
    await writeFile(join(root, ".wringer/judgement-bindings.json"), JSON.stringify({ schema_version: "wringer.native.judgement-bindings.v1", entries: [{ criterion: c.id, source_fingerprint: await humanSourceFingerprint(root), entry_sha256: sha256(JSON.stringify(entry)) }] }));
    const out = await verify(root);
    expect(out.acceptance.criteria[0].state).toBe("human");
    expect(out.acceptance.criteria[0].refuses).toBe(false);
    expect(out.acceptance.criteria[0].judgement.note).toBe("Yes: my own words # kept.");
    await schema(join(root, out.evidence_dir), "judgements.json", "judgement-record.schema.json");
    await writeFile(join(root, "source.txt"), "changed after human review\n");
    const changedSource = await verify(root);
    expect(changedSource.acceptance.criteria[0].refuses).toBe(true);
    expect(changedSource.acceptance.criteria[0].cause).toBe("human-judgement-stale");
    await spec(root, [{ ...c, title: "Looks different" }]);
    const stale = await verify(root);
    expect(stale.acceptance.criteria[0].cause).toBe("human-judgement-stale");
    expect(stale.acceptance.criteria[0].refuses).toBe(true);
});
test("build converges from real worker edits even when worker exits nonzero", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "test \"$(cat source.txt)\" = fixed", proves: "works" }], { run: { worker: "printf 'fixed\\n' > source.txt; exit 9", max_iterations: 2, worker_timeout: 5 } });
    await spec(root, [{ id: "works", title: "The source is fixed" }]);
    const out = await run(root);
    expect(out.status).toBe("converged");
    expect(out.final?.acceptance.counts.evidenced).toBe(1);
    await schema(join(root, out.loop_dir), "manifest.json", "loop-manifest-v2.schema.json");
    for (const line of (await readFile(join(root, out.loop_dir, "loop.jsonl"), "utf8")).trim().split("\n"))
        await validate(JSON.parse(line), "loop-event-v2.schema.json");
});
test("no-progress stops after exactly one verify and captures causal stdout as well as stderr", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "false" }], { run: { worker: "echo 'model requires newer CLI'; echo 'Reading stdin' >&2; exit 1", max_iterations: 2 } });
    const out = await run(root);
    expect(out.reason).toBe("no_progress");
    expect(out.worker_turns).toBe(1);
    expect(await readdir(join(root, ".wringer/runs"))).toHaveLength(1);
    const diagnosis = JSON.parse(await readFile(join(root, out.loop_dir, "worker-diagnosis.json"), "utf8"));
    expect(diagnosis.stdout_tail).toContain("requires newer CLI");
    expect(diagnosis.stderr_tail).toContain("Reading stdin");
    expect(out.next_move).toContain("wring resume");
});
test("a legacy or malformed loop cannot resume by resetting an unknown worker budget", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "false" }], { run: { worker: "true", max_iterations: 3 } });
    const stopped = await run(root), directory = join(root, stopped.loop_dir);
    await writeFile(join(directory, "checkpoint.json"), JSON.stringify({ schema_version: "wringer.native.loop-checkpoint.v1", workers: -1, iterations: 1 }));
    await new Bundle(directory).seal();
    await expect(run(root, { resume: stopped.loop_dir })).rejects.toThrow("worker-count checkpoint");
    expect(await readdir(join(root, ".wringer/runs"))).toHaveLength(1);
});
test("resume preserves original authority and refuses changed approved wording without another worker", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "false" }], { run: { worker: "true", max_iterations: 3 } });
    await spec(root, [{ id: "works", title: "Original" }]);
    const out = await run(root);
    await spec(root, [{ id: "works", title: "Changed" }]);
    const resumed = await run(root, { resume: out.loop_dir });
    expect(resumed.reason).toBe("authority_moved");
    expect(await readdir(join(root, ".wringer/runs"))).toHaveLength(1);
});
test("doctor reads last verification record and explain retains both streams", async () => {
    const root = await scratch();
    await config(root, [{ id: "test", run: "echo useful; echo broken >&2; false" }]);
    const out = await verify(root);
    const d = await doctor(root);
    expect(d.last_verify).toBe(out.evidence_dir);
    expect(d.checks.find(c => c.name === "last verify").detail).toContain(out.manifest.run_id);
    const e = await explain(root);
    expect(e.stdout).toContain("useful");
    expect(e.stderr).toContain("broken");
});
test("path traversal and symlinked evidence paths refuse before overwriting arbitrary files", async () => {
    const root = await scratch();
    await config(root, [{ id: "test", run: "true" }]);
    await expect(verify(root, { output: "../escape" })).rejects.toThrow("escapes");
    const outside = await mkdtemp(join(tmpdir(), "wringer-native-outside-"));
    roots.push(outside);
    await mkdir(join(root, ".wringer"));
    await symlink(outside, join(root, ".wringer/runs"));
    await expect(verify(root)).rejects.toThrow();
});
test("snapshot fingerprints untracked bytes and refuses merge state", async () => {
    const root = await scratch();
    await writeFile(join(root, "new.txt"), "a");
    const a = await snapshot(root);
    await writeFile(join(root, "new.txt"), "b");
    const b = await snapshot(root);
    expect(a.fingerprint).not.toBe(b.fingerprint);
    await writeFile(join(root, ".git/MERGE_HEAD"), a.head_sha!);
    await expect(snapshot(root)).rejects.toThrow("MERGE_HEAD");
});
test("prove re-runs current acceptance bytes against HEAD and writes sensitive receipts", async () => {
    const root = await scratch();
    await writeFile(join(root, "check.sh"), "test \"$(cat source.txt)\" = fixed\n");
    await config(root, [{ id: "accept", run: "sh check.sh", proves: "works" }]);
    await spec(root, [{ id: "works", title: "It works" }]);
    await writeFile(join(root, "source.txt"), "fixed\n");
    const out = await verify(root, { prove: true });
    const record = await Bun.file(join(root, out.evidence_dir, "vacuity.json")).json();
    expect(record.verdict).toBe("proven");
    expect(out.acceptance.criteria[0].receipt.kind).toBe("sensitive");
    await schema(join(root, out.evidence_dir), "vacuity.json", "vacuity.schema.json");
    expect((await git(root, ["worktree", "list", "--porcelain"])).stdout.match(/^worktree /gm)).toHaveLength(1);
    expect(await readFile(join(root, "source.txt"), "utf8")).toBe("fixed\n");
});
test("prove distinguishes vacuous checks and failed environment setup from proof", async () => {
    const root = await scratch();
    await config(root, [{ id: "vacuous", run: "true" }]);
    let out = await verify(root, { prove: true });
    expect((await Bun.file(join(root, out.evidence_dir, "vacuity.json")).json()).verdict).toBe("gates_vacuous");
    await config(root, [{ id: "vacuous", run: "true" }], { run: { worker: "true", prove_setup: "echo environment-broken >&2; exit 1" } });
    out = await verify(root, { prove: true });
    const record = await Bun.file(join(root, out.evidence_dir, "vacuity.json")).json();
    expect(record.verdict).toBe("inconclusive");
    expect(record.setup.ok).toBe(false);
    expect(record.gates).toHaveLength(0);
});
test("tracked binary content changes fingerprint without including raw binary payload in diff", async () => {
    const root = await scratch();
    await writeFile(join(root, "data.bin"), Buffer.from([0, 1, 2]));
    await git(root, ["add", "data.bin"]);
    await git(root, ["commit", "-m", "binary"]);
    await writeFile(join(root, "data.bin"), Buffer.from([0, 3, 2]));
    const a = await snapshot(root);
    await writeFile(join(root, "data.bin"), Buffer.from([0, 4, 2]));
    const b = await snapshot(root);
    expect(a.diff).toContain("Binary files");
    expect(a.diff).not.toContain("GIT binary patch");
    expect(a.fingerprint).not.toBe(b.fingerprint);
});
test("gate artifacts are bounded, text-redacted, and omit symlinks or unknown types", async () => {
    const root = await scratch();
    process.env.WRINGER_ARTIFACT_TEST_KEY = "artifact-secret-36baa719";
    try {
        await config(root, [{ id: "display", run: "printf '%s' \"$WRINGER_ARTIFACT_TEST_KEY\" > \"$WRINGER_ARTIFACTS_DIR/note.txt\"; printf 'unknown' > \"$WRINGER_ARTIFACTS_DIR/data.exe\"; ln -s /etc/passwd \"$WRINGER_ARTIFACTS_DIR/escape.txt\"", artifacts: { max_bytes: 1024, total_bytes: 2048 } }]);
        const out = await verify(root);
        const dir = join(root, out.evidence_dir, "gates/001_display");
        await schema(dir, "artifacts.json", "gate-artifacts.schema.json");
        const record = await Bun.file(join(dir, "artifacts.json")).json();
        expect(record.artifacts[0].name).toBe("note.txt");
        expect(record.artifacts[0].redacted).toBe(true);
        expect(record.omitted.map((r: any) => r.reason)).toEqual(["unknown_type", "unreadable"]);
        expect(await readFile(join(dir, "artifacts/note.txt"), "utf8")).toBe("[REDACTED]");
        expect((await validateDigests(join(root, out.evidence_dir))).ok).toBe(true);
    }
    finally {
        delete process.env.WRINGER_ARTIFACT_TEST_KEY;
    }
});
test("container argv makes network, env-name forwarding, mounts and cleanup inspectable without claiming live isolation", () => {
    const c = parseConfig({ version: 1, gates: [{ id: "test", run: "true" }], execution: { backend: "container", image: "local/checks", runtime: "docker", env: ["MY_API_KEY"], user: "1000:1000" } });
    const argv = containerArgv(c.execution!, "/tmp/project", "/tmp/cid", "echo ok");
    expect(argv).toContain("--pull=never");
    expect(argv.slice(argv.indexOf("--network"), argv.indexOf("--network") + 2)).toEqual(["--network", "none"]);
    expect(argv.slice(argv.indexOf("--env"), argv.indexOf("--env") + 2)).toEqual(["--env", "MY_API_KEY"]);
    expect(argv).not.toContain("--privileged");
    expect(() => containerArgv(c.execution!, "/tmp/a:b", "/tmp/cid", "true")).toThrow();
    const containment = parseConfig({ version: 1, gates: [{ id: "test", run: "true" }], run: { worker: "codex exec", containment: { image: "local/worker", env: ["CODEX_API_KEY"], egress: { policy: "allowlist", hosts: ["api.example.com"], ports: [443], broker_image: "local/broker" } } } }).run!.containment!;
    const script = armScript(containment);
    expect(script).toContain("iptables -P OUTPUT DROP");
    expect(script).toContain("ip6tables -P OUTPUT DROP");
    expect(script).toContain("'api.example.com'");
    expect(() => parseConfig({ version: 1, gates: [{ id: "test", run: "true" }], run: { worker: "true", containment: { image: "x", egress: { policy: "allowlist", hosts: ["x; echo escaped"], broker_image: "b" } } } })).toThrow();
});
test("real container protocol stub exercises native gate runner and cid cleanup; it is not an isolation test", async () => {
    const root = await scratch();
    await mkdir(join(root, "bin"));
    const executable = join(root, "bin/docker");
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${join(root, "runtime-argv.txt")}'\nif [ "$1" = image ]; then exit 0; fi\nif [ "$1" = rm ]; then exit 0; fi\nprevious=''\nfor arg in "$@"; do if [ "$previous" = --cidfile ]; then printf '%064d' 0 > "$arg"; fi; previous="$arg"; done\n/bin/sh -c "$previous"\n`);
    await chmod(executable, 0o755);
    const old = process.env.PATH;
    process.env.PATH = `${join(root, "bin")}:${old}`;
    try {
        await config(root, [{ id: "test", run: "echo measured" }], { execution: { backend: "container", image: "local/fixture", env: [] } });
        const out = await verify(root);
        expect(out.status).toBe("passed");
        await schema(join(root, out.evidence_dir), "execution.json", "execution.schema.json");
        const e = await Bun.file(join(root, out.evidence_dir, "execution.json")).json();
        expect(e.execution_mode).toBe("container");
        expect(await readFile(join(root, "runtime-argv.txt"), "utf8")).toContain("rm\n--force");
    }
    finally {
        process.env.PATH = old;
    }
});
test("worker timeout tightening is enforced and cannot increase the repository ceiling", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "false" }], { run: { worker: "sleep 30", worker_timeout: 5, max_iterations: 1 } });
    await expect(run(root, { workerTimeout: 10 })).rejects.toThrow("tighten");
    const out = await run(root, { workerTimeout: 0.1 });
    expect(out.reason).toBe("no_progress");
    const lines = (await readFile(join(root, out.loop_dir, "loop.jsonl"), "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(lines.find(e => e.type === "worker.finished").timed_out).toBe(true);
});
test("a loop wall-clock ceiling also bounds verification before any worker spend", async () => {
    const root = await scratch();
    await config(root, [{ id: "slow", run: "sleep 30", timeout: 60 }], { run: { worker: "touch worker-ran", max_iterations: 1 } });
    const started = Date.now(), out = await run(root, { wallClock: 0.1 });
    expect(out.reason).toBe("wall_clock");
    expect(out.status).toBe("stopped");
    expect(Date.now() - started).toBeLessThan(2500);
    expect(await Bun.file(join(root, "worker-ran")).exists()).toBe(false);
});
test("a worker cannot increase its budget or weaken its check declaration mid-loop", async () => {
    const root = await scratch();
    await config(root, [{ id: "check", run: "false" }], { run: { worker: "printf '{\"version\":1,\"gates\":[{\"id\":\"check\",\"run\":\"true\"}],\"run\":{\"worker\":\"true\",\"max_iterations\":100}}' > .wringer.yaml", max_iterations: 1 } });
    const out = await run(root);
    expect(out.reason).toBe("authority_moved");
    expect(out.status).toBe("stopped");
    expect(await readdir(join(root, ".wringer/runs"))).toHaveLength(1);
});
test("a passing gate that replaces its own check fails verification and never invokes a repair worker", async () => {
    const root = await scratch();
    await writeFile(join(root, "check.sh"), "printf 'true\\n' > check.sh\nexit 0\n");
    await config(root, [{ id: "check", run: "sh check.sh" }], { run: { worker: "touch worker-ran", max_iterations: 1 } });
    const out = await run(root);
    expect(out.reason).toBe("check_mutated");
    expect(out.final!.status).toBe("failed");
    expect(out.final!.results[0]!.status).toBe("passed");
    expect(await Bun.file(join(root, "worker-ran")).exists()).toBe(false);
});
test("prove setup cannot manufacture sensitivity by replacing the copied check", async () => {
    const root = await scratch();
    await writeFile(join(root, "check.sh"), "test \"$(cat source.txt)\" = fixed\n");
    await config(root, [{ id: "accept", run: "sh check.sh", proves: "works" }], { run: { worker: "true", prove_setup: "printf 'exit 1\\n' > check.sh" } });
    await spec(root, [{ id: "works", title: "It works" }]);
    await writeFile(join(root, "source.txt"), "fixed\n");
    const out = await verify(root, { prove: true });
    expect(out.vacuity.verdict).toBe("inconclusive");
    expect(out.vacuity.reason).toContain("changed the copied check identity");
    expect(out.acceptance.criteria[0].state).toBe("unevidenced");
    expect(await readFile(join(root, "check.sh"), "utf8")).toContain("cat source.txt");
});
test("container sensitivity uses a self-contained pre-change clone; protocol stub is not an isolation claim", async () => {
    const root = await scratch(), bin = await mkdtemp(join(tmpdir(), "wringer-container-prove-stub-"));
    roots.push(bin);
    const executable = join(bin, "docker");
    await writeFile(executable, `#!/bin/sh\nif [ "$1" = image ] || [ "$1" = rm ]; then exit 0; fi\nprevious=''\nwork=''\nfor arg in "$@"; do\n if [ "$previous" = --cidfile ]; then printf '%064d' 0 > "$arg"; fi\n if [ "$previous" = --volume ]; then case "$arg" in *:/workspace) work="\${arg%:/workspace}";; esac; fi\n previous="$arg"\ndone\ncd "$work" || exit 2\ntest -d .git || exit 2\n/bin/sh -c "$previous"\n`);
    await chmod(executable, 0o755);
    const old = process.env.PATH;
    process.env.PATH = `${bin}:${old}`;
    try {
        await writeFile(join(root, "check.sh"), "test \"$(cat source.txt)\" = fixed\n");
        await config(root, [{ id: "accept", run: "sh check.sh", proves: "works" }], { execution: { backend: "container", image: "local/fixture" } });
        await spec(root, [{ id: "works", title: "It works" }]);
        await writeFile(join(root, "source.txt"), "fixed\n");
        const out = await verify(root, { prove: true });
        expect(out.vacuity.verdict).toBe("proven");
        expect(out.acceptance.criteria[0].receipt.kind).toBe("sensitive");
        expect(await readFile(join(root, "source.txt"), "utf8")).toBe("fixed\n");
    }
    finally {
        process.env.PATH = old;
    }
});
test("worker-auth probes saved login without a key and distinguishes all four credential states before spend", async () => {
    const root = await scratch(), bin = join(root, "bin");
    await mkdir(bin);
    const executable = join(bin, "codex");
    await writeFile(executable, `#!/bin/sh\nif [ -n "$CODEX_API_KEY" ]; then echo 'ERROR: key crossed into saved-login probe'; exit 9; fi\ncase "$WRINGER_AUTH_TEST_MODE" in login) echo 'Logged in using ChatGPT';; absent) echo 'Not logged in'; exit 1;; *) echo 'unknown output'; exit 2;; esac\n`);
    await chmod(executable, 0o755);
    const before = { PATH: process.env.PATH, key: process.env.CODEX_API_KEY, mode: process.env.WRINGER_AUTH_TEST_MODE }, c = parseConfig({ version: 1, gates: [{ id: "test", run: "true" }], run: { worker: "codex -a never exec --sandbox workspace-write" } });
    try {
        process.env.PATH = `${bin}:${before.PATH}`;
        process.env.WRINGER_AUTH_TEST_MODE = "absent";
        process.env.CODEX_API_KEY = "fixture-key-not-a-real-provider-key";
        let auth = await workerAuth(root, c);
        expect(auth.credential).toBe("key-only");
        expect(auth.blocking).toBe(false);
        expect(auth.words).toContain("Presence is not validity");
        process.env.WRINGER_AUTH_TEST_MODE = "login";
        auth = await workerAuth(root, c);
        expect(auth.credential).toBe("key-and-login");
        expect(auth.blocking).toBe(true);
        delete process.env.CODEX_API_KEY;
        auth = await workerAuth(root, c);
        expect(auth.credential).toBe("login-only");
        expect(auth.blocking).toBe(false);
        process.env.WRINGER_AUTH_TEST_MODE = "absent";
        auth = await workerAuth(root, c);
        expect(auth.credential).toBe("none");
        expect(auth.blocking).toBe(true);
        process.env.WRINGER_AUTH_TEST_MODE = "unknown";
        process.env.CODEX_API_KEY = "fixture-key-not-a-real-provider-key";
        auth = await workerAuth(root, c);
        expect(auth.credential).toBe("key-login-unsettled");
        expect(auth.blocking).toBe(true);
    }
    finally {
        process.env.PATH = before.PATH;
        if (before.key === undefined)
            delete process.env.CODEX_API_KEY;
        else
            process.env.CODEX_API_KEY = before.key;
        if (before.mode === undefined)
            delete process.env.WRINGER_AUTH_TEST_MODE;
        else
            process.env.WRINGER_AUTH_TEST_MODE = before.mode;
    }
});
