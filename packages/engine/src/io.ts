import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, lstat, realpath, writeFile, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { EngineError, type EventCallback } from "./types";
import { version } from "../../../package.json";
export const VERSION = version;
export const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const now = () => new Date().toISOString();
export const newId = () => `${now().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${crypto.randomUUID().slice(0, 8)}`;
export const posix = (value: string) => value.replaceAll("\\", "/");
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function inside(root: string, path: string) {
    const r = relative(resolve(root), resolve(root, path));
    if (r === ".." || r.startsWith(`../`) || isAbsolute(r))
        throw new EngineError(`Path escapes ${root}: ${path}`, 3);
    return resolve(root, path);
}
export async function safePath(root: string, path: string) {
    const target = inside(root, path);
    let p = target;
    while (p !== dirname(p)) {
        try {
            const actual = await realpath(p);
            inside(await realpath(root), actual);
            break;
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                throw e;
            p = dirname(p);
        }
    }
    return target;
}
export async function readJson<T = any>(path: string): Promise<T> {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024)
        throw new EngineError(`Record is not a bounded regular file: ${path}`, 3);
    return JSON.parse(await readFile(path, "utf8"));
}
export async function maybeJson<T = any>(path: string): Promise<T | null> {
    try {
        return await readJson(path);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
            return null;
        throw new EngineError(`Unreadable record ${path}: ${(e as Error).message}`);
    }
}
export class Redactor {
    readonly values: string[];
    private readonly fragments: RegExp | null;
    constructor(patterns: string[] = ["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*"], env: NodeJS.ProcessEnv = process.env, extra: string[] = [], private readonly shapes = true) {
        const matchers = patterns.map(p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`, "i"));
        this.values = [...new Set([...Object.entries(env).filter(([k, v]) => v && matchers.some(r => r.test(k))).map(([, v]) => v!), ...extra].filter(v => v.length >= 4))].sort((a, b) => b.length - a.length);
        const parts = new Set<string>();
        for (const value of this.values)
            if (value.length >= 12)
                for (let n = 6; n < Math.min(value.length, 512); n++) {
                    parts.add(value.slice(0, n));
                    parts.add(value.slice(-n));
                }
        const escaped = [...parts].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        this.fragments = escaped.length ? new RegExp(`(?<![A-Za-z0-9_-])(?:${escaped.join("|")})(?![A-Za-z0-9_-])`, "g") : null;
    }
    scrub(value: string): string {
        let out = value;
        for (const secret of this.values)
            out = out.replaceAll(secret, "[REDACTED]");
        if (this.fragments)
            out = out.replace(this.fragments, "[REDACTED]");
        return this.shapes ? out.replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]") : out;
    }
    deep<T>(value: T): T {
        if (typeof value === "string")
            return this.scrub(value) as T;
        if (Array.isArray(value))
            return value.map(v => this.deep(v)) as T;
        if (value && typeof value === "object")
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [this.scrub(k), this.deep(v)])) as T;
        return value;
    }
}
export async function fileList(root: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(root, { withFileTypes: true })) {
        if (e.isSymbolicLink())
            throw new EngineError(`Bundle contains a symbolic link: ${join(root, e.name)}`, 3);
        if (e.isDirectory())
            for (const f of await fileList(join(root, e.name)))
                out.push(`${e.name}/${f}`);
        else if (e.isFile())
            out.push(e.name);
        else
            throw new EngineError(`Bundle contains a non-regular evidence file: ${join(root, e.name)}`, 3);
    }
    return out.sort();
}
export class Bundle {
    private chain: string = "0".repeat(64);
    private queue: Promise<void> = Promise.resolve();
    constructor(readonly directory: string, readonly redactor = new Redactor(), readonly ledger = "evidence.jsonl", readonly onEvent?: EventCallback) { }
    async prepare() {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        try {
            const lines = (await readFile(join(this.directory, this.ledger), "utf8")).trimEnd().split("\n");
            if (lines.at(-1))
                this.chain = sha256(lines.at(-1)!);
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                throw e;
        }
        return this;
    }
    async write(path: string, value: string | Uint8Array) { const target = await safePath(this.directory, path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); const raw = typeof value === "string" ? value : new TextDecoder().decode(value); await writeFile(target, this.redactor.scrub(raw), { mode: 0o600 }); }
    async json(path: string, value: unknown) { await this.write(path, JSON.stringify(this.redactor.deep(value), null, 2) + "\n"); }
    /** Binary gate artifacts are explicitly opt-in and marked redacted:false in their artifact record. */
    async binary(path: string, value: Uint8Array) { const target = await safePath(this.directory, path); await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, value, { mode: 0o600 }); }
    async event(type: string, fields: Record<string, unknown> = {}) { this.queue = this.queue.then(async () => { const event = this.redactor.deep({ type, ts: now(), prev_hash: this.chain, ...fields }); const line = JSON.stringify(event); await appendFile(await safePath(this.directory, this.ledger), line + "\n", { mode: 0o600 }); this.chain = sha256(line); this.onEvent?.(event); }); await this.queue; }
    async seal() {
        await this.queue;
        const files: Record<string, string> = {};
        for (const path of await fileList(this.directory))
            if (path !== "digests.json")
                files[path] = sha256(await readFile(join(this.directory, path)));
        await this.json("digests.json", { schema_version: "wringer.digests.v1", algorithm: "sha256", files });
    }
}
export async function validateDigests(directory: string): Promise<{
    ok: boolean;
    errors: string[];
}> {
    const errors: string[] = [];
    const digests = await maybeJson(join(directory, "digests.json"));
    if (!digests || digests.schema_version !== "wringer.digests.v1")
        return { ok: false, errors: ["Missing or unknown digests.json"] };
    const actual = await fileList(directory);
    for (const [path, digest] of Object.entries(digests.files ?? {})) {
        try {
            if (sha256(await readFile(await safePath(directory, path))) !== digest)
                errors.push(`Digest mismatch: ${path}`);
        }
        catch (e) {
            errors.push(`Cannot read ${path}: ${(e as Error).message}`);
        }
    }
    for (const path of actual)
        if (path !== "digests.json" && !(path in digests.files))
            errors.push(`Unsealed file: ${path}`);
    for (const name of ["evidence.jsonl", "loop.jsonl"]) {
        if (!actual.includes(name))
            continue;
        let previous = "0".repeat(64);
        let i = 0;
        for (const line of (await readFile(join(directory, name), "utf8")).split("\n").filter(Boolean)) {
            i++;
            try {
                const event = JSON.parse(line);
                if (event.prev_hash !== previous)
                    errors.push(`${name}:${i} chain mismatch`);
                previous = sha256(line);
            }
            catch {
                errors.push(`${name}:${i} invalid JSON`);
            }
        }
    }
    return { ok: errors.length === 0, errors };
}
export function criterionDigest(criterion: {
    id: string;
    title: string;
    guidance?: string;
}) { return sha256(JSON.stringify({ guidance: criterion.guidance ?? "", id: criterion.id, title: criterion.title })); }
export function schemaDirectory() { return resolve(import.meta.dir, "../../../schema"); }
