/** Exercise the compiled binary outside the checkout, without schema files or Python. */
import { chmod, copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";
const root = resolve(import.meta.dir, ".."), directory = join(root, ".wringer", `native-distribution-${crypto.randomUUID()}`), bin = join(directory, "bin"), repo = join(directory, "repository");
await mkdir(bin, { recursive: true });
await mkdir(repo, { recursive: true });
await copyFile(join(root, "dist/wring"), join(bin, "wring"));
await chmod(join(bin, "wring"), 0o755);
await copyFile(join(root, "dist/wringer-headless"), join(bin, "wringer-headless"));
await chmod(join(bin, "wringer-headless"), 0o755);
for (const name of ["wringer-board", "wringer-drive"])
    await symlink("wring", join(bin, name));
const node = Bun.which("node");
if (!node)
    throw new Error("The fixture requires the provisioned Node executable");
const environment = { ...process.env, PATH: `${bin}:${dirname(node)}:/usr/bin:/bin` };
const transcript: unknown[] = [];
async function execute(command: string[], expected = 0) { const result = await runProcess(command, { cwd: repo, env: environment, timeout: 30 }); transcript.push({ command, ...result }); await writeFile(join(directory, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n"); if (result.exit_code !== expected || result.timed_out)
    throw new Error(`${command.join(" ")} failed: ${result.stdout}\n${result.stderr}`); return result; }
await execute(["git", "init", "--initial-branch=main"]);
await execute(["git", "config", "user.name", "Native distribution fixture"]);
await execute(["git", "config", "user.email", "fixture@example.invalid"]);
await execute(["git", "config", "commit.gpgsign", "false"]);
await writeFile(join(repo, ".gitignore"), ".wringer/\n");
await writeFile(join(repo, "feature.txt"), "disabled\n");
await writeFile(join(repo, "check.mjs"), "import assert from 'node:assert/strict';import{readFileSync}from'node:fs';assert.equal(readFileSync('feature.txt','utf8').trim(),'enabled');\n");
await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "feature", run: "node check.mjs", proves: "enabled" }] }));
await writeFile(join(repo, "wringer.spec.yaml"), JSON.stringify({ schema_version: "wringer.spec.v1", approved: true, title: "Standalone contract fixture", intent: "Enable the feature.", criteria: [{ id: "enabled", title: "The feature is enabled", required: true }], tasks: [{ id: "enable", brief: "brief.md", objective: "Enable the feature." }], open_questions: [], gates: [] }));
await execute(["git", "add", "."]);
await execute(["git", "commit", "-m", "Committed standalone fixture"]);
const version = (await execute([join(bin, "wring"), "--version"])).stdout;
if (!(await execute([join(bin, "wringer-headless"), "--help"])).stdout.includes("No sandbox bypass"))
    throw new Error("Compiled headless help is unavailable");
if (!version.includes((await Bun.file(join(root, "package.json")).json()).version))
    throw new Error("Compiled version differs from the package");
for (const [name, marker] of [["wringer-board", "one set of facts"], ["wringer-drive", "one durable PM journey"]])
    if (!(await execute([join(bin, name!), "--help"])).stdout.includes(marker!))
        throw new Error(`Compiled alias ${name} selects the wrong surface`);
const red = JSON.parse((await execute([join(bin, "wring"), "verify", "--json"], 1)).stdout);
await writeFile(join(repo, "feature.txt"), "enabled\n");
const green = JSON.parse((await execute([join(bin, "wring"), "verify", "--json"])).stdout);
const acceptance = JSON.parse(await readFile(join(repo, green.evidence_dir, "acceptance.json"), "utf8"));
if (acceptance.counts.evidenced !== 1 || acceptance.criteria[0].receipt.bundle !== red.evidence_dir)
    throw new Error("The standalone program did not carry its genuine red-first receipt");
await execute([join(bin, "wringer-board"), "render"]);
const doctor = JSON.parse((await execute([join(bin, "wring"), "doctor", "--json"])).stdout);
if (doctor.last_verify !== green.evidence_dir)
    throw new Error("Standalone doctor did not read the latest run");
await writeFile(join(directory, "result.json"), JSON.stringify({ status: "passed", directory, version: version.trim(), binary_only_schemas: true, python_used: false, aliases_checked: 2, red_run: red.evidence_dir, green_run: green.evidence_dir, evidenced: 1 }, null, 2) + "\n");
console.log(`Standalone distribution passed away from its source tree: ${directory}`);
