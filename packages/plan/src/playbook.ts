import { resolve } from "node:path";
import { Redactor } from "@wringer/engine";
import { parseDesignJson } from "@wringer/design";
import { canonicalJson, freezeData, hashBytes, hashValue } from "./canonical";
import { record, repoPath, validateExecutionPlan, type PlanValidationOptions } from "./compile";
import type { EnvironmentMap, ExecutionPlan, RepositoryRef } from "./types";

export const MAX_PLAYBOOK_BYTES = 64 * 1024;
export interface PlaybookManifest {
    schema_version: "wringer.playbook.v1";
    id: string;
    revision: string;
    title: string;
    role: "worker";
    applicability: { taskFamily: string; context: string[]; tools: string[]; checks: string[]; scope: string[]; design: boolean };
    guidanceMarkdown: string;
    limits: string[];
    evaluationRefs: string[];
}
export interface PlaybookSnapshot {
    schema_version: "wringer.playbook-snapshot.v1";
    source: { repository: RepositoryRef; path: string; blob: string };
    content: string;
    manifest: PlaybookManifest;
    /** Exact source bytes, including whitespace. */
    sha256: string;
    snapshot_sha256: string;
}
const string = (value: unknown, label: string, max = 4096): string => {
    if (typeof value !== "string" || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || Buffer.byteLength(value) > max || Buffer.from(value).toString("utf8") !== value) throw new Error(`${label} must be bounded nonempty UTF-8 text`);
    return value;
};
const identifier = (value: unknown, label: string) => { const v = string(value, label, 64); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v)) throw new Error(`${label} must be an exact short identifier`); return v; };
const rows = (value: unknown, label: string, parse: (v: unknown) => string, min = 0) => {
    if (!Array.isArray(value) || value.length < min || value.length > 32) throw new Error(`${label} must contain ${min} to 32 explicit entries`);
    const result = value.map(parse); if (new Set(result).size !== result.length) throw new Error(`${label} has duplicate identities`); return result;
};
const path = (value: unknown) => { const v = repoPath(value); if (v === "." || Buffer.byteLength(v) > 512) throw new Error("Playbook applicability needs exact bounded paths, not the repository root"); return v; };
const digest = (value: unknown) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Playbook evaluation references must be exact SHA256 identities, never remote fetches"); return value; };

/** Pure inert-data validation. Guidance never grants tools, permission or execution. */
export function validatePlaybookManifest(value: unknown, options: PlanValidationOptions = {}): PlaybookManifest {
    const wire = canonicalJson(value);
    if (Buffer.byteLength(wire) > MAX_PLAYBOOK_BYTES) throw new Error("Playbook exceeds 64 KiB");
    const m = record(value, "playbook", ["schema_version", "id", "revision", "title", "role", "applicability", "guidanceMarkdown", "limits", "evaluationRefs"]);
    if (m.schema_version !== "wringer.playbook.v1" || m.role !== "worker") throw new Error("Only worker-only playbook v1 is supported");
    const a = record(m.applicability, "playbook applicability", ["taskFamily", "context", "tools", "checks", "scope", "design"]);
    if (typeof a.design !== "boolean") throw new Error("Playbook design requirement must be explicit");
    const manifest: PlaybookManifest = {
        schema_version: "wringer.playbook.v1", id: identifier(m.id, "playbook id"), revision: identifier(m.revision, "playbook revision"), title: string(m.title, "playbook title", 256), role: "worker",
        applicability: { taskFamily: identifier(a.taskFamily, "playbook task family"), context: rows(a.context, "playbook context", path).sort(), tools: rows(a.tools, "playbook tools", v => identifier(v, "tool name")).sort(), checks: rows(a.checks, "playbook checks", v => identifier(v, "check id")).sort(), scope: rows(a.scope, "playbook scope", path, 1).sort(), design: a.design },
        guidanceMarkdown: string(m.guidanceMarkdown, "playbook guidance", 48 * 1024), limits: rows(m.limits, "playbook limits", v => string(v, "playbook limit", 1024), 1), evaluationRefs: rows(m.evaluationRefs, "playbook evaluation references", digest).sort(),
    };
    if (new Redactor(undefined, options.credentialEnvironment ?? process.env).scrub(wire) !== wire) throw new Error("Playbook contains a detected credential; no altered instructions are accepted");
    return freezeData(manifest);
}
export function parsePlaybookManifest(input: string | Uint8Array, options: PlanValidationOptions = {}): PlaybookManifest {
    if (Buffer.byteLength(input) > MAX_PLAYBOOK_BYTES) throw new Error("Playbook exceeds 64 KiB");
    const content = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
    if (Buffer.from(content, "utf8").toString("utf8") !== content) throw new Error("Playbook is not exact UTF-8 text");
    return validatePlaybookManifest(parseDesignJson(content, MAX_PLAYBOOK_BYTES), options);
}

/** Offline verification of the source-bound snapshot; no credential utilities,
 * provider calls or source commands. Known environment secrets are rejected. */
export function validatePlaybookSnapshot(value: unknown, options: PlanValidationOptions = {}): PlaybookSnapshot {
    canonicalJson(value);
    const s = record(value, "playbook snapshot", ["schema_version", "source", "content", "manifest", "sha256", "snapshot_sha256"]);
    const source = record(s.source, "playbook source", ["repository", "path", "blob"]), repository = record(source.repository, "playbook repository", ["url", "commit"]);
    if (s.schema_version !== "wringer.playbook-snapshot.v1" || typeof repository.url !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(repository.commit ?? "") || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(source.blob ?? "")) throw new Error("Playbook snapshot needs an exact repository and Git blob identity");
    const content = string(s.content, "playbook source bytes", MAX_PLAYBOOK_BYTES), manifest = parsePlaybookManifest(content, options);
    if (hashBytes(content) !== digest(s.sha256) || canonicalJson(manifest) !== canonicalJson(s.manifest)) throw new Error("Playbook snapshot differs from its exact source bytes");
    const snapshot = { schema_version: "wringer.playbook-snapshot.v1" as const, source: { repository: { url: repository.url, commit: repository.commit }, path: path(source.path), blob: source.blob }, content, manifest, sha256: s.sha256 };
    if (hashValue(snapshot) !== digest(s.snapshot_sha256)) throw new Error("Playbook snapshot digest changed");
    return freezeData({ ...snapshot, snapshot_sha256: s.snapshot_sha256 });
}

export function assertPlaybookApplicability(rawSnapshot: PlaybookSnapshot, rawPlan: ExecutionPlan, environment?: EnvironmentMap, options: PlanValidationOptions = {}): void {
    const snapshot = validatePlaybookSnapshot(rawSnapshot, options), plan = validateExecutionPlan(rawPlan, options), selection = plan.playbook, a = snapshot.manifest.applicability;
    if (!selection || selection.path !== snapshot.source.path || selection.sha256 !== snapshot.sha256 || canonicalJson(snapshot.source.repository) !== canonicalJson(plan.repository) || selection.taskFamily !== a.taskFamily) throw new Error("Playbook does not match the exact approved source, selection or task family");
    if (a.context.some(p => !plan.environment.context.includes(p)) || a.tools.some(name => !plan.environment.tools.some(t => t.name === name)) || a.checks.some(id => !plan.acceptance.checks.some(c => c.id === id)) || plan.scope.writable.some(p => !a.scope.some(base => p === base || p.startsWith(base + "/"))) || a.design && !plan.design) throw new Error("Playbook applicability does not match declared context, tools, checks, scope or design");
    if (!plan.acceptance.protected_paths.includes(selection.path)) throw new Error("Approved playbook is not protected from worker edits");
    if (environment) {
        const { map_sha256, ...body } = environment;
        if (map_sha256 !== hashValue(body) || environment.plan_sha256 !== plan.plan_sha256 || canonicalJson(environment.repository) !== canonicalJson(plan.repository) || environment.inventory_sha256 !== hashValue(environment.files)) throw new Error("Playbook readiness requires the exact intact approved environment map");
        if (a.context.some(p => !environment.context.some(c => c.path === p && hashBytes(c.text) === c.sha256 && environment.files.some(f => f.path === p && f.blob === c.blob && ["100644", "100755"].includes(f.mode)))) || a.tools.some(name => {
            const tool = environment.tools.find(t => t.name === name), declared = plan.environment.tools.find(t => t.name === name), observation = tool?.observation;
            return !tool || !declared || tool.version !== declared.version || canonicalJson(tool.probe) !== canonicalJson(declared.probe) || observation?.status !== "passed" || observation.exit_code !== 0 || observation.source_commit !== plan.repository.commit || observation.image !== plan.runtime.image || observation.command_sha256 !== hashValue(declared.probe) || !observation.runtime_id || observation.output.trim() !== declared.version;
        })) throw new Error("Required playbook context or tool readiness has not been measured successfully");
    }
}

async function gitBytes(repo: string, args: string[], maximum: number): Promise<Uint8Array> {
    const child = Bun.spawn(["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd: resolve(repo), env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => child.kill(), 10000);
    const bounded = async (stream: ReadableStream<Uint8Array>, limit: number) => { const reader = stream.getReader(), chunks: Uint8Array[] = []; let bytes = 0; try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) throw new Error("Playbook Git observation exceeds its finite byte ceiling"); chunks.push(part.value); } return Buffer.concat(chunks); } catch (error) { child.kill(); throw error; } finally { reader.releaseLock(); } };
    try { const [stdout, , code] = await Promise.all([bounded(child.stdout, maximum), bounded(child.stderr, 8192), child.exited]); if (code !== 0) throw new Error("Cannot read the exact approved playbook from Git source objects"); return stdout; } finally { clearTimeout(timeout); }
}

/** Read exact approved base-commit objects, including from a bare delivery audit store. */
export async function readPinnedPlaybook(repo: string, rawPlan: ExecutionPlan, options: { environment?: EnvironmentMap } & PlanValidationOptions = {}): Promise<PlaybookSnapshot | null> {
    const plan = validateExecutionPlan(rawPlan, options), selection = plan.playbook;
    if (!selection) return null;
    const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const listing = decode(await gitBytes(repo, ["ls-tree", "-rz", "--full-tree", plan.repository.commit, "--", selection.path], 4096));
    const match = /^(100644|100755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t([^\0]+)\0$/.exec(listing);
    if (!match || match[3] !== selection.path) throw new Error("Approved playbook must be one exact regular Git source blob, never a symlink or submodule");
    const size = Number(decode(await gitBytes(repo, ["cat-file", "-s", match[2]!], 128)).trim());
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PLAYBOOK_BYTES) throw new Error("Approved playbook exceeds its bounded source size");
    const bytes = await gitBytes(repo, ["cat-file", "blob", match[2]!], MAX_PLAYBOOK_BYTES), content = decode(bytes);
    if (bytes.byteLength !== size || hashBytes(bytes) !== selection.sha256) throw new Error("Approved playbook SHA256 differs from the exact source blob");
    const manifest = parsePlaybookManifest(bytes, options), body = { schema_version: "wringer.playbook-snapshot.v1" as const, source: { repository: plan.repository, path: selection.path, blob: match[2]! }, content, manifest, sha256: selection.sha256 };
    const snapshot = freezeData({ ...body, snapshot_sha256: hashValue(body) });
    assertPlaybookApplicability(snapshot, plan, options.environment, options);
    return snapshot;
}
