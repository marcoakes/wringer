import { constants } from "node:fs";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createDesignSnapshot, importDesignFromMcp, readDesignSnapshot, writeDesignSnapshot, assertRepositoryDisclosure, parseDesignJson } from "@wringer/design";
import { compileDeclaration, canonicalPlanJson, loadExecutionPlan } from "@wringer/plan";
import { safePath } from "@wringer/engine";
import { readPinnedDesignSnapshot } from "@wringer/workflow";
import { assistantPath } from "@wringer/application";
import { allowed, flag, positionals, required, string, type Args } from "./args";
import type { Answer } from "./app";

export const DESIGN_HELP = `Design → contained build → visual review → handover proof

  wring design import --recipe READ_RECIPE.json --output design/snapshot.json
      [--token-env FIGMA_MCP_TOKEN] --allow-repository-storage
  wring design reference --input OWNED_REFERENCE.json --output design/snapshot.json
      --allow-repository-storage
  wring design inspect --snapshot design/snapshot.json
  wring design bind --plan PROFILE.yaml --snapshot design/snapshot.json
      --reviews REVIEWS.json --output /PRIVATE_OPERATOR_DIR/design-profile.json

All commands accept --repo PATH. Import and reference create new files only.
Without --allow-repository-storage, a snapshot remains private and cannot enter a
plan or delivery; --output must be in an existing private folder outside the
Git working tree. The parent must be an existing operator-owned 0700 folder.
Bind always requires that private output location for its new operator profile.
That flag means the design owner permits these exact design
bytes to travel with this repository and its handover evidence. It is not build
or publication approval. Never put a token in a recipe or command argument.

Import performs only a finite declared read recipe, never an agent loop or design
write. Figma requires an eligible authorized MCP connection; access failure is a
stop, not a substitute design. An owned export is labelled owned-reference.
Commit the intended snapshot in the source repo before bind; bind pins the HEAD
Git blob, preserves the previous checks/budget, and creates an unapproved v2 plan.
Guide: docs/native/DESIGN.md
`;

async function data(path: string, max = 20 * 1024 * 1024): Promise<any> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { return parseDesignJson(await boundedRead(file, max)); }
    finally { await file.close(); }
}
async function boundedRead(file: Awaited<ReturnType<typeof open>>, max: number): Promise<Buffer> {
    const s = await file.stat(); if (!s.isFile() || s.size > max) throw new Error("Design input must be a bounded regular file");
    const buffer = Buffer.alloc(s.size + 1); let offset = 0;
    while (offset < buffer.length) { const next = await file.read(buffer, offset, buffer.length - offset, null); if (!next.bytesRead) break; offset += next.bytesRead; }
    if (offset !== s.size) throw new Error("Design input changed during its bounded read");
    return buffer.subarray(0, offset);
}
function within(root: string, path: string) { const p = relative(root, path); return !p || p !== ".." && !p.startsWith("../") && !p.startsWith("/"); }
async function outputPath(repo: string, selected: string, publishable: boolean): Promise<string> {
    const root = await realpath(repo), output = resolve(root, selected);
    if (publishable) {
        const path = await safePath(root, selected), pieces = relative(root, path).split(sep);
        if (pieces.some(p => [".git", ".wringer", ".codex", ".claude", ".agents"].includes(p))) throw new Error("Design output cannot be stored in control metadata");
        return path;
    }
    await assistantPath(dirname(output), ".");
    const parent = await realpath(dirname(output)), info = await lstat(parent);
    if (within(root, parent) || !info.isDirectory() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())
        throw new Error("Private design output needs an existing operator-owned private folder (0700) outside the source repository. No design was fetched or stored.");
    // A caller selecting a repo subdirectory cannot conceal the enclosing source
    // tree. Refuse every enclosing Git workspace, including linked worktrees.
    for (let current = parent; ; current = dirname(current)) {
        let exists = false;
        try { await lstat(join(current, ".git")); exists = true; } catch (e: any) { if (e.code !== "ENOENT") throw e; }
        if (exists) throw new Error("Private design output cannot be inside any Git working tree. Choose an operator-owned private folder outside source control.");
        if (current === dirname(current)) break;
    }
    return output;
}
function keys(value: any, accepted: string[]) {
    if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).some(k => !accepted.includes(k)))
        throw new Error("Design input has an unknown field. Tokens and executable configuration do not belong in it.");
}
async function git(repo: string, args: string[]): Promise<string> {
    const p = Bun.spawn(["git", "--no-replace-objects", "--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: repo, env: { PATH: process.env.PATH, HOME: "/nonexistent", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" }, stdout: "pipe", stderr: "ignore" });
    const output = await new Response(p.stdout).text();
    if (await p.exited || Buffer.byteLength(output) > 4096) throw new Error("Could not read the exact committed source identity. No source command ran and no plan was written.");
    return output.trim();
}
export async function designCommand(a: Args, repo: string): Promise<Answer> {
    positionals(a, 1);
    const operation = a.words[0];
    if (operation === "inspect") {
        allowed(a, ["snapshot"]);
        const snapshot = await readDesignSnapshot(resolve(repo, required(a, "snapshot")));
        const value = { title: snapshot.title, source: snapshot.source, capturedAt: snapshot.captured_at, disclosure: snapshot.disclosure, snapshotSha256: snapshot.snapshot_sha256, references: snapshot.assets.map(({ base64, ...asset }) => asset), componentRules: snapshot.component_rules, limits: snapshot.provenance.limits };
        const references = snapshot.assets.length ? snapshot.assets.map(asset => `- ${asset.id}: ${asset.title} (${asset.width} × ${asset.height} PNG)`).join("\n") : "No reference images: this snapshot cannot satisfy visual review.";
        return { value, text: `${snapshot.title}\nSource: ${snapshot.source.provider} · ${snapshot.source.label}\nVersion basis: ${snapshot.source.version_basis}. Captured: ${snapshot.captured_at}\nDesign: ${snapshot.snapshot_sha256}\n${snapshot.assets.length} reference images; ${snapshot.component_rules.length} component rules.\nReference IDs for reviews.json:\n${references}\nRepository storage: ${snapshot.disclosure}\n${snapshot.provenance.limits.join("\n")}` };
    }
    if (operation === "import" || operation === "reference") {
        allowed(a, [operation === "import" ? "recipe" : "input", "output", "allow-repository-storage", ...(operation === "import" ? ["token-env"] : [])]);
        const disclosure = flag(a, "allow-repository-storage") ? "repository-permitted" : "private", output = await outputPath(repo, required(a, "output"), disclosure === "repository-permitted");
        if (await Bun.file(output).exists()) throw new Error("Design output already exists. Use a new path; previously approved inputs are never overwritten.");
        const input = await data(resolve(repo, required(a, operation === "import" ? "recipe" : "input")));
        keys(input, operation === "import" ? ["provider", "endpoint", "title", "source", "recipe", "componentRules", "limits"] : ["title", "context", "componentRules", "assets", "source"]);
        let snapshot;
        if (operation === "import") {
            const name = string(a, "token-env");
            if (name && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !process.env[name])) throw new Error("The explicitly named MCP token variable is unavailable. No keychain, login or other environment variable was inspected.");
            snapshot = await importDesignFromMcp({ ...input, disclosure, ...(name ? { token: process.env[name] } : {}) });
        } else {
            if (input.assets !== undefined && (!Array.isArray(input.assets) || input.assets.length > 8)) throw new Error("Supply at most eight owned PNG references");
            const inputDirectory = dirname(resolve(repo, required(a, "input")));
            const assets = await Promise.all((input.assets ?? []).map(async (asset: any) => {
                keys(asset, ["id", "title", "pngBase64", "path"]);
                if ((asset.path === undefined) === (asset.pngBase64 === undefined)) throw new Error("Each reference needs one PNG path or base64 value, not both");
                if (asset.path === undefined) return asset;
                const path = await safePath(inputDirectory, asset.path), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                try { return { id: asset.id, title: asset.title, pngBase64: (await boundedRead(file, 4 * 1024 * 1024)).toString("base64") }; }
                finally { await file.close(); }
            }));
            snapshot = createDesignSnapshot({ ...input, assets, disclosure });
        }
        await mkdir(dirname(output), { recursive: true });
        await outputPath(repo, required(a, "output"), disclosure === "repository-permitted");
        await writeDesignSnapshot(output, snapshot);
        return { value: { path: output, snapshotSha256: snapshot.snapshot_sha256, source: snapshot.source, disclosure, referenceCount: snapshot.assets.length }, text: `Captured ${snapshot.title}: ${snapshot.assets.length} reference images.\nSource: ${snapshot.source.provider}; version basis: ${snapshot.source.version_basis}.\nDesign: ${snapshot.snapshot_sha256}\nSaved: ${output}\n${disclosure === "private" ? "Private: cannot be bound or delivered. Do not commit this file. Re-import only with the design owner's explicit repository-storage permission." : "Storage permitted, not build approval. Commit the intended source and snapshot, then use wring design bind --help."}` };
    }
    if (operation === "bind") {
        allowed(a, ["plan", "snapshot", "reviews", "output"]);
        const base = await loadExecutionPlan(resolve(repo, required(a, "plan"))), snapshotFile = await safePath(repo, required(a, "snapshot"));
        const snapshot = await readDesignSnapshot(snapshotFile); assertRepositoryDisclosure(snapshot);
        const reviews = await data(resolve(repo, required(a, "reviews")), 65536), output = await outputPath(repo, required(a, "output"), false);
        const root = await realpath(repo), path = relative(root, await realpath(snapshotFile)).split(sep).join("/");
        if (!path || path.startsWith("../")) throw new Error("Design snapshot must be inside the target source repository");
        if (await realpath(await git(root, ["rev-parse", "--show-toplevel"])) !== root) throw new Error("Select the source repository root");
        const commit = await git(root, ["rev-parse", "--verify", "HEAD^{commit}"]), objectStore = resolve(root, await git(root, ["rev-parse", "--git-common-dir"]));
        const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, design, ...declaration } = base;
        const plan = compileDeclaration({ version: 2, ...declaration, repository: { ...base.repository, commit }, design: { snapshotPath: path, snapshotSha256: snapshot.snapshot_sha256, reviews } });
        const pinned = await readPinnedDesignSnapshot(plan, objectStore);
        if (!pinned || plan.design!.reviews.some(r => r.referenceIds.some(id => !pinned.assets.some(asset => asset.id === id)))) throw new Error("A named design reference is absent from the committed snapshot");
        if (await git(root, ["rev-parse", "HEAD^{commit}"]) !== commit) throw new Error("Source moved during design binding; repeat against a stable commit");
        const file = await open(output, "wx", 0o600);
        try { await file.writeFile(canonicalPlanJson(plan)); await file.sync(); } finally { await file.close(); }
        return { value: { path: output, planSha256: plan.plan_sha256, sourceCommit: commit, snapshotSha256: snapshot.snapshot_sha256, approval: "not-granted" }, text: `Prepared an unapproved design-aware plan: ${output}\nSource: ${commit}\nDesign: ${snapshot.snapshot_sha256}\nExisting checks and limits retained. No model, source script, approval or publication ran.\nNext: use this profile with wringer-assistant setup --plan ${JSON.stringify(output)} and your existing controller options. Then propose the PM request and review the plan.` };
    }
    throw new Error(DESIGN_HELP);
}
