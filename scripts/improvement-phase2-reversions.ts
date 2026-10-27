/** Improvement release 2 (playbook trees, materialisation, proposals from evidence): each
 * guard is removed alone in an isolated copy, watched red, restored and watched green.
 * Scripted roles, real Git, no model.
 *   bun scripts/improvement-phase2-reversions.ts [--check-targets] [--only NAME,NAME] */
import { runReversions, type Reversion } from "./rebuild-reversions";

const compile = "packages/plan/src/compile.ts", tree = "packages/plan/src/playbook-tree.ts", treeTest = "packages/plan/test/playbook-tree.test.ts";
const source = "packages/runtime/src/source.ts", overlayTest = "packages/runtime/test/overlay.test.ts";
const contained = "packages/workflow/src/contained.ts", journeyTest = "packages/workflow/test/playbook-materialisation.test.ts";
const evidence = "packages/application/src/proposer-evidence.ts", proposer = "packages/application/src/proposer.ts", proposerTest = "packages/application/test/proposer.test.ts";
const experiments = "packages/application/src/experiments.ts", experimentsTest = "packages/application/test/experiments.test.ts";
const cases: Reversion[] = [
    // D. A tree selection is a v6 plan's, every file protected, every content rule enforced before a worker runs.
    { name: "tree-needs-plan-v6", file: compile, before: 'if (p.version !== 6 && p.playbook && typeof p.playbook === "object" && ["surface", "files", "replace"].some(key => key in p.playbook))', after: "if (false)", test: treeTest, pattern: "tree selection rules refuse" },
    { name: "tree-one-always-on-file", file: compile, before: 'if (entries.filter(entry => entry.kind === "always-on").length !== 1) throw new Error(`A ${surface} playbook tree has exactly one always-on', after: 'if (false) throw new Error(`A ${surface} playbook tree has exactly one always-on', test: treeTest, pattern: "tree selection rules refuse" },
    { name: "tree-files-protected", file: compile, before: "playbook.path, ...(playbook.files ?? []).map(file => file.path)]", after: "playbook.path]", test: treeTest, pattern: "manifest and every file protected" },
    { name: "tree-replace-names-an-active-path", file: compile, before: "for (const target of replace) if (!active.includes(target)) throw", after: "for (const target of replace) if (false) throw", test: treeTest, pattern: "tree selection rules refuse" },
    { name: "tree-always-on-cap", file: tree, before: "if (Buffer.byteLength(alwaysText) > MAX_ALWAYS_ON_BYTES) throw", after: "if (false) throw", test: treeTest, pattern: "content rules" },
    { name: "tree-untriggered-skill", file: tree, before: "if (!alwaysText.includes(name)) throw new Error(`Skill", after: "if (false) throw new Error(`Skill", test: treeTest, pattern: "content rules" },
    { name: "tree-front-matter-grants-nothing", file: tree, before: 'if (at < 1 || !["name", "description"].includes(key)) throw', after: "if (at < 1) throw", test: treeTest, pattern: "content rules" },
    { name: "tree-script-references-exist", file: tree, before: "for (const match of content.matchAll(SCRIPT_REFERENCE)) if (!active.has(match[1]!)) throw", after: "for (const match of content.matchAll(SCRIPT_REFERENCE)) if (false) throw", test: treeTest, pattern: "content rules" },
    { name: "tree-shell-scripts-parse", file: tree, before: "if (result.exitCode !== 0) throw new Error(`Playbook script ${path} does not parse as sh`);", after: "", test: treeTest, pattern: "content rules" },
    { name: "tree-python-needs-a-declared-tool", file: tree, before: 'if (!tools.some(name => name === "python" || name === "python3")) throw', after: "if (false) throw", test: treeTest, pattern: "content rules" },
    { name: "tree-files-credential-free", file: tree, before: "if (redactor.scrub(content) !== content) throw new Error(`Playbook file ${file.path} contains a detected credential`);", after: "", test: treeTest, pattern: "content rules" },
    { name: "tree-directory-is-exactly-listed", file: tree, before: "if (canonicalJson([...objects.keys()].sort()) !== canonicalJson(expected)) throw", after: "if (false) throw", test: treeTest, pattern: "exactly its manifest and listed files" },
    { name: "tree-placement-never-silently-replaces", file: tree, before: "if (exact && !replace.includes(path)) throw", after: "if (false) throw", test: treeTest, pattern: "never replaces a tracked file silently" },
    // E. The overlay is the worker's alone; its edits stop the worker; readers re-observe it.
    { name: "capture-refuses-overlay-edits", file: source, before: "if (touched) throw new RuntimeError(", after: "if (false) throw new RuntimeError(", test: overlayTest, pattern: "capture reads the change against the overlay" },
    { name: "capture-never-rebases-silently", file: source, before: 'if (applied.code !== 0) throw new RuntimeError("The worker\'s change no longer applies', after: 'if (false) throw new RuntimeError("The worker\'s change no longer applies', test: overlayTest, pattern: "never silently rebased" },
    { name: "candidate-never-carries-overlay-paths", file: contained, before: "if (playbookActivePaths(plan).some(active => within(path, active) || within(active, path)))", after: "if (false)", test: journeyTest, pattern: "even if capture let it through" },
    { name: "only-the-worker-gets-the-overlay", file: contained, before: '        if (role === "worker" && plan.playbook) {\n            const store = (state!.source as PreparedRepositorySource | null)?.objectStore;', after: '        if (plan.playbook) {\n            const store = (state!.source as PreparedRepositorySource | null)?.objectStore;', test: journeyTest, pattern: "the judge never carry it" },
    { name: "materialisation-matches-the-approved-tree", file: contained, before: "canonicalJson(record.files.map(f => [f.sourcePath, f.activePath, f.mode, f.sha256])) !== canonicalJson(active.map(f => [f.sourcePath, f.activePath, f.mode, f.sha256])) ||", after: "", test: journeyTest, pattern: "readers refuse a changed materialisation" },
    { name: "readers-re-observe-the-overlay", file: contained, before: "if (typeof store !== \"string\" || (await verifyPlaybookOverlay(store, { base: record.base.commit, commit: record.overlay.commit, files: playbookActiveFiles(playbook).map(f => ({ path: f.activePath, mode: f.mode, content: f.content })) })).tree !== record.overlay.tree)", after: "if (false)", test: journeyTest, pattern: "readers refuse a changed materialisation" },
    // Not probed: the explicit refusal of an overlay commit in a judge or planner request. Those
    // requests must already name a commit in the journey's source set, which no overlay is (measured).
    // F. Evidence is fenced by name and content; a proposal is a validated, cited tree or KEEP_BASE.
    { name: "evidence-fence-by-held-out-identity", file: evidence, before: "for (const id of checked.heldOutIds) if (new RegExp(", after: "for (const id of checked.heldOutIds) if (false && new RegExp(", test: proposerTest, pattern: "held-out material refused" },
    { name: "evidence-fence-by-oracle-digest", file: evidence, before: "for (const digest of checked.oracleDigests) if (file.content.includes(digest)) throw", after: "for (const digest of checked.oracleDigests) if (false) throw", test: proposerTest, pattern: "held-out material refused" },
    { name: "evidence-fence-by-name", file: evidence, before: 'if (name === "labels.json" || name === "oracle.json" || globs.some(glob => glob.test(file.path))) throw', after: "if (false) throw", test: proposerTest, pattern: "held-out material refused" },
    { name: "evidence-fence-never-narrowed", file: evidence, before: "if (!DEFAULT_DENY_GLOBS.every(glob => fence.denyGlobs.includes(glob))) throw", after: "if (false) throw", test: proposerTest, pattern: "held-out material refused" },
    { name: "evidence-reads-only-its-plan", file: evidence, before: "if (history.plan.plan_sha256 !== plan.plan_sha256 || history.plan.repository.url !== plan.repository.url) throw", after: "if (false) throw", test: proposerTest, pattern: "held-out material refused" },
    { name: "proposal-stays-in-its-directory", file: proposer, before: "if (outside) throw new Error(`The proposer changed ${outside}", after: "if (false) throw new Error(`The proposer changed ${outside}", test: proposerTest, pattern: "is stopped when it writes outside" },
    { name: "proposal-is-a-valid-tree", file: proposer, before: "                validatePlaybookTreeContent(manifest, new Map([...files].filter(([path]) => path !== \"manifest.json\")),", after: "                void (manifest, new Map([...files].filter(([path]) => path !== \"manifest.json\")),", test: proposerTest, pattern: "is stopped when it writes outside" },
    { name: "proposal-directory-is-exactly-listed", file: proposer, before: "if ([...files.keys()].some(path => !listed.has(path)) || [...listed].some(path => !files.has(path))) throw", after: "if (false) throw", test: proposerTest, pattern: "is stopped when it writes outside" },
    { name: "proposal-changes-are-cited", file: proposer, before: "if (!found.length) throw new Error(`NOTES.md cites no trajectory moment", after: "if (false) throw new Error(`NOTES.md cites no trajectory moment", test: proposerTest, pattern: "is stopped when it writes outside" },
    { name: "proposal-citations-name-real-lines", file: proposer, before: "if (journey && lines && number >= 1 && number <= lines.length && lines[number - 1]!.trim()) found.push", after: "found.push", test: proposerTest, pattern: "is stopped when it writes outside" },
    { name: "keep-base-is-a-real-answer", file: proposer, before: 'if (notes.trimStart().startsWith("KEEP_BASE")) {', after: "if (false) {", test: proposerTest, pattern: "KEEP_BASE is recorded as no change" },
    { name: "proposal-one-reservation-never-replayed", file: proposer, before: "        if (prior) {\n            if (!retained) throw new Error(\"A reserved proposal is missing", after: "        if (false) {\n            if (!retained) throw new Error(\"A reserved proposal is missing", test: proposerTest, pattern: "cites the moment" },
    { name: "tree-comparisons-are-v2-records", file: experiments, before: 'schema_version: trees.every(Boolean) ? "wringer.experiment-plan.v2" as const : "wringer.experiment-plan.v1" as const', after: 'schema_version: "wringer.experiment-plan.v1" as const', test: experimentsTest, pattern: "tree-arm comparisons" },
    { name: "comparison-never-mixes-plan-families", file: experiments, before: "if (trees.some(Boolean) && !trees.every(Boolean)) throw", after: "if (false) throw", test: experimentsTest, pattern: "tree-arm comparisons" },
];
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
if (only) for (const name of only) if (!cases.some(row => row.name === name)) throw new Error(`Unknown probe ${name}`);
const selected = only ? cases.filter(row => only.includes(row.name)) : cases;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} improvement phase-2 isolated reversion targets`);
else await runReversions("improvement-phase2", [treeTest, overlayTest, journeyTest, proposerTest, experimentsTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory: only ? "docs/improvement/evidence/phase-2/reversions-followup" : "docs/improvement/evidence/phase-2/reversions" });
