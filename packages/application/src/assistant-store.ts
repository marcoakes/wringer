import { lstat, mkdir, open, link, unlink, readFile, readdir, realpath } from "node:fs/promises";
import { dirname, join, resolve, relative, sep } from "node:path";
import { hashValue } from "@wringer/plan";

export const assistantId = (value: unknown): string => {
    if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) throw new Error("Use a service-issued handle");
    return value;
};
/** No caller-controlled filename is resolved without validating every component. */
export async function assistantPath(root: string, name: string): Promise<string> {
    const base = resolve(root), path = resolve(base, name), rel = relative(base, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || name.includes("\0")) throw new Error("Assistant record escapes its controller");
    let current: string = sep;
    for (const part of path.split(sep).filter(Boolean)) {
        current = join(current, part);
        try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Assistant records cannot traverse symlinks"); }
        catch (e: any) { if (e.code !== "ENOENT") throw e; }
    }
    return path;
}
export async function createAssistantDirectory(root: string) {
    const path = await assistantPath(root, ".");
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error("Controller must be an operator-owned private directory (mode 0700)");
    const parent = await open(dirname(path), "r"); try { await parent.sync(); } finally { await parent.close(); }
    return realpath(path);
}
export async function assistantExists(root: string, name: string): Promise<boolean> {
    const path = await assistantPath(root, name);
    return lstat(path).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e; });
}
export async function readAssistantRecord<T = any>(root: string, name: string): Promise<T> {
    const path = await assistantPath(root, name), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw new Error("Assistant record is not a bounded regular file");
    const value = JSON.parse(await readFile(path, "utf8")), { sha256, ...body } = value;
    if (sha256 !== hashValue(body)) throw new Error("Assistant record identity changed; dispatch is refused");
    return body as T;
}
/** Install once, fsync before acceptance; duplicate semantic data observes the same record. */
export async function writeAssistantRecord(root: string, name: string, value: object): Promise<void> {
    const path = await assistantPath(root, name);
    if (path === resolve(root)) throw new Error("A record must name a file inside its controller");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${crypto.randomUUID()}.pending`, file = await open(temp, "wx", 0o600);
    try { await file.writeFile(JSON.stringify({ ...value, sha256: hashValue(value) }, null, 2) + "\n"); await file.sync(); } finally { await file.close(); }
    try {
        try { await link(temp, path); }
        catch (e: any) { if (e.code !== "EEXIST") throw e; if (hashValue(await readAssistantRecord(root, name)) !== hashValue(value)) throw new Error("This identity already names different data"); }
        let directoryPath = dirname(path);
        while (true) {
            const directory = await open(directoryPath, "r"); try { await directory.sync(); } finally { await directory.close(); }
            if (directoryPath === resolve(root)) break;
            directoryPath = dirname(directoryPath);
        }
    } finally { await unlink(temp); }
}
export async function assistantInventory(root: string, name: string): Promise<string[]> {
    const path = await assistantPath(root, name);
    const names = await readdir(path).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return []; throw e; });
    if (names.length > 10000) throw new Error("Assistant inventory exceeds its bound");
    return names.sort();
}
