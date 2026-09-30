/** Gate and workflow proposals, evaluated against a frozen oracle.
 *
 * A proposal changes how Wringer checks or coordinates work, so it cannot grade
 * itself. A gate experiment freezes a labelled corpus of exact commits, a
 * commitment to the oracle's labels, both arms' gates, a prediction and a run
 * budget before any run. The oracle stays with the evaluator until evaluation.
 * Every gate's files are pinned by content and overlaid on each item, so an item
 * cannot change the gate that judges it. Qualification is decided on the
 * held-out split against the oracle, never by a gate's own pass rate.
 *
 * Proposal, registration, evaluation, a reviewable source change, its separate
 * Send and future-only adoption are separate recorded actions. Nothing here edits
 * an active plan, grader or approval. */
import { lstat, mkdir, readdir, writeFile, copyFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { hashBytes, hashValue, validateContainedGraph, type ContainedGraphPlan, type ExecutionPlan } from "@wringer/plan";
import { processDriver, runContainedCommands, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource } from "@wringer/runtime";
import { Redactor } from "@wringer/engine";
import { locked } from "@wringer/workflow";
import { immutableControllerFile, privateControllerDirectory, readControllerFile } from "./controller";
import { unavailableExit } from "./services";

export interface GateFile { path: string; content: string; }
export interface GateDeclaration { id: string; argv: string[]; cwd: string; timeout_seconds: number; files: GateFile[]; }
export interface GateProposalInput {
    id: string; taskFamily: string; candidateGates: GateDeclaration[]; rationale: string;
    /** Every corpus item the author looked at. None may be held out. */
    inputs: { developmentItems: string[] };
    author: { actor: string; kind: "operator" | "delegated-agent" };
}
export interface GateProposal extends GateProposalInput { schema_version: "wringer.gate-proposal.v1"; createdAt: string; sha256: string; }
export interface GateOracle { schema_version: "wringer.gate-oracle.v1"; corpusId: string; labels: { itemId: string; label: "defect" | "control" }[]; sha256: string; }
export interface GateCorpusItem { id: string; split: "development" | "held-out"; commit: string; tree: string; }
export interface GatePrediction { statement: string; minimumAdditionalDefectsCaught: number; maximumAdditionalFalsePositives: number; minimumHeldOutDefects: number; minimumHeldOutControls: number; }
interface ExperimentCommon {
    id: string; taskFamily: string; repository: { url: string; commit: string };
    runtime: ExecutionPlan["runtime"]; proposalSha256: string;
    corpus: { id: string; items: GateCorpusItem[]; oracleSha256: string };
    prediction: GatePrediction; limits: { maxGateRuns: number; wallClockSeconds: number };
    holdout: { candidateIteration: number; maximumCandidateIterations: number; proposalSawHeldOut: false };
    order: "fixed-corpus-order"; stoppingRule: "fixed-sample-no-extension"; accounting: "all-planned-runs-including-unavailable";
}
export interface GateExperimentInput extends ExperimentCommon { changedVariable: "acceptance-gates"; baselineGates: GateDeclaration[]; }
export interface WorkflowExperimentInput extends ExperimentCommon { changedVariable: "workflow"; baselineGraph: ContainedGraphPlan; candidateGraph: ContainedGraphPlan; gateFiles: GateFile[]; maximumAdditionalHolds: number; }
export interface GateArm { gates: GateDeclaration[]; requiredHolds: number; graphSha256: string | null; commit: string; }
export interface GateExperiment extends ExperimentCommon {
    schema_version: "wringer.gate-experiment.v1"; changedVariable: "acceptance-gates" | "workflow";
    arms: { baseline: GateArm; candidate: GateArm }; maximumAdditionalHolds: number; registeredAt: string; sha256: string;
}
export type GateOutcome = "passed" | "failed" | "unavailable" | "uncertain" | "not-started";
export interface GateRun { index: number; itemId: string; arm: "baseline" | "candidate"; outcome: GateOutcome; exitCodes: (number | null)[]; outputSha256: string | null; runtimeId: string | null; sourceTree: string | null; durationMs: number | null; }
export interface GateScore { items: number; defects: number; controls: number; caught: number; missed: number; falsePositives: number; controlsPassed: number; unavailable: number; passRate: number; }
/** durationMs sums the gate commands' reported durations over recorded runs; a run with no measurement adds nothing and is counted as unavailable. */
export interface GateArmSummary { all: GateScore; development: GateScore; heldOut: GateScore; requiredHolds: number; gateRuns: number; durationMs: number; }
export interface GateEvaluation {
    schema_version: "wringer.gate-evaluation.v1"; experimentSha256: string; oracleSha256: string; evidenceKind: "contained" | "deterministic-fixture";
    runs: GateRun[]; summary: { baseline: GateArmSummary; candidate: GateArmSummary };
    qualification: { qualified: boolean; reasons: string[] }; evaluatedAt: string; sha256: string;
}
export interface GateSelection {
    schema_version: "wringer.gate-adoption.v1"; action: "adopt" | "undo"; taskFamily: string; repository: string;
    gates: GateDeclaration[]; experimentSha256: string | null; evaluationSha256: string | null;
    previousSha256: string | null; actor: string; at: string; futureOnly: true; sha256: string;
}

const HEX64 = /^[a-f0-9]{64}$/, OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const FIXED_ENV = { ...GIT_ENV, GIT_AUTHOR_NAME: "Wringer gate experiment", GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: "Wringer gate experiment", GIT_COMMITTER_EMAIL: "wringer@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
function fail(message: string): never { throw new Error(message); }
function shape(value: unknown, label: string, fields: string[]): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
    const row = value as Record<string, any>, keys = Object.keys(row);
    if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) fail(`${label} has missing or unknown fields`);
    return row;
}
function text(value: unknown, label: string, maximum = 16384): string {
    if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) fail(`${label} must be bounded text`);
    if (new Redactor().scrub(value) !== value) fail(`${label} contains a detected credential`);
    return value as string;
}
function id(value: unknown, label: string) { const name = text(value, label, 80); if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`Invalid ${label}`); return name; }
function integer(value: unknown, label: string, minimum: number, maximum: number) { if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(`${label} must be an integer from ${minimum} to ${maximum}`); return value as number; }
function relative(value: unknown, label: string) {
    const path = text(value, label, 512);
    if (isAbsolute(path) || path.split("/").some(part => !part || part === "." || part === ".." || part === ".git")) fail(`${label} must be a safe relative path`);
    return path;
}
const stamp = <T extends object>(body: T) => ({ ...body, sha256: hashValue(body) });
const unstamped = (value: Record<string, any>) => { const { sha256, ...body } = value; return body; };
function verify<T extends { sha256: string }>(value: T, label: string): T { if (!HEX64.test(value?.sha256 ?? "") || hashValue(unstamped(value)) !== value.sha256) fail(`${label} digest changed`); return value; }

function gateDeclaration(value: unknown, label: string): GateDeclaration {
    const row = shape(value, label, ["id", "argv", "cwd", "timeout_seconds", "files"]);
    if (!Array.isArray(row.argv) || !row.argv.length || row.argv.length > 64) fail(`${label} needs a bounded argv`);
    const files: GateFile[] = Array.isArray(row.files) && row.files.length <= 32 ? row.files.map((file: unknown, index: number) => {
        const entry = shape(file, `${label} file ${index}`, ["path", "content"]);
        if (typeof entry.content !== "string" || Buffer.byteLength(entry.content) > 256 * 1024) fail(`${label} file content must be text of at most 256 KiB`);
        if (new Redactor().scrub(entry.content) !== entry.content) fail(`${label} file contains a detected credential`);
        return { path: relative(entry.path, `${label} file path`), content: entry.content };
    }) : fail(`${label} needs at most 32 pinned files`);
    if (new Set(files.map(file => file.path)).size !== files.length) fail(`${label} names a file twice`);
    return { id: id(row.id, `${label} id`), argv: row.argv.map((arg: unknown) => text(arg, `${label} argument`, 4096)), cwd: row.cwd === "." ? "." : relative(row.cwd, `${label} cwd`), timeout_seconds: integer(row.timeout_seconds, `${label} timeout`, 1, 3600), files };
}
function gateSet(value: unknown, label: string, minimum: number): GateDeclaration[] {
    if (!Array.isArray(value) || value.length < minimum || value.length > 8) fail(`${label} needs ${minimum}–8 gates`);
    const gates = value.map((gate, index) => gateDeclaration(gate, `${label} gate ${index}`));
    if (new Set(gates.map(gate => gate.id)).size !== gates.length) fail(`${label} names a gate twice`);
    const paths = new Map<string, string>();
    for (const file of gates.flatMap(gate => gate.files)) { if (paths.has(file.path) && paths.get(file.path) !== file.content) fail(`${label} pins ${file.path} with two different contents`); paths.set(file.path, file.content); }
    return gates;
}
const sameGates = (left: GateDeclaration[], right: GateDeclaration[]) => hashValue([...left].sort((a, b) => a.id.localeCompare(b.id))) === hashValue([...right].sort((a, b) => a.id.localeCompare(b.id)));
function runtimeDeclaration(value: unknown): ExecutionPlan["runtime"] {
    const row = value as Record<string, any>;
    if (!row || !["apple-container", "gvisor-kubernetes"].includes(row.kind)) fail("A gate experiment names a contained runtime");
    if (typeof row.image !== "string" || !/@sha256:[a-f0-9]{64}$/.test(row.image)) fail("The verifier image must be pinned by digest");
    if (row.network?.policy !== "deny") fail("Gate runs deny the network");
    if (!Array.isArray(row.env) || row.env.length) fail("Gate runs receive no credentials");
    return structuredClone(row) as ExecutionPlan["runtime"];
}

export function createGateOracle(corpusId: string, labels: { itemId: string; label: "defect" | "control" }[]): GateOracle {
    if (!Array.isArray(labels) || labels.length < 2 || labels.length > 64) fail("An oracle labels 2–64 corpus items");
    const rows = labels.map((row, index) => { const entry = shape(row, `Oracle label ${index}`, ["itemId", "label"]); if (!["defect", "control"].includes(entry.label)) fail("An oracle label is defect or control"); return { itemId: id(entry.itemId, "item id"), label: entry.label as "defect" | "control" }; });
    if (new Set(rows.map(row => row.itemId)).size !== rows.length) fail("An oracle labels each item once");
    return stamp({ schema_version: "wringer.gate-oracle.v1" as const, corpusId: id(corpusId, "corpus id"), labels: rows });
}
function validateOracle(value: unknown): GateOracle {
    const row = shape(value, "Gate oracle", ["schema_version", "corpusId", "labels", "sha256"]) as GateOracle;
    if (row.schema_version !== "wringer.gate-oracle.v1") fail("Unsupported gate oracle version");
    const rebuilt = createGateOracle(row.corpusId, row.labels);
    if (rebuilt.sha256 !== row.sha256) fail("Gate oracle digest changed");
    return rebuilt;
}
export function createGateProposal(input: GateProposalInput, at = new Date()): GateProposal {
    const row = shape(structuredClone(input), "Gate proposal", ["id", "taskFamily", "candidateGates", "rationale", "inputs", "author"]);
    const inputs = shape(row.inputs, "Proposal inputs", ["developmentItems"]), author = shape(row.author, "Proposal author", ["actor", "kind"]);
    if (!Array.isArray(inputs.developmentItems) || inputs.developmentItems.length > 64) fail("A proposal lists at most 64 development items it saw");
    if (!["operator", "delegated-agent"].includes(author.kind)) fail("A proposal author is an operator or a delegated agent, never a human verdict");
    return stamp({ schema_version: "wringer.gate-proposal.v1" as const, id: id(row.id, "proposal id"), taskFamily: id(row.taskFamily, "task family"), candidateGates: gateSet(row.candidateGates, "Candidate", 1), rationale: text(row.rationale, "Proposal rationale"), inputs: { developmentItems: inputs.developmentItems.map((item: unknown) => id(item, "item id")) }, author: { actor: text(author.actor, "Proposal author", 200), kind: author.kind }, createdAt: at.toISOString() });
}
function validateProposal(value: unknown): GateProposal {
    const row = verify(value as GateProposal, "Gate proposal");
    if (row.schema_version !== "wringer.gate-proposal.v1") fail("Unsupported gate proposal version");
    const rebuilt = createGateProposal({ id: row.id, taskFamily: row.taskFamily, candidateGates: row.candidateGates, rationale: row.rationale, inputs: row.inputs, author: row.author }, new Date(row.createdAt));
    if (rebuilt.sha256 !== row.sha256) fail("Gate proposal digest changed");
    return rebuilt;
}

async function git(args: string[], label: string, options: { env?: Record<string, string>; input?: string; allowed?: number[] } = {}) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { env: options.env ?? GIT_ENV, timeoutMs: 60000, input: options.input });
    if (!(options.allowed ?? [0]).includes(result.code)) fail(`${label} failed`);
    return { code: result.code, out: result.stdout.trim() };
}
async function present(path: string) { try { const info = await lstat(path); if (info.isSymbolicLink()) fail("Experiment records cannot be symlinks"); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
/** Base tree plus the arm's pinned gate files: the evaluator commit every run overlays. */
async function gateCommit(store: string, base: string, gates: GateDeclaration[], ref: string) {
    const env = { ...FIXED_ENV, GIT_INDEX_FILE: join(store, `index-${ref}`) };
    await git(["--git-dir", store, "read-tree", base], "Reading the corpus base", { env });
    for (const file of gates.flatMap(gate => gate.files)) {
        const blob = (await git(["--git-dir", store, "hash-object", "-w", "--stdin"], "Storing a gate file", { env, input: file.content })).out;
        await git(["--git-dir", store, "update-index", "--add", "--cacheinfo", `100644,${blob},${file.path}`], "Pinning a gate file", { env });
    }
    const tree = (await git(["--git-dir", store, "write-tree"], "Writing the gate tree", { env })).out;
    const commit = (await git(["--git-dir", store, "commit-tree", tree, "-p", base, "-m", `Pinned ${ref} gates`], "Recording the gate commit", { env })).out;
    await git(["--git-dir", store, "update-ref", `refs/gates/${ref}`, commit], "Recording the gate reference");
    return commit;
}
function common(input: ExperimentCommon, proposal: GateProposal) {
    const repository = shape(input.repository, "Experiment repository", ["url", "commit"]);
    if (!OBJECT.test(repository.commit)) fail("The corpus base must be an exact commit");
    const corpus = shape(input.corpus, "Experiment corpus", ["id", "items", "oracleSha256"]);
    if (!HEX64.test(corpus.oracleSha256)) fail("The corpus needs a commitment to its oracle's labels before any run");
    if (!Array.isArray(corpus.items) || corpus.items.length < 2 || corpus.items.length > 64) fail("A corpus has 2–64 items");
    const items: GateCorpusItem[] = corpus.items.map((item: unknown, index: number) => { const row = shape(item, `Corpus item ${index}`, ["id", "split", "commit", "tree"]); if (!["development", "held-out"].includes(row.split)) fail("Every corpus item declares its development or held-out split"); if (!OBJECT.test(row.commit) || !OBJECT.test(row.tree)) fail("Every corpus item pins an exact commit and tree"); return { id: id(row.id, "item id"), split: row.split, commit: row.commit, tree: row.tree }; });
    if (new Set(items.map(item => item.id)).size !== items.length) fail("Corpus item ids must be distinct");
    if (!items.some(item => item.split === "held-out")) fail("A corpus needs held-out items to decide qualification");
    if (input.proposalSha256 !== proposal.sha256) fail("The registered proposal digest differs from the supplied proposal");
    if (proposal.taskFamily !== input.taskFamily) fail("The proposal belongs to another task family");
    for (const seen of proposal.inputs.developmentItems) {
        const item = items.find(row => row.id === seen);
        if (!item) fail(`The proposal names ${seen}, which is not in this corpus`);
        if (item.split === "held-out") fail(`A proposal built from held-out item ${seen} cannot be registered`);
    }
    const prediction = shape(input.prediction, "Prediction", ["statement", "minimumAdditionalDefectsCaught", "maximumAdditionalFalsePositives", "minimumHeldOutDefects", "minimumHeldOutControls"]);
    const limits = shape(input.limits, "Limits", ["maxGateRuns", "wallClockSeconds"]);
    const holdout = shape(input.holdout, "Holdout policy", ["candidateIteration", "maximumCandidateIterations", "proposalSawHeldOut"]);
    if (holdout.proposalSawHeldOut !== false) fail("A proposal that saw held-out items cannot be evaluated on them");
    if (integer(holdout.candidateIteration, "Candidate iteration", 1, 100) > integer(holdout.maximumCandidateIterations, "Iteration ceiling", 1, 100)) fail("The held-out corpus is exhausted for this proposal family");
    if (input.order !== "fixed-corpus-order" || input.stoppingRule !== "fixed-sample-no-extension" || input.accounting !== "all-planned-runs-including-unavailable") fail("Gate experiments use a fixed order and sample and count every planned run");
    return { id: id(input.id, "experiment id"), taskFamily: id(input.taskFamily, "task family"), repository: { url: text(repository.url, "Repository URL", 4096), commit: repository.commit }, runtime: runtimeDeclaration(input.runtime), proposalSha256: proposal.sha256,
        corpus: { id: id(corpus.id, "corpus id"), items, oracleSha256: corpus.oracleSha256 },
        prediction: { statement: text(prediction.statement, "Prediction"), minimumAdditionalDefectsCaught: integer(prediction.minimumAdditionalDefectsCaught, "Minimum additional defects", 0, 64), maximumAdditionalFalsePositives: integer(prediction.maximumAdditionalFalsePositives, "Maximum additional false positives", 0, 64), minimumHeldOutDefects: integer(prediction.minimumHeldOutDefects, "Minimum held-out defects", 1, 64), minimumHeldOutControls: integer(prediction.minimumHeldOutControls, "Minimum held-out controls", 1, 64) },
        limits: { maxGateRuns: integer(limits.maxGateRuns, "Run budget", 2, 4096), wallClockSeconds: integer(limits.wallClockSeconds, "Wall clock", 1, 604800) },
        holdout: { candidateIteration: holdout.candidateIteration, maximumCandidateIterations: holdout.maximumCandidateIterations, proposalSawHeldOut: false as const },
        order: "fixed-corpus-order" as const, stoppingRule: "fixed-sample-no-extension" as const, accounting: "all-planned-runs-including-unavailable" as const };
}
async function register(root: string, base: ReturnType<typeof common>, changedVariable: GateExperiment["changedVariable"], arms: { baseline: Omit<GateArm, "commit">; candidate: Omit<GateArm, "commit"> }, maximumAdditionalHolds: number, proposal: GateProposal, bundle: string, at: Date) {
    if (base.corpus.items.length * 2 > base.limits.maxGateRuns) fail(`The planned ${base.corpus.items.length * 2} gate runs exceed the registered budget of ${base.limits.maxGateRuns}`);
    const info = await lstat(bundle);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) fail("The corpus bundle must be a regular file of at most 64 MiB");
    await privateControllerDirectory(root);
    if ((await readdir(root)).length) fail("A gate experiment needs a new, empty private directory; nothing was overwritten");
    return locked(root, "gate-experiment", async () => {
        const store = join(root, "source.git");
        await copyFile(bundle, join(root, "corpus.bundle"), 1);
        await git(["init", "--bare", "--initial-branch=corpus", store], "Creating the corpus store");
        await git(["--git-dir", store, "fetch", "--no-tags", "--", join(root, "corpus.bundle"), "+refs/*:refs/corpus/*"], "Fetching the corpus");
        for (const commit of [base.repository.commit, ...base.corpus.items.map(item => item.commit)]) if ((await git(["--git-dir", store, "cat-file", "-e", `${commit}^{commit}`], "Checking a corpus commit", { allowed: [0, 1, 128] })).code !== 0) fail(`Corpus commit ${commit} is not in the bundle`);
        for (const item of base.corpus.items) if ((await git(["--git-dir", store, "rev-parse", `${item.commit}^{tree}`], "Reading an item tree")).out !== item.tree) fail(`Corpus item ${item.id} does not have its registered tree`);
        const registration: GateExperiment = stamp({ schema_version: "wringer.gate-experiment.v1" as const, ...base, changedVariable, arms: {
            baseline: { ...arms.baseline, commit: await gateCommit(store, base.repository.commit, arms.baseline.gates, "baseline") },
            candidate: { ...arms.candidate, commit: await gateCommit(store, base.repository.commit, arms.candidate.gates, "candidate") } }, maximumAdditionalHolds, registeredAt: at.toISOString() }) as GateExperiment;
        await git(["--git-dir", store, "bundle", "create", join(root, "gates.bundle"), "refs/gates/baseline", "refs/gates/candidate"], "Bundling the pinned gates");
        await immutableControllerFile(join(root, "proposal.json"), proposal);
        await immutableControllerFile(join(root, "experiment.json"), registration);
        return registration;
    });
}
export async function registerGateExperiment(root: string, input: GateExperimentInput, proposalInput: GateProposal, bundle: string, options: { at?: Date } = {}): Promise<GateExperiment> {
    const proposal = validateProposal(structuredClone(proposalInput)), base = common(structuredClone(input), proposal);
    if (input.changedVariable !== "acceptance-gates") fail("A gate experiment changes the acceptance gates only");
    return register(root, base, "acceptance-gates", { baseline: { gates: gateSet(input.baselineGates, "Baseline", 0), requiredHolds: 0, graphSha256: null }, candidate: { gates: proposal.candidateGates, requiredHolds: 0, graphSha256: null } }, 0, proposal, bundle, options.at ?? new Date());
}
/** A workflow is compared through the gates its loops require and its required human holds. */
function workflowArm(graph: ContainedGraphPlan, repository: { url: string; commit: string }, files: Map<string, string>): Omit<GateArm, "commit"> {
    const plan = validateContainedGraph(structuredClone(graph));
    if (plan.repository.url !== repository.url || plan.repository.commit !== repository.commit) fail("A compared workflow must pin the corpus base");
    const gates = new Map<string, GateDeclaration>();
    for (const node of Object.values(plan.nodes)) if (node.kind === "loop") for (const check of node.plan.acceptance.checks) {
        const gate: GateDeclaration = { id: check.id, argv: [...check.argv], cwd: check.cwd, timeout_seconds: check.timeout_seconds, files: check.files.map(path => ({ path, content: files.get(path) ?? fail(`Workflow gate ${check.id} needs the pinned content of ${path}`) })) };
        if (gates.has(check.id) && hashValue(gates.get(check.id)) !== hashValue(gate)) fail(`Workflow gate ${check.id} is declared two different ways`);
        gates.set(check.id, gate);
    }
    if (!gates.size) fail("A compared workflow must require at least one gate");
    return { gates: [...gates.values()], requiredHolds: plan.required.filter(name => plan.nodes[name]?.kind === "human-hold").length, graphSha256: plan.sha256 };
}
export async function registerWorkflowExperiment(root: string, input: WorkflowExperimentInput, proposalInput: GateProposal, bundle: string, options: { at?: Date } = {}): Promise<GateExperiment> {
    const proposal = validateProposal(structuredClone(proposalInput)), base = common(structuredClone(input) as ExperimentCommon, proposal);
    if (input.changedVariable !== "workflow") fail("A workflow experiment changes the workflow");
    const files = new Map<string, string>();
    for (const file of gateDeclaration({ id: "files", argv: ["true"], cwd: ".", timeout_seconds: 1, files: input.gateFiles }, "Workflow gate files").files) files.set(file.path, file.content);
    const baseline = workflowArm(input.baselineGraph, base.repository, files), candidate = workflowArm(input.candidateGraph, base.repository, files);
    if (!sameGates(candidate.gates, proposal.candidateGates)) fail("The proposal's candidate gates differ from the gates the candidate workflow requires");
    return register(root, base, "workflow", { baseline, candidate }, integer(input.maximumAdditionalHolds, "Maximum additional holds", 0, 16), proposal, bundle, options.at ?? new Date());
}
export async function readGateExperiment(root: string) {
    const registration = verify(await readControllerFile(join(root, "experiment.json")) as GateExperiment, "Gate experiment");
    if (registration.schema_version !== "wringer.gate-experiment.v1") fail("Unsupported gate experiment version");
    const proposal = validateProposal(await readControllerFile(join(root, "proposal.json")));
    if (proposal.sha256 !== registration.proposalSha256) fail("The retained proposal differs from the registered digest");
    const optional = async (name: string) => await present(join(root, name)) ? readControllerFile(join(root, name)) : null;
    const evaluation = await optional("evaluation.json") as GateEvaluation | null;
    if (evaluation) verify(evaluation, "Gate evaluation");
    return { registration, proposal, evaluation, change: await optional("change.json"), sent: await optional("sent.json") };
}

function score(experiment: GateExperiment, oracle: GateOracle, runs: GateRun[], arm: "baseline" | "candidate", split?: "development" | "held-out"): GateScore {
    const items = experiment.corpus.items.filter(item => !split || item.split === split), label = (item: string) => oracle.labels.find(row => row.itemId === item)!.label;
    const outcome = (item: string) => runs.find(run => run.itemId === item && run.arm === arm)?.outcome ?? "not-started";
    const defects = items.filter(item => label(item.id) === "defect"), controls = items.filter(item => label(item.id) === "control");
    return { items: items.length, defects: defects.length, controls: controls.length, caught: defects.filter(item => outcome(item.id) === "failed").length, missed: defects.filter(item => outcome(item.id) === "passed").length,
        falsePositives: controls.filter(item => outcome(item.id) === "failed").length, controlsPassed: controls.filter(item => outcome(item.id) === "passed").length,
        unavailable: items.filter(item => !["passed", "failed"].includes(outcome(item.id))).length, passRate: items.length ? items.filter(item => outcome(item.id) === "passed").length / items.length : 0 };
}
function qualify(experiment: GateExperiment, proposal: GateProposal, summary: GateEvaluation["summary"]): GateEvaluation["qualification"] {
    const reasons: string[] = [], base = summary.baseline.heldOut, cand = summary.candidate.heldOut, { prediction } = experiment;
    const incomplete = base.unavailable + cand.unavailable;
    if (incomplete) reasons.push(`incomplete evidence: ${incomplete} held-out runs are unavailable, uncertain or not started`);
    if (cand.defects < prediction.minimumHeldOutDefects || cand.controls < prediction.minimumHeldOutControls) reasons.push(`too few held-out items: ${cand.defects} defects and ${cand.controls} controls against the registered ${prediction.minimumHeldOutDefects} and ${prediction.minimumHeldOutControls}`);
    const gained = cand.caught - base.caught;
    if (gained < 0) reasons.push(`the candidate catches fewer held-out defects than the baseline (${cand.caught} against ${base.caught}), however green it looks`);
    else if (gained < prediction.minimumAdditionalDefectsCaught) reasons.push(`the registered prediction was not met: ${gained} additional held-out defects caught against the predicted ${prediction.minimumAdditionalDefectsCaught}`);
    const noise = cand.falsePositives - base.falsePositives;
    if (noise > prediction.maximumAdditionalFalsePositives) reasons.push(`the candidate adds ${noise} false positives on correct held-out controls`);
    const holds = summary.candidate.requiredHolds - summary.baseline.requiredHolds;
    if (holds > experiment.maximumAdditionalHolds) reasons.push(`the candidate adds ${holds} required human holds against an allowed ${experiment.maximumAdditionalHolds}`);
    const leaked = proposal.inputs.developmentItems.filter(item => experiment.corpus.items.find(row => row.id === item)?.split !== "development");
    if (leaked.length) reasons.push(`holdout leakage: the proposal saw ${leaked.join(", ")}`);
    return { qualified: !reasons.length, reasons };
}
/** Run every planned gate run once, in a fixed order, then decide on the held-out split. */
export async function evaluateGateExperiment(root: string, oracleInput: GateOracle, options: { runCommands?: (request: ContainedCommandRequest) => Promise<ContainedCommandResult>; evidenceKind?: "contained" | "deterministic-fixture"; signal?: AbortSignal; at?: () => Date } = {}): Promise<GateEvaluation> {
    return locked(root, "gate-experiment", async () => {
        const { registration: experiment, proposal, evaluation } = await readGateExperiment(root), oracle = validateOracle(structuredClone(oracleInput));
        if (oracle.sha256 !== experiment.corpus.oracleSha256 || oracle.corpusId !== experiment.corpus.id) fail("The oracle differs from the commitment registered before evaluation; no gate ran");
        const labelled = new Set(oracle.labels.map(row => row.itemId));
        if (labelled.size !== experiment.corpus.items.length || experiment.corpus.items.some(item => !labelled.has(item.id))) fail("The oracle must label exactly the registered corpus");
        if (evaluation) return evaluation;
        const evidenceKind = options.evidenceKind ?? (options.runCommands ? "deterministic-fixture" : "contained"), clock = options.at ?? (() => new Date());
        const started = clock(), deadline = started.getTime() + experiment.limits.wallClockSeconds * 1000, store = join(root, "source.git");
        await mkdir(join(root, "runs"), { recursive: true, mode: 0o700 });
        const plan = experiment.corpus.items.flatMap(item => (["baseline", "candidate"] as const).map(arm => ({ item, arm })));
        const runs: GateRun[] = []; let stopped = false;
        for (const [index, { item, arm }] of plan.entries()) {
            const name = String(index).padStart(4, "0"), recordPath = join(root, "runs", `${name}.json`), reservedPath = join(root, "runs", `${name}.reserved.json`);
            const blank: GateRun = { index, itemId: item.id, arm, outcome: "not-started", exitCodes: [], outputSha256: null, runtimeId: null, sourceTree: null, durationMs: null };
            if (await present(recordPath)) { runs.push(await readControllerFile(recordPath)); continue; }
            // A reservation without a record is an uncertain run: never rerun it.
            if (await present(reservedPath)) { const uncertain = { ...blank, outcome: "uncertain" as const }; await immutableControllerFile(recordPath, uncertain); runs.push(uncertain); continue; }
            const gates = experiment.arms[arm].gates;
            if (stopped || clock().getTime() > deadline || !gates.length) {
                const row = { ...blank, outcome: gates.length ? "not-started" as const : "passed" as const };
                await immutableControllerFile(recordPath, row); runs.push(row); continue;
            }
            await immutableControllerFile(reservedPath, { index, itemId: item.id, arm, reservedAt: clock().toISOString() });
            const request: ContainedCommandRequest = { repo: { url: experiment.repository.url, commit: item.commit, bundlePath: join(root, "corpus.bundle"), objectStore: store } as PreparedRepositorySource,
                runtime: experiment.runtime as ContainedCommandRequest["runtime"], commands: gates.map(gate => ({ id: `${arm}/${gate.id}`, argv: gate.argv, cwd: gate.cwd, timeoutMs: gate.timeout_seconds * 1000 })),
                acceptanceSource: { url: experiment.repository.url, commit: experiment.arms[arm].commit, bundlePath: join(root, "gates.bundle"), objectStore: store } as PreparedRepositorySource,
                protectedFiles: [...new Set(gates.flatMap(gate => gate.files.map(file => file.path)))], writableDirectories: [], timeoutMs: gates.reduce((sum, gate) => sum + gate.timeout_seconds * 1000, 0), signal: options.signal };
            let row: GateRun;
            try {
                const measured = await (options.runCommands ?? runContainedCommands)(request), p = measured.provenance;
                if (!p || p.role !== "verifier" || p.repository?.commit !== item.commit || p.repository?.url !== experiment.repository.url || p.image !== experiment.runtime.image || p.clonedInside !== true || !Array.isArray(p.hostMounts) || p.hostMounts.length) fail("A gate run did not establish the exact item in a contained verifier");
                if (hashValue(measured.results.map(result => result.id)) !== hashValue(request.commands.map(command => command.id))) fail("A gate run did not report exactly the planned gates");
                const codes = measured.results.map(result => result.code), unavailable = measured.sourceChanged || codes.some(code => !Number.isInteger(code) || unavailableExit(code));
                row = { ...blank, outcome: unavailable ? "unavailable" : codes.every(code => code === 0) ? "passed" : "failed", exitCodes: codes.map(code => unavailable && unavailableExit(code) ? null : code), outputSha256: hashBytes(measured.results.map(result => result.stdout + result.stderr).join("\n")), runtimeId: p.runtimeId ?? null, sourceTree: measured.sourceTree ?? null, durationMs: measured.results.every(result => Number.isSafeInteger(result.durationMs) && result.durationMs >= 0) ? measured.results.reduce((sum, result) => sum + result.durationMs, 0) : null };
                if (row.sourceTree !== null && row.sourceTree !== item.tree) row = { ...row, outcome: "unavailable" };
            } catch (error) {
                // An infrastructure failure stops collection; remaining runs stay in the denominator.
                row = { ...blank, outcome: "unavailable" }; stopped = true;
            }
            await immutableControllerFile(recordPath, row); runs.push(row);
        }
        const summary = { baseline: summarise(experiment, oracle, runs, "baseline"), candidate: summarise(experiment, oracle, runs, "candidate") };
        const result = stamp({ schema_version: "wringer.gate-evaluation.v1" as const, experimentSha256: experiment.sha256, oracleSha256: oracle.sha256, evidenceKind, runs, summary, qualification: qualify(experiment, proposal, summary), evaluatedAt: clock().toISOString() }) as GateEvaluation;
        await immutableControllerFile(join(root, "oracle.json"), oracle);
        await immutableControllerFile(join(root, "evaluation.json"), result);
        return result;
    });
}
function summarise(experiment: GateExperiment, oracle: GateOracle, runs: GateRun[], arm: "baseline" | "candidate"): GateArmSummary {
    return { all: score(experiment, oracle, runs, arm), development: score(experiment, oracle, runs, arm, "development"), heldOut: score(experiment, oracle, runs, arm, "held-out"), requiredHolds: experiment.arms[arm].requiredHolds, gateRuns: runs.filter(run => run.arm === arm && !["not-started"].includes(run.outcome) && experiment.arms[arm].gates.length > 0).length, durationMs: runs.filter(run => run.arm === arm).reduce((sum, run) => sum + (run.durationMs ?? 0), 0) };
}
async function qualified(root: string, action: string) {
    const current = await readGateExperiment(root);
    if (!current.evaluation?.qualification.qualified) fail(`Only a qualified evaluation can ${action}; ${current.evaluation ? current.evaluation.qualification.reasons.join("; ") : "nothing has been evaluated"}`);
    return current as Awaited<ReturnType<typeof readGateExperiment>> & { evaluation: GateEvaluation };
}
/** A reviewable source change: the candidate's pinned gate files on the corpus base,
 * with the prediction, results, scope and rollback. Nothing is sent. */
export async function prepareGateChange(root: string, output: string) {
    const current = await qualified(root, "prepare a source change"), { registration, proposal, evaluation } = current;
    if (current.change) fail("A source change was already prepared for this experiment");
    const store = join(root, "source.git"), commit = registration.arms.candidate.commit;
    const patch = (await git(["--git-dir", store, "diff", "--binary", registration.repository.commit, commit], "Writing the change patch")).out + "\n";
    await mkdir(output, { mode: 0o700 });
    const row = (label: string, arm: GateArmSummary) => `| ${label} | ${arm.heldOut.caught}/${arm.heldOut.defects} | ${arm.heldOut.falsePositives}/${arm.heldOut.controls} | ${Math.round(arm.heldOut.passRate * 100)}% | ${arm.requiredHolds} | ${arm.gateRuns} runs, ${arm.durationMs} ms |`;
    const body = `# ${registration.changedVariable === "workflow" ? "Workflow" : "Gate"} proposal ${proposal.id}\n\n${proposal.rationale}\n\n## Prediction (registered before evaluation)\n\n${registration.prediction.statement}\n\n## Held-out results against the frozen oracle\n\n| Arm | Defects caught | Controls failed | Pass rate | Required holds | Gate time (all splits) |\n| --- | --- | --- | --- | --- | --- |\n${row("Baseline", evaluation.summary.baseline)}\n${row("Candidate", evaluation.summary.candidate)}\n\nQualified: ${evaluation.qualification.qualified}. Evidence: ${evaluation.evidenceKind}. Evaluation \`${evaluation.sha256}\`.\n\n## Scope limits\n\nTask family \`${registration.taskFamily}\`, repository ${registration.repository.url} at \`${registration.repository.commit}\`, corpus \`${registration.corpus.id}\` (${registration.corpus.items.length} items), verifier image \`${registration.runtime.image}\`. A different model, image, check family or task family puts this evidence out of scope. The result says nothing about live agent behaviour.\n\n## Rollback\n\nRevert this change's commit. If the selection was adopted for future plans, record an undo with \`wring experiment gate undo\`; active plans and their graders were never changed.\n`;
    await writeFile(join(output, "change.patch"), patch, { flag: "wx", mode: 0o600 });
    await writeFile(join(output, "PROPOSAL.md"), body, { flag: "wx", mode: 0o600 });
    for (const [name, value] of [["experiment.json", registration], ["proposal.json", proposal], ["evaluation.json", evaluation]] as const) await writeFile(join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    const change = stamp({ schema_version: "wringer.gate-change.v1" as const, experimentSha256: registration.sha256, evaluationSha256: evaluation.sha256, base: registration.repository.commit, commit, patchSha256: hashBytes(patch), bodySha256: hashBytes(body) });
    await immutableControllerFile(join(root, "change.json"), change);
    return change;
}
/** Explicit, separate publication of the prepared change to a review branch only. */
export async function sendGateChange(root: string, options: { remote: string; sourceBranch: string; actor: string }) {
    return locked(root, "gate-experiment", async () => {
        const current = await readGateExperiment(root);
        if (!current.change) fail("Prepare the source change before sending it; nothing was sent");
        if (current.sent) fail("This change was already sent; a Send is never reissued");
        const branch = text(options.sourceBranch, "Review branch", 200), actor = text(options.actor, "Actor", 200), remote = text(options.remote, "Remote", 4096);
        if (["main", "master"].includes(branch) || /^[/-]|[\s~^:?*\[\\]|\.\.|@\{/.test(branch) || branch.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".lock"))) fail("A gate change is sent only to a safe non-default review branch");
        if (!isAbsolute(remote)) { const url = new URL(remote); if (!["https:", "ssh:"].includes(url.protocol) || url.password || url.protocol === "https:" && url.username) fail("Use a credential-free HTTPS/SSH remote or a local bare origin"); }
        const heads = (await git(["ls-remote", "--symref", "--", remote, "HEAD", `refs/heads/${branch}`], "Reading the remote")).out;
        if (new RegExp(`^ref: refs/heads/${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\tHEAD$`, "m").test(heads)) fail("The review branch is the remote default branch; nothing was sent");
        const existing = heads.split("\n").map(line => line.split("\t")).find(([, ref]) => ref === `refs/heads/${branch}`)?.[0];
        if (existing && existing !== current.change.commit) fail("The review branch already exists with different content; nothing was sent");
        await immutableControllerFile(join(root, "send-intent.json"), { commit: current.change.commit, sourceBranch: branch, actor });
        await git(["--git-dir", join(root, "source.git"), "push", "--porcelain", "--", remote, `${current.change.commit}:refs/heads/${branch}`], "Publishing the gate change");
        const confirmed = (await git(["ls-remote", "--", remote, `refs/heads/${branch}`], "Confirming the publication")).out.split("\t")[0];
        if (confirmed !== current.change.commit) fail("Publication is uncertain; the remote did not confirm the exact change commit");
        const sent = stamp({ schema_version: "wringer.gate-change-sent.v1" as const, commit: current.change.commit, sourceBranch: branch, actor, at: new Date().toISOString() });
        await immutableControllerFile(join(root, "sent.json"), sent);
        return sent;
    });
}
export async function readGateSelections(registry: string) {
    const directory = join(registry, "selections");
    const names = await present(directory) ? (await readdir(directory)).filter(name => name.endsWith(".json")).sort() : [];
    const records: GateSelection[] = []; let previous: string | null = null;
    for (const [index, name] of names.entries()) {
        if (name !== `${String(index).padStart(4, "0")}.json`) fail("Gate selections are not one contiguous history");
        const row = verify(await readControllerFile(join(directory, name)) as GateSelection, "Gate selection");
        if (row.previousSha256 !== previous) fail("Gate selection history is broken");
        records.push(row); previous = row.sha256;
    }
    // Undo returns to whatever the undone adoption replaced.
    const stack: GateSelection[] = [];
    for (const row of records) { if (row.action === "adopt") stack.push(row); else stack.pop(); }
    return { records, revision: previous, current: stack.at(-1) ?? null };
}
async function appendSelection(registry: string, body: Omit<GateSelection, "sha256" | "previousSha256" | "at" | "futureOnly" | "schema_version">, expectedRevision: string | null) {
    await privateControllerDirectory(registry);
    return locked(registry, "gate-selections", async () => {
        const history = await readGateSelections(registry);
        if (history.revision !== expectedRevision) fail("The gate selection revision changed; reload before deciding");
        await mkdir(join(registry, "selections"), { recursive: true, mode: 0o700 });
        const record = stamp({ schema_version: "wringer.gate-adoption.v1" as const, ...body, previousSha256: history.revision, at: new Date().toISOString(), futureOnly: true as const }) as GateSelection;
        await immutableControllerFile(join(registry, "selections", `${String(history.records.length).padStart(4, "0")}.json`), record);
        return record;
    });
}
/** Select the qualified candidate gates for FUTURE plans only. */
export async function adoptGateSelection(root: string, registry: string, options: { actor: string; expectedRevision: string | null }) {
    const { registration, evaluation } = await qualified(root, "be adopted");
    return appendSelection(registry, { action: "adopt", taskFamily: registration.taskFamily, repository: registration.repository.url, gates: registration.arms.candidate.gates, experimentSha256: registration.sha256, evaluationSha256: evaluation.sha256, actor: text(options.actor, "Actor", 200) }, options.expectedRevision);
}
export async function undoGateSelection(registry: string, options: { actor: string; expectedRevision: string | null }) {
    const history = await readGateSelections(registry);
    if (!history.current) fail("No adopted gate selection to undo");
    return appendSelection(registry, { action: "undo", taskFamily: history.current.taskFamily, repository: history.current.repository, gates: history.current.gates, experimentSha256: history.current.experimentSha256, evaluationSha256: history.current.evaluationSha256, actor: text(options.actor, "Actor", 200) }, options.expectedRevision);
}
