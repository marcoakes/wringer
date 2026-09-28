import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { distributionHash as hash, type ReleaseManifest } from "./distribution-manifest";
export async function writeReleaseInventory(root: string, output: string, archive: { name: string; sha256: string; bytes: number }, manifest: ReleaseManifest) {
    const locked = [];
    for (const file of ["bun.lock", "runtime/bun.lock"]) {
        const bytes = await readFile(join(root, file)), value = Bun.JSONC.parse(bytes.toString()) as any;
        locked.push({ file, sha256: hash(bytes), packages: Object.entries(value.packages ?? {}).map(([name, details]) => ({ name, locked: details })) });
    }
    const inventory = { schema_version: "wringer.release-inventory.v1", archive, manifestSha256: hash(await readFile(join(output, `${archive.name}.manifest.json`))), version: manifest.version, platform: `${manifest.platform}-${manifest.arch}`, source: manifest.source, repository: manifest.repository, runtime: manifest.runtime, licence: "Apache-2.0", lockedInputs: locked, runtimeImageInputs: { bases: JSON.parse(await readFile(join(root, "runtime/base-images.lock.json"), "utf8")), os: JSON.parse(await readFile(join(root, "runtime/os-snapshot.lock.json"), "utf8")) }, claims: { artifactInventory: "verified", installedExecution: "requires separate measurement against this archiveSha256", publicInstallation: "unmeasured", liveClientAcceptance: "unmeasured", containedRuntimeExecution: "requires separate platform measurement" }, limits: ["Dependency lock inventory includes development and optional platform packages; it is not a claim that every entry executes in the compiled binary.", "Local content digests are not independently signed provenance. CI attestations are separate artifacts."] };
    await writeFile(join(output, `${archive.name}.inventory.json`), JSON.stringify(inventory, null, 2) + "\n", { flag: "wx" });
    return inventory;
}
