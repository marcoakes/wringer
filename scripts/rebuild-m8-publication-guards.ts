import { runReversions } from "./rebuild-reversions";
const npm = "scripts/npm-publication.ts", test = "packages/cli/test/release-channels.test.ts", draft = "packages/cli/test/draft-release.test.ts";
await runReversions("m8-publication-guards", [test, draft], [
    { name: "npm-observation-archive", file: "scripts/release-claims.ts", before: "!npm.archiveIdentities?.some((a: any) => a.platform === platform && a.sha256 === sha256) ||", after: "", test: draft, pattern: "another archive" },
    { name: "parse-before-registry", file: npm, before: 'verified.push(verifyNpmTarball(await readFile(join(dirname(file), pkg.file)), pkg, plan.namespace));', after: 'verified.push({ pkg: { name: pkg.name, optionalDependencies: { "@wringer-fixture/wringer-darwin-arm64": plan.version } }, source: pkg.name.endsWith("darwin-arm64") ? { fixture: true } : null } as any);', test, pattern: "validates actual tarball" },
    { name: "native-package-content", file: npm, before: 'if (entry.data.length !== file.bytes || distributionHash(entry.data) !== file.sha256 || !!(entry.mode & 0o111) !== file.executable)', after: 'if (false)', test, pattern: "accepts actual pack bytes" },
    { name: "immutable-npm-version", file: npm, before: 'if (JSON.parse(viewed.stdout) !== pkg.integrity)', after: 'if (false)', test, pattern: "accepts actual pack bytes" },
    { name: "archive-sidecars", file: "scripts/draft-release.ts", before: 'throw new Error("Release sidecar differs from its exact native archive");', after: '{}', test: draft, pattern: "sidecar identity" },
]);
