/** Explicit CI-only local formula installation, using the same archive bytes. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runProcess } from "../packages/engine/src/process";
const channels = resolve(process.argv[2] ?? ""), artifacts = resolve(process.argv[3] ?? ""), evidence = resolve(process.argv[4] ?? "");
if (process.argv[5] !== "--apply-ci-fixture" || process.env.CI !== "true" || process.platform !== "darwin") throw new Error("This explicit Homebrew fixture requires macOS CI; it does not install a global formula on a user's machine");
const brew = Bun.which("brew"); if (!brew) throw new Error("Homebrew is required by the selected channel measurement");
const report = JSON.parse(await readFile(join(channels, "CHANNELS.json"), "utf8"));
let formula = (await readFile(join(channels, "wringer.rb"), "utf8")).replace("class Wringer < Formula", "class WringerCandidateFixture < Formula");
for (const asset of report.artifacts) formula = formula.replace(asset.url, pathToFileURL(join(artifacts, asset.url.split("/").at(-1))).href);
await mkdir(evidence, { recursive: true }); const path = join(evidence, "wringer-candidate-fixture.rb"); await writeFile(path, formula, { flag: "wx" });
const env = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ANALYTICS: "1" };
const checks: { name: string; exit: number | null; timedOut: boolean }[] = [];
async function run(name: string, args: string[]) {
    const result = await runProcess([brew!, ...args], { cwd: evidence, env, timeout: 300, maxBytes: 2 * 1024 * 1024 });
    await writeFile(join(evidence, name + ".log"), result.stdout + result.stderr); checks.push({ name, exit: result.exit_code, timedOut: result.timed_out });
    if (result.exit_code || result.timed_out) throw new Error(`Homebrew fixture ${name} failed; inspect retained log`);
}
const prior = await runProcess([brew, "list", "--versions", "wringer-candidate-fixture"], { cwd: evidence, env, timeout: 30, maxBytes: 4096 });
if (prior.exit_code === 0 && prior.stdout.trim()) throw new Error("A prior formula exists; it will not be replaced or uninstalled");
const tap = `wringer-fixture/candidate-${crypto.randomUUID()}`, qualified = `${tap}/wringer-candidate-fixture`;
let installed = false, createdTap = false;
try {
    // Current Homebrew accepts a named tapped formula. Do not rely on the
    // historical direct .rb-path installation interface.
    await run("create-owned-tap", ["tap-new", tap]); createdTap = true;
    const located = await runProcess([brew, "--repository", tap], { cwd: evidence, env, timeout: 30, maxBytes: 4096 });
    if (located.exit_code || located.timed_out || !located.stdout.trim().startsWith("/") || located.stdout_truncated) throw new Error("Owned Homebrew tap location unavailable");
    const formulaPath = join(located.stdout.trim(), "Formula", "wringer-candidate-fixture.rb");
    await writeFile(formulaPath, formula, { flag: "wx" });
    await run("install", ["install", "--formula", qualified]); installed = true;
    await run("functional-demo", ["test", qualified]);
} finally {
    try { if (installed) await run("remove-owned-fixture", ["uninstall", "--formula", qualified]); }
    finally {
        try { if (createdTap) await run("remove-owned-tap", ["untap", tap]); }
        finally { await writeFile(join(evidence, "result.json"), JSON.stringify({ kind: "actual Homebrew, local candidate URL substitution with identical digest", version: report.version, artifacts: report.artifacts, checks }, null, 2) + "\n"); }
    }
}
