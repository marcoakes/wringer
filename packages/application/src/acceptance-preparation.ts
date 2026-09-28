import { withMaintenanceLock } from "./maintenance";
import { mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { git, parseGate, Redactor, runProcess, type Gate } from "@wringer/engine";
import { hashBytes, hashValue } from "@wringer/plan";
import { createLocalSourceBundle } from "@wringer/runtime";
import { assistantExists, assistantId, assistantPath, createAssistantDirectory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { safeWorkspaceSnapshot } from "./workspaces";
import { validateAdoptionRecord } from "./adoption-records";
import adapterSource from "../../../integrations/assertion-adapter.txt" with { type: "text" };
import nodeReporter from "../../../runtime/node-reporter.mjs" with { type: "text" };
export const ACCEPTANCE_ADAPTER = "wringer-acceptance/wringer-assertions.bun.js";
export interface AcceptanceInput {
    schema_version: "wringer.acceptance-input.v1";
    requirements: { id: string; title: string; quote: string }[];
    files: { path: string; contents: string }[];
    checks: { id: string; run: string; inputs: string[]; requirements: string[]; timeout?: number; adapter?: "node-test" | "vitest" | "playwright" }[];
}
const plain = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, keys: string[]) => plain(value) && Object.keys(value).every(key => keys.includes(key));
const pathOkay = (path: unknown): path is string => typeof path === "string" && /^wringer-acceptance\/[A-Za-z0-9][A-Za-z0-9_./-]{0,199}$/.test(path) && path.split("/").every(part => part && !part.startsWith("."));
const word = (value: unknown, length: number): value is string => typeof value === "string" && !!value.trim() && !value.includes("\0") && Buffer.byteLength(value) <= length;
export async function inspectAcceptancePreparation(root: string, repoPath: string, input: AcceptanceInput) {
    await validateAdoptionRecord(input);
    const repo = await realpath(repoPath), distance = relative(repo, resolve(root));
    if (!distance || distance !== ".." && !distance.startsWith(`..${sep}`) && !distance.startsWith(sep)) throw new Error("Acceptance preparation state must be outside the source repository");
    if (!exact(input, ["schema_version", "requirements", "files", "checks"]) || input.schema_version !== "wringer.acceptance-input.v1" || Buffer.byteLength(JSON.stringify(input)) > 1024 * 1024 || !Array.isArray(input.requirements) || !input.requirements.length || input.requirements.length > 64 || !Array.isArray(input.files) || input.files.length > 64 || !Array.isArray(input.checks) || !input.checks.length || input.checks.length > 64) throw new Error("Use a bounded acceptance preparation with requirements, new files and checks");
    const ids = new Set<string>();
    for (const row of input.requirements) {
        if (!exact(row, ["id", "title", "quote"]) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(row.id) || ids.has(row.id) || !word(row.title, 200) || !word(row.quote, 4096)) throw new Error("Acceptance requirements need distinct IDs and the original request words");
        ids.add(row.id);
    }
    const source = await safeWorkspaceSnapshot(repo);
    if (source.root !== repo || !source.head_sha || source.dirty) throw new Error("Acceptance preparation requires the clean committed repository root; preserve current edits before preparing new tests");
    const tracked = (await git(repo, ["ls-tree", "-r", "--name-only", "-z", source.head_sha])).stdout.split("\0").filter(Boolean);
    if (tracked.some(path => path === "wringer-acceptance" || path.startsWith("wringer-acceptance/"))) throw new Error("This source already has acceptance preparation files. Review a new baseline explicitly; existing tests are never overwritten");
    const paths = new Set<string>();
    for (const file of input.files) {
        if (!exact(file, ["path", "contents"]) || !pathOkay(file.path) || file.path === ACCEPTANCE_ADAPTER || paths.has(file.path) || !word(file.contents, 128 * 1024) || [...paths].some(path => path.startsWith(file.path + "/") || file.path.startsWith(path + "/"))) throw new Error("Only distinct new inert files under wringer-acceptance are supported; traversal and replacement are refused");
        paths.add(file.path);
    }
    const checkIds = new Set<string>(), gates: Gate[] = [];
    for (const check of input.checks) {
        if (!exact(check, ["id", "run", "inputs", "requirements", "timeout", "adapter"]) || checkIds.has(check.id) || !Array.isArray(check.requirements) || !check.requirements.length || check.requirements.some(id => !ids.has(id)) || !Array.isArray(check.inputs) || !check.inputs.length || check.inputs.some(path => !paths.has(path) && !tracked.includes(path)) || !word(check.run, 16384)) throw new Error("Each new check needs distinct identity, exact existing/new input paths and declared requirements");
        const gate = parseGate({ id: check.id, run: check.run, inputs: check.inputs, proves: check.requirements, ...(check.timeout ? { timeout: check.timeout } : {}), ...(check.adapter ? { evidence: { kind: "assertions", adapter: check.adapter } } : {}) });
        checkIds.add(check.id); gates.push(gate);
    }
    if (input.requirements.some(row => !gates.some(gate => gate.proves.includes(row.id))) || input.files.some(file => !gates.some(gate => gate.inputs.includes(file.path)))) throw new Error("Every requirement and added test file must be linked to a selected check");
    const files = [...input.files, ...(gates.some(gate => gate.evidence) ? [{ path: ACCEPTANCE_ADAPTER, contents: adapterSource }] : [])];
    if (gates.some(gate => gate.evidence?.adapter === "node-test")) {
        if (paths.has("wringer-acceptance/node-reporter.mjs")) throw new Error("The measured Node reporter path is reserved");
        files.push({ path: "wringer-acceptance/node-reporter.mjs", contents: nodeReporter });
        if (gates.some(gate => gate.evidence?.adapter === "node-test" && !gate.run.includes("--test-reporter=./wringer-acceptance/node-reporter.mjs"))) throw new Error("Choose node --test --test-reporter=./wringer-acceptance/node-reporter.mjs with your selected tests. Plain TAP cannot distinguish an empty file from a registered test");
    }
    if (new Redactor().scrub(JSON.stringify(input)) !== JSON.stringify(input)) throw new Error("Detected credential in inert acceptance input");
    const body = { schema_version: "wringer.acceptance-preview.v1", repo, baseCommit: source.head_sha, sourceFingerprint: source.fingerprint, input, files, gates, authority: "none", executionApproved: false };
    return { ...body, identity: hashValue(body) };
}
export type AcceptancePreview = Awaited<ReturnType<typeof inspectAcceptancePreparation>>;
type Prepared = { schema_version: "wringer.acceptance-prepared.v1"; id: string; repo: string; baseCommit: string; commit: string; sourceRepo: string; preview: AcceptancePreview; actor: string; executionApproved: false };
/** Git's configuration and hooks are disabled, and input travels as objects.
 * No project script, filter, dependency install or test executes on the host. */
async function inertGit(repo: string, args: string[]) {
    const result = await runProcess(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], { cwd: repo, timeout: 30, maxBytes: 2 * 1024 ** 2, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Wringer acceptance preparation", GIT_AUTHOR_EMAIL: "preparation@example.invalid", GIT_COMMITTER_NAME: "Wringer acceptance preparation", GIT_COMMITTER_EMAIL: "preparation@example.invalid", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" } });
    if (result.exit_code !== 0 || result.timed_out || result.stdout_truncated) throw new Error("Inert acceptance source preparation failed; retained state needs inspection");
    return result.stdout.trim();
}
export async function readAcceptancePreparation(root: string, id: string, repo: string) {
    const record = await readAssistantRecord<Prepared>(root, `acceptance-preparations/${assistantId(id)}/result.json`);
    const sourceRepo = await assistantPath(root, `acceptance-preparations/${id}/source`);
    if (record.schema_version !== "wringer.acceptance-prepared.v1" || record.id !== id || record.repo !== repo || record.sourceRepo !== sourceRepo || record.executionApproved !== false || record.baseCommit !== record.preview.baseCommit) throw new Error("Acceptance source binding changed");
    const snapshot = await safeWorkspaceSnapshot(sourceRepo);
    if (snapshot.dirty || snapshot.head_sha !== record.commit || (await inertGit(sourceRepo, ["rev-parse", "HEAD^"])) !== record.baseCommit) throw new Error("Prepared acceptance source changed");
    const changed = (await inertGit(sourceRepo, ["diff", "--name-only", "--no-ext-diff", "--no-textconv", "HEAD^", "HEAD"])).split("\n").sort();
    if (hashValue(changed) !== hashValue(record.preview.files.map(file => file.path).sort())) throw new Error("Prepared source includes an unreviewed change");
    for (const file of record.preview.files) if (hashBytes(await readFile(await assistantPath(sourceRepo, file.path))) !== hashBytes(Buffer.from(file.contents))) throw new Error("Prepared acceptance bytes changed");
    return record;
}
export async function applyAcceptancePreparation(root: string, preview: AcceptancePreview, decision: { expectedIdentity: string; actor: string }) {
    if (decision.expectedIdentity !== preview.identity || !word(decision.actor, 200) || new Redactor().scrub(decision.actor) !== decision.actor) throw new Error("Review the exact inert acceptance preparation and name its decision actor");
    const current = await inspectAcceptancePreparation(root, preview.repo, preview.input);
    if (hashValue(current) !== hashValue(preview)) throw new Error("Acceptance preparation changed since preview");
    return withMaintenanceLock(root, async () => {
    await createAssistantDirectory(root);
    const index = `acceptance-index/${preview.identity}.json`;
    if (!await assistantExists(root, index)) await writeAssistantRecord(root, index, { id: crypto.randomUUID(), identity: preview.identity });
    const registered = await readAssistantRecord<any>(root, index), id = assistantId(registered.id);
    if (registered.identity !== preview.identity) throw new Error("Acceptance registration changed");
    const directory = await assistantPath(root, `acceptance-preparations/${id}`); await mkdir(directory, { recursive: true, mode: 0o700 });
    const lockPath = join(directory, "preparation.lock"), lock = await open(lockPath, "wx", 0o600).catch(() => { throw new Error("Acceptance preparation is owned or interrupted; inspect retained state before recovery"); });
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, identity: preview.identity })); await lock.sync();
        if (await assistantExists(directory, "result.json")) return readAcceptancePreparation(root, id, preview.repo);
        await writeAssistantRecord(directory, "preview.json", preview);
        const sourceRepo = join(directory, "source"), bundle = join(directory, "base.bundle");
        if (await assistantExists(directory, "source") || await assistantExists(directory, "base.bundle")) throw new Error("Acceptance source preparation was interrupted; retain its outputs for explicit recovery");
        await createLocalSourceBundle(preview.repo, preview.baseCommit, bundle);
        await inertGit(directory, ["clone", "--no-checkout", "--template=/dev/null", "--", bundle, sourceRepo]);
        await inertGit(sourceRepo, ["checkout", "--detach", preview.baseCommit]);
        for (const file of preview.files) { const path = await assistantPath(sourceRepo, file.path); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.contents, { flag: "wx", mode: 0o644 }); }
        await inertGit(sourceRepo, ["add", "--", "wringer-acceptance"]);
        await inertGit(sourceRepo, ["commit", "-m", `Reviewed inert acceptance preparation ${preview.identity}`]);
        const commit = await inertGit(sourceRepo, ["rev-parse", "HEAD"]);
        if ((await safeWorkspaceSnapshot(preview.repo)).fingerprint !== preview.sourceFingerprint) throw new Error("Source changed during acceptance preparation; the retained snapshot was not approved");
        const record: Prepared = { schema_version: "wringer.acceptance-prepared.v1", id, repo: preview.repo, baseCommit: preview.baseCommit, commit, sourceRepo, preview, actor: decision.actor, executionApproved: false };
        await writeAssistantRecord(directory, "result.json", record); return readAcceptancePreparation(root, id, preview.repo);
    } finally { await lock.close(); await unlink(lockPath); }
    });
}
