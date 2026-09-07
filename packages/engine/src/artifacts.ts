import { readFile, readdir, lstat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Bundle, sha256 } from "./io";
import type { Gate } from "./types";
const TYPES: Record<string, [
    string,
    boolean
]> = { ".png": ["image/png", false], ".jpg": ["image/jpeg", false], ".jpeg": ["image/jpeg", false], ".gif": ["image/gif", false], ".webp": ["image/webp", false], ".pdf": ["application/pdf", false], ".svg": ["image/svg+xml", true], ".txt": ["text/plain", true], ".log": ["text/plain", true], ".md": ["text/markdown", true], ".json": ["application/json", true], ".csv": ["text/csv", true], ".html": ["text/html", true] };
export async function captureArtifacts(staging: string, gate: Gate, bundle: Bundle, dir: string) {
    const artifacts: any[] = [], omitted: any[] = [];
    let total = 0;
    async function visit(folder: string, prefix = "") {
        for (const e of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
            const original = prefix + e.name, name = bundle.redactor.scrub(original), path = join(folder, e.name);
            if (e.isSymbolicLink()) {
                omitted.push({ name, reason: "unreadable" });
                continue;
            }
            if (e.isDirectory()) {
                await visit(path, original + "/");
                continue;
            }
            if (!e.isFile()) {
                omitted.push({ name, reason: "unreadable" });
                continue;
            }
            try {
                const stat = await lstat(path);
                const type = TYPES[extname(name).toLowerCase()];
                if (!type) {
                    omitted.push({ name, reason: "unknown_type" });
                    continue;
                }
                if (stat.size > gate.artifacts!.max_bytes) {
                    omitted.push({ name, reason: "too_large", bytes: stat.size });
                    continue;
                }
                let bytes = await readFile(path), redacted = false;
                if (type[1]) {
                    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
                    bytes = Buffer.from(bundle.redactor.scrub(text));
                    redacted = true;
                }
                if (bytes.length > gate.artifacts!.max_bytes) {
                    omitted.push({ name, reason: "too_large", bytes: bytes.length });
                    continue;
                }
                if (total + bytes.length > gate.artifacts!.total_bytes) {
                    omitted.push({ name, reason: "total_exceeded", bytes: bytes.length });
                    continue;
                }
                total += bytes.length;
                await bundle.binary(`${dir}/artifacts/${name}`, bytes);
                artifacts.push({ name, bytes: bytes.length, sha256: sha256(bytes), media_type: type[0], redacted });
            }
            catch {
                omitted.push({ name, reason: "unreadable" });
            }
        }
    }
    await visit(staging);
    await bundle.json(`${dir}/artifacts.json`, { schema_version: "wringer.gate-artifacts.v1", gate: gate.id, artifacts, omitted, limits: ["Artifacts record bytes and media types, not what the artifacts demonstrate. Binary artifacts cannot be redacted and are explicitly marked redacted:false.", "Gate artifacts remain local and must not be transmitted by delivery by default."] });
}
