/** Compiled public journey contract fixture. Synthetic execution is a separate binary,
 * never a production flag, provider substitute or claimed real containment test. */
import { chmod, copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";

const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `contained-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), fixtureHome = join(directory, "isolated-home");
await mkdir(bin, { recursive: true }); await mkdir(fixtureHome);
await copyFile(join(root, "dist/wring"), join(bin, "wring")); await chmod(join(bin, "wring"), 0o755);
await symlink("wring", join(bin, "wringer-drive")); await symlink("wring", join(bin, "wringer-board"));
const environment = { PATH: `${bin}:/usr/bin:/bin`, HOME: fixtureHome, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const transcript: unknown[] = [], startedAt = new Date().toISOString();
async function execute(label: string, argv: string[], options: { expected?: number | "nonzero"; cwd?: string; build?: boolean } = {}) {
    const result = await runProcess(argv, { cwd: options.cwd ?? directory, env: options.build ? process.env : environment, timeout: options.build ? 120 : 45, maxBytes: 4 * 1024 * 1024 });
    transcript.push({ label, command: argv, cwd: options.cwd ?? directory, ...result });
    await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
    const expected = options.expected ?? 0;
    if (result.timed_out || (expected === "nonzero" ? result.exit_code === 0 : result.exit_code !== expected)) throw new Error(`${label}: unexpected exit ${result.exit_code}\n${result.stdout}\n${result.stderr}`);
    return result;
}
const driver = join(bin, "fixture-driver"), drive = join(bin, "wringer-drive");
await execute("compile-fixture-only-driver", [process.execPath, "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--asset", "schema", "scripts/fixtures/contained-driver.ts", "--outfile", driver], { cwd: root, build: true });
const prepared = JSON.parse((await execute("synthetic-fixture-source-preparation", [driver, "prepare", directory])).stdout), state = prepared.state;
const plan = join(directory, "plan.yaml"), authority = join(directory, "authority.json"), expires = new Date(Date.now() + 3600000).toISOString();
await execute("public-plan", [drive, "plan", plan]);
await execute("public-planning-bound-authority", [drive, "authority", plan, "--actor", "Distribution fixture operator", "--expires", expires, "--output", authority]);
const hold = JSON.parse((await execute("synthetic-agent-and-check-observations", [driver, "run", directory])).stdout);
if (hold.status !== "human-hold" || hold.sessions !== 2) throw new Error("Fixture did not reach the human hold with exactly worker+judge sessions");
await execute("public-status-at-hold", [drive, "status", "--state", state, "--json"], { expected: 3 });
await execute("public-board-at-hold", [drive, "board", "--state", state, "--output", join(directory, "hold-board.html")]);
const unavailableDisplay = await execute("public-show-missing-runtime", [drive, "show", "--state", state, "--criterion", "readable"], { expected: "nonzero" });
if (!/container|runtime|ENOENT|unavailable|not found/i.test(unavailableDisplay.stdout + unavailableDisplay.stderr)) throw new Error("Public display failure did not explain the unmeasured runtime boundary");
const display = JSON.parse((await execute("synthetic-display-observation", [driver, "display", directory])).stdout);
const note = "In this deterministic fixture, I inspected the expected value and its display is readable.";
await execute("public-human-review", [drive, "review", "--state", state, "--criterion", "readable", "--display", display.id, "--verdict", "met", "--by", "Distribution fixture operator", "--note", note]);
const ready = JSON.parse((await execute("public-resume-no-agent-replay", [drive, "resume", "--state", state, "--json"])).stdout);
if (ready.status !== "review-ready" || ready.sessions !== 2 || ready.humanJudgements[0]?.note !== note) throw new Error("Public resume replayed agents or lost the original human note");
await execute("public-board-ready", [drive, "board", "--state", state, "--output", join(directory, "ready-board.html")]);
const publication = ["--state", state, "--remote", prepared.origin, "--source-branch", "wringer/distribution-fixture", "--target-branch", "main"];
const preview = JSON.parse((await execute("public-delivery-preview", [drive, "deliver", ...publication, "--json"])).stdout);
if (preview.pushed || preview.status !== "prepared") throw new Error("Delivery preview published unexpectedly");
const delivered = JSON.parse((await execute("public-delivery-explicit-send-local-origin", [drive, "deliver", ...publication, "--send", "--json"])).stdout);
if (!delivered.pushed || delivered.codeCommit !== ready.candidate.source.commit || delivered.evidenceCommit === delivered.codeCommit) throw new Error("Publication lost the code/evidence commit split");
const main = (await execute("unchanged-default-branch", ["git", "--git-dir", prepared.origin, "rev-parse", "main"])).stdout.trim();
if (main !== prepared.baseCommit) throw new Error("Fixture delivery changed the default branch");
const clone = join(directory, "fresh-clone");
await execute("fresh-review-branch-clone", ["git", "clone", "--no-local", "--branch", "wringer/distribution-fixture", prepared.origin, clone]);
await execute("literal-delivery-audit-command", ["/bin/sh", "-c", delivered.auditCommand], { cwd: clone });
const bundle = join(clone, ".wringer/deliveries", delivered.deliveryId), documents = (await Promise.all(["mr.md", "summary.md", "certificate.json", "board.html"].map(name => readFile(join(bundle, name), "utf8")))).join("\n");
if (!documents.includes(note) || documents.includes("PRIVATE_FIXTURE") || documents.includes(state)) throw new Error("Portable delivery lost the review note or leaked private/controller-only content");
const falsify = await execute("literal-falsify-missing-runtime-inconclusive", ["/bin/sh", "-c", delivered.falsify.command], { cwd: clone, expected: 3 });
if (!/inconclusive|unavailable/i.test(falsify.stdout)) throw new Error("Missing runtime was not recorded as inconclusive falsification");
const result = { status: "passed", startedAt, finishedAt: new Date().toISOString(), directory, journeyId: ready.journeyId, deliveryId: delivered.deliveryId, codeCommit: delivered.codeCommit, evidenceCommit: delivered.evidenceCommit, publicCommandStages: transcript.length - 4, publicAuditPassed: true, synthetic: ["worker ACP reply", "judge ACP reply", "check execution observations", "successful display observation"], liveProviderMeasured: false, realContainmentMeasured: false, publicDisplay: "runtime-unavailable", publicFalsify: "inconclusive-runtime-unavailable", limits: ["This deterministic contract fixture is not a successful live-agent/real-container product run.", "Publication uses only a new local bare fixture origin; no hosted forge or external branch was changed."] };
await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(`Compiled contained distribution fixture passed: ${directory}\nReal provider/containment remain unmeasured; public display unavailable and falsification inconclusive as expected.`);
