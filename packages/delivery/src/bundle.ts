import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { realpath as fsRealpath } from "node:fs/promises";
import { hashBytes } from "@wringer/plan";
import { auditContained } from "./contained";
import { files, inside } from "./io";
import { inspectBundle } from "../../../examples/evidence/read-bundle.mjs";
import readerSource from "../../../integrations/bundle-reader.txt" with { type: "text" };
import indexSchema from "../../../schema/bundle-index-v1.schema.json";

/** Export only an already portable, semantically auditable contained delivery.
 * Never traverse a private controller or copy provider/session logs. */
export async function exportEvidenceBundle(input: string, destination: string) {
    const source = await fsRealpath(input), parent = await fsRealpath(dirname(resolve(destination)));
    if ((await lstat(input)).isSymbolicLink()) throw new Error("A bundle root cannot be a symlink");
    const output = join(parent, basename(resolve(destination)));
    if (output === source || output.startsWith(source + sep)) throw new Error("Export outside the source bundle");
    const audit = await auditContained(source);
    if (audit.status !== "passed") throw new Error("Only an intact, auditable contained bundle can be exported");
    const manifestBytes = await readFile(join(source, "manifest.json")), manifest = JSON.parse(manifestBytes.toString("utf8"));
    const sealBytes = await readFile(join(source, "digests.json"));
    // Exclusive allocation preserves an existing directory, including a prior
    // interrupted export. Retry into a new destination, never overwrite it.
    await mkdir(output, { mode: 0o700 });
    const payload = join(output, "evidence"); await mkdir(payload, { mode: 0o700 });
    for (const name of await files(source)) {
        const bytes = await readFile(await inside(source, name)), target = await inside(payload, name);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    }
    // Audit the copied snapshot too: a concurrent source edit must not turn an
    // earlier passing observation into a successful export of different bytes.
    if ((await auditContained(payload)).status !== "passed") throw new Error("Exported evidence changed during copy; partial export retained");
    const contents = { "read-bundle.mjs": readerSource, "schema.json": JSON.stringify(indexSchema, null, 2) + "\n", "summary.md": await readFile(join(payload, "summary.md"), "utf8") };
    const index = { schema_version: "wringer.bundle-index.v1", payload: "evidence", bundleFamily: manifest.schema_version, deliveryId: manifest.id, source: { commit: manifest.source.codeCommit, tree: manifest.source.tree }, manifestSha256: hashBytes(manifestBytes), digestsSha256: hashBytes(sealBytes), files: Object.fromEntries(Object.entries(contents).map(([name, content]) => [name, hashBytes(content)])), semanticAudit: { command: "wringer-drive audit --bundle evidence", scope: "Run from the exported directory. This validates carried observations, not fresh behavior or author authenticity." } };
    for (const [name, content] of Object.entries(contents)) await writeFile(join(output, name), content, { flag: "wx", mode: 0o600 });
    await writeFile(join(output, "bundle.json"), JSON.stringify(index, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await inspectBundle(output);
    return index;
}
export async function inspectEvidenceBundle(directory: string) {
    const integrity = await inspectBundle(directory), audit = await auditContained(join(directory, "evidence"));
    return { ...integrity, semanticAudit: audit.status, audit };
}
