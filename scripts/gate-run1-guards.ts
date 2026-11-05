/** Isolated reversions of what beta gate run 1 found (alpha.42): each fix is undone alone in a
 * scratch copy, and the test that names it must turn red. Findings in
 * docs/adoption/evidence/alpha41/BETA_GATE_RUN1_2026-11-04.md; F1 has its own guards
 * (scripts/install-upgrade-guards.ts). Nothing here runs an agent, a model or a browser. */
import { runReversions } from "./rebuild-reversions";
const clients = "packages/cli/test/client-adapters.test.ts", protocol = "packages/application/test/delegation-protocol.test.ts", door = "packages/cli/test/delegation-door.test.ts";
const server = "packages/mcp/test/server.test.ts", engineering = "packages/application/test/engineering-view.test.ts", audit = "packages/cli/test/contained-cli.test.ts", page = "packages/board/test/job-render.test.ts";
await runReversions("gate-run1", [clients, protocol, door, server, engineering, audit, page], [
    // F2: codex exec could not record a proposal under "auto".
    { name: "codex-approval-auto", file: "packages/cli/src/client-adapters.ts", before: '{ default_tools_approval_mode: "approve" }', after: '{ default_tools_approval_mode: "auto" }', test: clients, pattern: "explicit routine approval" },
    { name: "codex-approval-unexplained", file: "packages/cli/src/client-adapters.ts", before: "Client trust/reload may still be required.${codexApproval}`", after: "Client trust/reload may still be required.`", test: clients, pattern: "explicit routine approval" },
    // F3: the prepared job read as questions for the person, and nothing named it.
    { name: "prepared-phase-questions", file: "packages/application/src/delegation-protocol.ts", before: 'isPreparedJob(view.questions) ? "prepared" : "questions"', after: '"questions"', test: protocol, pattern: "prepared waits for the assistant" },
    { name: "prepared-actor-operator", file: "packages/application/src/delegation-protocol.ts", before: 'if (view.outcome === "needs-decision" && isPreparedJob(view.questions)) return { code: "revise", actor: "assistant", eligible: true, reason: view.nextAction };', after: "", test: protocol, pattern: "prepared waits for the assistant" },
    { name: "job-new-unnamed", file: "packages/cli/src/adoption-cli.ts", before: 'Tell your coding assistant your request and name this job, for example: "Please delegate this to Wringer on prepared job ${value.id}: YOUR REQUEST"', after: "Ask the connected coding assistant to revise this pending proposal.", test: door, pattern: "prepared job for the assistant" },
    { name: "instructions-propose-only", file: "packages/mcp/src/server.ts", before: "propose it, or, when list_jobs shows a job the person prepared with wring job new (get_status phase prepared), record it on that job with revise_proposal instead;", after: "propose;", test: server, pattern: "server instructions lead with the loop" },
    { name: "skill-propose-only", file: "integrations/wringer/SKILL.md", before: "Before proposing, call `wringer.list_jobs`", after: "Before proposing, consider `wringer.list_jobs`", test: door, pattern: "skill and guides" },
    // F4: the private page could be unlocked only in the default browser.
    { name: "open-print-refused", file: "packages/cli/src/adoption-cli.ts", before: 'allowed(a, ["app-dir", "workspace", "job", "print"])', after: 'allowed(a, ["app-dir", "workspace", "job"])', test: door, pattern: "prepared job for the assistant" },
    // F5: only the passing run was on the page.
    { name: "baseline-unshown", file: "packages/application/src/engineering-view.ts", before: " + startingPoint(history?.state.baseline?.checks.find(row => row.id === check.id)?.status)", after: "", test: engineering, pattern: "how it ran on the approved source" },
    // F6: a trusted-local audit was headed contained.
    { name: "audit-headed-contained", file: "packages/cli/src/contained-cli.ts", before: 'value.limits.includes(TRUSTED_LOCAL_SENTENCE) ? "Trusted-local" : "Contained"', after: '"Contained"', test: audit, pattern: "headed trusted-local" },
    // F7: one result shown as two unlabelled identities.
    { name: "send-identity-unlabelled", file: "packages/board/src/job-render.ts", before: "This sends the exact reviewed result. Its source tree is ${value.candidateTree}", after: "This sends the exact reviewed result: ${value.candidateTree}", test: page, pattern: "labels the candidate commit" },
    { name: "record-identity-unlabelled", file: "packages/board/src/job-render.ts", before: 'Candidate source tree ${value.candidateTree ?? "Not recorded"}', after: 'Candidate ${value.candidateTree ?? "Not recorded"}', test: page, pattern: "labels the candidate commit" },
    // F8, F9: the skill called trusted-local work contained; the guide said to start approved work.
    { name: "skill-calls-it-contained", file: "integrations/wringer/SKILL.md", before: "description: Check changes with Wringer evidence or propose a bounded Wringer job, contained or trusted-local,", after: "description: Check changes with Wringer evidence or propose a bounded contained Wringer job,", test: door, pattern: "skill and guides" },
    { name: "guide-says-start", file: "docs/START_AGENT.md", before: "3. Approval starts the work by itself.", after: "3. Once approved, `wringer.start` with the revision. Approval starts the work by itself.", test: door, pattern: "skill and guides" },
], { baseline: "d05bfa56ccb54a2aea3f90339199bd725c3a195e" });
