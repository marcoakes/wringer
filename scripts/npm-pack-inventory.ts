import { readReleaseArchive } from "../packages/cli/src/release-archive";
import { distributionHash, type DistributionFile } from "../packages/cli/src/distribution-manifest";
/** Inspect tar bytes: npm's printable summary can redact ordinary filenames. */
export function verifyNpmPackInventory(bytes: Buffer, inventoryBytes: Buffer, packageBytes: Buffer) {
    const entries = readReleaseArchive(bytes), inventory = JSON.parse(inventoryBytes.toString());
    const metadata = (path: string, data: Buffer) => ({ path, kind: "file" as const, sha256: distributionHash(data), bytes: data.length, executable: false });
    const files = [metadata("package.json", packageBytes), metadata("dist/PACKAGE-CONTENTS.json", inventoryBytes),
        ...(inventory.files as DistributionFile[]).map(file => ({ ...file, path: `dist/${file.path}` }))];
    const expected = files.map(file => `package/${file.path}`).sort();
    if (entries.some(entry => entry.kind !== "file") || JSON.stringify(entries.map(entry => entry.path).sort()) !== JSON.stringify(expected)) throw new Error("Actual npm archive differs from its channel inventory");
    for (const file of files) {
        const entry = entries.find(entry => entry.path === `package/${file.path}`)!;
        if (file.kind !== "file" || entry.data.length !== file.bytes || distributionHash(entry.data) !== file.sha256 || !!(entry.mode & 0o111) !== file.executable) throw new Error(`Actual npm content differs from its channel inventory: ${file.path}`);
    }
    return entries.map(entry => entry.path.slice("package/".length)).sort();
}
