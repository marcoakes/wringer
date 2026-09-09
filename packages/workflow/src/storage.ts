import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, realpath, lstat, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { parseYaml, Redactor } from "@wringer/engine";
import type { StopRecord } from "./types";
export const WORKFLOW_DIR = ".wringer/workflow";
export const SPEC_PATH = "wringer.spec.yaml";
export const PLAN_PATH = `${WORKFLOW_DIR}/plan.json`;
export const SOURCE_PATH = `${WORKFLOW_DIR}/source.md`;
export const now = () => new Date().toISOString();
export function stable(value: unknown): string {
    if (Array.isArray(value))
        return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
    return JSON.stringify(value);
}
export const digest = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : stable(value)).digest("hex");
export const quoteShell = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
export function command(repo: string, verb: string) { return `cd ${quoteShell(resolve(repo))} && ${verb}`; }
const secretScope = new AsyncLocalStorage<string[]>();
export function withSecrets<T>(values: (string | undefined)[], task: () => Promise<T>): Promise<T> {
    return secretScope.run([...new Set([...(secretScope.getStore() ?? []), ...values.filter((v): v is string => !!v)])], task);
}
export function scrub(text: string): string {
    return new Redactor(undefined, process.env, secretScope.getStore() ?? []).scrub(text);
}
export function scrubValue<T>(value: T): T { return JSON.parse(scrub(JSON.stringify(value))) as T; }
export async function safePath(repo: string, target: string): Promise<string> {
    const root = await realpath(repo);
    const candidate = resolve(root, target);
    if (candidate !== root && !candidate.startsWith(root + sep))
        throw new Error(`Path escapes repository: ${target}`);
    let current = candidate;
    for (;;) {
        try {
            const existing = await realpath(current);
            if (existing !== root && !existing.startsWith(root + sep))
                throw new Error(`Path follows a symlink outside repository: ${target}`);
            break;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            if (current === root)
                throw error;
            current = dirname(current);
        }
    }
    return candidate;
}
export async function atomicWrite(repo: string, target: string, content: string) {
    const path = await safePath(repo, target);
    await mkdir(dirname(path), { recursive: true });
    // Readers validate authoritative directory contents, not just JSON bytes.
    // Stage outside those namespaces so a concurrent read sees only complete records.
    const staging = await safePath(repo, ".wringer/write-pending");
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const stat = await lstat(staging);
    if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Atomic write staging must be a real directory");
    const temp = join(staging, `${randomUUID()}.tmp`);
    const handle = await open(temp, "wx", 0o600);
    try {
        try { await handle.writeFile(scrub(content)); }
        finally { await handle.close(); }
        await rename(temp, path);
    }
    finally {
        await unlink(temp).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
        });
    }
}
export const writeJson = (repo: string, path: string, value: unknown) => atomicWrite(repo, path, JSON.stringify(value, null, 2) + "\n");
export async function readJson<T>(repo: string, path: string): Promise<T | null> {
    try {
        return JSON.parse(await readFile(await safePath(repo, path), "utf8")) as T;
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return null;
        throw new Error(`Unreadable record ${path}: ${(error as Error).message}`);
    }
}
export async function readText(repo: string, path: string): Promise<string | null> {
    try {
        return await readFile(await safePath(repo, path), "utf8");
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return null;
        throw error;
    }
}
export async function immutableJson(repo: string, path: string, value: unknown) {
    const prior = await readJson<unknown>(repo, path);
    if (prior !== null) {
        if (stable(prior) !== stable(value))
            throw new Error(`Immutable record changed: ${path}`);
        return;
    }
    await atomicWrite(repo, path, JSON.stringify(value, null, 2) + "\n");
}
export async function exists(repo: string, path: string) { return (await readText(repo, path)) !== null; }
export async function listDirectories(repo: string, path: string): Promise<string[]> {
    try {
        return (await readdir(await safePath(repo, path), { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return [];
        throw error;
    }
}
export class WorkflowError extends Error {
    constructor(public readonly stop: StopRecord) { super(stop.message); this.name = "WorkflowError"; }
}
export async function stop(repo: string, reason: string, message: string, next: string, details?: unknown): Promise<never> {
    const record: StopRecord = {
        schema_version: "wringer.workflow-stop.v1", at: now(), reason, message: scrub(message),
        cwd: resolve(repo), next_move: command(repo, next),
        preserved: [SOURCE_PATH, PLAN_PATH, `${WORKFLOW_DIR}/drafts`, `${WORKFLOW_DIR}/requirements`],
        ...(details === undefined ? {} : { details: JSON.parse(scrub(JSON.stringify(details))) }),
    };
    await writeJson(repo, `${WORKFLOW_DIR}/stop.json`, record);
    throw new WorkflowError(record);
}
export async function locked<T>(repo: string, name: string, task: () => Promise<T>): Promise<T> {
    if (!/^[a-z][a-z0-9-]*$/.test(name))
        throw new Error("Invalid workflow lock name");
    const path = await safePath(repo, `${WORKFLOW_DIR}/${name}.lock`);
    await mkdir(dirname(path), { recursive: true });
    let handle: Awaited<ReturnType<typeof import("node:fs/promises").open>>;
    const { open, unlink } = await import("node:fs/promises");
    const owner = { pid: process.pid, token: randomUUID(), started_at: now() };
    const alive = (pid: number) => {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH")
                return false;
            return true;
        }
    };
    const readOwner = async (target: string) => {
        const stat = await lstat(target);
        if (!stat.isFile() || stat.size > 4096)
            throw new Error("Lock is not a bounded regular file");
        const text = await readFile(target, "utf8");
        const data = JSON.parse(text);
        if (!Number.isSafeInteger(data.pid) || data.pid < 1 || !Number.isFinite(Date.parse(data.started_at)))
            throw new Error("Lock has no valid recorded process owner");
        return { stat, text, data };
    };
    try {
        handle = await open(path, "wx", 0o600);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST")
            throw error;
        let prior;
        try {
            prior = await readOwner(path);
        }
        catch (error) {
            return stop(repo, "workflow-lock-unreadable", `Cannot establish ownership of ${relative(repo, path)}: ${(error as Error).message}. No lock was removed.`, "wring explain");
        }
        // A reused PID is deliberately treated as live: absence can be proved,
        // identity cannot safely be guessed from a timestamp in a file.
        if (alive(prior.data.pid))
            return stop(repo, "workflow-busy", `A live process (${prior.data.pid}) holds ${relative(repo, path)}. No lock was removed.`, "wring explain");
        const recoveryPath = `${path}.recovery`;
        let recovery: Awaited<ReturnType<typeof open>>;
        try {
            recovery = await open(recoveryPath, "wx", 0o600);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                throw error;
            return stop(repo, "workflow-lock-recovery-busy", `A recovery guard already exists at ${relative(repo, recoveryPath)}. No owner was guessed and no lock was removed.`, "wring explain");
        }
        try {
            await recovery.writeFile(JSON.stringify(owner));
            const current = await readOwner(path);
            if (current.text !== prior.text || current.stat.ino !== prior.stat.ino || alive(current.data.pid))
                return stop(repo, "workflow-lock-owner-changed", "The lock owner changed during recovery. No lock was removed.", "wringer-drive resume");
            await writeJson(repo, `${WORKFLOW_DIR}/lock-recoveries/${owner.token}.json`, { schema_version: "wringer.workflow-lock-recovery.v1", at: now(), lock: relative(repo, path), previous_owner: current.data, evidence: "process-no-longer-exists", recovered_by: owner });
            await unlink(path);
            // Another entrant may win this open; EEXIST is a safe refusal and is
            // never followed by deletion of that entrant's lock.
            try {
                handle = await open(path, "wx", 0o600);
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                    throw error;
                return stop(repo, "workflow-busy", "Another workflow acquired the recovered lock first; nothing was replayed.", "wringer-drive resume");
            }
        }
        finally {
            await recovery.close();
            await unlink(recoveryPath);
        }
    }
    try {
        await handle.writeFile(JSON.stringify(owner));
        return await task();
    }
    finally {
        await handle.close();
        // Do not unlink a lock substituted by another actor while this task ran.
        const current = await readOwner(path).catch(() => null);
        if (current?.data.token === owner.token)
            await unlink(path);
    }
}
/** Read-only ownership observation. A retained phase alone never proves a live process. */
export async function workflowLockStatus(repo: string, name: string): Promise<"held" | "absent" | "stale" | "unknown"> {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Invalid workflow lock name");
    try {
        const path = await safePath(repo, `${WORKFLOW_DIR}/${name}.lock`), stat = await lstat(path);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return "unknown";
        const owner = JSON.parse(await readFile(path, "utf8"));
        if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 || !Number.isFinite(Date.parse(owner.started_at))) return "unknown";
        try { process.kill(owner.pid, 0); return "held"; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "stale" : "held"; }
    } catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unknown"; }
}
export function parseObject(text: string, label: string): Record<string, unknown> {
    const parsed: unknown = parseYaml(text, label);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error(`${label} must be an object`);
    return parsed as Record<string, unknown>;
}
export function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}
export function string(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${label} must be nonempty text`);
    return value;
}
export function array(value: unknown, label: string): unknown[] {
    if (!Array.isArray(value))
        throw new Error(`${label} must be an array`);
    return value;
}
export function bool(value: unknown, label: string, fallback: boolean): boolean {
    if (value === undefined)
        return fallback;
    if (typeof value !== "boolean")
        throw new Error(`${label} must be boolean`);
    return value;
}
export function slug(value: unknown, label: string): string {
    const v = string(value, label);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v))
        throw new Error(`${label} must be a slug of at most 64 characters`);
    return v;
}
export function knownKeys(value: Record<string, unknown>, allowed: string[], label: string) {
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new Error(`${label} has unknown field ${key}`);
}
export function unique<T>(values: T[], key: (v: T) => string, label: string): T[] {
    const seen = new Set<string>();
    for (const v of values) {
        const id = key(v);
        if (seen.has(id))
            throw new Error(`${label} contains duplicate ${id}`);
        seen.add(id);
    }
    return values;
}
