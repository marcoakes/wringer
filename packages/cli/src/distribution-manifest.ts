import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DISTRIBUTION } from "./routes";

export type DistributionFile = { path: string; kind: "file"; sha256: string; bytes: number; executable: boolean } | { path: string; kind: "symlink"; target: "wring" };
export interface ReleaseManifest {
    schema_version: "wringer.distribution.v1";
    version: string; runtime: string; platform: string; arch: string;
    source: { commit: string; dirty: boolean; contentSha256: string };
    repository: "https://github.com/marcoakes/wringer";
    files: DistributionFile[];
    routes: typeof DISTRIBUTION.aliases;
    optionalHelpers: typeof DISTRIBUTION.optionalHelpers;
    provenance: string;
}
export const distributionHash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hash = distributionHash;
export const distributionPath = (path: string) => typeof path === "string" && !!path && path.length <= 240 && !path.startsWith("/") && !path.includes("\\") && path.split("/").every(p => !!p && p !== "." && p !== ".." && !/[\x00-\x20\x7f:]/.test(p));
const safe = distributionPath;
export const RELEASE_REPOSITORY = "https://github.com/marcoakes/wringer" as const;
export const releaseVersion = (value: string) => typeof value === "string" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(value) && value.length <= 80;
function keys(value: any, required: string[]) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join() === required.sort().join(); }
export function parseDistributionManifest(bytes: Buffer): ReleaseManifest {
    if (bytes.length > 2 * 1024 * 1024) throw new Error("Distribution manifest exceeds its limit");
    const m = JSON.parse(bytes.toString());
    if (!keys(m, ["schema_version", "version", "runtime", "platform", "arch", "source", "repository", "files", "routes", "optionalHelpers", "provenance"]) || m.schema_version !== "wringer.distribution.v1" || !releaseVersion(m.version) || m.repository !== RELEASE_REPOSITORY || typeof m.runtime !== "string" || !["darwin-arm64", "linux-x64"].includes(`${m.platform}-${m.arch}`) || !keys(m.source, ["commit", "dirty", "contentSha256"]) || !/^[a-f0-9]{40}$/.test(m.source.commit) || typeof m.source.dirty !== "boolean" || !/^[a-f0-9]{64}$/.test(m.source.contentSha256) || typeof m.provenance !== "string" || !Array.isArray(m.files) || m.files.length > 4096 || JSON.stringify(m.routes) !== JSON.stringify(DISTRIBUTION.aliases) || JSON.stringify(m.optionalHelpers) !== JSON.stringify(DISTRIBUTION.optionalHelpers)) throw new Error("Invalid distribution manifest or repository provenance declaration");
    const names = new Set<string>();
    for (const f of m.files) {
        if (!safe(f.path) || f.path === "DISTRIBUTION.json" || names.has(f.path) || f.path.split("/").some((p: string) => ["AGENTS.md", "CLAUDE.md", ".wringer.yaml", ".mcp.json"].includes(p))) throw new Error("Unsafe or duplicate distribution path");
        names.add(f.path);
        if (f.kind === "symlink") {
            if (!keys(f, ["path", "kind", "target"]) || f.target !== "wring" || !DISTRIBUTION.aliases.some(row => row.alias === f.path)) throw new Error("Unexpected distribution link");
        } else if (f.kind !== "file" || !keys(f, ["path", "kind", "sha256", "bytes", "executable"]) || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > 256 * 1024 * 1024 || typeof f.executable !== "boolean") throw new Error("Invalid distribution file");
    }
    for (const path of names) { const parts = path.split("/"); while (parts.length > 1) { parts.pop(); if (names.has(parts.join("/"))) throw new Error("Distribution entry used as a parent"); } }
    for (const path of ["wring", "BUILD.json", "LICENSE", "USING_WRINGER.md", ...DISTRIBUTION.aliases.map(row => row.alias)]) if (!names.has(path)) throw new Error(`Required distribution entry absent: ${path}`);
    if (!m.files.some((f: DistributionFile) => f.path === "wring" && f.kind === "file" && f.executable)) throw new Error("Primary executable absent");
    return m;
}
export async function distributionFiles(root: string): Promise<DistributionFile[]> {
    const files: DistributionFile[] = [];
    async function walk(prefix: string) {
        for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
            const path = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (!safe(path) || ["AGENTS.md", "CLAUDE.md", ".wringer.yaml", ".mcp.json"].includes(entry.name)) throw new Error(`Active contributor/configuration file in distribution: ${path}`);
            if (path === "DISTRIBUTION.json") continue;
            if (entry.isDirectory()) { await walk(path); continue; }
            const info = await lstat(join(root, path));
            if (info.isSymbolicLink()) {
                if (!DISTRIBUTION.aliases.some(row => row.alias === path) || await readlink(join(root, path)) !== "wring") throw new Error(`Unexpected distribution link: ${path}`);
                files.push({ path, kind: "symlink", target: "wring" });
            } else if (info.isFile() && info.nlink === 1) {
                files.push({ path, kind: "file", sha256: hash(await readFile(join(root, path))), bytes: info.size, executable: !!(info.mode & 0o111) });
            } else throw new Error(`Unexpected distribution entry: ${path}`);
        }
    }
    await walk("");
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function writeDistributionManifest(root: string, identity: Pick<ReleaseManifest, "version" | "runtime" | "platform" | "arch" | "source">) {
    const manifest: ReleaseManifest = { schema_version: "wringer.distribution.v1", ...identity, repository: RELEASE_REPOSITORY, files: await distributionFiles(root), routes: DISTRIBUTION.aliases, optionalHelpers: DISTRIBUTION.optionalHelpers, provenance: "Local build inventory. Checksums establish integrity, not independent provenance or human approval." };
    parseDistributionManifest(Buffer.from(JSON.stringify(manifest)));
    await writeFile(join(root, "DISTRIBUTION.json"), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
}
export async function verifyDistributionManifest(root: string): Promise<ReleaseManifest> {
    const manifest = parseDistributionManifest(await readFile(join(root, "DISTRIBUTION.json")));
    if (manifest.schema_version !== "wringer.distribution.v1" || !Array.isArray(manifest.files) || manifest.files.length > 4096 || new Set(manifest.files.map(f => f.path)).size !== manifest.files.length || manifest.files.some(f => !safe(f.path))) throw new Error("Invalid distribution inventory");
    if (JSON.stringify(await distributionFiles(root)) !== JSON.stringify(manifest.files)) throw new Error("Distribution content differs from its exact manifest");
    for (const path of ["wring", "BUILD.json", "LICENSE", "USING_WRINGER.md", ...DISTRIBUTION.aliases.map(row => row.alias)])
        if (!manifest.files.some(f => f.path === path)) throw new Error(`Required distribution entry absent: ${path}`);
    return manifest;
}
