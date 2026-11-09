/** Isolated reversions of what the 2026-11-09 end-to-end review found at the doors (alpha.44, "the
 * doors, honestly"): each repair is undone alone in a scratch copy, and the test that names it must
 * turn red. Findings in ~/Claude/WRINGER_E2E_AND_MARKET_REVIEW_2026-11-09.md, Part A §A2–A3. Nothing
 * here runs an agent or a model; the job page runs in a headless browser. */
import { runReversions } from "./rebuild-reversions";
const doors = "packages/cli/test/alpha44.test.ts", journey = "packages/application/test/trusted-local-journey.test.ts", server = "packages/mcp/test/server.test.ts";
const delegationTools = "packages/mcp/test/delegation-contract.test.ts", verificationTools = "packages/mcp/test/verification-contract.test.ts", demo = "packages/cli/test/verification-door.test.ts";
const owner = "packages/cli/src/delegation-owner.ts", cli = "packages/cli/src/adoption-cli.ts", adapters = "packages/cli/src/client-adapters.ts", protocol = "packages/application/src/delegation-protocol.ts";
await runReversions("alpha44-guards", [doors, journey, server, delegationTools, verificationTools, demo], [
    // W1: a 0755 application directory was refused with "wring --help" as the way out.
    { name: "w1-refusal-unnamed", file: "packages/application/src/assistant-store.ts", before: "return new EngineError(`${path} ${reason}. Wringer keeps its records only in an operator-owned private directory (mode 0700). Nothing was changed.`, 2, move);", after: 'return new Error("Controller must be an operator-owned private directory (mode 0700)");', test: doors, pattern: "others can read" },
    { name: "w1-next-is-help", file: "packages/application/src/assistant-store.ts", before: "Nothing was changed.`, 2, move);", after: "Nothing was changed.`, 2);", test: doors, pattern: "others can read" },
    // N1: the setup preview did not show the destination it would record.
    { name: "n1-preview-omits-destination", file: cli, before: "return remote && base ? { ...preview, destination: { remote, base,", after: "return remote && base ? { ...preview, recordedLater: { remote, base,", test: doors, pattern: "destination it will record" },
    { name: "n1-text-omits-destination", file: cli, before: "nothing is contained.\\n${destinationLine(trusted)}\\nRepeat with", after: "nothing is contained.\\nRepeat with", test: doors, pattern: "destination it will record" },
    // W2: connect left .mcp.json and the skill untracked in the repository, and said nothing.
    { name: "w2-no-exclude", file: adapters, before: "if (missing.length) after = ", after: "if (false) after = ", test: doors, pattern: "not to commit" },
    { name: "w2-exclude-refused-at-apply", file: adapters, before: "[locations.config, locations.skill, ...(exclude ? [exclude] : [])]", after: "[locations.config, locations.skill]", test: doors, pattern: "not to commit" },
    { name: "w2-text-silent", file: cli, before: '.join("") + ((result as { repositoryFiles?: { advice: string } }).repositoryFiles ?', after: '.join("") + (false ?', test: doors, pattern: "not to commit" },
    // W3: the tool list was 166,286 compact bytes, 148,488 of them output schemas.
    { name: "w3-delegation-lists-output-schemas", file: "packages/mcp/src/delegation-contract.ts", before: "tools: () => DELEGATION_TOOLS.map(({ outputSchema, ...row }) => row),", after: "tools: () => DELEGATION_TOOLS,", test: server, pattern: "under 25 KB" },
    { name: "w3-verification-lists-output-schemas", file: "packages/mcp/src/verification-contract.ts", before: "tools: () => VERIFICATION_TOOLS.map(({ readOnly, ...tool }) => ({ ...tool, annotations:", after: "tools: () => VERIFICATION_TOOLS.map(({ readOnly, ...tool }) => ({ ...tool, outputSchema: outputSchema(tool.name), annotations:", test: verificationTools, pattern: "T19" },
    { name: "w3-output-unvalidated", file: "packages/mcp/src/delegation-contract.ts", before: "if (!validate || !validate(output)) throw", after: "if (false) throw", test: server, pattern: "under 25 KB" },
    // W4: a stopped worker read "inspect, operator, not eligible", and the page named no one to retry.
    { name: "w4-status-inspect", file: protocol, before: 'if (retry) return { code: "continue"', after: 'if (false) return { code: "continue"', test: journey, pattern: "cannot start" },
    { name: "w4-continue-when-ineligible", file: protocol, before: 'view.actions?.find(row => row.enabled && ["retry-stopped"', after: 'view.actions?.find(row => ["retry-stopped"', test: journey, pattern: "cannot start" },
    { name: "w4-page-model-silent", file: "packages/cli/src/assistant-job.ts", before: "...(stop ? { stop } : {}), retryable", after: "retryable", test: journey, pattern: "cannot start" },
    { name: "w4-page-card-static", file: "packages/board/src/job-render.ts", before: 'el("blocked-step").textContent =', after: 'el("blocked-step").dataset.unused =', test: doors, pattern: "one job under the ID" },
    // W7: a revised request became a second job, and the person's ID opened the superseded one.
    { name: "w7-link-names-revision", file: owner, before: "pageUrl: `${origin}/?jobId=${(await proposalIdentity(controller, jobId)).rootJobId}`", after: "pageUrl: `${origin}/?jobId=${jobId}`", test: doors, pattern: "one job under the ID" },
    { name: "w7-picker-names-revision", file: owner, before: "jobs.set(named.rootJobId, { jobId: named.rootJobId,", after: "jobs.set(named.rootJobId, { jobId: named.currentJobId,", test: doors, pattern: "one job under the ID" },
    { name: "w7-page-shows-revision-id", file: owner, before: "const view = { ...read, jobId: named.rootJobId,", after: "const view = { ...read, jobId: read.jobId,", test: doors, pattern: "one job under the ID" },
    { name: "w7-decision-on-superseded", file: owner, before: "json(await current.flow.post(action, { ...input, jobId: named.currentJobId }))", after: "json(await current.flow.post(action, input))", test: doors, pattern: "one job under the ID" },
    { name: "w7-revision-link-lost", file: "packages/board/src/job-render.ts", before: "if (owner) selected = owner.jobId;", after: "", test: doors, pattern: "one job under the ID" },
    { name: "w7-list-two-jobs", file: cli, before: "if ((workspace && job.workspaceId !== workspace) || seen.has(rootJobId)) continue;", after: "if (workspace && job.workspaceId !== workspace) continue;", test: doors, pattern: "one job under the ID" },
    { name: "w7-open-names-revision", file: cli, before: 'if (workspace.mode === "delegation") id = (await delegationJobIdentity(root, id)).rootJobId;', after: "", test: doors, pattern: "one job under the ID" },
    { name: "w7-status-names-revision", file: "packages/application/src/delegation-jobs.ts", before: "jobId: rootJobId, ...(revision > 1 ? { requestRevision:", after: "jobId, ...(revision > 1 ? { requestRevision:", test: doors, pattern: "one job under the ID" },
    { name: "w7-report-silent", file: protocol, before: "job: { jobId: named.rootJobId, requestRevision: named.revision, recordedAs: jobId }, ", after: "", test: doors, pattern: "one job under the ID" },
    // The demo pointed at the standalone route, not the two doors the README leads with.
    { name: "demo-next-standalone", file: "packages/cli/src/app.ts", before: '\\nNext, in your own repository: read ${await startPage("START_PM.md")} if you decide on the work, or ${await startPage("START_AGENT.md")} if your coding assistant does it`', after: "\\nNext: wring start, in your own repository`", test: demo, pattern: "demo points" },
], { baseline: "58fb371b297d78871cc92fc0a20b3f69450e769b" });
