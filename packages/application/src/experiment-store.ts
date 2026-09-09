import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, readdir, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { hashValue } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { locked } from "../../workflow/src/storage";

export const ZERO = "0".repeat(64);
export function boundedText(value: unknown, label: string, max = 4000): asserts value is string {
    if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value) > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${label} must be bounded plain text`);
}
export function id(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(value)) throw new Error("Use a short lowercase record identity"); }
export function hash(value: unknown): asserts value is string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("An exact SHA-256 identity is required"); }
export function integer(value: unknown, label: string, min: number, max: number): asserts value is number { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new Error(`${label} must be between ${min} and ${max}`); }
export function shape(value: unknown, fields: string[], label: string): asserts value is Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) throw new Error(`${label} contains unsupported fields`); }
export function clean<T>(value: T): T {
    const wire = JSON.stringify(value);
    if (Buffer.byteLength(wire) > 16 * 1024 * 1024 || new Redactor(undefined, {}).scrub(wire) !== wire) throw new Error("Research input is oversized or contains a detected credential. Supply sanitised repository-scoped records, never credentials.");
    return value;
}
export function stamped<T extends object>(value: T): T & { sha256: string } { clean(value); return { ...value, sha256: hashValue(value) }; }
export function verifyStamp<T extends { sha256: string }>(value: T): T {
    if (!value || typeof value !== "object") throw new Error("Missing identity-bound research record");
    const { sha256, ...data } = value; hash(sha256);
    if (hashValue(data) !== sha256) throw new Error("Research record identity changed; no effect or promotion is authorised");
    return clean(value);
}
export async function experimentPath(root: string, path = "."): Promise<string> {
    root = await realpath(root);
    const target = resolve(root, path), rel = relative(root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw new Error("Research path escapes its private controller");
    let part = root;
    for (const piece of rel ? rel.split(sep) : []) {
        part = join(part, piece);
        try { if ((await lstat(part)).isSymbolicLink()) throw new Error("Research records and paths cannot be symbolic links"); }
        catch (e: any) { if (e.code !== "ENOENT") throw e; }
    }
    return target;
}
export async function privateExperimentRoot(root: string): Promise<string> {
    const selected = resolve(root), info = await lstat(selected);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error("Experiments require an existing operator-owned private 0700 directory, outside Git and production controllers");
    const actual = await realpath(selected);
    for (let current = actual; ; current = dirname(current)) {
        for (const marker of [".git", ".wringer/contained", "assistant-config.json"]) {
            try { await lstat(join(current, marker)); throw new Error("An experiment must use a separate private directory outside Git and production controllers"); }
            catch (e: any) { if (e.code !== "ENOENT") throw e; }
        }
        if (current === dirname(current)) break;
    }
    return actual;
}
export async function readExperimentJson<T>(path: string, max = 16 * 1024 * 1024): Promise<T> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const stat = await file.stat(); if (!stat.isFile() || stat.size < 2 || stat.size > max) throw new Error("Research record is not a bounded regular file");
        const bytes = Buffer.alloc(stat.size + 1); let length = 0;
        while (length < bytes.length) { const result = await file.read(bytes, length, bytes.length - length, null); if (!result.bytesRead) break; length += result.bytesRead; }
        if (length !== stat.size) throw new Error("Research record changed during its bounded read");
        // Reject duplicate JSON keys through the existing inert YAML parser's JSON path.
        const { parseYaml } = await import("@wringer/engine");
        return parseYaml(bytes.subarray(0, length).toString("utf8"), "research record") as T;
    } finally { await file.close(); }
}
export async function optionalJson<T>(root: string, path: string): Promise<T | null> {
    try { return await readExperimentJson<T>(await experimentPath(root, path)); }
    catch (e: any) { if (e.code === "ENOENT") return null; throw e; }
}
export async function exclusiveJson(root: string, path: string, value: unknown): Promise<void> {
    clean(value); const output = await experimentPath(root, path), parent = dirname(output);
    await mkdir(parent, { recursive: true, mode: 0o700 }); await experimentPath(root, path);
    const file = await open(output, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(value, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
}
export async function atomicJson(root: string, path: string, value: unknown): Promise<void> {
    clean(value); const name = `pending-${randomUUID()}.json`, output = await experimentPath(root, path), temporary = await experimentPath(root, name);
    await exclusiveJson(root, name, value);
    try { await mkdir(dirname(output), { recursive: true, mode: 0o700 }); await experimentPath(root, path); await rename(temporary, output); }
    finally { await unlink(temporary).catch((e: any) => { if (e.code !== "ENOENT") throw e; }); }
}
export async function records<T extends { sha256: string }>(root: string, directory: string, max: number): Promise<T[]> {
    let names: string[];
    try { names = await readdir(await experimentPath(root, directory)); } catch (e: any) { if (e.code === "ENOENT") return []; throw e; }
    if (names.length > max || names.some(name => !/^[a-z0-9-]+\.json$/.test(name))) throw new Error("Unexpected or excessive files in the authoritative research namespace");
    return Promise.all(names.sort().map(async name => verifyStamp(await readExperimentJson<T>(await experimentPath(root, `${directory}/${name}`)))));
}
export async function experimentLock<T>(root: string, task: () => Promise<T>): Promise<T> { return locked(await privateExperimentRoot(root), "experiment", task); }
