import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/installer.test.ts", installation = "packages/cli/src/installation.ts", archive = "packages/cli/src/release-archive.ts";
await runReversions("m8-installer-guards", [test], [
    { name: "archive-digest", file: archive, before: 'distributionHash(bytes) !== selection.sha256', after: 'false', test, pattern: 'archive checksum' },
    { name: "archive-platform", file: archive, before: '`${manifest.platform}-${manifest.arch}` !== (selection.platform ?? `${process.platform}-${process.arch}`)', after: 'false', test, pattern: 'archive checksum' },
    { name: "archive-content", file: archive, before: 'distributionHash(entry.data) !== file.sha256 || entry.data.length !== file.bytes ||', after: '', test, pattern: 'archive checksum' },
    { name: "archive-links", file: archive, before: 'entry.target !== "wring"', after: 'false', test, pattern: 'archive checksum' },
    { name: "record-compatibility", file: installation, before: '...compatibility(current, target)', after: '...[]', test, pattern: 'ownership, same-version' },
    { name: "live-owner", file: installation, before: 'held.push("owner-running-close-before-switch")', after: 'void 0', test, pattern: 'ownership, same-version' },
    { name: "completed-replay", file: installation, before: 'if (await exists(receipt)) {', after: 'if (false && await exists(receipt)) {', test, pattern: 'a lost switch response' },
    { name: "receipt-cleanup", file: installation, before: 'if (transaction.preview?.identity === expected)', after: 'if (false)', test, pattern: 'lost final receipt' },
    { name: "ownership-stage", file: installation, before: 'const stage = await mkdtemp(join(dirname(prefix), ".wringer-install-initial-"));', after: 'await mkdir(prefix, { recursive: true, mode: 0o700 }); const stage = prefix;', test, pattern: 'partial first ownership' },
    { name: "removal-inventory", file: installation, before: 'await validateRemoval(prefix, preview.remove);', after: '/* fault: omit ownership revalidation */', test, pattern: 'interrupted removal' },
    { name: "derived-verification-outcome", file: installation, before: 'if (!await exists(observation)) held.push("verification-outcome-unconfirmed");', after: 'if (!await exists(observation)) { /* lost reservation */ }', test, pattern: 'migration holds derived' },
    { name: "derived-runner-outcome", file: installation, before: 'held.push("delegation-operation-unfinished")', after: 'void 0', test, pattern: 'migration holds derived' },
]);
