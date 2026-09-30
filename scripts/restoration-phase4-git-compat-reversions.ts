/** Phase 4 release fix: the guards that let a join integrate with Git 2.38–2.39
 * (macOS 14's Apple Git) are each removed alone in an isolated copy, watched red,
 * restored and watched green. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const compatTest = "packages/application/test/graph-git-compat.test.ts", adapterTest = "packages/application/test/graph-parallel.test.ts", adapter = "packages/application/src/graph.ts";
const cases: Reversion[] = [
    { name: "git-compat-explicit-base-from-2-40", file: adapter, before: "if (major > 2 || major === 2 && minor >= 40) return \"explicit-base\";", after: "if (major > 2 || major === 2 && minor >= 39) return \"explicit-base\";", test: compatTest, pattern: "installed Git version" },
    { name: "git-compat-computed-base-from-2-38", file: adapter, before: "if (major === 2 && minor >= 38) return \"computed-base\";", after: "if (major === 2 && minor >= 37) return \"computed-base\";", test: compatTest, pattern: "installed Git version" },
    { name: "git-compat-computed-base-is-fork-source", file: adapter, before: "if (bases.length !== 1 || bases[0] !== base) fail(", after: "if (false) fail(", test: compatTest, pattern: "do not meet exactly" },
    { name: "git-compat-join-preflight", file: adapter, before: "                if (!await installedMergeMode()) fail(`Joins need Git 2.38 or later", after: "                if (false) fail(`Joins need Git 2.38 or later", test: adapterTest, pattern: "older than 2.38" },
];
const evidenceDirectory = "docs/restoration/evidence/phase-4/git-compat";
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-4 Git-compatibility reversion targets`);
else await runReversions("restoration-phase4-git-compat", [compatTest, adapterTest], cases, { baseline: revision.stdout.toString().trim(), evidenceDirectory, restoreEach: true });
