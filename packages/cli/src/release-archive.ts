import { gzipSync, gunzipSync } from "node:zlib";
import { mkdir, open, readFile, symlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { distributionHash, distributionPath, parseDistributionManifest, verifyDistributionManifest } from "./distribution-manifest";

const MAX_ARCHIVE = 256 * 1024 * 1024, MAX_UNPACKED = 768 * 1024 * 1024;
export interface ArchiveEntry { path: string; kind: "file" | "symlink"; mode: number; data: Buffer; target: string }
function textAt(block: Buffer, start: number, bytes: number) {
    const field = block.subarray(start, start + bytes), nul = field.indexOf(0), used = nul < 0 ? field : field.subarray(0, nul);
    if (nul >= 0 && field.subarray(nul).some(byte => byte !== 0) || used.some(byte => byte < 32 || byte > 126)) throw new Error("Noncanonical archive text");
    return used.toString("ascii");
}
function octal(block: Buffer, start: number, bytes: number) {
    const field = block.subarray(start, start + bytes).toString("ascii");
    if (!/^[0-7]+[\x00 ]*$/.test(field)) throw new Error("Invalid archive numeric field");
    const value = parseInt(field, 8); if (!Number.isSafeInteger(value)) throw new Error("Archive integer overflow"); return value;
}
/** Deliberately narrow POSIX ustar reader. No external extractor runs on data.
 * Extensions, hard links, devices, directories and duplicate entries refuse. */
export function readReleaseArchive(compressed: Buffer): ArchiveEntry[] {
    if (compressed.length > MAX_ARCHIVE) throw new Error("Compressed archive exceeds its limit");
    const tar = gunzipSync(compressed, { maxOutputLength: MAX_UNPACKED });
    if (tar.length % 512 || tar.length < 1024) throw new Error("Partial archive");
    const entries: ArchiveEntry[] = [], seen = new Set<string>(); let at = 0;
    while (at < tar.length) {
        const h = tar.subarray(at, at + 512);
        if (h.every(byte => byte === 0)) { if (tar.length - at < 1024 || tar.subarray(at).some(byte => byte !== 0)) throw new Error("Invalid archive terminator"); return entries; }
        if (entries.length >= 4097 || h.subarray(257, 263).toString() !== "ustar\0" || h.subarray(263, 265).toString() !== "00") throw new Error("Unsupported archive format or entry bound");
        const expected = octal(h, 148, 8), copy = Buffer.from(h); copy.fill(32, 148, 156);
        if (copy.reduce((a, b) => a + b, 0) !== expected) throw new Error("Archive header checksum differs");
        const name = textAt(h, 0, 100), prefix = textAt(h, 345, 155), path = prefix ? `${prefix}/${name}` : name;
        if (!distributionPath(path) || seen.has(path)) throw new Error("Unsafe or duplicate archive path");
        seen.add(path);
        const mode = octal(h, 100, 8), size = octal(h, 124, 12), type = h[156], target = textAt(h, 157, 100);
        if (mode & ~0o777 || ![0, 48, 50].includes(type!) || type === 50 && size !== 0 || type !== 50 && target !== "" || size > 256 * 1024 * 1024 || at + 512 + size > tar.length) throw new Error("Unsafe archive entry type, mode or size");
        const data = tar.subarray(at + 512, at + 512 + size), next = at + 512 + Math.ceil(size / 512) * 512;
        if (tar.subarray(at + 512 + size, next).some(byte => byte !== 0)) throw new Error("Nonzero archive padding");
        entries.push({ path, kind: type === 50 ? "symlink" : "file", mode, data, target }); at = next;
    }
    throw new Error("Missing archive terminator");
}
export function verifyReleaseArchive(bytes: Buffer, selection: { sha256: string; version: string; platform?: string }) {
    if (!/^[a-f0-9]{64}$/.test(selection.sha256) || distributionHash(bytes) !== selection.sha256) throw new Error("Archive SHA-256 differs from the selected digest");
    const entries = readReleaseArchive(bytes), record = entries.find(row => row.path === "DISTRIBUTION.json");
    if (!record || record.kind !== "file" || record.mode & 0o111) throw new Error("Missing regular archive manifest");
    const manifest = parseDistributionManifest(record.data);
    if (manifest.version !== selection.version || `${manifest.platform}-${manifest.arch}` !== (selection.platform ?? `${process.platform}-${process.arch}`)) throw new Error("Archive version/platform mismatch");
    if (entries.length !== manifest.files.length + 1) throw new Error("Archive inventory differs from manifest");
    for (const file of manifest.files) {
        const entry = entries.find(row => row.path === file.path);
        if (!entry || entry.kind !== file.kind || (file.kind === "file" ? distributionHash(entry.data) !== file.sha256 || entry.data.length !== file.bytes || !!(entry.mode & 0o111) !== file.executable : entry.target !== "wring")) throw new Error(`Archive content differs: ${file.path}`);
    }
    const build = JSON.parse(entries.find(row => row.path === "BUILD.json")!.data.toString());
    if (build.version !== manifest.version || build.platform !== manifest.platform || build.arch !== manifest.arch || build.python_runtime !== false) throw new Error("Build identity differs from archive manifest");
    return { manifest, manifestSha256: distributionHash(record.data), entries };
}
function numberAt(h: Buffer, offset: number, length: number, value: number) { h.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length, "ascii"); }
export function encodeReleaseArchive(entries: ArchiveEntry[]): Buffer {
    const chunks: Buffer[] = []; let bytes = 1024;
    for (const entry of entries) {
        if (!distributionPath(entry.path)) throw new Error("Unsafe archive path");
        const h = Buffer.alloc(512), split = entry.path.length > 100 ? entry.path.lastIndexOf("/") : -1;
        const prefix = split < 0 ? "" : entry.path.slice(0, split), name = split < 0 ? entry.path : entry.path.slice(split + 1);
        if (prefix.length > 155 || name.length > 100) throw new Error("Path exceeds ustar bounds");
        h.write(name, 0, 100, "ascii"); h.write(prefix, 345, 155, "ascii");
        numberAt(h, 100, 8, entry.mode); numberAt(h, 108, 8, 0); numberAt(h, 116, 8, 0); numberAt(h, 124, 12, entry.data.length); numberAt(h, 136, 12, 0);
        h.fill(32, 148, 156); h[156] = entry.kind === "symlink" ? 50 : 48; h.write(entry.target, 157, 100, "ascii"); h.write("ustar\0", 257); h.write("00", 263);
        const checksum = h.reduce((a, b) => a + b, 0); h.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148);
        const padding = Buffer.alloc((512 - entry.data.length % 512) % 512); chunks.push(h, entry.data, padding); bytes += 512 + entry.data.length + padding.length;
        if (bytes > MAX_UNPACKED) throw new Error("Archive exceeds expanded byte limit");
    }
    chunks.push(Buffer.alloc(1024)); const compressed = gzipSync(Buffer.concat(chunks), { level: 9 });
    if (compressed.length > MAX_ARCHIVE) throw new Error("Archive exceeds compressed byte limit"); return compressed;
}
export async function packageReleaseArchive(root: string) {
    const manifest = await verifyDistributionManifest(root), files: ArchiveEntry[] = [];
    for (const f of [{ path: "DISTRIBUTION.json", kind: "file", executable: false } as const, ...manifest.files]) files.push({ path: f.path, kind: f.kind, mode: f.kind === "symlink" ? 0o777 : f.executable ? 0o755 : 0o644, data: f.kind === "file" ? await readFile(join(root, f.path)) : Buffer.alloc(0), target: f.kind === "symlink" ? "wring" : "" });
    const bytes = encodeReleaseArchive(files); verifyReleaseArchive(bytes, { sha256: distributionHash(bytes), version: manifest.version, platform: `${manifest.platform}-${manifest.arch}` }); return bytes;
}
export async function extractReleaseArchive(directory: string, verified: ReturnType<typeof verifyReleaseArchive>) {
    // Caller allocates an empty, exclusively owned staging directory.
    for (const entry of verified.entries.filter(row => row.kind === "file")) {
        const path = join(directory, entry.path); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const file = await open(path, "wx", entry.mode & 0o111 ? 0o755 : 0o644);
        try { await file.writeFile(entry.data); await file.sync(); } finally { await file.close(); }
    }
    for (const entry of verified.entries.filter(row => row.kind === "symlink")) await symlink(entry.target, join(directory, entry.path));
    await verifyDistributionManifest(directory);
}
