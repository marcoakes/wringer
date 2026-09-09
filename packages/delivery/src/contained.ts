import { mkdir, readFile, writeFile, lstat, readdir, realpath, mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { hashValue, hashBytes, canonicalJson, validateExecutionPlan, validateExecutionAuthority, type ExecutionPlan } from "@wringer/plan";
import { processDriver } from "@wringer/runtime";
import { readValidatedContainedState, withContainedJourneyLock, validContainedHumanAttribution } from "@wringer/workflow";
import { assertContainedDisplayVisuals, readPinnedDesignSnapshot } from "@wringer/workflow";
import { Redactor } from "@wringer/engine";
import { inside, files, seal, checkSeal, quote } from "./io";
import { publishMergeRequest, assertForgeRepositoryBinding, type ForgeConfiguration, type MergeRequestPublication } from "./forge";
import { containedViewContracts, containedViewContractsV3, deriveContainedDeliveryProjection, containedProjectionDigest, renderContainedCertificate, renderContainedBoard, renderContainedBoardV2, renderContainedDocuments, renderContainedDocumentsV3, type ContainedDeliveryProjection } from "./projection";
import { openReader } from "@wringer/records";
import { schemaDirectory } from "@wringer/engine";
import { inspectCandidateHistory } from "./source-inspection";
import { approveSourceFindings, readSourceDecisionBatch, readSourceApprovals, sourceReviewReceipt, sourceReviewMarker, sourceReviewDigest, validateSourceReviewReceipt, SOURCE_REVIEW_LIMITATIONS, type SourceReviewDecision, type SourceReviewReceipt } from "./source-review";
export interface ContainedPublication {
    remote: string;
    sourceBranch: string;
    targetBranch: string;
    forge?: ForgeConfiguration;
}
export interface ContainedDeliveryOptions {
    stateDir: string;
    publication: ContainedPublication;
    send?: boolean;
    signal?: AbortSignal;
    resumeCommand?: string;
    expectedRevision?: string;
    expectedCandidateTree?: string;
}
export interface ContainedDeliveryResult {
    schema_version: "wringer.contained-publication.v1";
    status: "prepared" | "delivered";
    deliveryId: string;
    bundleDir: string;
    codeCommit: string;
    evidenceCommit: string;
    sourceBranch: string;
    targetBranch: string;
    auditCommand: string;
    pushed: boolean;
    forge?: MergeRequestPublication;
    falsify: {
        status: "available";
        command: string;
        reason: string;
    };
}
export interface ContainedAudit {
    schema_version: "wringer.contained-audit.v1";
    status: "passed" | "failed";
    deliveryId: string | null;
    codeCommit: string | null;
    checks: number;
    human: number;
    claims: {
        id: string;
        status: "checked" | "failed";
        reason: string;
    }[];
    limits: string[];
}
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const digestPattern = /^[a-f0-9]{64}$/, gitPattern = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const legacyFalsificationRouteV1 = (bundlePath: string) => ({ status: "available" as const, command: `wringer-drive falsify --bundle ${bundlePath}`, reason: "A separate bounded committed-source mutation challenge is available. No mutation result is claimed before that command runs; an unavailable contained runtime is recorded as inconclusive." });
const falsificationRoute = legacyFalsificationRouteV1;
const legacyLimitationsV1 = ["This is a tamper-evident record of controller observations, not a fresh execution of acceptance checks or proof against a malicious controller.", "ACP prompts, worker narrative, thought streams and private provider traces are omitted. The source journal was validated before a separately hashed portable semantic projection was made; source digest commitments are provenance, not a claim that omitted bytes can be replayed here.", "Container declarations and recorded runtime identities do not substitute for the live platform isolation release gate.", "The candidate bundle carries exact committed Git history. An evidence commit contains this bundle; its own hash is returned by publication, not self-embedded in its contents.", "The separate contained falsification command challenges supported changed source lines only. It is not a correctness proof; caught, surviving and unavailable mutations are reported separately."];
const limitations = [...legacyLimitationsV1];
const gitEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Wringer evidence", GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: "Wringer evidence", GIT_COMMITTER_EMAIL: "wringer@localhost", GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z" };
async function git(store: string, args: string[], options: {
    input?: string | Uint8Array;
    signal?: AbortSignal;
    allowFailure?: boolean;
} = {}) {
    const r = await processDriver.command(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "uploadpack.packObjectsHook=", "-c", "commit.gpgsign=false", "-c", "protocol.ext.allow=never", "-c", "protocol.file.allow=always", "--git-dir", store, ...args], { input: options.input, signal: options.signal, env: gitEnv, timeoutMs: 60000 });
    if (r.code !== 0 && !options.allowFailure)
        throw new Error(`Contained delivery Git operation failed (${r.code}): ${new Redactor().scrub(r.stderr)}`);
    return r;
}
async function immutable(path: string, value: unknown) {
    const bytes = typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
        await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    }
    catch (e: any) {
        if (e.code !== "EEXIST" || await readFile(path, "utf8") !== bytes)
            throw e;
    }
}
async function immutableImage(root: string, name: string, base64: string) {
    const path = await inside(root, name), bytes = Buffer.from(base64, "base64");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error: any) { if (error.code !== "EEXIST" || hashBytes(await readFile(path)) !== hashBytes(bytes)) throw error; }
}
function visualImagePath(criterionId: string, kind: "reference" | "capture", id: string) { return `visuals/${safeId(criterionId, "visual requirement")}/${kind}-${safeId(id, "visual image")}.png`; }
function visualInventory(plan: ExecutionPlan, humanCriteria: string[]) { return plan.design ? ["visuals/snapshot.json", ...plan.design.reviews.filter(row => humanCriteria.includes(row.criterionId)).flatMap(row => [...row.referenceIds.map(id => visualImagePath(row.criterionId, "reference", id)), ...row.captures.map(image => visualImagePath(row.criterionId, "capture", image.id))])] : []; }
async function read(root: string, name: string, max = 16 * 1024 * 1024) {
    const path = await inside(root, name), stat = await lstat(path);
    if (!stat.isFile() || stat.size > max)
        throw new Error(`Record is not a bounded regular file: ${name}`);
    return JSON.parse(await readFile(path, "utf8"));
}
async function recordedPath(stateDir: string, value: string) { const actual = await realpath(resolve(stateDir, value)); return inside(stateDir, relative(stateDir, actual)); }
function same(a: unknown, b: unknown, label: string) {
    if (canonicalJson(a) !== canonicalJson(b))
        throw new Error(`${label} differs from its bound record`);
}
const ref = (v: any) => v ? { url: v.url, commit: v.commit } : null;
function safeId(value: unknown, label: string): string {
    if (typeof value !== "string" || !value || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(value))
        throw new Error(`Invalid ${label}`);
    return value;
}
function safeBranch(value: unknown) {
    if (typeof value !== "string" || !value || value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".") || value.includes("..") || value.includes("@{") || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) || value.split("/").some(p => !p || p.startsWith(".") || p.endsWith(".lock")))
        throw new Error("Publication needs explicit safe branch names");
    return value;
}
async function validatePublication(publication: ContainedPublication) {
    if (!publication || Object.keys(publication).some(k => !["remote", "sourceBranch", "targetBranch", "forge"].includes(k)))
        throw new Error("Unknown publication setting");
    const source = safeBranch(publication.sourceBranch), target = safeBranch(publication.targetBranch);
    if (source === target || ["main", "master"].includes(source))
        throw new Error("Contained delivery only publishes a distinct nondefault review branch");
    if (typeof publication.remote !== "string" || !publication.remote)
        throw new Error("An explicit publication repository URL is required");
    if (publication.forge)
        assertForgeRepositoryBinding(publication.remote, publication.forge);
    if (publication.remote.startsWith("/")) {
        const stat = await lstat(publication.remote);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (await git(publication.remote, ["rev-parse", "--is-bare-repository"])).stdout.trim() !== "true")
            throw new Error("Local publication targets must be explicit bare Git repositories");
        return;
    }
    let url: URL;
    try {
        url = new URL(publication.remote);
    }
    catch {
        throw new Error("Publication remote must be an explicit HTTPS/SSH URL or local bare repository, not a recalled remote alias");
    }
    if (!["https:", "ssh:"].includes(url.protocol) || url.password || url.protocol === "https:" && url.username || url.search || url.hash)
        throw new Error("Publication remote must not contain credentials/query/fragment");
}
function provenance(p: any) {
    if (!p || p.schema_version !== "wringer.runtime.v1" || !p.clonedInside || !Array.isArray(p.hostMounts) || p.hostMounts.length || !p.runtimeId || !gitPattern.test(p.repository?.commit))
        throw new Error("Runtime provenance lacks the independent cloned-repository boundary");
    return { schema_version: p.schema_version, runtimeId: p.runtimeId, role: p.role, kind: p.kind, image: p.image, repository: ref(p.repository)!, clonedInside: true, hostMounts: [], repositoryAccess: p.repositoryAccess, declared: p.declared, observed: p.observed, limits: p.limits };
}
function verification(v: any) { return v ? { ...v, evidenceRef: `receipts/${safeId(v.runtimeId, "verification runtime")}` } : null; }
function portableState(state: any) { return { schema_version: state.schema_version, id: state.id, planSha256: state.planSha256, authoritySha256: state.authoritySha256, environmentSha256: state.environmentSha256, startedAt: state.startedAt, source: ref(state.source), stage: state.stage, iteration: state.iteration, plannerComplete: state.plannerComplete, workerEffect: state.workerEffect, judgeEffect: state.judgeEffect, runtimeIds: state.runtimeIds, effects: state.effects.map((e: any) => ({ id: e.id, role: e.role, status: e.status, requestSha256: e.requestSha256, requestIdentity: e.requestIdentity, ...(e.disposition ? { disposition: e.disposition } : {}), ...(e.resultSha256 ? { resultSha256: e.resultSha256 } : {}), ...(e.invalidReason ? { invalidReasonOmitted: true } : {}) })), ...(state.verificationAttempts ? { verificationAttempts: state.verificationAttempts.map((a: any) => ({ ...a, ...(a.result ? { result: verification(a.result) } : {}) })) } : {}), baseline: verification(state.baseline), verification: verification(state.verification), candidate: state.candidate ? { source: ref(state.candidate.source), tree: state.candidate.tree, changedPaths: state.candidate.changedPaths } : null, judge: state.judge, humanJudgements: state.humanJudgements }; }
function clean(value: unknown, redactor: Redactor, label: string) {
    const wire = JSON.stringify(value);
    if (redactor.scrub(wire) !== wire || /-----BEGIN [^-]*PRIVATE KEY-----/.test(wire))
        throw new Error(`${label} contains a detected credential; delivery was refused, not silently rewritten`);
    return value;
}
async function observation(stateDir: string, v: any, plan: ExecutionPlan) {
    const root = await recordedPath(stateDir, v.evidenceRef);
    const saved = await read(root, "result.json"), observed = await read(root, "observations.json");
    if (saved.sha256 !== hashValue(saved.value))
        throw new Error("Verification result seal changed");
    same(saved.value, v, "Journal verification receipt");
    if (typeof observed.sourceChanged !== "boolean" || observed.sourceTree !== v.candidateTree || observed.provenance?.runtimeId !== v.runtimeId || observed.provenance?.role !== "verifier" || observed.provenance?.repository?.commit !== v.candidateCommit || observed.provenance?.image !== plan.runtime.image)
        throw new Error("Verification observation contradicts its source/runtime identity");
    if (!Array.isArray(observed.results) || new Set(observed.results.map((r: any) => r.id)).size !== observed.results.length)
        throw new Error("Verification observation duplicates command results");
    for (const row of observed.results)
        if (typeof row.stdout !== "string" || typeof row.stderr !== "string" || Buffer.byteLength(row.stdout + row.stderr) > 1024 * 1024)
            throw new Error("A check observation exceeds the 1 MiB portable output ceiling; no truncated proof was published");
    return { ...observed, provenance: provenance(observed.provenance) };
}
function validateObservations(v: any, observed: any, plan: ExecutionPlan) {
    if (typeof observed.sourceChanged !== "boolean" || observed.sourceTree !== v.candidateTree || observed.provenance.runtimeId !== v.runtimeId || observed.provenance.repository.commit !== v.candidateCommit || observed.provenance.image !== plan.runtime.image || observed.provenance.role !== "verifier")
        throw new Error("Check receipts are not bound to the exact source and verifier");
    provenance(observed.provenance);
    same(observed.provenance.observed?.writableDirectories ?? [], plan.environment.writable_directories, "Verifier writable-output policy");
    const expected = [...plan.environment.setup.map(c => `setup/${c.id}`), ...plan.environment.baseline.map(c => `baseline/${c.id}`), ...plan.acceptance.checks.map(c => `acceptance/${c.id}`)];
    same(observed.results.map((r: any) => r.id), expected, "Declared command inventory");
    const unavailable = observed.sourceChanged || plan.environment.setup.some(setup => observed.results.find((r: any) => r.id === `setup/${setup.id}`)?.code !== 0);
    if (v.checks.length !== plan.acceptance.checks.length || new Set(v.checks.map((r: any) => r.id)).size !== v.checks.length)
        throw new Error("Acceptance check inventory changed");
    for (const check of plan.acceptance.checks) {
        const row = v.checks.find((r: any) => r.id === check.id), out = observed.results.find((r: any) => r.id === `acceptance/${check.id}`);
        if (!row || !out || !Number.isInteger(out.code) || row.exitCode !== (unavailable ? null : out.code) || row.status !== (unavailable ? "unavailable" : out.code === 0 ? "passed" : "failed") || row.outputSha256 !== hashBytes(out.stdout + out.stderr) || row.checkInputsSha256 !== hashValue({ argv: check.argv, cwd: check.cwd, files: check.files, protectedInputs: observed.checkInputsSha256 ?? null, image: plan.runtime.image }))
            throw new Error(`Acceptance check ${check.id} contradicts its command/input/output receipt`);
    }
    if ((v.regressions ?? []).length !== plan.environment.baseline.length)
        throw new Error("Regression receipts omitted a declared baseline");
    for (const baseline of plan.environment.baseline) {
        const row = v.regressions.find((r: any) => r.id === baseline.id), out = observed.results.find((r: any) => r.id === `baseline/${baseline.id}`);
        if (!row || !out || row.exitCode !== (unavailable ? null : out.code) || row.status !== (unavailable ? "unavailable" : out.code === 0 ? "passed" : "failed") || row.outputSha256 !== hashBytes(out.stdout + out.stderr))
            throw new Error("Regression receipt contradicts observed output");
    }
    const rows = [...v.checks, ...(v.regressions ?? [])];
    if (v.status !== (rows.some((r: any) => r.status === "unavailable") ? "unavailable" : rows.some((r: any) => r.status === "failed") ? "failed" : "passed"))
        throw new Error("Verification aggregate contradicts check results");
}
async function cloneBundle(bundlePath: string, store: string, commit: string, signal?: AbortSignal) {
    await mkdir(dirname(store), { recursive: true, mode: 0o700 });
    await git(store, ["init", "--bare", ...(commit.length === 64 ? ["--object-format=sha256"] : []), store], { signal });
    await git(store, ["bundle", "verify", bundlePath], { signal });
    await git(store, ["fetch", "--no-tags", bundlePath, `${commit}:refs/heads/candidate`], { signal });
    await git(store, ["fsck", "--strict", "--no-reflogs"], { signal });
    if ((await git(store, ["rev-parse", `${commit}^{commit}`], { signal })).stdout.trim() !== commit)
        throw new Error("Candidate bundle did not resolve the exact recorded commit");
}
async function verifySource(store: string, manifest: any, plan: ExecutionPlan, environment: any, observations: Map<string, any>) {
    const code = manifest.source.codeCommit, base = plan.repository.commit;
    if ((await git(store, ["rev-parse", `${code}^{tree}`])).stdout.trim() !== manifest.source.tree || (await git(store, ["rev-parse", `${base}^{tree}`])).stdout.trim() !== environment.source_tree)
        throw new Error("Carried Git trees differ from candidate/environment identities");
    if ((await git(store, ["merge-base", "--is-ancestor", base, code], { allowFailure: true })).code !== 0)
        throw new Error("Candidate does not descend from the approved baseline");
    const actual = (await git(store, ["diff", "--name-only", "-z", base, code, "--"])).stdout.split("\0").filter(Boolean).sort();
    if (!actual.length)
        throw new Error("No committed source change distinguishes the candidate from its red baseline");
    const listing = (await git(store, ["ls-tree", "-rz", "--full-tree", base])).stdout.split("\0").filter(Boolean).map(line => {
        const row = /^(\d{6}) (?:blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
        if (!row)
            throw new Error("Unrecognized baseline tree entry");
        return { path: row[3]!, mode: row[1]!, blob: row[2]! };
    }).sort((a, b) => a.path.localeCompare(b.path));
    same(listing, environment.files, "Environment source inventory");
    for (const context of environment.context) {
        const entry = listing.find(row => row.path === context.path);
        if (!entry || entry.blob !== context.blob || hashBytes(context.text) !== context.sha256 || (await git(store, ["cat-file", "blob", entry.blob])).stdout !== context.text)
            throw new Error("Environment context does not resolve from the carried source");
    }
    for (const observed of observations.values())
        if ((await git(store, ["rev-parse", `${observed.provenance.repository.commit}^{tree}`])).stdout.trim() !== observed.sourceTree)
            throw new Error("A verification receipt names a tree absent from the carried candidate history");
    for (const path of actual) {
        if (path.split("/").includes(".wringer") || !plan.scope.writable.some(prefix => prefix === "." || path === prefix || path.startsWith(prefix + "/")) || plan.acceptance.protected_paths.some(prefix => prefix === "." || path === prefix || path.startsWith(prefix + "/")))
            throw new Error(`Candidate changed a protected/out-of-scope path: ${path}`);
    }
    const protectedFiles = [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])];
    if (protectedFiles.length) {
        const original = (await git(store, ["--literal-pathspecs", "ls-tree", "-r", "-z", base, "--", ...protectedFiles])).stdout, candidate = (await git(store, ["--literal-pathspecs", "ls-tree", "-r", "-z", code, "--", ...protectedFiles])).stdout;
        same(candidate, original, "Original acceptance input blobs");
        for (const observed of observations.values())
            if (observed.checkInputsSha256 !== hashBytes(original))
                throw new Error("Verifier check-input hash does not resolve from the carried original source");
    }
    return actual;
}
/** Frozen v1 renderer: retained so changes to current product wording cannot invalidate old deliveries. */
export function legacyContainedDocumentsV1(plan: ExecutionPlan, manifest: any, human: any[]) {
    const notes = human.map(row => `- ${row.judgement.criterionId}: ${row.judgement.note} — ${row.judgement.by}`).join("\n"), id = manifest.id;
    return { "summary.md": `# ${plan.name}\n\nDelivery: ${id}\nCandidate: ${manifest.source.codeCommit}\nTree: ${manifest.source.tree}\nChecks: ${manifest.counts.checks}; red-first receipts: ${manifest.counts.proved}; human answers: ${manifest.counts.human}.\n\n${notes}\n\n${legacyLimitationsV1.join("\n\n")}\n`, "mr.md": `# ${plan.name}\n\nDelivery: ${id}\nCandidate commit: ${manifest.source.codeCommit}\nChecks: ${manifest.counts.checks}; red-first receipts: ${manifest.counts.proved}; human answers: ${manifest.counts.human}.\n\n${notes}\n\nFrom the ROOT of a fresh clone of the delivered review branch, run exactly:\n\n\`\`\`sh\n${manifest.auditCommand}\n\`\`\`\n\nThen challenge the committed source range in the declared isolated verifier, from that same clone root:\n\n\`\`\`sh\n${manifest.falsify.command}\n\`\`\`\n\n${manifest.falsify.reason}\n\nThe bundle includes candidate.bundle, plan.json, authority.json, environment.json, manifest.json, projection.json, summary.md, mr.md, digests.json, and every journal/, roles/, receipts/ and human/ file named by the digest inventory. The audit is offline; no original controller directory or provider account is required.\n\n${legacyLimitationsV1.join("\n\n")}\n` };
}
function displayRowsValid(measured: any, plan: ExecutionPlan, criterionId: string): boolean {
    const show = plan.acceptance.criteria.find(c => c.id === criterionId)?.show;
    if (!show || !Array.isArray(measured?.results))
        return false;
    const expected = [...plan.environment.setup.map(c => `setup/${c.id}`), show.id];
    return canonicalJson(measured.results.map((r: any) => r.id)) === canonicalJson(expected) && measured.results.every((r: any) => r.code === 0 && typeof r.stdout === "string" && typeof r.stderr === "string" && Buffer.byteLength(r.stdout + r.stderr) <= 1024 * 1024) && canonicalJson(measured.provenance?.observed?.writableDirectories ?? []) === canonicalJson(plan.environment.writable_directories);
}
function expectedInventory(manifest: any, receiptIds: string[], plan: ExecutionPlan): string[] { return ["candidate.bundle", "plan.json", "authority.json", "environment.json", "manifest.json", "projection.json", "summary.md", "mr.md", "digests.json", ...(["wringer.contained-delivery.v2", "wringer.contained-delivery.v3"].includes(manifest.schema_version) ? ["view.json", "certificate.json", "board.html"] : []), ...(manifest.sourceReview ? ["source-inspection.json"] : []), ...visualInventory(plan, manifest.humanCriteria), ...Array.from({ length: manifest.journal.eventCount }, (_, i) => `journal/${String(i + 1).padStart(6, "0")}.json`), ...manifest.roles.map((id: string) => `roles/${safeId(id, "role")}.json`), ...manifest.humanCriteria.map((id: string) => `human/${safeId(id, "human")}.json`), ...receiptIds.flatMap(id => [`receipts/${safeId(id, "receipt")}/verification.json`, `receipts/${id}/observations.json`])].sort(); }
/** Direct operator CLI only; no provider call, publication or MCP approval. */
export async function reviewContainedSource(options: { stateDir: string; policyDirectory?: string; decision?: SourceReviewDecision; decisionFile?: string; signal?: AbortSignal }) {
    const stateDir = await realpath(options.stateDir);
    return withContainedJourneyLock(stateDir, async () => {
        const { state, plan } = await readValidatedContainedState(stateDir), candidate = state.candidate;
        if (!candidate?.source.bundlePath) throw new Error("Source review needs an exact captured candidate bundle");
        const bundle = await recordedPath(stateDir, candidate.source.bundlePath), info = await lstat(bundle);
        if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error("Source review requires a bounded captured candidate bundle");
        const scratch = await mkdtemp(join(tmpdir(), "wringer-source-review-")), store = join(scratch, "objects.git");
        try {
            await cloneBundle(bundle, store, candidate.source.commit, options.signal);
            const redactor = new Redactor(["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*", ...(plan.runtime.env ?? [])]);
            const inspected = await inspectCandidateHistory(store, candidate.source.commit, redactor, { collectFindings: true, signal: options.signal }), inventory = inspected.inventory!;
            if (options.decision || options.decisionFile) {
                if (!options.policyDirectory) throw new Error("Source review decisions require an explicit --policy-dir outside the target repository");
                if (options.decision && options.decisionFile) throw new Error("Choose one exact decision or one finite decision file, not both");
                const decisions = options.decision ? [options.decision] : await readSourceDecisionBatch(options.decisionFile!, stateDir, options.policyDirectory, inventory);
                await approveSourceFindings(stateDir, inventory, { directory: options.policyDirectory, sourceUrl: plan.repository.url, sourcePaths: [store, dirname(bundle)], decisions, redactor });
            }
            const approvals = await readSourceApprovals(stateDir, inventory);
            return { ...inspected, approvals, pending: inventory.findings.filter(f => !approvals.some(a => a.finding.id === f.id)), limitations: SOURCE_REVIEW_LIMITATIONS };
        } finally { await rm(scratch, { recursive: true, force: true }); }
    });
}
/** Portable, controller-validated delivery. No product worktree or repository program runs on the host. */
export async function deliverContained(options: ContainedDeliveryOptions): Promise<ContainedDeliveryResult> {
    const stateDir = await realpath(options.stateDir);
    return withContainedJourneyLock(stateDir, () => deliverContainedLocked({ ...options, stateDir }));
}
async function deliverContainedLocked(options: ContainedDeliveryOptions): Promise<ContainedDeliveryResult> {
    options.signal?.throwIfAborted();
    await validatePublication(options.publication);
    const stateDir = await realpath(options.stateDir), validated = await readValidatedContainedState(stateDir), { plan, authority, environment, state, result, events } = validated;
    if (options.expectedRevision !== undefined && options.expectedRevision !== events.at(-1)!.sha256 || options.expectedCandidateTree !== undefined && options.expectedCandidateTree !== state.candidate?.tree)
        throw new Error("Delivery selection is stale; reload the current journal and candidate before authorizing publication");
    if (state.stage !== "ready" || result.status !== "review-ready" || !state.candidate || !state.verification || !state.baseline)
        throw new Error("Delivery requires a validated terminal review-ready journal, not a mutable result view");
    const redactor = new Redactor(["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*", ...(plan.runtime.env ?? [])]), id = `contained-${hashValue({ version: 2, journey: state.id, head: events.at(-1)!.sha256, source: options.publication.sourceBranch, target: options.publication.targetBranch }).slice(0, 24)}`, directory = join(stateDir, "deliveries", id), bundleDir = join(directory, "bundle"), bundlePath = `.wringer/deliveries/${id}`;
    const falsify = falsificationRoute(bundlePath);
    await inside(stateDir, relative(stateDir, bundleDir));
    await mkdir(bundleDir, { recursive: true, mode: 0o700 });
    await inside(stateDir, relative(stateDir, bundleDir));
    if (typeof state.candidate.source.bundlePath !== "string")
        throw new Error("Candidate has no controller-captured Git bundle");
    const candidateBundle = await recordedPath(stateDir, state.candidate.source.bundlePath);
    const stat = await lstat(candidateBundle);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
        throw new Error("Candidate needs a bounded self-contained Git bundle");
    const carried = join(bundleDir, "candidate.bundle");
    await inside(bundleDir, "candidate.bundle");
    try {
        await writeFile(carried, await readFile(candidateBundle), { flag: "wx", mode: 0o600 });
    }
    catch (e: any) {
        if (e.code !== "EEXIST" || hashBytes(await readFile(carried)) !== hashBytes(await readFile(candidateBundle)))
            throw e;
    }
    // Each attempt gets an isolated bare index. A killed earlier Git command
    // cannot leave a lock/ref/index that blocks retry or changes this attempt.
    // The immutable carried bundle and all evidence remain at the same paths.
    const scratch = await mkdtemp(join(directory, "preparation-")), store = join(scratch, "objects.git");
    try {
    await cloneBundle(carried, store, state.candidate.source.commit, options.signal);
    const designSnapshot = await readPinnedDesignSnapshot(plan, store);
    if (designSnapshot) await immutable(join(bundleDir, "visuals/snapshot.json"), designSnapshot);
    const observations = new Map<string, any>(), verifications = new Map<string, any>();
    for (const event of events)
        for (const v of [event.state.baseline, event.state.verification, ...((event.state as any).verificationAttempts ?? []).map((a: any) => a.result)])
            if (v && !verifications.has(v.runtimeId)) {
                const observed = await observation(stateDir, v, plan);
                validateObservations(v, observed, plan);
                observations.set(v.runtimeId, observed);
                verifications.set(v.runtimeId, verification(v));
                await immutable(join(bundleDir, `receipts/${safeId(v.runtimeId, "verifier")}/verification.json`), clean(verification(v), redactor, "Verification"));
                await immutable(join(bundleDir, `receipts/${v.runtimeId}/observations.json`), clean(observed, redactor, "Check observations"));
            }
    const roleRows: any[] = [];
    for (const effect of state.effects) {
        const roleResult = effect.result;
        const request = await read(stateDir, `.wringer/contained/effects/${safeId(effect.id, "effect")}/request.json`);
        const row = { id: effect.id, role: effect.role, status: effect.status, ...((effect as any).disposition ? { disposition: (effect as any).disposition } : {}), sourceRequestSha256: effect.requestSha256, sourceResultSha256: effect.resultSha256 ?? null, request: { role: request.role, repo: ref(request.repo), runtime: request.runtime, agent: request.agent, budget: request.budget, ...(request.scope !== undefined ? { scope: request.scope } : {}), ...(request.design !== undefined ? { design: request.design } : {}) }, result: roleResult ? { status: roleResult.status, sessionId: roleResult.sessionId, stopReason: roleResult.stopReason, protocolVersion: roleResult.protocolVersion, authentication: roleResult.authentication, usage: roleResult.usage ?? null, provenance: provenance(roleResult.provenance), ...(effect.id === state.judgeEffect ? { finding: state.judge } : {}) } : null };
        roleRows.push(row);
        await immutable(join(bundleDir, `roles/${effect.id}.json`), clean(row, redactor, "Role receipt"));
    }
    let previous = "0".repeat(64);
    const projected: any[] = [];
    for (const original of events) {
        const row = { schema_version: "wringer.contained-delivery-event.v2", sequence: original.sequence, previous, at: original.at, type: original.type, source_event_sha256: original.sha256, state: portableState(original.state) };
        const projectedEvent = { ...row, sha256: hashValue(row) };
        previous = projectedEvent.sha256;
        projected.push(projectedEvent);
        await immutable(join(bundleDir, `journal/${String(row.sequence).padStart(6, "0")}.json`), clean(projectedEvent, redactor, "Portable journal"));
    }
    const human: any[] = [];
    for (const judgement of state.humanJudgements) {
        const names = await readdir(join(stateDir, "displays"));
        let found: any;
        for (const name of names) {
            if (!/^[a-f0-9-]{36}\.json$/.test(name))
                continue;
            const receipt = await read(stateDir, `displays/${name}`, 64 * 1024 * 1024);
            const { sha256, ...body } = receipt;
            if (sha256 === judgement.display.receiptSha256) {
                if (sha256 !== hashValue(body) || !receipt.success || receipt.candidateTree !== state.candidate.tree || receipt.acceptanceSha256 !== plan.acceptance_sha256 || receipt.criterionId !== judgement.criterionId || receipt.measured?.sourceChanged || receipt.measured?.sourceTree !== state.candidate.tree || !displayRowsValid(receipt.measured, plan, judgement.criterionId))
                    throw new Error("Human judgement display receipt does not establish the reviewed candidate");
                found = { ...body, measured: { ...body.measured, provenance: provenance(body.measured.provenance) } };
                break;
            }
        }
        if (!found || hashValue(found) !== judgement.display.receiptSha256)
            throw new Error("Human judgement has no fully portable, hash-resolving successful display receipt");
        assertContainedDisplayVisuals(found, plan, designSnapshot);
        if (found.visuals) for (const [kind, images] of [["reference", found.visuals.referenceAssets], ["capture", found.visuals.captures]] as const) for (const image of images) await immutableImage(bundleDir, visualImagePath(judgement.criterionId, kind, image.id), image.base64);
        observations.set(found.measured.provenance.runtimeId, found.measured);
        const projection = { schema_version: "wringer.contained-human-receipt.v1", judgement, source_display_sha256: judgement.display.receiptSha256, display: found };
        human.push(projection);
        await immutable(join(bundleDir, `human/${safeId(judgement.criterionId, "human criterion")}.json`), clean(projection, redactor, "Human display"));
    }
    const manifest = { schema_version: "wringer.contained-delivery.v2", id, journeyId: state.id, createdAt: events.at(-1)!.at, source: { url: plan.repository.url, baseCommit: plan.repository.commit, codeCommit: state.candidate.source.commit, tree: state.candidate.tree }, planSha256: plan.plan_sha256, acceptanceSha256: plan.acceptance_sha256, authoritySha256: hashValue(authority), environmentSha256: environment.map_sha256, journal: { eventCount: projected.length, headSha256: previous, sourceHeadSha256: events.at(-1)!.sha256 }, baseline: verification(state.baseline), verification: verification(state.verification), roles: roleRows.map(r => r.id), humanCriteria: human.map(r => r.judgement.criterionId), judge: state.judge, counts: { checks: plan.acceptance.checks.length, proved: plan.acceptance.checks.length, human: human.length }, publication: { sourceBranch: options.publication.sourceBranch, targetBranch: options.publication.targetBranch }, evidencePath: bundlePath, auditCommand: `wringer-drive audit --bundle ${bundlePath}`, falsify, limits: limitations, contracts: containedViewContracts };
    await verifySource(store, manifest, plan, environment, observations);
    // Inspect exact candidate history, never unrelated or later evidence refs.
    // Inflation is streamed under independent finite inspection bounds;
    // ordinary runtime-command capture keeps its existing 64 MiB ceiling.
    const sourceInspection = await inspectCandidateHistory(store, state.candidate.source.commit, redactor, { signal: options.signal, collectFindings: true });
    const sourceReceipt = await sourceReviewReceipt(stateDir, sourceInspection.inventory!);
    const v3 = !!plan.design || !!sourceReceipt || human.some(row => row.judgement.schema_version === "wringer.contained-human-decision.v1");
    const currentManifest = { ...manifest, ...(v3 ? { schema_version: "wringer.contained-delivery.v3", contracts: containedViewContractsV3, sourceReview: sourceReceipt ? { receipt: "source-inspection.json", sha256: hashValue(sourceReceipt), findings: sourceReceipt.approvals.length } : null } : {}), limits: sourceReceipt ? [...limitations, sourceReviewMarker(sourceReceipt), ...SOURCE_REVIEW_LIMITATIONS] : limitations };
    const view = deriveContainedDeliveryProjection(plan, currentManifest, human, roleRows), versionedManifest = { ...currentManifest, viewSha256: containedProjectionDigest(view) };
    if (sourceReceipt) await immutable(join(bundleDir, "source-inspection.json"), clean(sourceReceipt, redactor, "Source review receipt"));
    for (const [name, value] of Object.entries({ "plan.json": plan, "authority.json": authority, "environment.json": environment, "manifest.json": versionedManifest, "view.json": view, "certificate.json": renderContainedCertificate(view), "projection.json": { schema_version: "wringer.contained-projection.v2", omitted: ["ACP request prompt bodies", "ACP thought/progress traces and provider stderr", "Worker/planner narrative and patch duplication", "Controller absolute transport paths", "Journal free-form details and feedback duplicates"], sourceJournalHeadSha256: events.at(-1)!.sha256, portableJournalHeadSha256: previous, viewSha256: versionedManifest.viewSha256, limits: limitations } }))
        await immutable(join(bundleDir, name), clean(value, redactor, name));
    for (const [name, body] of Object.entries({ ...(v3 ? renderContainedDocumentsV3(view, manifest.falsify.reason) : renderContainedDocuments(view, manifest.falsify.reason)), "board.html": v3 ? renderContainedBoardV2(view) : renderContainedBoard(view) }))
        await immutable(join(bundleDir, name), body);
    same((await files(bundleDir)).filter(name => name !== "digests.json"), expectedInventory(currentManifest, [...verifications.keys()], plan).filter(name => name !== "digests.json"), "Portable evidence inventory");
    await seal(bundleDir);
    const audit = await auditContained(bundleDir);
    if (audit.status !== "passed")
        throw new Error(`Prepared contained delivery failed its independent audit: ${JSON.stringify(audit.claims)}`);
    await git(store, ["read-tree", manifest.source.codeCommit]);
    if ((await git(store, ["cat-file", "-e", `${manifest.source.codeCommit}:${bundlePath}`], { allowFailure: true })).code === 0)
        throw new Error("Delivery evidence would overwrite source-owned content");
    let index = "";
    for (const name of await files(bundleDir)) {
        const path = `${bundlePath}/${name}`, blob = (await git(store, ["hash-object", "-w", "--stdin"], { input: await readFile(await inside(bundleDir, name)) })).stdout.trim();
        index += `100644 ${blob}\t${path}\0`;
    }
    await git(store, ["update-index", "-z", "--index-info"], { input: index });
    const evidenceTree = (await git(store, ["write-tree"])).stdout.trim(), evidenceCommit = (await git(store, ["commit-tree", evidenceTree, "-p", manifest.source.codeCommit, "-m", `Wringer contained evidence ${id}`])).stdout.trim();
    await git(store, ["update-ref", `refs/heads/${options.publication.sourceBranch}`, evidenceCommit]);
    const output: ContainedDeliveryResult = { schema_version: "wringer.contained-publication.v1", status: "prepared", deliveryId: id, bundleDir, codeCommit: manifest.source.codeCommit, evidenceCommit, sourceBranch: options.publication.sourceBranch, targetBranch: options.publication.targetBranch, auditCommand: manifest.auditCommand, pushed: false, falsify };
    await immutable(join(directory, "prepared.json"), { ...output, transportSha256: hashValue(options.publication) });
    const forgeOptions = options.publication.forge ? { forge: options.publication.forge, deliveryId: id, bodyPath: relative(stateDir, join(bundleDir, "mr.md")), stateDirectory: relative(stateDir, join(directory, "forge")), sourceBranch: options.publication.sourceBranch, targetBranch: options.publication.targetBranch, title: plan.name, expectedHeadCommit: evidenceCommit, publicationRemote: options.publication.remote, signal: options.signal, resumeCommand: options.resumeCommand } : null;
    if (forgeOptions)
        output.forge = await publishMergeRequest(stateDir, { ...forgeOptions, send: false });
    if (options.send) {
        options.signal?.throwIfAborted();
        const heads = (await git(store, ["ls-remote", "--symref", options.publication.remote, "HEAD", `refs/heads/${options.publication.sourceBranch}`, `refs/heads/${options.publication.targetBranch}`], { signal: options.signal })).stdout;
        const defaultBranch = /^ref: refs\/heads\/([^\t\r\n]+)\tHEAD$/m.exec(heads)?.[1];
        if (!defaultBranch)
            throw new Error("Remote default branch could not be established; no push was sent");
        if (defaultBranch === options.publication.sourceBranch)
            throw new Error("Publication branch is the remote default branch; no push was sent");
        const current = heads.split("\n").find(line => line.endsWith(`\trefs/heads/${options.publication.sourceBranch}`))?.split("\t")[0];
        if (current && current !== evidenceCommit)
            throw new Error("Review branch already exists with different content; no overwrite or force push was attempted");
        if (!heads.split("\n").some(line => line.endsWith(`\trefs/heads/${options.publication.targetBranch}`)))
            throw new Error("Publication target branch does not exist on the remote");
        if (!current)
            await git(store, ["push", "--porcelain", options.publication.remote, `${evidenceCommit}:refs/heads/${options.publication.sourceBranch}`], { signal: options.signal });
        const confirmed = (await git(store, ["ls-remote", options.publication.remote, `refs/heads/${options.publication.sourceBranch}`], { signal: options.signal })).stdout.trim().split(/\s+/)[0];
        if (confirmed !== evidenceCommit)
            throw new Error("Publication outcome is uncertain; the remote branch did not confirm the exact evidence commit");
        output.status = "delivered";
        output.pushed = true;
    }
    if (forgeOptions && options.send)
        output.forge = await publishMergeRequest(stateDir, { ...forgeOptions, send: true });
    await immutable(join(directory, "outcomes", `${hashValue(output)}.json`), output);
    return output;
    } finally {
        // Only this call's generated scratch; never a previous attempt, bundle,
        // journal, source repository or evidence record. Process operations have
        // settled/terminated before control reaches this cleanup.
        await rm(scratch, { recursive: true, force: true });
    }
}
/** Independent offline reader: all claimed source objects, receipts and projected events must travel. */
export async function auditContained(bundleDir: string): Promise<ContainedAudit> { return (await inspectContainedDelivery(bundleDir)).report; }
/** Facts returned only after one complete audit of the same captured records. */
export async function readContainedDeliveryProjection(bundleDir: string): Promise<ContainedDeliveryProjection> {
    const { report, view } = await inspectContainedDelivery(bundleDir);
    if (report.status !== "passed" || !view) throw new Error(`Contained delivery projection is not auditable: ${report.claims.map(c => c.reason).join("; ")}`);
    return view;
}
async function inspectContainedDelivery(bundleDir: string): Promise<{ report: ContainedAudit; view: ContainedDeliveryProjection | null }> {
    const report: ContainedAudit = { schema_version: "wringer.contained-audit.v1", status: "failed", deliveryId: null, codeCommit: null, checks: 0, human: 0, claims: [], limits: limitations };
    let view: ContainedDeliveryProjection | null = null;
    try {
        await checkSeal(bundleDir);
        const manifest = await read(bundleDir, "manifest.json"), plan = validateExecutionPlan(await read(bundleDir, "plan.json")), authority = await read(bundleDir, "authority.json"), environment = await read(bundleDir, "environment.json");
        const v3 = manifest.schema_version === "wringer.contained-delivery.v3", v2 = v3 || manifest.schema_version === "wringer.contained-delivery.v2", contractReader = await openReader(schemaDirectory());
        if (v2) {
            const checked = await contractReader.validate(manifest, v3 ? "contained-delivery-v3.schema.json" : "contained-delivery-v2.schema.json");
            if (!checked.ok) throw new Error(`Frozen delivery manifest: ${checked.said}`);
            for (const [value, schema] of [[plan, plan.schema_version === "wringer.execution-plan.v2" ? "execution-plan-v2.schema.json" : "execution-plan-v1.schema.json"], [authority, "execution-authority-v1.schema.json"], [environment, "environment-map-v1.schema.json"]] as const) {
                const result = await contractReader.validate(value, schema);
                if (!result.ok) throw new Error(`Frozen ${schema}: ${result.said}`);
            }
        }
        if (!v2 && manifest.schema_version !== "wringer.contained-delivery.v1" || manifest.planSha256 !== plan.plan_sha256 || manifest.acceptanceSha256 !== plan.acceptance_sha256 || manifest.authoritySha256 !== hashValue(authority) || manifest.environmentSha256 !== environment.map_sha256 || manifest.source.baseCommit !== plan.repository.commit || manifest.source.url !== plan.repository.url)
            throw new Error("Delivery authority/source identities disagree");
        const { map_sha256, ...environmentData } = environment;
        if (map_sha256 !== hashValue(environmentData) || environment.inventory_sha256 !== hashValue(environment.files) || environment.plan_sha256 !== plan.plan_sha256)
            throw new Error("Environment map integrity failed");
        report.deliveryId = manifest.id;
        report.codeCommit = manifest.source.codeCommit;
        const names = await readdir(await inside(bundleDir, "journal"));
        if (names.length !== manifest.journal.eventCount)
            throw new Error("Portable journal inventory changed");
        let previous = "0".repeat(64), last: any, redSequence = 0, firstWorker = Infinity, previousTime = -Infinity;
        const knownEffects = new Map<string, any>(), receiptRefs = new Map<string, any>(), knownVerifications = new Map<string, any>(), knownSources = new Set([plan.repository.commit]);
        for (const [index, name] of names.sort().entries()) {
            if (name !== `${String(index + 1).padStart(6, "0")}.json`)
                throw new Error("Portable journal sequence changed");
            const event = await read(bundleDir, `journal/${name}`), { sha256, ...body } = event;
            if (v2) {
                const checked = await contractReader.validate(event, "contained-delivery-event-v2.schema.json");
                if (!checked.ok) throw new Error(`Frozen portable event: ${checked.said}`);
            }
            const eventTime = typeof event.at === "string" ? Date.parse(event.at) : NaN;
            if (!Number.isFinite(eventTime) || eventTime < previousTime || new Date(eventTime).toISOString() !== event.at)
                throw new Error("Portable journal has an invalid or non-monotonic timestamp");
            previousTime = eventTime;
            if (event.schema_version !== (v2 ? "wringer.contained-delivery-event.v2" : "wringer.contained-delivery-event.v1") || event.sequence !== index + 1 || event.previous !== previous || sha256 !== hashValue(body) || !digestPattern.test(event.source_event_sha256))
                throw new Error("Portable journal hash chain failed");
            previous = sha256;
            last = event;
            if (index === 0)
                validateExecutionAuthority(authority, plan, new Date(event.at));
            if (event.state.planSha256 !== plan.plan_sha256 || event.state.authoritySha256 !== hashValue(authority) || event.state.environmentSha256 !== environment.map_sha256 || event.state.id !== manifest.journeyId)
                throw new Error("Journal authority identity changed");
            if (event.state.candidate) knownSources.add(event.state.candidate.source.commit);
            if (!Array.isArray(event.state.effects) || new Set(event.state.effects.map((e: any) => e.id)).size !== event.state.effects.length || event.state.effects.length < knownEffects.size)
                throw new Error("Journal lost or duplicated charged effects");
            for (const effect of event.state.effects) {
                const prior = knownEffects.get(effect.id);
                safeId(effect.id, "effect");
                if (!["worker", "judge", "planner"].includes(effect.role) || !["reserved", "completed", "uncertain"].includes(effect.status) || !digestPattern.test(effect.requestSha256) || !digestPattern.test(effect.requestIdentity))
                    throw new Error("Malformed journal effect");
                if (effect.disposition !== undefined && !["accepted", "stopped", "invalid", "unsettled"].includes(effect.disposition)) throw new Error("Malformed role task disposition");
                if (!prior) {
                    validateExecutionAuthority(authority, plan, new Date(event.at));
                    if (event.type !== "agent-reserved" || !authority.actions.includes(effect.role === "worker" ? "build" : effect.role === "judge" ? "judge" : "plan"))
                        throw new Error("Role has no authorized pre-spend reservation");
                }
                else if (prior.role !== effect.role || prior.requestSha256 !== effect.requestSha256 || prior.requestIdentity !== effect.requestIdentity || prior.status === "completed" && (effect.status !== "completed" || prior.resultSha256 !== effect.resultSha256))
                    throw new Error("Reserved effect identity or completed result changed");
                knownEffects.set(effect.id, effect);
            }
            for (const id of knownEffects.keys())
                if (!event.state.effects.some((e: any) => e.id === id))
                    throw new Error("Journal removed a charged effect");
            for (const role of ["worker", "judge", "planner"] as const)
                if (event.state.effects.filter((e: any) => e.role === role).length > authority.budget[role === "worker" ? "max_worker_turns" : role === "judge" ? "max_judge_turns" : "max_planner_turns"])
                    throw new Error("Journal exceeded the role budget");
            const attempts = event.state.verificationAttempts ?? [];
            if (!Array.isArray(attempts) || attempts.length > authority.budget.max_sessions || attempts.length < knownVerifications.size || new Set(attempts.map((a: any) => a.id)).size !== attempts.length)
                throw new Error("Portable journal lost or exceeded its verifier reservation ceiling");
            for (const attempt of attempts) {
                safeId(attempt.id, "verifier attempt");
                if (!["baseline", "candidate"].includes(attempt.phase) || !["reserved", "completed", "uncertain"].includes(attempt.status) || !knownSources.has(attempt.sourceCommit) || attempt.requestSha256 !== hashValue({ plan: plan.plan_sha256, source: { url: plan.repository.url, commit: attempt.sourceCommit }, phase: attempt.phase }))
                    throw new Error("Portable verifier reservation lost its exact source/request binding");
                const prior = knownVerifications.get(attempt.id);
                if (!prior) {
                    validateExecutionAuthority(authority, plan, new Date(event.at));
                    if (event.type !== "verification-reserved" || attempt.status !== "reserved" || !authority.actions.includes("verify")) throw new Error("Verifier lacks its authorized pre-execution reservation");
                } else if (prior.requestSha256 !== attempt.requestSha256 || prior.sourceCommit !== attempt.sourceCommit || prior.phase !== attempt.phase || prior.status === "completed" && canonicalJson(prior) !== canonicalJson(attempt)) {
                    throw new Error("Portable verifier reservation or completed result changed");
                }
                if (attempt.status === "completed" ? !attempt.result || attempt.disposition !== attempt.result.status || attempt.result.candidateCommit !== attempt.sourceCommit : attempt.result !== undefined || attempt.disposition !== undefined)
                    throw new Error("Verifier disposition contradicts its durable observation");
                knownVerifications.set(attempt.id, attempt);
            }
            for (const id of knownVerifications.keys()) if (!attempts.some((a: any) => a.id === id)) throw new Error("Portable journal discarded a charged verifier attempt");
            for (const v of [event.state.baseline, event.state.verification, ...(event.state.verificationAttempts ?? []).map((a: any) => a.result)])
                if (v) {
                    const prior = receiptRefs.get(v.runtimeId);
                    if (prior)
                        same(prior, v, "Historical verification identity");
                    else
                        receiptRefs.set(v.runtimeId, v);
                }
            if (event.type === "acceptance-red")
                redSequence = event.sequence;
            if (event.state.effects.some((e: any) => e.role === "worker"))
                firstWorker = Math.min(firstWorker, event.sequence);
        }
        if (previous !== manifest.journal.headSha256 || last.source_event_sha256 !== manifest.journal.sourceHeadSha256 || last.state.stage !== "ready" || last.type !== "review-ready" || !redSequence || redSequence >= firstWorker)
            throw new Error("Delivery lacks a terminal red-before-worker journal");
        same(last.state.candidate.source, { url: manifest.source.url, commit: manifest.source.codeCommit }, "Terminal candidate");
        if (last.state.candidate.tree !== manifest.source.tree)
            throw new Error("Terminal candidate tree changed");
        same(last.state.baseline, manifest.baseline, "Baseline");
        same(last.state.verification, manifest.verification, "Candidate verification");
        if (knownVerifications.size) for (const [phase, value] of [["baseline", manifest.baseline], ["candidate", manifest.verification]])
            if (![...knownVerifications.values()].some(a => a.phase === phase && a.result && canonicalJson(a.result) === canonicalJson(value))) throw new Error("Terminal verification is not a completed reserved attempt");
        same(last.state.judge, manifest.judge, "Judge");
        const observations = new Map<string, any>(), runtimeIds = new Set<string>(), sessionIds = new Set<string>();
        for (const name of await readdir(await inside(bundleDir, "receipts"))) {
            safeId(name, "receipt directory");
            const v = await read(bundleDir, `receipts/${name}/verification.json`), observed = await read(bundleDir, `receipts/${name}/observations.json`);
            validateObservations(v, observed, plan);
            same(receiptRefs.get(v.runtimeId), v, "Carried historical verification");
            observations.set(v.runtimeId, observed);
            if (runtimeIds.has(v.runtimeId))
                throw new Error("Independent verifications reused a runtime");
            runtimeIds.add(v.runtimeId);
        }
        if (observations.size !== receiptRefs.size)
            throw new Error("A historical verification receipt is missing");
        same(await files(bundleDir), expectedInventory(manifest, [...receiptRefs.keys()], plan), "Portable evidence inventory");
        for (const v of [manifest.baseline, manifest.verification]) {
            const carried = await read(bundleDir, `${v.evidenceRef}/verification.json`);
            same(carried, v, "Required verification");
        }
        if (manifest.baseline.candidateCommit !== plan.repository.commit || manifest.verification.candidateCommit !== manifest.source.codeCommit || manifest.verification.candidateTree !== manifest.source.tree || manifest.verification.status !== "passed")
            throw new Error("Delivery did not verify the recorded candidate");
        for (const check of manifest.baseline.checks) {
            const green = manifest.verification.checks.find((r: any) => r.id === check.id);
            if (check.status !== "failed" || !Number.isInteger(check.exitCode) || check.exitCode === 0 || [124, 126, 127, 137, 143].includes(check.exitCode) || green?.status !== "passed" || green.checkInputsSha256 !== check.checkInputsSha256)
                throw new Error("A red-first claim lacks a genuine failure of the exact original check");
        }
        const roles: any[] = [];
        if (!Array.isArray(manifest.roles) || new Set(manifest.roles).size !== manifest.roles.length)
            throw new Error("Role inventory is duplicated");
        for (const id of manifest.roles) {
            const role = await read(bundleDir, `roles/${safeId(id, "role effect")}.json`);
            roles.push(role);
            const effect = last.state.effects.find((e: any) => e.id === id);
            if (!effect || effect.role !== role.role || effect.status !== role.status || (effect.disposition ?? null) !== (role.disposition ?? null) || effect.requestSha256 !== role.sourceRequestSha256 || (effect.resultSha256 ?? null) !== role.sourceResultSha256)
                throw new Error("Role receipt differs from the terminal journal");
            same(role.request.agent, plan.agents[role.role as "worker" | "judge" | "planner"], "Approved role agent");
            same(role.request.runtime, plan.runtime, "Approved role runtime");
            same(role.request.design ?? null, plan.design ? { snapshotPath: plan.design.snapshotPath, snapshotSha256: plan.design.snapshotSha256, referenceIds: [...new Set(plan.design.reviews.flatMap(row => row.referenceIds))].sort() } : null, "Approved role design snapshot");
            if (v2 && role.role === "worker") {
                if (!object(role.request.scope)) throw new Error("Approved worker write scope is missing from the portable role receipt");
                same(role.request.scope, { writable: plan.scope.writable, protected: plan.acceptance.protected_paths, writableDirectories: plan.environment.writable_directories }, "Approved worker write scope");
            }
            if (v2 && role.role !== "worker" && role.request.scope !== undefined)
                throw new Error("Read-only role cannot carry worker write authority");
            if (role.request.role !== role.role || role.request.repo.url !== plan.repository.url || role.request.budget.maxTurns !== 1 || !Number.isSafeInteger(role.request.budget.timeoutMs) || role.request.budget.timeoutMs < 1 || role.request.budget.timeoutMs > authority.budget.session_timeout_seconds * 1000)
                throw new Error("Role request exceeds approved source/budget policy");
            if (role.result) {
                const p = provenance(role.result.provenance);
                if (v2) {
                    const result = await contractReader.validate(p, "runtime-v1.schema.json");
                    if (!result.ok) throw new Error(`Frozen role runtime: ${result.said}`);
                }
                if (runtimeIds.has(p.runtimeId) || p.image !== plan.runtime.image || p.kind !== plan.runtime.kind || p.role !== role.role || p.repository.commit !== role.request.repo.commit)
                    throw new Error("Worker/judge/verifier isolation identities overlap or changed");
                runtimeIds.add(p.runtimeId);
                if (p.repositoryAccess !== (role.role === "worker" ? "read-write" : "read-only") || role.result.status === "completed" && (!role.result.authentication?.sessionOpened || role.result.protocolVersion !== 1 || !role.result.sessionId))
                    throw new Error("Completed role lacks its declared access/protocol session");
                if (role.result.sessionId) {
                    if (sessionIds.has(role.result.sessionId))
                        throw new Error("ACP roles reused a session");
                    sessionIds.add(role.result.sessionId);
                }
            }
        }
        if (roles.length !== last.state.effects.length || roles.length > authority.budget.max_sessions)
            throw new Error("Role budget/effect inventory differs from the journal");
        const worker = roles.find(r => r.id === last.state.workerEffect), judge = roles.find(r => r.id === last.state.judgeEffect);
        if (!worker || worker.role !== "worker" || worker.result?.status !== "completed" || !worker.result.authentication.sessionOpened || worker.result.provenance.repositoryAccess !== "read-write")
            throw new Error("Final worker has no completed isolated session");
        if (plan.acceptance.checks.length) {
            if (!judge || judge.role !== "judge" || judge.result?.status !== "completed" || judge.request.repo.commit !== manifest.source.codeCommit || judge.result.provenance.repositoryAccess !== "read-only" || judge.result.sessionId !== manifest.judge?.sessionId || judge.result.provenance.runtimeId !== manifest.judge?.runtimeId)
                throw new Error("Independent judge did not inspect this immutable candidate");
            same(judge.result.finding, manifest.judge, "Judge findings");
            for (const criterion of plan.acceptance.criteria.filter(c => c.kind === "check" && c.required))
                if (manifest.judge.criteria.find((r: any) => r.id === criterion.id)?.met !== true)
                    throw new Error("Judge did not establish a required criterion");
        }
        const humanRows: any[] = [];
        for (const criterion of plan.acceptance.criteria.filter(c => c.kind === "human" && (c.required || v2 && manifest.humanCriteria.includes(c.id)))) {
            const row = await read(bundleDir, `human/${safeId(criterion.id, "criterion")}.json`, 64 * 1024 * 1024), j = row.judgement, d = row.display;
            if (j.schema_version === "wringer.contained-human-decision.v1" && j.displayId !== d.id) throw new Error("Explicit human decision names a different display identity");
            if (j.criterionId !== criterion.id || !["met", "not_met"].includes(j.verdict) || criterion.required && j.verdict !== "met" || !validContainedHumanAttribution(j, authority) || j.candidateTree !== manifest.source.tree || j.acceptanceSha256 !== plan.acceptance_sha256 || !d.success || d.candidateTree !== manifest.source.tree || d.criterionId !== criterion.id || d.acceptanceSha256 !== plan.acceptance_sha256 || d.measured?.sourceChanged || d.measured?.sourceTree !== manifest.source.tree || !displayRowsValid(d.measured, plan, criterion.id) || row.source_display_sha256 !== j.display?.receiptSha256 || hashValue(d) !== row.source_display_sha256)
                throw new Error("Human verdict is not bound to the shown candidate");
            assertContainedDisplayVisuals(d, plan);
            if (d.visuals) for (const [kind, images] of [["reference", d.visuals.referenceAssets], ["capture", d.visuals.captures]] as const) for (const image of images) {
                const bytes = await readFile(await inside(bundleDir, visualImagePath(criterion.id, kind, image.id)));
                if (bytes.length !== image.bytes || hashBytes(bytes) !== image.sha256 || bytes.toString("base64") !== image.base64) throw new Error("Carried visual image differs from the human-reviewed PNG bytes");
            }
            same(last.state.humanJudgements.find((r: any) => r.criterionId === criterion.id), j, "Human judgement");
            const p = provenance(d.measured.provenance);
            if (p.role !== "verifier" || p.repository.commit !== manifest.source.codeCommit || p.image !== plan.runtime.image || runtimeIds.has(p.runtimeId))
                throw new Error("Human display did not use a fresh candidate runtime");
            runtimeIds.add(p.runtimeId);
            humanRows.push(row);
            observations.set(p.runtimeId, d.measured);
            report.human++;
        }
        const scratch = await mkdtemp(join(tmpdir(), "wringer-contained-audit-")), store = join(scratch, "objects.git");
        let reviewedSource: SourceReviewReceipt | null = null;
        try {
            await cloneBundle(await inside(bundleDir, "candidate.bundle"), store, manifest.source.codeCommit);
            await verifySource(store, manifest, plan, environment, observations);
            const designSnapshot = await readPinnedDesignSnapshot(plan, store);
            if (designSnapshot) {
                same(await read(bundleDir, "visuals/snapshot.json", 32 * 1024 * 1024), designSnapshot, "Carried design snapshot");
                for (const row of humanRows) assertContainedDisplayVisuals(row.display, plan, designSnapshot);
            }
            if (v3) {
                const declared = sourceReviewDigest(manifest.limits);
                // Derive disclosure requirements from the carried bytes, not
                // from a sender's optional claim that no exceptions exist.
                const measured = await inspectCandidateHistory(store, manifest.source.codeCommit, new Redactor([], {}), { collectFindings: true });
                if (manifest.sourceReview) {
                    reviewedSource = await read(bundleDir, "source-inspection.json");
                    validateSourceReviewReceipt(reviewedSource, measured.inventory!);
                    if (manifest.sourceReview.receipt !== "source-inspection.json" || manifest.sourceReview.sha256 !== hashValue(reviewedSource) || declared !== manifest.sourceReview.sha256 || manifest.sourceReview.findings !== reviewedSource.approvals.length || !manifest.limits.includes(sourceReviewMarker(reviewedSource))) throw new Error("Source review receipt lost its manifest commitment");
                    report.limits = [...report.limits, ...SOURCE_REVIEW_LIMITATIONS];
                } else if (declared || measured.inventory!.findings.length) throw new Error("Carried source findings or a source review declaration have no committed exception receipt");
            }
        } finally { await rm(scratch, { recursive: true, force: true }); }
        if (manifest.counts.checks !== plan.acceptance.checks.length || manifest.counts.proved !== manifest.baseline.checks.length || manifest.counts.human !== report.human)
            throw new Error("Delivery counts disagree with carried receipts");
        same(manifest.humanCriteria, humanRows.map(row => row.judgement.criterionId), "Human inventory");
        if (manifest.evidencePath !== `.wringer/deliveries/${safeId(manifest.id, "delivery")}` || manifest.auditCommand !== `wringer-drive audit --bundle ${manifest.evidencePath}`)
            throw new Error("Printed audit route differs from the delivered bundle");
        same(manifest.falsify, (v2 ? falsificationRoute : legacyFalsificationRouteV1)(manifest.evidencePath), "Printed falsification route");
        view = deriveContainedDeliveryProjection(plan, manifest, humanRows, roles);
        if (v2) {
            same(manifest.contracts, v3 ? containedViewContractsV3 : containedViewContracts, "Delivery view contract versions");
            if (manifest.viewSha256 !== containedProjectionDigest(view)) throw new Error("Delivery view digest differs from its evidence");
            same(await read(bundleDir, "view.json"), view, "Delivery view");
            same(await read(bundleDir, "certificate.json"), renderContainedCertificate(view), "Certificate");
            for (const [value, schema] of [[manifest, v3 ? "contained-delivery-v3.schema.json" : "contained-delivery-v2.schema.json"], [view, "contained-delivery-view-v1.schema.json"], [renderContainedCertificate(view), "contained-certificate-v1.schema.json"]] as const) {
                const checked = await contractReader.validate(value, schema);
                if (!checked.ok) throw new Error(`Frozen delivery contract: ${checked.said}`);
            }
            if (await readFile(await inside(bundleDir, "board.html"), "utf8") !== (v3 ? renderContainedBoardV2(view) : renderContainedBoard(view))) throw new Error("Delivered board differs from its audited view");
        }
        for (const [name, body] of Object.entries(v3 ? renderContainedDocumentsV3(view, manifest.falsify.reason) : v2 ? renderContainedDocuments(view, manifest.falsify.reason) : legacyContainedDocumentsV1(plan, manifest, humanRows)))
            if (await readFile(await inside(bundleDir, name), "utf8") !== body)
                throw new Error("Summary/MR wording disagrees with the source, counts or human notes");
        const projection = await read(bundleDir, "projection.json");
        if (projection.schema_version !== (v2 ? "wringer.contained-projection.v2" : "wringer.contained-projection.v1") || v2 && projection.viewSha256 !== manifest.viewSha256)
            throw new Error("Portable projection version or view binding changed");
        if (v2) {
            const checked = await contractReader.validate(projection, "contained-projection-v2.schema.json");
            if (!checked.ok) throw new Error(`Frozen portable projection: ${checked.said}`);
        }
        if (projection.sourceJournalHeadSha256 !== manifest.journal.sourceHeadSha256 || projection.portableJournalHeadSha256 !== manifest.journal.headSha256)
            throw new Error("Portable projection provenance differs from its journal");
        report.checks = plan.acceptance.checks.length;
        report.claims = [{ id: "portable-journal-and-authority", status: "checked", reason: "Complete carried projection chain and historical authority validated." }, { id: "candidate-source", status: "checked", reason: "Complete Git bundle resolves the exact candidate, baseline, protected inputs and permitted changes." }, { id: "red-first-and-green", status: "checked", reason: "Every original check genuinely failed before worker reservation and passed independently on the candidate." }, { id: "independent-judge-and-human", status: "checked", reason: "Distinct role/session/runtime identities and candidate-bound judgements resolve." }];
        if (plan.design) report.claims.push({ id: "source-bound-visual-review", status: "checked", reason: "Pinned design snapshot, exact reference/captured PNG bytes and their human display-decision digests resolve. This verifies evidence integrity, not screenshot truth, visual quality or authenticated human identity." });
        if (reviewedSource) report.claims.push({ id: "source-credential-shape-review", status: "checked", reason: `Recomputed the complete candidate-history shape inventory: ${reviewedSource.approvals.length} exact object/rule/match-byte digests have carried operator decisions. This does not authenticate the actor, recheck private controller secrets or prove these examples harmless.` });
        report.status = "passed";
    }
    catch (error) {
        report.claims.push({ id: "delivery-integrity", status: "failed", reason: new Redactor().scrub(String(error)) });
    }
    return { report, view: report.status === "passed" ? view : null };
}
