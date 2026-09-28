import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/release-channels.test.ts", file = "scripts/release-channels.ts";
await runReversions("m8-channel-guards", [test], [
    { name: "namespace-observation", file, before: "if (!selection.fixture) {", after: "if (false) {", test, pattern: "production namespace" },
    { name: "private-fixture-packages", file, before: "name: packageName, version, private: selection.fixture", after: "name: packageName, version, private: false", test, pattern: "actual npm tarball" },
    { name: "actual-repository-license", file, before: 'description: "Reviewable checks and bounded delegation with a local human decision page", license: "Apache-2.0"', after: 'description: "Reviewable checks and bounded delegation with a local human decision page", license: "MIT"', test, pattern: "actual npm tarball" },
]);
