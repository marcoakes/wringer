/** Isolated reversions of the job page's source-history review (alpha.46): each repair is undone alone
 * in a scratch copy, and the test that names it must turn red. Found by the first real change through
 * Wringer, docs/adoption/evidence/alpha45/REAL_CHANGE_ZENJEV_2026-11-09.md. No agent or model runs. */
import { runReversions } from "./rebuild-reversions";
const delivery = "packages/delivery/test/contained.test.ts", page = "packages/board/test/job-render.test.ts";
await runReversions("alpha46-guards", [delivery, page], [
    { name: "paths-unnamed", file: "packages/delivery/src/contained.ts", before: "if (options.names && inventory.findings.length) {", after: "if (false) {", test: delivery, pattern: "job page's source review" },
    { name: "batch-ignored", file: "packages/delivery/src/contained.ts", before: "options.decisions ?? await readSourceDecisionBatch(", after: "await readSourceDecisionBatch(", test: delivery, pattern: "job page's source review" },
    { name: "carried-from-own-candidate", file: "packages/delivery/src/source-review.ts", before: "filter(name => commit.test(name) && name !== inventory.candidateCommit)", after: "filter(name => commit.test(name))", test: delivery, pattern: "job page's source review" },
    { name: "carried-never-found", file: "packages/delivery/src/source-review.ts", before: "carried.push({ findingId: finding.id, candidateCommit: candidate,", after: "void ({ findingId: finding.id, candidateCommit: candidate,", test: delivery, pattern: "job page's source review" },
    { name: "review-shown-on-any-phase", file: "packages/board/src/job-model.ts", before: 'v.sourceReview === undefined || v.phase === "blocked" && exact(v.sourceReview,', after: "v.sourceReview === undefined || exact(v.sourceReview,", test: page, pattern: "source review on the page" },
    { name: "review-panel-missing", file: "packages/board/src/job-render.ts", before: '<section id="source-review-panel" hidden>', after: '<section id="source-review-removed" hidden>', test: page, pattern: "source review on the page" },
], { baseline: "a706fec31634b203a782a5f77df3e40a810de488" });
