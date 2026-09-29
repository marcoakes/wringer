/** Each logical integration fix is removed in an isolated copy, watched red,
 * restored and watched green before another mutation. No live dispatch. */
import { runReversions, type Reversion } from "./rebuild-reversions";
const job = "packages/cli/test/job-improvements.test.ts", future = "packages/application/test/improvements.test.ts", protocol = "packages/application/test/delegation-protocol.test.ts", browser = "scripts/job-improvements-browser.test.ts", collections = "packages/cli/test/improvement-collections.test.ts";
const cases: Reversion[] = [];
const probe = (name: string, file: string, before: string, after: string, test: string, pattern: string) => cases.push({ name, file, before, after, test, pattern });
const assistant = "packages/application/src/assistant.ts", improvements = "packages/application/src/improvements.ts", binding = "packages/application/src/job-improvements.ts", command = "packages/cli/src/experiment-cli.ts", owner = "packages/cli/src/delegation-owner.ts", page = "packages/board/src/improvements-render.ts", manager = "packages/cli/src/improvement-collections.ts";
probe("ordinary-cli-view", "packages/cli/src/adoption-cli.ts", 'if (verb === "improvements")', 'if (verb === "retired-improvements")', job, "ordinary job improvement CLI");
probe("mcp-view-routing", "packages/application/src/delegation-protocol.ts", 'if (name === "wringer.inspect_improvements")', 'if (name === "wringer.retired_improvements")', protocol, "T07 T08");
probe("mcp-auth-before-private-read", "packages/application/src/delegation-protocol.ts", 'if (name === "wringer.inspect_improvements") {\n                const observed = await service.call(token, "wringer.get_status", { jobId: args.jobId });\n                if (observed.isError) return refusal(String(observed.code), String(observed.message));', 'if (name === "wringer.inspect_improvements") {\n                const observed = await service.call(token, "wringer.get_status", { jobId: args.jobId });', protocol, "T07 T08");
probe("no-new-view-authority", "schema/job-improvements-v1.schema.json", '"title": "Read-only job improvements and exact applicability",\n  "type": "object",\n  "additionalProperties": false', '"title": "Read-only job improvements and exact applicability",\n  "type": "object",\n  "additionalProperties": true', protocol, "T07 T08");
probe("explicit-unapproved-future", "schema/job-improvements-v1.schema.json", '"executionApproved": {\n          "const": false\n        }', '"executionApproved": {\n          "type": "boolean"\n        }', protocol, "T07 T08");
probe("typed-future-selection", assistant, 'value.plan = (await futureImprovementTemplate(root, value.plan)).plan;', '// Future approach composition removed for the probe.', future, "adoption changes");
probe("adopted-comparison-source-only", improvements, '.filter(row => row.plan.sha256 === selected.experimentSha256)', '', future, "adoption changes");
probe("bounded-public-improvement-view", improvements, 'if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)', 'if (false)', future, "adoption changes");
probe("validation-plan-identity", assistant, 'value.canonicalIdentity = value.plan.plan_sha256;', '// Canonical identity update removed.', future, "adoption changes");
probe("validation-uses-future-composition", assistant, 'return composed(args.proposal, true);', 'return composeAuthorableProposal(workspace.profile, args.proposal);', future, "adoption changes");
probe("caller-input-unchanged", assistant, 'const args = { ...exact(raw, fields[name]!) };', 'const args = exact(raw, fields[name]!);', future, "adoption changes");
probe("retained-proposal-before-future-lookup", assistant, 'if (await withAssistantProposalLock(root, () => observeAuthored(retainedId, authored))) return presentedStatus(retainedId);', '// Retained replay shortcut removed.', future, "adoption changes");
probe("retained-revision-before-future-lookup", assistant, 'const next = retained ? retained.successor : await composed(args.proposal);', 'const next = await composed(args.proposal);', future, "adoption changes");
probe("revision-replay-preserves-selection", assistant, 'transition = existing; successor = existing.successor;', '// Replayed successor replacement removed.', future, "adoption changes");
for (const [name, expression] of [
    ["source", "hashValue(plan.repository) === hashValue(profile.repository)"],
    ["runtime", "hashValue(plan.runtime) === hashValue(profile.runtime)"],
    ["models", "hashValue(plan.agents) === hashValue(profile.agents)"],
    ["environment", "hashValue(plan.environment) === hashValue(profile.environment)"],
    ["checks", "hashValue(plan.acceptance.checks) === hashValue(profile.acceptance.checks)"]
]) probe(`future-${name}-binding`, improvements, expression!, "true", future, "adoption changes");
probe("new-context-connection", "packages/application/src/delegation-jobs.ts", 'await inheritWorkspaceImprovements(root, workspaceId, controller, profile.plan);', '// New context inheritance removed.', "packages/application/test/delegation-profile.test.ts", "T18");
probe("registration-arguments-before-allocation", command, 'if (operation === "register") allowed(a, ["job", "app-dir", "experiment", "input"]);', '// Pre-allocation argument validation removed.', job, "job comparison registers");
probe("single-validated-registration-input", command, 'registerExperiment(location.state!, registration as Parameters<typeof registerExperiment>[1])', 'registerExperiment(location.state!, await readExperimentJson(resolve(repo, required(a, "input"))))', job, "one input validated");
probe("registered-handle-identity", binding, 'if (plan.id !== experimentId || plan.repository !== link.repository || plan.taskFamily !== link.taskFamily)', 'if (false)', job, "job comparison registers");
probe("retained-comparison-repository", binding, 'if (current.plan.id !== experimentId || current.plan.repository !== link.repository || current.plan.taskFamily !== link.taskFamily)', 'if (false)', job, "foreign repository");
probe("failure-pattern-job-plan", binding, 'await readJobLoopInspection(current.plan, state);', '// Job plan binding removed.', job, "failure patterns require");
probe("ordinary-page-integration", owner, 'withImprovementCard(renderPmJobWorkspace({ nonce }), nonce, { jobScoped: true })', 'renderPmJobWorkspace({ nonce })', job, "ordinary improvement MCP");
probe("operator-query-exact-job", owner, 'if ([...url.searchParams.keys()].join(",") !== "jobId")', 'if (false)', job, "ordinary improvement MCP");
probe("operator-workspace-binding", owner, 'if (job.workspaceId !== workspaceId) throw new Error("Job belongs to another workspace");', '// Workspace binding removed.', job, "ordinary improvement MCP");
probe("collection-no-duplicate-dispatch", manager, 'if (rows.has(prepared.reservationKey))', 'if (false)', collections, "explicit collection");
probe("collection-stop-abort", manager, 'for (const row of rows.values()) row.abort.abort();', 'for (const row of rows.values()) { /* abort removed */ }', collections, "explicit collection");
probe("collection-admission-after-preparation", manager, 'assertAccepting(); const prepared = await prepareImprovementTest(root, profile, input); assertAccepting();', 'assertAccepting(); const prepared = await prepareImprovementTest(root, profile, input);', collections, "concurrently with shutdown");
probe("collection-message-scope", manager, '.filter(row => row.root === root)', '.filter(() => true)', collections, "explicit collection");
probe("browser-decision-job-binding", page, '{ ...body, ...(jobScoped ? { jobId } : {}) }', 'body', browser, "ordinary job browser");
probe("browser-obsolete-job-read", page, 'if (busy || locked || own !== generation || jobId !== selectedJob()) return;', 'if (busy || locked) return;', browser, "ordinary job browser");
probe("browser-obsolete-job-decision", page, 'if (!locked && own === generation && jobId === selectedJob()) message.textContent = (error as Error).message', 'if (!locked) message.textContent = (error as Error).message', browser, "ordinary job browser");
probe("browser-lock-clears-research", page, 'locked = true; generation++; content.replaceChildren(); message.textContent = ""; panel.hidden = true;', 'locked = true; generation++;', browser, "ordinary job browser");
const revision = Bun.spawnSync(["git", "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
if (revision.exitCode) throw new Error("Could not record source baseline");
for (const probe of cases) if ((await Bun.file(probe.file).text()).split(probe.before).length !== 2) throw new Error(`Mutation target is not unique: ${probe.name}`);
if (process.argv.includes("--check-targets")) console.log(`${cases.length} phase-2 isolated reversion targets`);
else await runReversions("restoration-phase2", [job, future, protocol, collections, browser, "packages/application/test/delegation-profile.test.ts"], cases, { baseline: revision.stdout.toString().trim(), evidenceDirectory: "docs/restoration/evidence/phase-2", restoreEach: true });
