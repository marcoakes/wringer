import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const privateRoots = new Set([".wringer", ".git", ".codex", ".agents", ".claude", ".ssh", ".aws", ".azure", ".kube", ".gnupg", ".config", "node_modules", "dist"]);
const privatePart = (part: string) => privateRoots.has(part) || part === ".env" || part.startsWith(".env.");
const privatePath = (path: string) => path.split("/").some(privatePart);
const seeds = ["ASSISTANT_START.md", "README.md", "docs/ASSISTANT_SECURITY.md", "docs/ASSISTANT_COMPATIBILITY.md", "docs/PM_ASSISTANT_BLIND_TEST.md"];
const digest = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const unix = (path: string) => path.split(sep).join("/");
const encoded = (path: string) => unix(path).split("/").map(encodeURIComponent).join("/");
const passiveExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".ico", ".pdf", ".csv", ".log", ".diff", ".patch"]);
/** Reference source must not become an executable module, auto-discovered test
 * or an active package/tool configuration in the compiled distribution. */
export function distributionReferencePath(path: string) {
    const name = basename(path).toLowerCase();
    return passiveExtensions.has(extname(path).toLowerCase()) && !/^(?:package|tsconfig(?:\.[^.]*)?|jsconfig(?:\.[^.]*)?|deno)\.json$/.test(name) ? path : `${path}.txt`;
}
interface Pointer { start: number; end: number; href: string; hrefStart: number; label: string; kind: "markdown" | "html"; original: string; }
interface Omission { page: string; target: string; reason: "private-local-evidence-not-distributed"; }
export interface DistributionDocsManifest {
    schema_version: "wringer.distribution-docs.v1";
    entrypoints: string[];
    files: { path: string; sha256: string; sourcePath?: string }[];
    redirects: { path: string; target: string }[];
    omissions: Omission[];
    note: string;
}

/** Bounded documentation syntax, not an HTML browser or executable parser.
 * Skip fenced code: sample Markdown/HTML is data rather than a live link. */
function pointers(text: string): Pointer[] {
    const blocks: { start: number; end: number }[] = [];
    const fence = /^\s*(`{3,}|~{3,})[^\n]*\n/gm;
    let opening: RegExpExecArray | null;
    while ((opening = fence.exec(text))) {
        const marker = opening[1]!, end = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`, "gm");
        end.lastIndex = fence.lastIndex;
        const close = end.exec(text);
        const stop = close ? end.lastIndex : text.length;
        blocks.push({ start: opening.index, end: stop }); fence.lastIndex = stop;
    }
    const active = (index: number) => !blocks.some(block => index >= block.start && index < block.end);
    const result: Pointer[] = [];
    for (const match of text.matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/g)) {
        if (!active(match.index!)) continue;
        const inside = match[2]!.trim();
        const target = inside.startsWith("<") ? /^<([^>]+)>/.exec(inside)?.[1] : /^(\S+?)(?:\s+["'][\s\S]*["'])?$/.exec(inside)?.[1];
        if (!target) throw new Error("Unsupported documentation link syntax; use a URL-encoded or angle-bracket path");
        result.push({ start: match.index!, end: match.index! + match[0].length, href: target, hrefStart: match[0].indexOf("](") + 2 + match[2]!.indexOf(target), label: match[1]!, kind: "markdown", original: match[0] });
    }
    for (const match of text.matchAll(/<(?:img|source|video|audio)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)) {
        if (active(match.index!)) result.push({ start: match.index!, end: match.index! + match[0].length, href: match[2]!, hrefStart: match[0].indexOf(match[2]!, match[0].search(/\bsrc\s*=/i)), label: "Referenced media", kind: "html", original: match[0] });
    }
    return result.sort((a, b) => a.start - b.start);
}

function resolvePointer(page: string, href: string): { path: string; suffix: string } | null {
    if (/^(?:https?:|mailto:)/i.test(href) || href.startsWith("#")) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) throw new Error(`Unsupported documentation URL in ${page}`);
    const split = href.search(/[?#]/), rawPath = split < 0 ? href : href.slice(0, split), suffix = split < 0 ? "" : href.slice(split);
    let decoded: string;
    try { decoded = decodeURIComponent(rawPath); decodeURIComponent(suffix); }
    catch { throw new Error(`Malformed encoded documentation link in ${page}`); }
    if (!decoded || /[\0\\]/.test(decoded)) throw new Error(`Unsafe documentation path in ${page}`);
    if (isAbsolute(decoded)) {
        // Historical reports can name an operator's private absolute capture.
        // Never open it, and do not carry the workstation/user prefix onward.
        const parts = unix(decoded).split("/"), privateIndex = parts.findIndex(privatePart);
        if (privateIndex >= 0) return { path: parts.slice(privateIndex).join("/"), suffix };
        throw new Error(`Unsafe documentation path in ${page}`);
    }
    const absolute = resolve("/wringer-doc-root", dirname(page), decoded), path = unix(relative("/wringer-doc-root", absolute));
    if (!path || path === ".." || path.startsWith("../")) throw new Error(`Documentation link escapes its source root: ${page}`);
    return { path, suffix };
}

async function safePath(root: string, path: string, missing = false): Promise<string> {
    if (isAbsolute(path) || path.split(/[\\/]/).some(part => part === "..") || path.includes("\0")) throw new Error("Unsafe distribution documentation path");
    let cursor = root;
    for (const part of path.split("/")) {
        cursor = join(cursor, part);
        try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Documentation must not traverse a symlink: ${path}`); }
        catch (error: any) { if (!(missing && error.code === "ENOENT")) throw error; }
    }
    return cursor;
}

async function rootDirectory(path: string, create: boolean) {
    const absolute = resolve(path);
    // Inspect before recursive mkdir so an existing symlink cannot redirect it.
    let cursor = isAbsolute(absolute) ? sep : "";
    for (const part of absolute.split(sep).filter(Boolean)) {
        cursor = join(cursor, part);
        try {
            const info = await lstat(cursor);
            // System aliases such as /tmp are permitted only above the selected
            // root. All paths inside that canonical root are checked separately.
            if (cursor === absolute && (info.isSymbolicLink() || !info.isDirectory())) throw new Error("Documentation root must be a real directory");
        } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    if (create) await mkdir(absolute, { recursive: true });
    return realpath(absolute);
}

/** Copy public documentation's relative-link closure. Local runtime captures
 * become named omissions; they are never opened or accidentally shipped. */
export async function copyDistributionDocs(sourceDirectory: string, outputDirectory: string, options: { entrypoints?: string[]; nativeGuides?: string[] } = {}): Promise<DistributionDocsManifest> {
    const source = await rootDirectory(sourceDirectory, false), output = await rootDirectory(outputDirectory, true);
    const sourceWithinOutput = relative(output, source);
    if (source === output || sourceWithinOutput !== ".." && !sourceWithinOutput.startsWith(`..${sep}`) && !isAbsolute(sourceWithinOutput)) throw new Error("Distribution output must not equal or contain its source checkout");
    const native = options.nativeGuides ?? (await readdir(await safePath(source, "docs/native"))).filter(name => name.endsWith(".md")).map(name => `docs/native/${name}`);
    const entrypoints = options.entrypoints ?? seeds, queue = [...entrypoints, ...native], seen = new Set<string>(), omissions: Omission[] = [];
    const files = new Map<string, { sha256: string; sourcePath?: string }>();
    // Incremental builds may contain executable reference copies emitted by an
    // earlier builder. Remove only exact, unchanged, manifest-owned copies that
    // now move to inert names. Never infer ownership from a filename or glob.
    let previous: DistributionDocsManifest | undefined;
    const retiring: { path: string; sha256: string }[] = [];
    try { previous = JSON.parse(await readFile(await safePath(output, "DOCUMENTATION.json"), "utf8")); }
    catch (error: any) { if (error.code !== "ENOENT") throw error; }
    if (previous) {
        if (previous.schema_version !== "wringer.distribution-docs.v1" || !Array.isArray(previous.files) || previous.files.length > 1024) throw new Error("Previous documentation inventory is invalid; no generated reference was removed");
        for (const file of previous.files) {
            if (typeof file.path !== "string" || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("Previous documentation inventory is unreadable");
            if (distributionReferencePath(file.path) === file.path) continue;
            if (privatePath(file.path)) throw new Error("Private files cannot be removed through a documentation inventory");
            const old = await safePath(output, file.path, true);
            try {
                const info = await lstat(old);
                if (!info.isFile() || info.nlink !== 1 || info.size > 10 * 1024 * 1024 || digest(await readFile(old)) !== file.sha256) throw new Error(`Previously generated reference changed; preserve and inspect it: ${file.path}`);
                retiring.push({ path: file.path, sha256: file.sha256 });
            } catch (error: any) { if (error.code !== "ENOENT") throw error; } // A prior interrupted migration may already have removed it.
        }
    }
    let bytes = 0;
    async function write(path: string, content: string | Buffer, sourcePath?: string) {
        const destination = await safePath(output, path, true);
        await mkdir(dirname(destination), { recursive: true }); await safePath(output, path, true);
        await writeFile(destination, content);
        files.set(path, { sha256: digest(content), ...(sourcePath ? { sourcePath } : {}) });
    }
    while (queue.length) {
        const path = queue.shift()!;
        if (seen.has(path)) continue;
        if (seen.size >= 512) throw new Error("Documentation closure exceeds its file bound");
        if (privatePath(path)) throw new Error("A private directory cannot be a documentation entry point");
        seen.add(path);
        const input = await safePath(source, path), info = await lstat(input);
        if (!info.isFile() || info.size > 10 * 1024 * 1024 || (bytes += info.size) > 32 * 1024 * 1024) throw new Error(`Documentation asset exceeds its file/size bound: ${path}`);
        const content = await readFile(input);
        const packagedPath = distributionReferencePath(path);
        if (extname(path).toLowerCase() !== ".md") { await write(packagedPath, content, path); continue; }
        const text = content.toString("utf8"), replacements: { start: number; end: number; value: string }[] = [];
        for (const pointer of pointers(text)) {
            const resolved = resolvePointer(path, pointer.href);
            if (!resolved) continue;
            if (privatePath(resolved.path)) {
                omissions.push({ page: path, target: resolved.path, reason: "private-local-evidence-not-distributed" });
                const label = `${pointer.label} (local evidence not included in this distribution: ${resolved.path})`;
                replacements.push({ start: pointer.start, end: pointer.end, value: pointer.kind === "html" ? label.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") : label });
                continue;
            }
            await safePath(source, resolved.path); // Ordinary missing public targets fail before publication.
            queue.push(resolved.path);
            const next = encoded(relative(dirname(packagedPath), distributionReferencePath(resolved.path))) + resolved.suffix;
            replacements.push({ start: pointer.start, end: pointer.end, value: pointer.original.slice(0, pointer.hrefStart) + next + pointer.original.slice(pointer.hrefStart + pointer.href.length) });
        }
        let rendered = text;
        for (const change of replacements.reverse()) rendered = rendered.slice(0, change.start) + change.value + rendered.slice(change.end);
        const guide = encoded(relative(dirname(path), "DOCS.md"));
        await write(packagedPath, `> Packaged reference copy. Source-build commands run from the full Git checkout, not this distribution. [Documentation scope](${guide}).\n\n${rendered}`, path);
    }
    const redirects = native.map(path => ({ path: `docs/${path.slice("docs/native/".length)}`, target: path }));
    for (const redirect of redirects) {
        if (seen.has(redirect.path)) throw new Error("Legacy documentation redirect conflicts with a source page");
        const target = encoded(relative(dirname(redirect.path), redirect.target));
        await write(redirect.path, `# Guide location\n\n[Open the current guide](${target}). This compatibility pointer preserves the old installed path; the guide is maintained only once.\n`);
    }
    const starts = entrypoints.map(path => `[${path}](${encoded(distributionReferencePath(path))})`).join(" · ");
    await write("DOCS.md", `# Distribution documentation\n\nThese are reference copies from the build's source checkout, not a complete development checkout. Build/install commands must run at the original full Wringer Git repository root, not here or inside a target repository. Keep the compiled distribution together.\n\n${starts}\n\nPublic relative links and media are carried with their source-relative paths. Source code, tests, scripts and active configuration references receive a .txt suffix so they cannot become runnable modules, discovered tests or package configuration here; their original sourcePath is recorded in DOCUMENTATION.json. YAML plan templates and passive evidence retain their formats. Historical links into private runtime captures are explicitly marked as not included; their contents are never copied. This does not turn missing historical evidence into a pass.\n`);
    const manifest: DistributionDocsManifest = { schema_version: "wringer.distribution-docs.v1", entrypoints, files: [...files].map(([path, metadata]) => ({ path, ...metadata })).sort((a, b) => a.path.localeCompare(b.path)), redirects, omissions, note: "Reference documentation and inert linked public files, not a full source checkout or a copy of local runtime evidence." };
    await validateDistributionDocs(output, manifest);
    // The complete replacement closure validates before old executable copies
    // are removed. Recheck ownership; a changed or unrecorded file is not ours.
    for (const old of retiring) {
        const path = await safePath(output, old.path, true);
        try {
            const info = await lstat(path);
            if (!info.isFile() || info.nlink !== 1 || info.size > 10 * 1024 * 1024 || digest(await readFile(path)) !== old.sha256) throw new Error(`Previously generated reference changed; preserve and inspect it: ${old.path}`);
            await unlink(path);
        } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
    await writeFile(await safePath(output, "DOCUMENTATION.json", true), JSON.stringify(manifest, null, 2) + "\n");
    return manifest;
}

export async function validateDistributionDocs(outputDirectory: string, supplied?: DistributionDocsManifest) {
    const output = await rootDirectory(outputDirectory, false);
    const manifest = supplied ?? JSON.parse(await readFile(await safePath(output, "DOCUMENTATION.json"), "utf8")) as DistributionDocsManifest;
    if (manifest.schema_version !== "wringer.distribution-docs.v1" || !Array.isArray(manifest.files) || manifest.files.length > 1024) throw new Error("Invalid documentation inventory");
    const declared = new Set(manifest.files.map(file => file.path));
    let count = 0;
    for (const file of manifest.files) {
        const path = await safePath(output, file.path), data = await readFile(path);
        if (digest(data) !== file.sha256) throw new Error(`Packaged documentation digest changed: ${file.path}`);
        if (extname(file.path).toLowerCase() !== ".md") continue;
        for (const pointer of pointers(data.toString("utf8"))) {
            const target = resolvePointer(file.path, pointer.href);
            if (!target) continue;
            if (!declared.has(target.path)) throw new Error(`Packaged documentation points outside its inventory: ${file.path} -> ${target.path}`);
            const resolved = await safePath(output, target.path);
            if (!(await lstat(resolved)).isFile()) throw new Error("Packaged documentation link is not a file");
            count++;
        }
    }
    return { files: manifest.files.length, links: count, namedOmissions: manifest.omissions.length };
}
