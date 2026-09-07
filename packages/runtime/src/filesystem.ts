import { posix } from "node:path";
import { parseWritableDirectories, quote } from "./policy";
import { RuntimeError, type WorkerScope } from "./types";

const reserved = [".git", ".wringer", ".github", ".gitlab", ".codex", ".claude", ".agents", "AGENTS.md", "CLAUDE.md"];
function paths(value: unknown, label: string): string[] {
    if (!Array.isArray(value) || value.length > 256 || value.some(path => typeof path !== "string" || !path || path.length > 512 || path.startsWith("/") || /[\\\x00-\x1f\x7f:*?\[\]]/.test(path) || path !== "." && path.split("/").some((part: string) => !part || part === "." || part === "..")))
        throw new RuntimeError(`${label} must be bounded exact repository-relative paths`, "worker-scope-invalid");
    return [...new Set(value)].sort();
}
export function parseWorkerScope(value: unknown): WorkerScope {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["writable", "protected", "writableDirectories"].includes(key)))
        throw new RuntimeError("A worker requires explicit approved filesystem scope before allocation", "worker-scope-required");
    const row = value as Record<string, unknown>, writable = paths(row.writable, "Worker writable scope"), protectedPaths = paths(row.protected, "Worker protected scope");
    if (!writable.length || !protectedPaths.length)
        throw new RuntimeError("Worker scope requires writable paths and pinned protected acceptance inputs", "worker-scope-required");
    const protectedAll = [...new Set([...reserved, ...protectedPaths])].sort();
    if (writable.some(path => protectedAll.some(protectedPath => protectedPath === "." || path === protectedPath || path.startsWith(protectedPath + "/"))))
        throw new RuntimeError("Worker writable scope is inside protected policy or acceptance", "worker-scope-invalid");
    return { writable, protected: protectedAll, writableDirectories: parseWritableDirectories(row.writableDirectories ?? [], protectedAll) };
}
/** Shell is fixed controller code. Every source-derived argument is strictly parsed and quoted. */
export function repositoryPermissionsScript(root: string, scope?: WorkerScope): string {
    const lines = ["set -eu", `test -d ${quote(root)}; test ! -L ${quote(root)}`, `chown -R 0:0 ${quote(root)}`, `chmod -R a-w ${quote(root)}`];
    if (!scope) return lines.join("\n");
    const parsed = parseWorkerScope(scope);
    for (const path of [...parsed.writable, ...parsed.protected, ...(parsed.writableDirectories ?? [])]) {
        let current = root;
        if (path === ".") continue;
        for (const part of path.split("/")) {
            current += "/" + part;
            lines.push(`test ! -L ${quote(current)}`);
        }
    }
    for (const directory of parsed.writableDirectories ?? []) {
        const target = `${root}/${directory}`;
        lines.push(`tracked=$(git --literal-pathspecs -c safe.directory=${quote(root)} -C ${quote(root)} ls-files -- ${quote(directory)}); test -z "$tracked"`, `test ! -e ${quote(target)} || test -d ${quote(target)}`, `mkdir -p -- ${quote(target)}`);
    }
    for (const path of [...parsed.writable, ...(parsed.writableDirectories ?? [])]) {
        const target = path === "." ? root : `${root}/${path}`;
        lines.push(`if test ! -e ${quote(target)}; then printf '%s\\n' ${quote(`Worker scope path ${path} does not exist. Create the intended file/directory in the approved baseline; Wringer will not guess its type.`)} >&2; exit 73; fi`, `chown -R 1000:1000 ${quote(target)}`, `chmod -R u+w ${quote(target)}`);
    }
    // A writable parent would allow unlinking/replacing an otherwise read-only child.
    // Keep missing protected paths' existing parents locked too, so policy cannot be introduced.
    const parents = new Set<string>([root]);
    for (const path of parsed.protected) {
        const target = path === "." ? root : `${root}/${path}`;
        lines.push(`if test -e ${quote(target)}; then chown -R 0:0 ${quote(target)}; chmod -R a-w ${quote(target)}; fi`);
        let parent = posix.dirname(target);
        while (parent === root || parent.startsWith(root + "/")) {
            parents.add(parent);
            if (parent === root) break;
            parent = posix.dirname(parent);
        }
    }
    for (const parent of parents) lines.push(`if test -d ${quote(parent)}; then chown 0:0 ${quote(parent)}; chmod a-w ${quote(parent)}; fi`);
    return lines.join("\n");
}
