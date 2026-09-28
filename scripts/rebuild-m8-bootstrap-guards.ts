import { runReversions } from "./rebuild-reversions";
const test = "packages/cli/test/bootstrap.test.ts", file = "packaging/install.sh", pattern = "bootstrap refuses";
await runReversions("m8-bootstrap-guards", [test], [
    { name: "checksum-before-exec", file, before: '[ "$actual" = "$wanted" ] ||', after: 'true ||', test, pattern },
    { name: "hardlink-ownership", file, before: '[ "$(links "$destination/$artifact")" -eq 1 ] &&', after: 'true &&', test, pattern },
    { name: "required-linux-not-skipped", file: "packages/runtime/test/filesystem.test.ts", before: 'process.env.WRINGER_REQUIRE_LINUX_DAC === "1" && !realLinuxDac', after: 'false', test, pattern: "required Linux DAC measurement" },
]);
