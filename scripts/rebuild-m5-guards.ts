import { runReversions } from "./rebuild-reversions";
const review = "packages/application/test/standalone-review.test.ts", board = "packages/board/test/job-render.test.ts", reader = "packages/records/test/reader-concurrency.test.ts", page = "packages/board/src/job-render.ts";
await runReversions("m5-guards", [review, board, reader], [
    { name: "repeated-current-judgement", file: "packages/application/src/standalone-review.ts", before: "if (!validateCurrent(record))", after: 'if (!ajv.compile(await readSchema("judgements-v2.schema.json", schemas) as object)(record))', test: review, pattern: "correction can be replaced" },
    { name: "concurrent-schema-compilation", file: "packages/records/src/read.ts", before: "if (pending) return pending;", after: "void pending;", test: reader, pattern: "simultaneous first reads" },
    { name: "visible-mode", file: page, before: 'el("job-mode").textContent = value.mode === "verification"', after: 'el("job-mode").textContent = false', test: board, pattern: "mode remains visible" },
    { name: "decision-focus", file: page, before: 'if (decisionChanged) el("job-workspace").focus();', after: "void decisionChanged;", test: board, pattern: "mode remains visible" },
    { name: "notification-rate-limit", file: page, before: " || Date.now() - lastNotificationAt < 30000", after: "", test: board, pattern: "notification is opt-in" },
    { name: "notification-decision-identity", file: page, before: "${value.phase}:${value.readyRevision}", after: "${value.phase}", test: board, pattern: "notification is opt-in" },
    { name: "notification-disable", file: page, before: "if (notifications) {", after: "if (false) {", test: board, pattern: "notification opt-in can be disabled" },
]);
