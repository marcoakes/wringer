import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/config";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(files: Record<string, string>) { const root = await mkdtemp(join(tmpdir(), "wringer-discovery-")); roots.push(root); for (const [name, data] of Object.entries(files)) await writeFile(join(root, name), data); return root; }
test("T05 no-check discovery cannot create a successful placeholder", async () => {
    const root = await fixture({}); const result = await init(root);
    expect(result.status).toBe("incomplete");
    expect(await Bun.file(join(root, ".wringer.yaml")).exists()).toBeFalse();
    expect(await Bun.file(join(root, ".gitignore")).exists()).toBeFalse();
});
test("T04 discovery identifies Rust and Go checks as inert proposals", async () => {
    const rust = await fixture({ "Cargo.toml": '[package]\nname="fixture"\nversion="0.1.0"\n', "Cargo.lock": "version=4\n" });
    expect((await init(rust)).gates).toContainEqual(expect.objectContaining({ id: "test", run: "cargo test --locked" }));
    const go = await fixture({ "go.mod": "module example.invalid/fixture\n\ngo 1.24\n" });
    expect((await init(go)).gates).toContainEqual(expect.objectContaining({ id: "test", run: "go test ./..." }));
});
test("W7 discovery proposes JVM, .NET, Swift and Elixir tests, preferring a committed wrapper", async () => {
    const run = async (files: Record<string, string>) => (await init(await fixture(files), { dryRun: true })).gates.map(g => g.run);
    expect(await run({ "build.gradle.kts": "plugins { java }\n", gradlew: "#!/bin/sh\n" })).toEqual(["./gradlew test"]);
    expect(await run({ "build.gradle": "apply plugin: 'java'\n" })).toEqual(["gradle test"]);
    expect(await run({ "pom.xml": "<project/>\n", mvnw: "#!/bin/sh\n" })).toEqual(["./mvnw -B test"]);
    expect(await run({ "pom.xml": "<project/>\n" })).toEqual(["mvn -B test"]);
    expect(await run({ "App.sln": "\n" })).toEqual(["dotnet test App.sln"]);
    expect(await run({ "App.csproj": "<Project/>\n" })).toEqual(["dotnet test"]);
    expect(await run({ "Package.swift": "// swift-tools-version:5.9\n" })).toEqual(["swift test"]);
    expect(await run({ "mix.exs": "defmodule Fixture.MixProject do end\n" })).toEqual(["mix test"]);
    // Two solutions are ambiguous: no check is guessed, and the reason is given.
    const two = await init(await fixture({ "A.sln": "\n", "B.sln": "\n" }), { dryRun: true });
    expect(two.status).toBe("incomplete"); expect(two.suggestions.join(" ")).toContain("Several .NET solutions (A.sln, B.sln)");
});
test("T08 preview is nonmutating and package-manager choice comes from data", async () => {
    const root = await fixture({ "package.json": JSON.stringify({ packageManager: "yarn@4.9.0", scripts: { test: "touch MUST_NOT_RUN; exit 1" } }) });
    const result = await init(root, { dryRun: true });
    expect(result.gates).toContainEqual(expect.objectContaining({ id: "test", run: "yarn run test" }));
    expect(await Bun.file(join(root, ".wringer.yaml")).exists()).toBeFalse();
    expect(await Bun.file(join(root, "MUST_NOT_RUN")).exists()).toBeFalse();
});
test("T08 existing configuration remains byte-identical under inspection", async () => {
    const original = "version: 1\ngates:\n  - id: custom\n    run: ./check.sh\n";
    const root = await fixture({ ".wringer.yaml": original });
    expect((await init(root, { dryRun: true })).status).toBe("existing");
    expect(await readFile(join(root, ".wringer.yaml"), "utf8")).toBe(original);
});
