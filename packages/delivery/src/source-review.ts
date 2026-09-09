import { mkdir, readFile, writeFile, lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { hashValue, canonicalJson } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { processDriver } from "@wringer/runtime";
import { inside } from "./io";
import { SOURCE_FINDING_RULES, type SourceFinding } from "./source-findings";

export interface SourceFindingInventory { schema_version: "wringer.source-findings.v1"; candidateCommit: string; findings: SourceFinding[]; sha256: string }
export interface SourceReviewDecision { findingId: string; inventorySha256: string; actor: string; actorKind: "operator" | "delegated-agent"; reason: string }
export interface SourceReviewDecisionBatch { schema_version: "wringer.source-review-decisions.v1"; candidateCommit: string; inventorySha256: string; decisions: SourceReviewDecision[] }
export interface SourceReviewApproval { schema_version: "wringer.source-review-approval.v1"; candidateCommit: string; inventorySha256: string; finding: SourceFinding; actor: string; actorKind: "operator" | "delegated-agent"; reason: string; at: string; sha256: string }
export interface SourceReviewReceipt { schema_version: "wringer.source-review-receipt.v1"; inventory: SourceFindingInventory; approvals: SourceReviewApproval[]; limitations: string[] }
export const SOURCE_REVIEW_LIMITATIONS = ["Exact credential-shaped matches were accepted as non-secret examples by the named operator or delegated agent. This is an exception record, NOT a secret-free certificate.", "Configured controller secret values and their fragments were non-overridable at delivery. Offline audit has no access to those private values and cannot repeat that check or prove that an unknown credential is harmless.", "Review identity and reasons are operator assertions in cooperative-local state, not authenticated human judgements. A same-account process can exercise that operator authority; no MCP approval tool is provided."];
const digest = /^[a-f0-9]{64}$/, commit = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const sealed = (value: any) => { const { sha256, ...body } = value ?? {}; return digest.test(sha256) && hashValue(body) === sha256; };
function checkFinding(value: any): asserts value is SourceFinding {
    if (!value || !same(Object.keys(value).sort(), ["id", "matchSha256", "objectId", "objectType", "rule"].sort()) || !commit.test(value.objectId) || !["blob", "commit", "tree", "tag"].includes(value.objectType) || !SOURCE_FINDING_RULES.includes(value.rule) || !digest.test(value.matchSha256) || value.id !== hashValue({ objectId: value.objectId, objectType: value.objectType, rule: value.rule, matchSha256: value.matchSha256 })) throw new Error("Source review finding identity is invalid; paths and wildcard exemptions are not accepted");
}
export function validateSourceInventory(value: any): asserts value is SourceFindingInventory {
    if (!value || !same(Object.keys(value).sort(), ["schema_version", "candidateCommit", "findings", "sha256"].sort()) || value.schema_version !== "wringer.source-findings.v1" || !commit.test(value.candidateCommit) || !Array.isArray(value.findings) || value.findings.length > 10000 || !sealed(value)) throw new Error("Source finding inventory was changed or is incomplete");
    value.findings.forEach(checkFinding);
    if (!same(value.findings.map((f: SourceFinding) => f.id), [...new Set<string>(value.findings.map((f: SourceFinding) => f.id))].sort())) throw new Error("Source finding inventory is not unique and ordered");
}
function checkApproval(value: any, inventory: SourceFindingInventory): asserts value is SourceReviewApproval {
    if (!value || !same(Object.keys(value).sort(), ["schema_version", "candidateCommit", "inventorySha256", "finding", "actor", "actorKind", "reason", "at", "sha256"].sort()) || value.schema_version !== "wringer.source-review-approval.v1" || !sealed(value) || value.candidateCommit !== inventory.candidateCommit || value.inventorySha256 !== inventory.sha256 || !["operator", "delegated-agent"].includes(value.actorKind) || typeof value.actor !== "string" || !value.actor.trim() || value.actor.length > 200 || typeof value.reason !== "string" || value.reason.trim().length < 12 || value.reason.length > 4000 || !Number.isFinite(Date.parse(value.at)) || new Date(value.at).toISOString() !== value.at) throw new Error("Source review approval is stale, changed or missing its exact candidate, actor, reason and time");
    checkFinding(value.finding);
    if (!inventory.findings.some(f => same(f, value.finding))) throw new Error("Source review approval does not match this exact inventoried object and credential-shaped byte digest");
}
export function validateSourceReviewReceipt(receipt: any, measured: SourceFindingInventory): asserts receipt is SourceReviewReceipt {
    validateSourceInventory(measured);
    if (!receipt || !same(Object.keys(receipt).sort(), ["schema_version", "inventory", "approvals", "limitations"].sort()) || receipt.schema_version !== "wringer.source-review-receipt.v1" || !same(receipt.inventory, measured) || !Array.isArray(receipt.approvals) || !same(receipt.limitations, SOURCE_REVIEW_LIMITATIONS)) throw new Error("Portable source review receipt differs from the complete candidate-history inventory");
    receipt.approvals.forEach((approval: any) => checkApproval(approval, measured));
    if (!same(receipt.approvals.map((a: SourceReviewApproval) => a.finding.id), measured.findings.map(f => f.id))) throw new Error("Every credential-shaped finding needs its own exact approval; unknown, duplicate and omitted matches refuse handover");
}
export const sourceReviewMarker = (receipt: SourceReviewReceipt) => `Source credential-shape exceptions: ${receipt.approvals.length} exact reviewed matches; source-inspection.json SHA256 ${hashValue(receipt)}. This is not a secret-free claim. Actor identity is asserted, not authenticated.`;
export function sourceReviewDigest(limits: unknown): string | null {
    if (!Array.isArray(limits)) return null;
    const rows = limits.filter(row => typeof row === "string" && row.startsWith("Source credential-shape exceptions:"));
    if (!rows.length) return null;
    if (rows.length !== 1) throw new Error("Source review declaration is duplicated");
    const match = /^Source credential-shape exceptions: [0-9]+ exact reviewed matches; source-inspection\.json SHA256 ([a-f0-9]{64})\. This is not a secret-free claim\. Actor identity is asserted, not authenticated\.$/.exec(rows[0]);
    if (!match) throw new Error("Source review declaration is malformed"); return match[1]!;
}
async function privateJson(path: string): Promise<any> {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024 || (info.mode & 0o077) || typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("Source review state must be a bounded private operator-owned regular file");
    try { return JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("Source review state is not valid JSON; private bytes were not printed"); }
}
async function immutable(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }); }
    catch (error: any) { if (error.code !== "EEXIST" || !same(await privateJson(path), value)) throw new Error("An immutable source review record already exists with different contents"); }
}
function descendant(parent: string, path: string) { const rest = relative(parent, path); return rest === "" || (!rest.startsWith("..") && !isAbsolute(rest)); }
/** No repository-carried policy is read. An explicit operator directory is
 * bound privately to this controller and cannot live in its source repository. */
async function policyDirectory(stateDir: string, candidate: string, options?: { directory: string; sourceUrl: string; sourcePaths: string[] }) {
    const binding = await inside(stateDir, `.wringer/source-review/${candidate}.json`);
    if (options) {
        if (!isAbsolute(options.directory)) throw new Error("Source review needs an absolute operator policy directory outside the target repository");
        if (descendant(await realpath(stateDir), resolve(options.directory))) throw new Error("Source review policy needs a separate operator directory outside controller state and the target repository");
        const localUrl = options.sourceUrl.startsWith("/") ? options.sourceUrl : options.sourceUrl.startsWith("file:") ? new URL(options.sourceUrl).pathname : null;
        for (const source of [...options.sourcePaths, ...(localUrl ? [localUrl] : [])]) if (descendant(resolve(source), resolve(options.directory))) throw new Error("Source review policy must remain outside the target repository and its captured source objects");
        await mkdir(options.directory, { recursive: true, mode: 0o700 });
        const path = await realpath(options.directory), info = await lstat(options.directory);
        if (descendant(await realpath(stateDir), path)) throw new Error("Source review policy needs a separate operator directory outside controller state and the target repository");
        if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("Source review policy directory must be private and operator-owned");
        for (const source of [...options.sourcePaths, ...(localUrl ? [localUrl] : [])]) {
            const canonical = await realpath(source).catch(() => resolve(source));
            if (descendant(canonical, path)) throw new Error("Source review policy must remain outside the target repository and its captured source objects");
        }
        const query = async (args: string[]) => processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-C", path, ...args], { env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
        const root = await query(["rev-parse", "--show-toplevel"]);
        if (!root.code) {
            const origin = await query(["config", "--get", "remote.origin.url"]);
            const ownsCandidate = await query(["cat-file", "-e", `${candidate}^{commit}`]);
            if (!ownsCandidate.code || (!origin.code && origin.stdout.trim().replace(/\.git$/, "") === options.sourceUrl.replace(/\.git$/, "")) || localUrl && descendant(root.stdout.trim(), resolve(localUrl))) throw new Error("Source-carried review policy is not allowed; choose a separate operator directory");
        }
        const body = { schema_version: "wringer.source-review-binding.v1", candidateCommit: candidate, directory: path };
        await immutable(binding, { ...body, sha256: hashValue(body) });
    }
    let saved: any; try { saved = await privateJson(binding); } catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
    if (!same(Object.keys(saved ?? {}).sort(), ["schema_version", "candidateCommit", "directory", "sha256"].sort()) || !sealed(saved) || saved.schema_version !== "wringer.source-review-binding.v1" || saved.candidateCommit !== candidate || typeof saved.directory !== "string" || !isAbsolute(saved.directory)) throw new Error("Operator source review binding was changed");
    const path = await realpath(saved.directory), info = await lstat(saved.directory);
    if (descendant(await realpath(stateDir), path)) throw new Error("Operator source review directory must remain outside controller state");
    if (path !== saved.directory || !info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) || typeof process.getuid === "function" && info.uid !== process.getuid()) throw new Error("Operator source review directory changed or is no longer private");
    return path;
}
export async function readSourceApprovals(stateDir: string, inventory: SourceFindingInventory) {
    validateSourceInventory(inventory);
    const directory = await policyDirectory(stateDir, inventory.candidateCommit), approvals: SourceReviewApproval[] = [];
    if (directory) for (const finding of inventory.findings) {
        const path = await inside(directory, `${inventory.candidateCommit}/${finding.id}.json`);
        let value: unknown; try { value = await privateJson(path); } catch (error: any) { if (error.code === "ENOENT") continue; throw error; }
        checkApproval(value, inventory); approvals.push(value);
    }
    return approvals;
}
type SourceReviewOptions = { directory: string; sourceUrl: string; sourcePaths: string[]; redactor: Redactor };
export async function readSourceDecisionBatch(path: string, stateDir: string, directory: string, inventory: SourceFindingInventory): Promise<SourceReviewDecision[]> {
    const file = await realpath(path), external = await realpath(directory);
    if (!descendant(external, file) || descendant(await realpath(stateDir), file)) throw new Error("Batch decisions must be a private file in the separate operator policy directory, outside controller state");
    const batch = await privateJson(path);
    if (!batch || !same(Object.keys(batch).sort(), ["schema_version", "candidateCommit", "inventorySha256", "decisions"].sort()) || batch.schema_version !== "wringer.source-review-decisions.v1" || batch.candidateCommit !== inventory.candidateCommit || batch.inventorySha256 !== inventory.sha256) throw new Error("Source decision batch is stale or malformed; no decisions were recorded");
    return batch.decisions;
}
export async function approveSourceFindings(stateDir: string, inventory: SourceFindingInventory, options: SourceReviewOptions & { decisions: SourceReviewDecision[] }) {
    validateSourceInventory(inventory);
    if (!Array.isArray(options.decisions) || options.decisions.length < 1 || options.decisions.length > 10000 || new Set(options.decisions.map(row => row?.findingId)).size !== options.decisions.length) throw new Error("Source decisions require a finite, nonempty list of unique exact finding IDs; no decisions were recorded");
    const existing = await readSourceApprovals(stateDir, inventory);
    // Validate the complete batch and existing-decision conflicts before writing
    // any binding/approval. I/O interruption may retain a valid immutable prefix;
    // retry reuses it, while incomplete coverage still cannot authorize delivery.
    const approvals = options.decisions.map(decision => {
        if (!decision || !same(Object.keys(decision).sort(), ["findingId", "inventorySha256", "actor", "actorKind", "reason"].sort())) throw new Error("Source decision has unknown fields; no decisions were recorded");
        const finding = inventory.findings.find(row => row.id === decision.findingId);
        if (!finding || decision.inventorySha256 !== inventory.sha256) throw new Error("Source review selection is stale or unknown; inspect this exact candidate inventory again");
        const prior = existing.find(row => row.finding.id === finding.id);
        if (prior && !same({ actor: prior.actor, actorKind: prior.actorKind, reason: prior.reason }, { actor: decision.actor, actorKind: decision.actorKind, reason: decision.reason })) throw new Error("This exact source finding already has an immutable decision; its actor/reason cannot be overwritten");
        const body = { schema_version: "wringer.source-review-approval.v1" as const, candidateCommit: inventory.candidateCommit, inventorySha256: inventory.sha256, finding, actor: decision.actor, actorKind: decision.actorKind, reason: decision.reason, at: prior?.at ?? new Date().toISOString() }, approval = { ...body, sha256: hashValue(body) };
        checkApproval(approval, inventory);
        const wire = JSON.stringify(approval);
        if (options.redactor.scrub(wire) !== wire || /-----BEGIN [^-]*PRIVATE KEY-----/.test(wire)) throw new Error("Review actor/reason must not contain matching source bytes or a credential; use a description, not the value");
        return approval;
    });
    const directory = (await policyDirectory(stateDir, inventory.candidateCommit, options))!;
    await immutable(await inside(directory, `${inventory.candidateCommit}/inventory-${inventory.sha256}.json`), inventory);
    for (const approval of approvals) await immutable(await inside(directory, `${inventory.candidateCommit}/${approval.finding.id}.json`), approval);
    return approvals;
}
export async function approveSourceFinding(stateDir: string, inventory: SourceFindingInventory, options: SourceReviewOptions & { decision: SourceReviewDecision }) {
    return (await approveSourceFindings(stateDir, inventory, { ...options, decisions: [options.decision] }))[0]!;
}
export async function sourceReviewReceipt(stateDir: string, inventory: SourceFindingInventory): Promise<SourceReviewReceipt | null> {
    if (!inventory.findings.length) return null;
    const approvals = await readSourceApprovals(stateDir, inventory);
    if (approvals.length !== inventory.findings.length) throw new Error(`Source history needs review: ${inventory.findings.length - approvals.length} of ${inventory.findings.length} credential-shaped findings lack exact operator decisions. No matching values were printed. Next: wringer-drive source-review --state '${stateDir.replaceAll("'", "'\\''")}'`);
    const receipt: SourceReviewReceipt = { schema_version: "wringer.source-review-receipt.v1", inventory, approvals, limitations: SOURCE_REVIEW_LIMITATIONS };
    validateSourceReviewReceipt(receipt, inventory); return receipt;
}
