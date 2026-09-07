import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { openReader } from "@wringer/records";
import { Redactor, runProcess, schemaDirectory } from "@wringer/engine";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
export const digest = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const stamp = (): string => `${new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "")}-${crypto.randomUUID().slice(0, 8)}`;
export class Refusal extends Error {
    constructor(message: string, public next_move: string, public code = "refused") { super(message); this.name = "Refusal"; }
}
export async function json(path: string): Promise<any> {
    try {
        return JSON.parse(await Bun.file(path).text());
    }
    catch (error) {
        throw new Refusal(`Cannot read ${path}: ${error instanceof Error ? error.message : error}`, `wring doctor --repo ${quote(dirname(path))}`, "unreadable-record");
    }
}
export async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    }
    catch (e: any) {
        if (e.code === "ENOENT")
            return false;
        throw e;
    }
}
export async function put(path: string, value: unknown, redactor = new Redactor()): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, typeof value === "string" ? redactor.scrub(value) : JSON.stringify(redactor.deep(value), null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
}
/** Every component is checked: lexical containment alone does not contain symlinks. */
export async function inside(root: string, name: string): Promise<string> {
    portableName(name);
    const base = await realpath(root), target = resolve(base, name);
    if (!target.startsWith(base + sep))
        throw new Error(`Path escapes bundle: ${name}`);
    let cursor = base;
    for (const part of relative(base, target).split(sep)) {
        cursor = join(cursor, part);
        try {
            if ((await lstat(cursor)).isSymbolicLink())
                throw new Error(`Symlinks are not portable evidence: ${name}`);
        }
        catch (e: any) {
            if (e.code !== "ENOENT")
                throw e;
        }
    }
    return target;
}
export function portableName(name: string) {
    if (!name || isAbsolute(name) || name.includes("\0") || name.split(/[\\/]/).some(v => v === ".." || v === ".git"))
        throw new Error(`Unsafe portable path: ${name}`);
    return name;
}
export async function files(root: string, prefix = ""): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
            throw new Error(`Symlink in evidence: ${name}`);
        if (entry.isDirectory())
            found.push(...await files(root, name));
        else if (entry.isFile())
            found.push(name);
        else
            throw new Error(`Unsupported evidence entry: ${name}`);
    }
    return found.sort();
}
export async function seal(root: string): Promise<void> {
    const hashes: Record<string, string> = {};
    for (const name of await files(root))
        if (name !== "digests.json")
            hashes[name] = digest(new Uint8Array(await Bun.file(await inside(root, name)).arrayBuffer()));
    await put(join(root, "digests.json"), { schema_version: "wringer.digests.v1", algorithm: "sha256", files: hashes });
}
export async function checkSeal(root: string): Promise<number> {
    const record = await json(join(root, "digests.json"));
    if (record.schema_version !== "wringer.digests.v1" || record.algorithm !== "sha256" || !record.files || typeof record.files !== "object" || Array.isArray(record.files))
        throw new Error(`Invalid digest index in ${root}`);
    const actual = (await files(root)).filter(v => v !== "digests.json");
    if (JSON.stringify(actual) !== JSON.stringify(Object.keys(record.files).sort()))
        throw new Error(`Evidence inventory differs from digest index in ${root}`);
    for (const name of actual) {
        if (!/^[a-f0-9]{64}$/.test(record.files[name]))
            throw new Error(`Invalid digest for ${name}`);
        if (digest(new Uint8Array(await Bun.file(await inside(root, name)).arrayBuffer())) !== record.files[name])
            throw new Error(`Evidence changed: ${name}`);
    }
    for (const ledger of ["evidence.jsonl", "loop.jsonl"]) {
        if (!actual.includes(ledger))
            continue;
        let previous = "0".repeat(64);
        for (const line of (await Bun.file(join(root, ledger)).text()).split("\n").filter(Boolean)) {
            const event = JSON.parse(line);
            if (event.prev_hash !== previous)
                throw new Error(`Broken event chain in ${ledger}`);
            previous = digest(line);
        }
    }
    if (actual.includes("ledger.jsonl")) {
        let previous = "0".repeat(64);
        for (const line of (await Bun.file(join(root, "ledger.jsonl")).text()).split("\n").filter(Boolean)) {
            const { hash, ...event } = JSON.parse(line);
            if (event.prev_hash !== previous || hash !== digest(JSON.stringify(event)))
                throw new Error("Broken delivery event chain in ledger.jsonl");
            previous = hash;
        }
    }
    if (actual.includes("portable-projection.json")) {
        const projection = await json(join(root, "portable-projection.json")), original = await json(join(root, "original-digests.json"));
        if (projection.source_digest_index_sha256 !== digest(new Uint8Array(await Bun.file(join(root, "original-digests.json")).arrayBuffer())))
            throw new Error("Portable projection lost its original digest inventory");
        for (const [path, hash] of Object.entries(original.files)) {
            if (projection.omitted.includes(path))
                continue;
            if (record.files[path] !== hash)
                throw new Error(`Portable projection changed a non-omitted file: ${path}`);
        }
    }
    return actual.length;
}
export async function copyBundle(source: string, target: string): Promise<void> {
    await checkSeal(source);
    await mkdir(target, { recursive: true });
    const inventory = await files(source), omitted = inventory.filter(name => /^(?:prove\/)?gates\/[^/]+\/(?:attempts\/[^/]+\/)?(?:artifacts\/|artifacts\.json$)/.test(name));
    for (const name of inventory) {
        if (omitted.includes(name))
            continue;
        const destination = await inside(target, name);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, new Uint8Array(await Bun.file(await inside(source, name)).arrayBuffer()), { mode: 0o600, flag: "wx" });
    }
    if (omitted.length) {
        const original = new Uint8Array(await Bun.file(join(source, "digests.json")).arrayBuffer());
        await writeFile(join(target, "original-digests.json"), original, { mode: 0o600, flag: "wx" });
        await put(join(target, "portable-projection.json"), { schema_version: "wringer.native.portable-projection.v1", source_digest_index_sha256: digest(original), omitted, reason: "Opt-in gate display artifacts remain local and are not transmitted by delivery." });
        await seal(target);
    }
}
export async function git(repo: string, args: string[], options: {
    input?: string | Uint8Array;
    env?: Record<string, string | undefined>;
    allowFailure?: boolean;
    raw?: boolean;
    timeout?: number;
} = {}): Promise<string> {
    const result = await runProcess(["git", "-c", "core.quotePath=false", ...args], { cwd: repo, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...options.env }, input: options.input, timeout: options.timeout ?? 60, maxBytes: 64 * 1024 * 1024, redactor: new Redactor([], {}, [], false) });
    if (result.stdout_truncated || result.stderr_truncated || result.timed_out)
        throw new Refusal(`git ${args[0]} exceeded its bounded capture or time limit; no partial output was accepted.`, `git -C ${quote(repo)} status`);
    if (result.exit_code && !options.allowFailure)
        throw new Refusal(`git ${args[0]} failed (${result.exit_code}): ${new Redactor().scrub(result.stderr.trim())}`, `git -C ${quote(repo)} status`);
    return result.exit_code ? "" : options.raw ? result.stdout : result.stdout.trimEnd();
}
export async function gitBytes(repo: string, args: string[]): Promise<Uint8Array> { const result = await promisify(execFile)("git", ["-C", repo, ...args], { encoding: "buffer", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }); return new Uint8Array(result.stdout); }
export async function record(path: string, version?: string): Promise<any> {
    const reader = await openReader(schemaDirectory());
    const result = await reader.read(path, version);
    if (!result.ok)
        throw new Error(`${path}: ${result.reason}: ${result.said}`);
    return result.value;
}
