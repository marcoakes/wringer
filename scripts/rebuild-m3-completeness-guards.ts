import { runReversions } from "./rebuild-reversions";
const test = "packages/engine/test/assertions.test.ts", file = "packages/engine/src/gate-evidence.ts";
await runReversions("m3-completeness-guards", [test], [
    { name: "node-registration", file, before: 'evidence.adapter === "node-test" && translation.counts.executed > 0', after: 'false && translation.counts.executed > 0', test, pattern: "T05 standalone Node" },
    { name: "report-freshness", file, before: 'if (options.reportBefore === undefined || after === options.reportBefore)', after: 'if (false)', test, pattern: "T05 an unchanged" },
    { name: "complete-captured-output", file, before: 'if (!evidence.report && (process.stdout_truncated || process.stderr_truncated))', after: 'if (false)', test, pattern: "T05 truncated" },
    { name: "output-is-not-check-source", file: "packages/engine/src/acceptance.ts", before: ' || gate.evidence?.report && name === posix(gate.evidence.report).replace(/^\\.\\//, "")', after: '', test, pattern: "T05 an unchanged" },
    { name: "output-input-overlap", file: "packages/engine/src/config.ts", before: 'if (gate.inputs.some(pattern => new Bun.Glob(pattern).match(report.replace(/^\\.\\//, ""))))', after: 'if (false)', test, pattern: "declared output report" },
]);
