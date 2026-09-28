/** Actual local CLI/check execution from shipped inert examples. No model calls. */
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, runProcess, validateDigests } from "../packages/engine/src";
import { hashBytes } from "../packages/plan/src";
import { inspectAcceptancePreparation, applyAcceptancePreparation } from "../packages/application/src/acceptance-preparation";
const source = resolve(import.meta.dir, ".."), assets = resolve(process.argv[2] ?? join(source, "examples/adoption")), binary = process.argv[3] ? [resolve(process.argv[3])] : [process.execPath, join(source, "packages/cli/src/launcher.ts")], output = resolve(process.argv[4] ?? join(source, "build/example-measurement"));
const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-examples-"))), rows: object[] = [];
await mkdir(output, { recursive: true });
const check = (name: string, value: unknown) => { rows.push({ name, passed: !!value }); if (!value) throw new Error(name); };
async function init(name: string) { const repo = join(root, name); await mkdir(repo); await git(repo, ["init", "-b", "main"]); for (const [key, value] of [["user.name", "Automated documentation fixture"], ["user.email", "fixture@example.invalid"], ["commit.gpgsign", "false"], ["core.hooksPath", "/dev/null"]]) await git(repo, ["config", key!, value!]); await writeFile(join(repo, ".gitignore"), ".wringer/\n"); return repo; }
async function commit(repo: string) { await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "Explicit scratch example baseline"]); }
async function cli(repo: string, args: string[], expected: number) {
    const result = await runProcess([...binary, ...args, "--repo", repo, "--json"], { cwd: repo, timeout: 60, maxBytes: 2 * 1024 * 1024 });
    check(`${args.join(" ")}: exit ${expected}`, result.exit_code === expected && !result.timed_out && !result.stdout_truncated); return JSON.parse(result.stdout);
}
try {
    const local = await init("total");
    for (const [from, to] of [["total.mjs.txt", "total.mjs"], ["checks.test.mjs.txt", "checks.test.mjs"], ["config.json.txt", ".wringer.yaml"]]) await writeFile(join(local, to!), await readFile(join(assets, "local-fix", from!)));
    const reporter = await runProcess([...binary, "reporter", "node-test"], { cwd: local, timeout: 10 }); check("installed reporter export", reporter.exit_code === 0); await writeFile(join(local, "node-reporter.mjs"), reporter.stdout); await commit(local);
    const red = await cli(local, ["verify", "--strict"], 1); check("red evidence sealed", (await validateDigests(join(local, red.evidence_dir))).ok);
    await writeFile(join(local, "total.mjs"), (await readFile(join(local, "total.mjs"), "utf8")).replace("values.slice(1).reduce", "values.reduce"));
    const green = await cli(local, ["verify", "--strict"], 0); check("different exact result bundles", red.evidence_dir !== green.evidence_dir);
    const assertions = JSON.parse(await readFile(join(local, green.evidence_dir, "gate-assertions.json"), "utf8")); check("meaningful registered assertions", assertions.gates[0].status === "established");
    await cli(local, ["audit", "--set", green.evidence_dir], 0);
    await cli(local, ["setup", "--client", "generic", "--mode", "verification", "--dry-run"], 0);
    const verificationApp = join(root, "verification-application");
    const workspace = await cli(local, ["setup", "--client", "generic", "--mode", "verification", "--app-dir", verificationApp, "--apply"], 0);
    const job = await cli(local, ["job", "new", "--workspace", workspace.id, "--app-dir", verificationApp, "--intent", "Check the total with the default declared selection"], 0);
    const status = await cli(local, ["job", "status", "--job", job.id, "--app-dir", verificationApp], 0);
    check("default CLI job retains original words and grants no execution", job.intent === "Check the total with the default declared selection" && status.phase === "approval" && status.operation === null);
    const range = await init("range"); await mkdir(join(range, "src")); await writeFile(join(range, "src/range.mjs"), await readFile(join(assets, "contained-feature/range.mjs.txt"))); await commit(range);
    const input = JSON.parse(await readFile(join(assets, "contained-feature/acceptance.json.txt"), "utf8")), app = join(root, "application");
    const preview = await inspectAcceptancePreparation(app, range, input), prepared = await applyAcceptancePreparation(app, preview, { expectedIdentity: preview.identity, actor: "Automated example preparation" });
    check("inert acceptance leaves original source", (await git(range, ["status", "--porcelain"])).stdout === "");
    const runCheck = async (expected: number) => { const result = await runProcess(["node", "--test", "--test-reporter=./wringer-acceptance/node-reporter.mjs", "wringer-acceptance/range.test.mjs"], { cwd: prepared.sourceRepo, timeout: 30 }); check(`feature actual Node check exit ${expected}`, result.exit_code === expected && !result.timed_out); };
    await runCheck(1); const file = join(prepared.sourceRepo, "src/range.mjs"); await writeFile(file, (await readFile(file, "utf8")).replace("end - start", "end - start + (inclusive ? 1 : 0)")); await runCheck(0);
    const visual = await init("visual"); for (const [from, to] of [["page.html.txt", "page.html"], ["show.mjs.txt", "show.mjs"], ["config.json.txt", ".wringer.yaml"], ["spec.json.txt", "wringer.spec.yaml"]]) await writeFile(join(visual, to!), await readFile(join(assets, "visual-change", from!))); await commit(visual);
    await cli(visual, ["verify", "--strict"], 0);
    const show = await runProcess(["node", "show.mjs"], { cwd: visual, timeout: 10 }); check("visual declared display succeeds with actual HTML", show.exit_code === 0 && show.stdout.includes("2, 3, 4"));
    await writeFile(join(visual, "page.html"), "missing result"); const failed = await runProcess(["node", "show.mjs"], { cwd: visual, timeout: 10 }); check("missing visual content fails", failed.exit_code !== 0);
} finally {
    await writeFile(join(output, "result.json"), JSON.stringify({ kind: "real local example commands; no contained runtime/model/human-acceptance claim", platform: `${process.platform}-${process.arch}`, binarySha256: binary.length === 1 ? hashBytes(await readFile(binary[0]!)) : null, modelCalls: 0, rows }, null, 2) + "\n");
}
console.log(`${rows.length} example observations passed`);
