/**
 * Declared inputs in a check's identity, and the post-run source comparison.
 *
 * Measured before this release: `checks.json` said, in its own limits, *only files
 * explicitly named in a shell command are hashed*. `vitest run` names nothing,
 * discovers `tests/**` at runtime, and is configured by a file and a lockfile that
 * decide what those tests are — so changing an indirectly loaded test left identity
 * byte-identical, and a receipt comparing red to green accepted a transition that
 * was no longer about the same assertions. And ZenJev's CI coordinator compared
 * source cleanliness before AND after verification; Wringer captured its snapshot
 * fingerprint before the gates and nothing after.
 *
 * Every red-watch here was observed failing with its guard removed.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { checkIdentity, MAX_INPUT_FILES } from "../src/acceptance";
import { parseConfig } from "../src/config";
import { git } from "../src/git";
import { schemaDirectory } from "../src/io";
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
    const root = await mkdtemp(join(tmpdir(), "wringer-strict-"));
    roots.push(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Strict Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(root, ".gitignore"), ".wringer/\ndist/\n");
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests/one.test.ts"), "// the runner discovers this\n");
    await writeFile(join(root, "vitest.config.ts"), "export default {};\n");
    await writeFile(join(root, "source.txt"), "fixture\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    return root;
}
const gate = (over: any = {}) => ({ id: "unit", run: "true", timeout: 120, optional: false, proves: [], corroborates: [], inputs: [], concurrent: false, ...over });
test("declared globs are hashed into identity, and the coverage label says which parts exist", async () => {
    const root = await repo();
    const bare = await checkIdentity(root, gate({ run: "npx vitest run" }));
    expect(bare.coverage).toBe("command-only");
    expect(bare.inputs).toEqual({});
    const declared = await checkIdentity(root, gate({ run: "npx vitest run", inputs: ["tests/**", "vitest.config.ts"] }));
    expect(declared.coverage).toBe("command-and-inputs");
    expect(Object.keys(declared.inputs).sort()).toEqual(["tests/one.test.ts", "vitest.config.ts"]);
    const both = await checkIdentity(root, gate({ run: "node vitest.config.ts", inputs: ["tests/**"] }));
    expect(both.coverage).toBe("command-files-and-inputs");
    expect(Object.keys(both.files)).toEqual(["vitest.config.ts"]);
    expect(await checkIdentity(root, gate({ run: "node vitest.config.ts" }))).toMatchObject({ coverage: "command-and-files" });
    // Its own evidence directory is never part of a check's identity.
    await mkdir(join(root, ".wringer/runs/x"), { recursive: true });
    await writeFile(join(root, ".wringer/runs/x/thing.ts"), "x");
    expect(Object.keys((await checkIdentity(root, gate({ inputs: ["**/*.ts"] }))).inputs)).not.toContain(".wringer/runs/x/thing.ts");
});
// RED-WATCH: `inputs` dropped from identity.
test("changing an indirectly loaded test invalidates comparability", async () => {
    const root = await repo();
    const declared = () => checkIdentity(root, gate({ run: "npx vitest run", inputs: ["tests/**"] }));
    const before = await declared();
    await writeFile(join(root, "tests/one.test.ts"), "// the assertions changed entirely\n");
    const after = await declared();
    expect(after.run_sha256).toBe(before.run_sha256);
    expect(after.files).toEqual(before.files);
    // The command is identical and names nothing. Only the declared inputs saw the change.
    expect(after.inputs).not.toEqual(before.inputs);
    // A newly discovered test file is also a changed identity.
    await writeFile(join(root, "tests/two.test.ts"), "// a second case appears\n");
    expect(Object.keys((await declared()).inputs).sort()).toEqual(["tests/one.test.ts", "tests/two.test.ts"]);
});
test("inputs globs are bounded and repository-relative", () => {
    const base = { version: 1, gates: [{ id: "a", run: "true", inputs: ["tests/**"] }] };
    expect(parseConfig(base).gates[0]!.inputs).toEqual(["tests/**"]);
    expect(parseConfig({ version: 1, gates: [{ id: "a", run: "true", inputs: "tests/**" }] }).gates[0]!.inputs).toEqual(["tests/**"]);
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", inputs: ["/etc/**"] }] })).toThrow("repository-relative glob");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", inputs: ["../outside/**"] }] })).toThrow("repository-relative glob");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", inputs: ["tests/**", "tests/**"] }] })).toThrow("names the same glob twice");
    expect(() => parseConfig({ version: 1, gates: [{ id: "a", run: "true", inputs: Array.from({ length: 65 }, (_, i) => `d${i}/**`) }] })).toThrow("more than 64 globs");
    expect(MAX_INPUT_FILES).toBe(4096);
});
test("a run writes checks v2 only where a gate declares inputs", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "true" }] }));
    const plain = await verify(root);
    const v1 = await Bun.file(join(root, plain.evidence_dir, "checks.json")).json();
    expect(v1.schema_version).toBe("wringer.checks.v1");
    expect(v1.checks[0].inputs).toBeUndefined();
    await schema(v1, "checks.schema.json");
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "true", inputs: ["tests/**"] }] }));
    const declared = await verify(root);
    const v2 = await Bun.file(join(root, declared.evidence_dir, "checks.json")).json();
    expect(v2.schema_version).toBe("wringer.checks.v2");
    expect(Object.keys(v2.checks[0].inputs)).toEqual(["tests/one.test.ts"]);
    await schema(v2, "checks-v2.schema.json");
    expect(v2.limits[0]).toContain("the tracked files a gate's declared inputs globs match");
});
// RED-WATCH: strict mode ignoring a tracked modification.
test("strict refuses an exact-source claim a gate took away, and permits ignored build output", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "true" }] }));
    const clean = await verify(root, { strict: true });
    expect(clean.status).toBe("passed");
    expect(clean.exit_code).toBe(0);
    const selection = await Bun.file(join(root, clean.evidence_dir, "selection.json")).json();
    await schema(selection, "selection-v3.schema.json");
    expect(selection.schema_version).toBe("wringer.selection.v3");
    expect(selection.strict).toMatchObject({ exact_source: true, changed_tracked: [] });
    expect(selection.strict.before).toBe(selection.strict.after);
    expect(selection.strict.reason).toContain("This result describes the commit under review");
    // Ignored build output is permitted and counted, not hidden. The build's artifact is written
    // by a script rather than named in the command, because a file the command NAMES is covered by
    // the existing check-mutation rule and would fail the run for a different and correct reason.
    await writeFile(join(root, "build.sh"), "mkdir -p dist && echo built > dist/app.js\n");
    await git(root, ["add", "build.sh"]);
    await git(root, ["commit", "-m", "build script"]);
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "sh build.sh" }] }));
    const built = await verify(root, { strict: true });
    expect(built.status).toBe("passed");
    const permitted = await Bun.file(join(root, built.evidence_dir, "selection.json")).json();
    expect(permitted.strict.exact_source).toBeTrue();
    expect(permitted.strict.permitted_ignored).toBeGreaterThan(0);
    expect(permitted.strict.reason).toContain("permitted build output");
    // A gate that writes to TRACKED source cannot leave an exact-source claim.
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "echo rewritten > source.txt" }] }));
    const mutated = await verify(root, { strict: true });
    expect(mutated.results[0]!.status).toBe("passed");
    expect(mutated.status).toBe("failed");
    expect(mutated.exit_code).toBe(1);
    const broken = await Bun.file(join(root, mutated.evidence_dir, "selection.json")).json();
    expect(broken.strict).toMatchObject({ exact_source: false, changed_tracked: ["source.txt"] });
    expect(broken.strict.before).not.toBe(broken.strict.after);
    expect(broken.strict.reason).toContain("cannot leave an exact-source claim");
    expect(await readFile(join(root, mutated.evidence_dir, "summary.md"), "utf8")).toContain("A gate wrote to the source under review");
    // Without the flag, nothing is claimed either way and the record stays v1.
    const quiet = await verify(root);
    expect(quiet.status).toBe("passed");
    expect((await Bun.file(join(root, quiet.evidence_dir, "selection.json")).json()).schema_version).toBe("wringer.selection.v1");
});
test("strict is automatic under CI, through the public entry", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "unit", run: "echo rewritten > source.txt" }] }));
    const { dispatch } = await import("../../cli/src/app");
    const before = process.env.CI;
    try {
        process.env.CI = "true";
        const answer = await dispatch(["verify", "--repo", root]);
        expect(answer.exit).toBe(1);
        const value = answer.value as { evidence_dir: string };
        expect((await Bun.file(join(root, value.evidence_dir, "selection.json")).json()).strict.exact_source).toBeFalse();
    }
    finally {
        if (before === undefined)
            delete process.env.CI;
        else
            process.env.CI = before;
    }
});

// RED-WATCH: the pages that teach this reverted.
test("the operator pages carry the inputs and strict sentences", async () => {
    const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
    const setup = await Bun.file(join(root, "SETUP.md")).text();
    expect(setup).toContain("inputs: [tests/**, vitest.config.ts, package-lock.json]");
    expect(setup).toContain("cannot leave an exact-source claim");
    expect(setup).toContain("automatic when `CI=true`");
    const headless = await Bun.file(join(root, "docs/native/HEADLESS.md")).text();
    expect(headless).toContain("A gate that modifies tracked\nsource cannot leave an exact-source claim");
    expect(headless).toContain("changing a discovered test leaves it byte-identical");
    const schemas = await Bun.file(join(root, "schema/README.md")).text();
    for (const file of ["checks-v2.schema.json", "selection-v3.schema.json"])
        expect(schemas, file).toContain(`[\`${file}\`](${file})`);
});
