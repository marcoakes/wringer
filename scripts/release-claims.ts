import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { distributionHash } from "./distribution-manifest";
export async function releaseClaims(artifacts: string, evidence: string, platform: string, version: string) {
    const name = `wringer-${version}-${platform}.tar.gz`, sha256 = distributionHash(await readFile(join(artifacts, name)));
    const manifest = JSON.parse(await readFile(join(artifacts, name + ".manifest.json"), "utf8"));
    const extracted = JSON.parse(await readFile(join(evidence, "extracted/result.json"), "utf8")), installer = JSON.parse(await readFile(join(evidence, "installer/result.json"), "utf8")), npm = JSON.parse(await readFile(join(evidence, "npm/result.json"), "utf8"));
    if (manifest.version !== version || `${manifest.platform}-${manifest.arch}` !== platform || extracted.archive.sha256 !== sha256 || installer.archiveSha256 !== sha256 || installer.platform !== platform || npm.platform !== platform || npm.version !== version || !npm.archiveIdentities?.some((a: any) => a.platform === platform && a.sha256 === sha256) || !extracted.checks.length || extracted.checks.some((c: any) => c.passed !== true) || installer.records.length < 13 || installer.records.some((c: any) => c.exit !== (c.name === "bootstrap-corrupt-binary-refused" ? 2 : 0)) || !npm.records.length || npm.records.some((c: any) => c.exit !== 0)) throw new Error("Exact artifact release measurements are missing or failed");
    const value = { schema_version: "wringer.release-claims.v1", archive: name, archiveSha256: sha256, source: manifest.source, version, platform, claims: { extractedRoutes: "passed", installedOfflineArtifact: "passed", npmOfflineCandidate: "passed", schemaAndContractTests: "see required native validation workflow", publicDownload: "unmeasured", containedRuntime: "separately gated", namedClientLiveJourney: "unmeasured", humanAcceptance: "unmeasured", independentUsability: "unmeasured" }, measurements: { extractedChecks: extracted.checks.length, installerChecks: installer.records.length, npmChecks: npm.records.length }, limits: ["Engineering fixture observations are not a personal decision, independent newcomer result or public installation measurement.", "Linux binary verification and contained gVisor readiness are distinct claims."] };
    await writeFile(join(artifacts, `${name}.claims.json`), JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); return value;
}
if (import.meta.main) {
    const [artifacts, evidence, platform, version] = process.argv.slice(2); if (!artifacts || !evidence || !platform || !version) throw new Error("Usage: bun scripts/release-claims.ts ARTIFACTS EVIDENCE PLATFORM VERSION");
    console.log(JSON.stringify(await releaseClaims(resolve(artifacts), resolve(evidence), platform, version), null, 2));
}
