import { Redactor } from "@wringer/engine";
import { parseDesignJson } from "@wringer/design";
import { canonicalJson, freezeData, hashBytes, hashValue } from "./canonical";
import { record, repoPath, validateExecutionPlan, type PlanValidationOptions } from "./compile";
import { gitBytes } from "./git-objects";
import { PLAYBOOK_ALWAYS_ON, PLAYBOOK_MANIFEST, PLAYBOOK_SURFACES, playbookTreeDirectory, playbookTreeEntry, type PlaybookFileKind } from "./playbook-paths";
import type { EnvironmentMap, ExecutionPlan, PlaybookSelection, PlaybookSurface, RepositoryRef } from "./types";

export * from "./playbook-paths";
/** A whole tree, manifest included. */
export const MAX_PLAYBOOK_TREE_BYTES = 256 * 1024;
/** The always-on file is read at every turn: it stays small. */
export const MAX_ALWAYS_ON_BYTES = 8 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
export interface PlaybookManifestV2 {
    schema_version: "wringer.playbook.v2";
    id: string;
    revision: string;
    title: string;
    role: "worker";
    taskFamily: string;
    surface: PlaybookSurface;
    /** Paths relative to the manifest's directory. */
    files: { path: string; sha256: string; kind: PlaybookFileKind }[];
    limits: string[];
    evaluationRefs: string[];
}
export interface PlaybookTreeFile { path: string; blob: string; mode: "100644" | "100755"; sha256: string; content: string; }
export interface PlaybookTreeSnapshot {
    schema_version: "wringer.playbook-snapshot.v3";
    /** The manifest's source identity; every file follows with its own. */
    source: { repository: RepositoryRef; path: string; blob: string };
    content: string;
    manifest: PlaybookManifestV2;
    /** Exact manifest bytes. */
    sha256: string;
    files: PlaybookTreeFile[];
    snapshot_sha256: string;
}
/** What a materialisation writes: active repository path and exact bytes. */
export interface PlaybookActiveFile { sourcePath: string; activePath: string; mode: "100644" | "100755"; sha256: string; content: string; }

const text = (value: unknown, label: string, max = 4096): string => {
    if (typeof value !== "string" || !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || Buffer.byteLength(value) > max) throw new Error(`${label} must be bounded nonempty UTF-8 text`);
    return value;
};
const identifier = (value: unknown, label: string) => { const v = text(value, label, 64); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v)) throw new Error(`${label} must be an exact short identifier`); return v; };
const digest = (value: unknown, label: string) => { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} must be an exact SHA256`); return value; };
const rows = <T>(value: unknown, label: string, parse: (v: unknown) => T, min: number, max: number): T[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} must contain ${min} to ${max} explicit entries`);
    return value.map(parse);
};

/** Pure inert-data validation of a v2 manifest. Guidance never grants tools, permission or execution. */
export function validatePlaybookManifestV2(value: unknown, options: PlanValidationOptions = {}): PlaybookManifestV2 {
    const wire = canonicalJson(value);
    if (Buffer.byteLength(wire) > MAX_MANIFEST_BYTES) throw new Error("Playbook manifest exceeds 64 KiB");
    const m = record(value, "playbook manifest", ["schema_version", "id", "revision", "title", "role", "taskFamily", "surface", "files", "limits", "evaluationRefs"]);
    if (m.schema_version !== "wringer.playbook.v2" || m.role !== "worker") throw new Error("A playbook tree manifest is a worker-only wringer.playbook.v2");
    if (!PLAYBOOK_SURFACES.includes(m.surface)) throw new Error("A playbook tree names its adapter surface: claude-code, codex or generic");
    const surface = m.surface as PlaybookSurface;
    const files = rows(m.files, "playbook files", raw => {
        const f = record(raw, "playbook file", ["path", "sha256", "kind"]), path = repoPath(f.path), entry = playbookTreeEntry(surface, path);
        if (!entry || entry.kind !== f.kind) throw new Error(`Playbook file ${path} is not a ${String(f.kind)} file of a ${surface} tree`);
        return { path, sha256: digest(f.sha256, "Playbook file digest"), kind: entry.kind };
    }, 1, 64);
    if (new Set(files.map(f => f.path)).size !== files.length) throw new Error("Playbook files contain duplicate paths");
    if (files.map(f => f.path).join("\n") !== files.map(f => f.path).sort().join("\n")) throw new Error("Playbook files are listed in path order");
    if (files.filter(f => f.kind === "always-on").length !== 1) throw new Error(`A ${surface} playbook tree has exactly one always-on ${PLAYBOOK_ALWAYS_ON[surface]}`);
    const limits = rows(m.limits, "playbook limits", v => text(v, "playbook limit", 1024), 1, 32), refs = rows(m.evaluationRefs, "playbook evaluation references", v => digest(v, "Playbook evaluation reference"), 0, 32);
    if (new Set(limits).size !== limits.length || new Set(refs).size !== refs.length) throw new Error("Playbook limits and references have no duplicates");
    const manifest: PlaybookManifestV2 = { schema_version: "wringer.playbook.v2", id: identifier(m.id, "playbook id"), revision: identifier(m.revision, "playbook revision"), title: text(m.title, "playbook title", 256), role: "worker", taskFamily: identifier(m.taskFamily, "playbook task family"), surface, files, limits, evaluationRefs: [...refs].sort() };
    if (canonicalJson(manifest.evaluationRefs) !== canonicalJson(refs)) throw new Error("Playbook evaluation references are listed in order");
    if (new Redactor(undefined, options.credentialEnvironment ?? process.env).scrub(wire) !== wire) throw new Error("Playbook contains a detected credential; no altered instructions are accepted");
    return freezeData(manifest);
}
export function parsePlaybookManifestV2(input: string | Uint8Array, options: PlanValidationOptions = {}): PlaybookManifestV2 {
    if (Buffer.byteLength(input) > MAX_MANIFEST_BYTES) throw new Error("Playbook manifest exceeds 64 KiB");
    const content = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
    return validatePlaybookManifestV2(parseDesignJson(content, MAX_MANIFEST_BYTES), options);
}

/** Front matter may name and describe; it never grants hooks, tools or permissions (R-B). */
function frontMatter(content: string, label: string): Record<string, string> {
    if (!content.startsWith("---\n")) throw new Error(`${label} starts with front matter naming it and describing when to use it`);
    const end = content.indexOf("\n---\n", 4);
    if (end < 0) throw new Error(`${label} front matter is not closed`);
    const fields: Record<string, string> = {};
    for (const line of content.slice(4, end).split("\n")) {
        if (!line.trim()) continue;
        const at = line.indexOf(":"), key = line.slice(0, at).trim(), value = line.slice(at + 1).trim();
        if (at < 1 || !["name", "description"].includes(key)) throw new Error(`${label} front matter may carry only name and description; ${key || "this line"} is refused. A playbook never grants hooks, tools or permissions`);
        if (key in fields || !value || value.length > 1024) throw new Error(`${label} front matter ${key} is duplicated, empty or too long`);
        fields[key] = value;
    }
    if (!fields.name || !fields.description) throw new Error(`${label} front matter needs name and description`);
    return fields;
}
const SCRIPT_REFERENCE = /(?:^|[\s`'"(=])((?:scripts\/wringer|\.claude\/skills|\.agents\/skills|\.playbook\/skills)\/[A-Za-z0-9._\/-]+\.(?:sh|mjs|js|ts|py))(?=$|[\s`'")\],.;:])/g;
const TREE_SCRIPT_REFERENCE = /(?:^|[\s`'"(=])(scripts\/(?!wringer\/)[A-Za-z0-9._\/-]+\.(?:sh|mjs|js|ts|py))(?=$|[\s`'")\],.;:])/g;
function parseScript(path: string, content: string, tools: string[]) {
    if (path.endsWith(".sh")) {
        const result = Bun.spawnSync(["sh", "-n"], { stdin: Buffer.from(content), stdout: "ignore", stderr: "pipe", env: { PATH: "/usr/bin:/bin" } });
        if (result.exitCode !== 0) throw new Error(`Playbook script ${path} does not parse as sh`);
        return;
    }
    if (path.endsWith(".py")) {
        if (!tools.some(name => name === "python" || name === "python3")) throw new Error(`Playbook script ${path} is Python, and the plan declares no python tool; scripts in an undeclared toolchain are refused`);
        const result = Bun.spawnSync(["python3", "-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], { stdin: Buffer.from(content), stdout: "ignore", stderr: "pipe", env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
        if (result.exitCode !== 0) throw new Error(`Playbook script ${path} does not parse as Python`);
        return;
    }
    try { new Bun.Transpiler({ loader: path.endsWith(".ts") ? "ts" : "js" }).transformSync(content); }
    catch { throw new Error(`Playbook script ${path} does not parse`); }
}
/** Content rules, with every byte in hand: digests, sizes, the always-on cap, skill and
 * subagent front matter, triggers, script references and parses, and no credential. */
export function validatePlaybookTreeContent(manifest: PlaybookManifestV2, contents: Map<string, string>, options: PlanValidationOptions & { tools: string[]; manifestBytes: number }): void {
    const redactor = new Redactor(undefined, options.credentialEnvironment ?? process.env);
    let total = options.manifestBytes;
    for (const file of manifest.files) {
        const content = contents.get(file.path);
        if (content === undefined) throw new Error(`Playbook file ${file.path} is missing`);
        if (hashBytes(content) !== file.sha256) throw new Error(`Playbook file ${file.path} differs from its manifest digest`);
        if (content.includes("\0")) throw new Error(`Playbook file ${file.path} is not text`);
        if (redactor.scrub(content) !== content) throw new Error(`Playbook file ${file.path} contains a detected credential`);
        total += Buffer.byteLength(content);
    }
    if (contents.size !== manifest.files.length) throw new Error("The tree holds a file its manifest does not list");
    if (total > MAX_PLAYBOOK_TREE_BYTES) throw new Error("Playbook tree exceeds 256 KiB");
    const always = manifest.files.find(f => f.kind === "always-on")!, alwaysText = contents.get(always.path)!;
    if (Buffer.byteLength(alwaysText) > MAX_ALWAYS_ON_BYTES) throw new Error(`${always.path} is read at every turn and is capped at 8 KiB`);
    const active = new Map(manifest.files.map(f => [playbookTreeEntry(manifest.surface, f.path)!.active, f] as const));
    for (const file of manifest.files) {
        const content = contents.get(file.path)!;
        if (file.kind === "skill" && file.path.endsWith("/SKILL.md")) {
            const name = file.path.split("/")[1]!, fields = frontMatter(content, file.path);
            if (fields.name !== name) throw new Error(`${file.path} names itself ${fields.name}, not ${name}`);
            if (!alwaysText.includes(name)) throw new Error(`Skill ${name} is never named in ${always.path}; an untriggered skill is refused`);
        }
        if (file.kind === "subagent") {
            const name = file.path.slice("agents/".length, -".md".length), fields = frontMatter(content, file.path);
            if (fields.name !== name) throw new Error(`${file.path} names itself ${fields.name}, not ${name}`);
            if (!alwaysText.includes(name)) throw new Error(`Subagent ${name} is never named in ${always.path}; an untriggered subagent is refused`);
        }
        if (file.kind === "script") parseScript(file.path, content, options.tools);
        if (file.kind === "always-on" || file.kind === "skill" || file.kind === "subagent") {
            for (const match of content.matchAll(SCRIPT_REFERENCE)) if (!active.has(match[1]!)) throw new Error(`${file.path} invokes ${match[1]}, which this tree does not contain`);
            for (const match of content.matchAll(TREE_SCRIPT_REFERENCE)) if (manifest.files.some(f => f.path === match[1])) throw new Error(`${file.path} names the tree path ${match[1]}; name its materialised path ${playbookTreeEntry(manifest.surface, match[1]!)!.active}`);
        }
    }
}

const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
/** Offline verification of a source-bound tree snapshot. */
export function validatePlaybookTreeSnapshot(value: unknown, options: PlanValidationOptions & { tools: string[] }): PlaybookTreeSnapshot {
    canonicalJson(value);
    const s = record(value, "playbook tree snapshot", ["schema_version", "source", "content", "manifest", "sha256", "files", "snapshot_sha256"]);
    const source = record(s.source, "playbook source", ["repository", "path", "blob"]), repository = record(source.repository, "playbook repository", ["url", "commit"]);
    if (s.schema_version !== "wringer.playbook-snapshot.v3" || typeof repository.url !== "string" || !SHA.test(repository.commit ?? "") || !SHA.test(source.blob ?? "")) throw new Error("Playbook tree snapshot needs an exact repository and manifest blob identity");
    const path = repoPath(source.path);
    if (!PLAYBOOK_MANIFEST.test(path)) throw new Error("A playbook tree manifest lives at wringer/playbooks/<id>/manifest.json");
    const content = text(s.content, "playbook manifest bytes", MAX_MANIFEST_BYTES), manifest = parsePlaybookManifestV2(content, options);
    if (hashBytes(content) !== digest(s.sha256, "Playbook manifest digest") || canonicalJson(manifest) !== canonicalJson(s.manifest)) throw new Error("Playbook tree snapshot differs from its exact manifest bytes");
    const directory = playbookTreeDirectory(path);
    const files = rows(s.files, "playbook tree files", raw => {
        const f = record(raw, "playbook tree file", ["path", "blob", "mode", "sha256", "content"]);
        if (typeof f.content !== "string" || !SHA.test(f.blob ?? "") || !["100644", "100755"].includes(f.mode)) throw new Error("Playbook tree file needs exact bytes, blob and regular mode");
        return { path: repoPath(f.path), blob: f.blob as string, mode: f.mode as PlaybookTreeFile["mode"], sha256: digest(f.sha256, "Playbook tree file digest"), content: f.content as string };
    }, 1, 64);
    if (canonicalJson(files.map(f => [f.path, f.sha256])) !== canonicalJson(manifest.files.map(f => [directory + f.path, f.sha256]))) throw new Error("Playbook tree files differ from the manifest's list");
    validatePlaybookTreeContent(manifest, new Map(files.map(f => [f.path.slice(directory.length), f.content])), { ...options, manifestBytes: Buffer.byteLength(content) });
    const snapshot = { schema_version: "wringer.playbook-snapshot.v3" as const, source: { repository: { url: repository.url, commit: repository.commit }, path, blob: source.blob as string }, content, manifest, sha256: s.sha256 as string, files };
    if (hashValue(snapshot) !== digest(s.snapshot_sha256, "Playbook tree snapshot digest")) throw new Error("Playbook tree snapshot digest changed");
    return freezeData({ ...snapshot, snapshot_sha256: s.snapshot_sha256 as string });
}
const toolNames = (plan: ExecutionPlan) => plan.environment.tools.map(t => t.name);
/** The snapshot is the plan's selection, protected, and placeable without a silent collision. */
export function assertPlaybookTreeApplicability(rawSnapshot: PlaybookTreeSnapshot, rawPlan: ExecutionPlan, environment?: EnvironmentMap, options: PlanValidationOptions = {}): void {
    const plan = validateExecutionPlan(rawPlan, options), snapshot = validatePlaybookTreeSnapshot(rawSnapshot, { ...options, tools: toolNames(plan) }), selection = plan.playbook;
    if (!selection?.files || !selection.surface) throw new Error("This plan selects no playbook tree");
    if (selection.path !== snapshot.source.path || selection.sha256 !== snapshot.sha256 || selection.surface !== snapshot.manifest.surface || selection.taskFamily !== snapshot.manifest.taskFamily || canonicalJson(snapshot.source.repository) !== canonicalJson(plan.repository) || canonicalJson(selection.files) !== canonicalJson(snapshot.files.map(f => ({ path: f.path, sha256: f.sha256 })))) throw new Error("Playbook tree does not match the exact approved source, selection, surface or task family");
    for (const path of [selection.path, ...selection.files.map(f => f.path)]) if (!plan.acceptance.protected_paths.includes(path)) throw new Error(`Approved playbook file ${path} is not protected from worker edits`);
    if (environment) {
        const { map_sha256, ...body } = environment;
        if (map_sha256 !== hashValue(body) || environment.plan_sha256 !== plan.plan_sha256 || canonicalJson(environment.repository) !== canonicalJson(plan.repository) || environment.inventory_sha256 !== hashValue(environment.files)) throw new Error("Playbook readiness requires the exact intact approved environment map");
        assertPlaybookPlacement(plan, environment.files.map(f => ({ path: f.path, mode: f.mode })));
    }
}
/** Every active path a plan's tree selection materialises; none without a tree. */
export function playbookActivePaths(plan: { playbook?: PlaybookSelection }): string[] {
    const selection = plan.playbook;
    if (!selection?.files || !selection.surface) return [];
    const directory = playbookTreeDirectory(selection.path);
    return selection.files.flatMap(f => { const entry = playbookTreeEntry(selection.surface!, f.path.slice(directory.length)); return entry?.active ? [entry.active] : []; }).sort();
}
/** Active paths never silently replace tracked files: a collision refuses unless the
 * plan names it in playbook.replace, and a replacement must name a tracked regular file. */
export function assertPlaybookPlacement(plan: ExecutionPlan, tracked: { path: string; mode: string }[]): void {
    const replace = plan.playbook?.replace ?? [], active = playbookActivePaths(plan);
    for (const path of active) {
        const exact = tracked.find(f => f.path === path);
        if (exact && !replace.includes(path)) throw new Error(`The playbook would materialise ${path}, which the repository already tracks. Name it in playbook.replace to replace it for the worker, or move the file; nothing was replaced`);
        if (exact && !["100644", "100755"].includes(exact.mode)) throw new Error(`${path} is not a regular tracked file and cannot be replaced`);
        if (tracked.some(f => path.startsWith(f.path + "/") || f.path.startsWith(path + "/"))) throw new Error(`The playbook path ${path} collides with a tracked file or directory of the same name; nothing was replaced`);
    }
    for (const path of replace) if (!tracked.some(f => f.path === path)) throw new Error(`playbook.replace names ${path}, which the repository does not track`);
}
/** The materialisation for a validated snapshot: each active file, mode 755 for scripts. */
export function playbookActiveFiles(snapshot: PlaybookTreeSnapshot): PlaybookActiveFile[] {
    const directory = playbookTreeDirectory(snapshot.source.path);
    return snapshot.files.flatMap(file => {
        const entry = playbookTreeEntry(snapshot.manifest.surface, file.path.slice(directory.length))!;
        return entry.active ? [{ sourcePath: file.path, activePath: entry.active, mode: entry.kind === "script" ? "100755" as const : "100644" as const, sha256: file.sha256, content: file.content }] : [];
    }).sort((a, b) => a.activePath.localeCompare(b.activePath));
}

/** Read the exact approved tree from base-commit objects: the manifest, and every file
 * it lists and nothing else in its directory, each digest checked. */
export async function readPinnedPlaybookTree(repo: string, rawPlan: ExecutionPlan, options: { environment?: EnvironmentMap } & PlanValidationOptions = {}): Promise<PlaybookTreeSnapshot | null> {
    const plan = validateExecutionPlan(rawPlan, options), selection = plan.playbook;
    if (!selection) return null;
    if (!selection.files) throw new Error("This plan selects one JSON playbook, not a tree; read it with readPinnedPlaybook");
    const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(bytes), directory = playbookTreeDirectory(selection.path);
    const listing = decode(await gitBytes(repo, ["ls-tree", "-rz", "--full-tree", plan.repository.commit, "--", directory], 64 * 1024)).split("\0").filter(Boolean);
    const objects = new Map<string, { mode: "100644" | "100755"; blob: string }>();
    for (const row of listing) {
        const match = /^(100644|100755) blob ([a-f0-9]{40}(?:[a-f0-9]{24})?)\t(.+)$/.exec(row);
        if (!match) throw new Error("Every playbook tree file is one exact regular Git source blob, never a symlink or submodule");
        objects.set(match[3]!, { mode: match[1] as "100644" | "100755", blob: match[2]! });
    }
    const expected = [selection.path, ...selection.files.map(f => f.path)].sort();
    if (canonicalJson([...objects.keys()].sort()) !== canonicalJson(expected)) throw new Error(`The approved tree ${directory} holds exactly its manifest and listed files; it differs from the plan's selection`);
    const read = async (path: string) => {
        const object = objects.get(path)!, size = Number(decode(await gitBytes(repo, ["cat-file", "-s", object.blob], 128)).trim());
        if (!Number.isSafeInteger(size) || size < 1 || size > MAX_PLAYBOOK_TREE_BYTES) throw new Error(`Approved playbook file ${path} exceeds its bounded source size`);
        const bytes = await gitBytes(repo, ["cat-file", "blob", object.blob], MAX_PLAYBOOK_TREE_BYTES);
        if (bytes.byteLength !== size) throw new Error(`Approved playbook file ${path} changed while it was read`);
        return { ...object, content: decode(bytes), sha256: hashBytes(bytes) };
    };
    const manifestObject = await read(selection.path);
    if (manifestObject.sha256 !== selection.sha256) throw new Error("Approved playbook manifest SHA256 differs from the exact source blob");
    const files: PlaybookTreeFile[] = [];
    for (const file of selection.files) {
        const object = await read(file.path);
        if (object.sha256 !== file.sha256) throw new Error(`Approved playbook file ${file.path} differs from its selected SHA256`);
        files.push({ path: file.path, blob: object.blob, mode: object.mode, sha256: object.sha256, content: object.content });
    }
    const manifest = parsePlaybookManifestV2(manifestObject.content, options);
    const body = { schema_version: "wringer.playbook-snapshot.v3" as const, source: { repository: plan.repository, path: selection.path, blob: manifestObject.blob }, content: manifestObject.content, manifest, sha256: selection.sha256, files };
    const snapshot = freezeData({ ...body, snapshot_sha256: hashValue(body) });
    assertPlaybookTreeApplicability(snapshot, plan, options.environment, options);
    return snapshot;
}
/** The exact v6 selection for a tree committed at `commit`: the manifest's digest and
 * every listed file's, each checked against the manifest. Offline; nothing is approved. */
export async function selectPlaybookTree(repo: string, commit: string, manifestPath: string, options: { replace?: string[] } & PlanValidationOptions = {}): Promise<PlaybookSelection> {
    if (!PLAYBOOK_MANIFEST.test(manifestPath)) throw new Error("A playbook tree manifest lives at wringer/playbooks/<id>/manifest.json");
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)) throw new Error("Select a tree at one exact commit");
    const bytes = await gitBytes(repo, ["cat-file", "blob", `${commit}:${manifestPath}`], 64 * 1024), manifest = parsePlaybookManifestV2(bytes, options), directory = playbookTreeDirectory(manifestPath);
    const files = [];
    for (const file of manifest.files) {
        const content = await gitBytes(repo, ["cat-file", "blob", `${commit}:${directory}${file.path}`], MAX_PLAYBOOK_TREE_BYTES);
        if (hashBytes(content) !== file.sha256) throw new Error(`${directory}${file.path} differs from its manifest digest; fix the manifest before selecting it`);
        files.push({ path: directory + file.path, sha256: file.sha256 });
    }
    return { path: manifestPath, sha256: hashBytes(bytes), taskFamily: manifest.taskFamily, surface: manifest.surface, files, ...(options.replace?.length ? { replace: [...options.replace].sort() } : {}) };
}
