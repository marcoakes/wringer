import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/runtime-image-channel.test.ts", file = "scripts/runtime-image-publish.ts";
await runReversions("m8-image-guards", [test], [
    { name: "all-native-inputs-before-effects", file, before: 'if (candidates.length !== 2 || new Set(candidates.map(c => c.record.platform)).size !== 2 || new Set(candidates.map(c => `${c.record.version}:${c.record.commit}`)).size !== 1)', after: 'if (false)', test, pattern: 'all native image inputs' },
    { name: "published-image-identity", file, before: 'if (remote && remote.imageId !== record.imageId)', after: 'if (false)', test, pattern: 'exact already-published image' },
    { name: "image-receipt-replay", file, before: 'if (retained) {', after: 'if (false) {', test, pattern: 'exact already-published image' },
    { name: "native-image-build-platform", file: 'scripts/runtime-image-artifact.ts', before: 'platform !== "linux" ||', after: '', test, pattern: 'native image plans' },
], { gitFixture: true });
