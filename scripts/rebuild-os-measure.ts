import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fetchArchiveMetadata } from "../runtime/prepare-os";
const measuredAt = new Date().toISOString(), records = [];
async function bounded(url: string, max: number) {
    const response = await fetchArchiveMetadata(url);
    if (!response.ok) throw new Error(`Archive metadata refused: ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer()); if (data.length > max) throw new Error("Archive metadata is oversized"); return data;
}
for (const archive of ["debian", "debian-security"]) {
    const data = JSON.parse(new TextDecoder().decode(await bounded(`https://snapshot.debian.org/mr/timestamp/?archive=${archive}`, 2 * 1024 ** 2)));
    const timestamp = data.result[archive].filter((value: string) => /^\d{8}T\d{6}Z$/.test(value)).sort().at(-1);
    if (!timestamp) throw new Error("No observed archive timestamp");
    for (const suite of archive === "debian" ? ["bookworm", "bookworm-updates"] : ["bookworm-security"]) {
        const url = `https://snapshot.debian.org/archive/${archive}/${timestamp}/dists/${suite}/InRelease`, bytes = await bounded(url, 1024 ** 2);
        records.push({ archive, timestamp, suite, url, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    }
}
const value = { schema_version: "wringer.runtime-os-lock.v1", measuredAt, records, signatureVerification: "APT uses the pinned base image's Debian archive keyring; validity-date expiry alone is disabled for archived snapshots", executionMeasured: false };
await writeFile(new URL("../runtime/os-snapshot.lock.json", import.meta.url), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
await writeFile(new URL(`../docs/rebuild/evidence/m3/os-resolution-${measuredAt.replaceAll(":", "-")}.json`, import.meta.url), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(value, null, 2));
