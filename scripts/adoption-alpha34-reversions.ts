/** alpha.34: each guard of the trusted-local runtime, its records and refusals, and the
 * distribution's withheld operating contracts is removed alone in an isolated copy,
 * watched red, restored and watched green. Real git and host processes; fixture ACP
 * agents, no model.
 *   bun scripts/adoption-alpha34-reversions.ts [--check-targets] [--only NAME,NAME] */
import { runReversions, type Reversion } from "./rebuild-reversions";

const policy = "packages/runtime/src/policy.ts", host = "packages/runtime/src/trusted-local.ts", compile = "packages/plan/src/compile.ts", family = "packages/plan/src/family.ts";
const assistant = "packages/application/src/assistant.ts", jobs = "packages/application/src/delegation-jobs.ts", profile = "packages/application/src/delegation-profile.ts";
const delivery = "packages/delivery/src/contained.ts", falsify = "packages/delivery/src/contained-falsify.ts", docs = "scripts/distribution-docs.ts";
const runtimeTest = "packages/runtime/test/trusted-local.test.ts", planTest = "packages/plan/test/trusted-local-plan.test.ts", journey = "packages/application/test/trusted-local-journey.test.ts";
const profileTest = "packages/application/test/delegation-profile.test.ts", docsTest = "packages/cli/test/distribution-docs.test.ts";
const protocol = "packages/application/src/delegation-protocol.ts", ownerTest = "packages/cli/test/delegation-owner.test.ts";
const page = "packages/board/src/job-render.ts", pageModel = "packages/board/src/job-model.ts", pageTest = "packages/board/test/job-render.test.ts";
const jobFlow = "packages/cli/src/assistant-job.ts", jobFlowTest = "packages/cli/test/assistant-job.test.ts", changeReader = "packages/application/src/candidate-change.ts", changeTest = "packages/application/test/candidate-change.test.ts";
const workflow = "packages/workflow/src/contained.ts", stopTest = "packages/workflow/test/role-stop.test.ts", workflowTest = "packages/workflow/test/contained.test.ts", outcome = "packages/workflow/src/worker-outcome.ts";
const cases: Reversion[] = [
    // The policy is explicit and claims nothing it cannot enforce.
    { name: "policy-refuses-enforced-network", file: policy, before: 'if (!object(value.network) || Object.keys(value.network).length !== 1 || value.network.policy !== "unenforced")', after: "if (false)", test: runtimeTest, pattern: "trusted-local is an explicit policy" },
    { name: "policy-refuses-container-settings", file: policy, before: 'if (!["kind", "network", "env"].includes(key))', after: "if (false)", test: runtimeTest, pattern: "trusted-local is an explicit policy" },
    // Records match their runtime only when they say what happened.
    { name: "provenance-carries-the-sentence", file: policy, before: " && Array.isArray(p.limits) && p.limits.includes(TRUSTED_LOCAL_SENTENCE);", after: ";", test: runtimeTest, pattern: "matches only a trusted-local runtime" },
    { name: "provenance-contained-is-not-v3", file: policy, before: "    return p.schema_version !== TRUSTED_LOCAL_PROVENANCE && p.image === policy.image", after: "    return p.image === policy.image", test: runtimeTest, pattern: "matches only a trusted-local runtime" },
    // Host processes: a short fixed environment, no design tools, pinned inputs, observed source changes.
    { name: "host-environment-allowlist", file: host, before: "    for (const name of BASE_ENVIRONMENT) if (process.env[name] !== undefined) env[name] = process.env[name];", after: "    Object.assign(env, process.env);", test: runtimeTest, pattern: "only the account's identity" },
    { name: "host-refuses-design", file: host, before: "    if (request.design) throw new RuntimeError(", after: "    if (false) throw new RuntimeError(", test: runtimeTest, pattern: "design references need a contained runtime" },
    { name: "host-pinned-check-inputs", file: host, before: "            if (candidate !== authority) throw new RuntimeError(", after: "            if (false) throw new RuntimeError(", test: runtimeTest, pattern: "changed a pinned check input" },
    { name: "host-observes-source-change", file: host, before: "        const changed = sourceStatus(before) !== sourceStatus(after);", after: "        const changed = false;", test: runtimeTest, pattern: "checks run in a fresh clone" },
    // Plans and record families: only v5 names it, and its records are siblings.
    { name: "plan-v5-only-names-trusted-local", file: compile, before: "        if (r.kind !== \"trusted-local\")\n            throw new Error(\"A version 5 plan names", after: "        if (false)\n            throw new Error(\"A version 5 plan names", test: planTest, pattern: "no older plan can name trusted-local" },
    { name: "plan-older-refuses-trusted-local", file: compile, before: "    if (r.kind === \"trusted-local\")\n        throw new Error(\"A trusted-local runtime needs a version 5 plan", after: "    if (false)\n        throw new Error(\"A trusted-local runtime needs a version 5 plan", test: planTest, pattern: "no older plan can name trusted-local" },
    { name: "family-trusted-local-siblings", file: family, before: "(trustedLocalPlan(plan) && kind in TRUSTED_LOCAL_RECORDS ?", after: "(false ?", test: planTest, pattern: "never accepted for a contained plan" },
    // Refusals at the edges: protected mode, a mislabelled workspace, profile options, falsification.
    { name: "protected-mode-refuses-trusted-local", file: assistant, before: "    insist(input.cooperativeLocal || (input.plan as", after: "    insist(true || (input.plan as", test: journey, pattern: "protected mode refuses a trusted-local plan" },
    { name: "workspace-boundary-matches-profile", file: jobs, before: "        if (workspace.boundary.execution !== (profile.plan.runtime.kind === \"trusted-local\" ? \"trusted-local\" : \"contained\")) throw", after: "        if (false) throw", test: profileTest, pattern: "R-1" },
    { name: "profile-refuses-provision-and-network", file: profile, before: "    if (trustedLocal && (selection.provisionId || selection.readinessId || selection.network)) throw", after: "    if (false) throw", test: profileTest, pattern: "R-1" },
    { name: "falsify-refuses-trusted-local", file: falsify, before: "    if (plan.runtime.kind === \"trusted-local\") { await rm(scratch", after: "    if (false) { await rm(scratch", test: journey, pattern: "from proposal to review, stamped" },
    { name: "delivery-states-the-runtime", file: delivery, before: "plan.runtime.kind === \"trusted-local\" ? trustedLocalLimitations : limitations;", after: "limitations;", test: journey, pattern: "from proposal to review, stamped" },
    // Found by the pre-release rehearsal: the earlier response versions pin a contained boundary.
    { name: "owner-answers-in-response-sibling", file: protocol, before: 'RESPONSE = trusted ? "wringer.assistant-response.v3" : "wringer.assistant-response.v2"', after: 'RESPONSE = "wringer.assistant-response.v2"', test: ownerTest, pattern: "R-1 a trusted-local workspace answers" },
    { name: "owner-answers-in-setup-sibling", file: protocol, before: 'SETUP = trusted ? "wringer.delegation-setup.v2" : "wringer.delegation-setup.v1"', after: 'SETUP = "wringer.delegation-setup.v1"', test: ownerTest, pattern: "R-1 a trusted-local workspace answers" },
    { name: "revision-records-v5-successor", file: assistant, before: 'plan?.schema_version === "wringer.execution-plan.v5" ? "wringer.proposal-supersession.v2" : "wringer.proposal-supersession.v1";', after: '"wringer.proposal-supersession.v1";', test: ownerTest, pattern: "R-1 a trusted-local workspace answers" },
    { name: "job-status-states-the-boundary", file: jobs, before: 'execution: workspace.boundary.execution }', after: 'execution: "contained" }', test: profileTest, pattern: "R-1" },
    { name: "page-says-where-work-runs", file: page, before: 'value.execution === "trusted-local" ? "Delegation · on this computer, nothing contained" : ', after: "", test: pageTest, pattern: "a trusted-local delegation says on the page" },
    { name: "page-model-admits-only-delegation", file: pageModel, before: '|| !(v.execution === undefined || v.execution === "trusted-local" && v.mode !== "verification")', after: "", test: pageTest, pattern: "a trusted-local delegation says on the page" },
    { name: "stopped-worker-says-why", file: workflow, before: 'refuse("worker-stopped", describeRoleStop("worker", effect.result!),', after: 'refuse("worker-stopped", effect.result!.stopReason,', test: workflowTest, pattern: "known stopped and invalid replies" },
    { name: "stop-message-never-carries-narrative", file: outcome, before: 'typeof failure?.error?.message === "string" ? failure.error.message : ""', after: 'String(failure?.error?.message ?? (result as any).text ?? "")', test: stopTest, pattern: "never the agent's own words" },
    { name: "stopped-role-names-sign-in", file: outcome, before: 'failure?.error?.data?.errorKind === "authentication_failed" ||', after: "", test: stopTest, pattern: "sign-in failure" },
    { name: "page-shows-the-change", file: page, before: "changePanel.hidden = !change;", after: "changePanel.hidden = true;", test: pageTest, pattern: "what a result changed" },
    { name: "change-reader-bounds-patch", file: changeReader, before: "patch.length > CHANGE_PATCH_LIMIT ? patch.slice(0, CHANGE_PATCH_LIMIT) : patch", after: "patch", test: changeTest, pattern: "cut at its bound" },
    { name: "no-claimed-acceptance-without-a-person", file: jobFlow, before: 'const settled = human.length ? "Your result is accepted." :', after: 'const settled = true ? "Your result is accepted." :', test: jobFlowTest, pattern: "reopening a job preserves an uncertain send" },
    { name: "delivery-says-falsify-refuses", file: delivery, before: 'plan?.runtime.kind === "trusted-local"\n    ? {', after: 'false\n    ? {', test: journey, pattern: "from proposal to review, stamped" },
    // Installs never carry an agent operating contract.
    { name: "docs-withhold-operating-contract", file: docs, before: "            if (operatingContract(resolved.path)) {", after: "            if (false) {", test: docsTest, pattern: "maintainer instructions" },
    { name: "docs-validator-refuses-operating-contract", file: docs, before: "    if (contract) throw new Error(", after: "    if (false) throw new Error(", test: docsTest, pattern: "maintainer instructions" },
];
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
if (only) for (const name of only) if (!cases.some(row => row.name === name)) throw new Error(`Unknown probe ${name}`);
const selected = only ? cases.filter(row => only.includes(row.name)) : cases;
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const row of cases) if ((await Bun.file(row.file).text()).split(row.before).length !== 2) throw new Error(`Mutation target is absent or not unique: ${row.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} alpha.34 isolated reversion targets`);
else await runReversions("adoption-alpha34", [runtimeTest, planTest, journey, profileTest, docsTest, ownerTest, pageTest, stopTest, workflowTest, jobFlowTest, changeTest], selected, { baseline: revision.stdout.toString().trim(), evidenceDirectory: only ? "docs/adoption/evidence/alpha34/reversions-followup" : "docs/adoption/evidence/alpha34/reversions" });
