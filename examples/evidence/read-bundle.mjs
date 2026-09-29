#!/usr/bin/env node
// Independent reader: Node built-ins only. Integrity is not semantic acceptance.
import { createHash } from "node:crypto";
import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const insist = (ok, message) => { if (!ok) throw new Error(message); };
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
async function file(root, name) {
    insist(typeof name === "string" && name.length <= 1024 && !name.includes("\\") && !name.includes("\0") && name.split("/").every(part => part && part !== "." && part !== ".." && part !== ".git"), "Unsafe evidence path");
    let path = root;
    for (const part of name.split("/")) {
        path = join(path, part);
        insist(!(await lstat(path)).isSymbolicLink(), "Symlink in evidence");
    }
    const info = await lstat(path);
    insist(info.isFile() && info.size <= 512 * 1024 * 1024, "Evidence file is not a bounded regular file");
    return readFile(path);
}
async function inventory(root, prefix = "", depth = 0) {
    insist(depth < 32, "Evidence nesting is excessive");
    const rows = [];
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        insist(!entry.isSymbolicLink(), "Symlink in evidence");
        if (entry.isDirectory()) rows.push(...await inventory(root, name, depth + 1));
        else { insist(entry.isFile(), "Unsupported evidence entry"); rows.push(name); }
        insist(rows.length <= 32768, "Evidence inventory is excessive");
    }
    return rows.sort();
}
export async function inspectBundle(input) {
    insist(!(await lstat(input)).isSymbolicLink(), "Symlink bundle root");
    const root = await realpath(input);
    insist(JSON.stringify((await readdir(root)).sort()) === JSON.stringify(["bundle.json", "evidence", "read-bundle.mjs", "schema.json", "summary.md"]), "Envelope inventory changed");
    const index = JSON.parse(await file(root, "bundle.json"));
    insist(index.schema_version === "wringer.bundle-index.v1" && index.payload === "evidence" && /^wringer\.contained-delivery\.v[1-4]$/.test(index.bundleFamily), "Unsupported bundle index");
    insist(index.files && typeof index.files === "object" && !Array.isArray(index.files), "Invalid envelope inventory");
    const expected = ["read-bundle.mjs", "schema.json", "summary.md"].sort();
    insist(JSON.stringify(Object.keys(index.files).sort()) === JSON.stringify(expected), "Envelope inventory changed");
    for (const name of expected) insist(hash(index.files[name]) && digest(await file(root, name)) === index.files[name], `Envelope changed: ${name}`);
    const evidence = resolve(root, index.payload);
    insist(evidence.startsWith(root + sep) && !(await lstat(evidence)).isSymbolicLink(), "Invalid payload directory");
    const sealBytes = await file(evidence, "digests.json"), manifestBytes = await file(evidence, "manifest.json");
    insist(digest(sealBytes) === index.digestsSha256 && digest(manifestBytes) === index.manifestSha256, "Evidence manifest or seal changed");
    const seal = JSON.parse(sealBytes), manifest = JSON.parse(manifestBytes);
    insist(seal.schema_version === "wringer.digests.v1" && seal.algorithm === "sha256" && seal.files && typeof seal.files === "object" && !Array.isArray(seal.files), "Invalid evidence seal");
    const paths = await inventory(evidence);
    insist(JSON.stringify(paths.filter(name => name !== "digests.json")) === JSON.stringify(Object.keys(seal.files).sort()), "Evidence inventory changed");
    for (const name of Object.keys(seal.files)) insist(hash(seal.files[name]) && digest(await file(evidence, name)) === seal.files[name], `Evidence changed: ${name}`);
    insist(index.bundleFamily === manifest.schema_version && index.deliveryId === manifest.id && index.source?.commit === manifest.source?.codeCommit && index.source?.tree === manifest.source?.tree, "Bundle source identity changed");
    const engineering = paths.includes("engineering.json") ? JSON.parse(await file(evidence, "engineering.json")) : null;
    return { schema_version: "wringer.independent-bundle-inspection.v1", integrity: "passed", semanticAudit: "not-run", deliveryId: index.deliveryId, source: index.source, bundleFamily: index.bundleFamily, files: paths.length, decisions: engineering?.loopDecisions ?? [], summary: (await file(evidence, "summary.md")).toString("utf8"), limits: ["Hashes detect changed bytes relative to this index; they do not authenticate its author or prove behavior.", "No checks, models, runtimes, human decisions or network calls were executed. Run Wringer's semantic audit separately."] };
}
const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entry && import.meta.url === pathToFileURL(entry).href) {
    try {
        insist(process.argv.length === 3, "Usage: node read-bundle.mjs EXPORTED_DIRECTORY");
        console.log(JSON.stringify(await inspectBundle(process.argv[2]), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
