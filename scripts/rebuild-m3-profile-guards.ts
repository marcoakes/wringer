import { runReversions } from "./rebuild-reversions";
const profile = "packages/application/src/delegation-profile.ts", test = "packages/application/test/delegation-profile.test.ts", readiness = "packages/application/src/runtime-readiness.ts", readinessTest = "packages/application/test/runtime-readiness.test.ts";
await runReversions("m3-profile", [test, readinessTest], [
    { name: "private-state-boundary", file: profile, before: '!distance || distance !== ".." && !distance.startsWith(`..${sep}`) && !distance.startsWith(sep)', after: "false", test, pattern: "profile inspection refuses" },
    { name: "clean-source-required", file: profile, before: "!source.head_sha || source.dirty", after: "!source.head_sha", test, pattern: "profile inspection refuses" },
    { name: "profile-reinspection", file: profile, before: "const current = await inspectDelegationProfile(root, preview.repo, preview.selection);", after: "const current = preview;", test, pattern: "applying a reviewed profile" },
    { name: "readiness-image-binding", file: readiness, before: "|| report.runtime?.image !== image", after: "", test: readinessTest, pattern: "readiness requires" },
    { name: "readiness-completeness", file: readiness, before: "|| REQUIRED_RUNTIME_MEASUREMENTS.some(id => !report.rows.some((row: any) => row.id === id))", after: "", test: readinessTest, pattern: "readiness requires" },
    { name: "readiness-cleanup", file: readiness, before: ".length < 5", after: ".length < 0", test: readinessTest, pattern: "readiness requires" },
    { name: "readiness-inventory", file: readiness, before: 'inventory?.bun !== "1.4.2" ||', after: "", test: readinessTest, pattern: "readiness requires" },
]);
