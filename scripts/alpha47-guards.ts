/** Isolated reversions of alpha.47, the evidence layer riding the pull request: a forge chosen at
 * setup rides each job, and its Send pushes and opens a pull or merge request whose description is
 * the delivery's mr.md. Each repair is undone alone in a scratch copy, and the test that names it must
 * turn red. Nothing here runs an agent, a model, the network or a real token. */
import { runReversions } from "./rebuild-reversions";
const cli = "packages/cli/test/alpha47.test.ts", send = "packages/application/test/forge-send.test.ts", forge = "packages/delivery/test/forge.test.ts", redactor = "packages/engine/test/redactor.test.ts", doors = "packages/cli/test/alpha44.test.ts";
const setup = "packages/cli/src/adoption-cli.ts", workspaces = "packages/application/src/workspaces.ts", jobs = "packages/application/src/delegation-jobs.ts", page = "packages/cli/src/assistant-job.ts", forgeSource = "packages/delivery/src/forge.ts";
await runReversions("alpha47-guards", [cli, send, forge, redactor, doors], [
    // Setup records the forge and says what Send will open.
    { name: "setup-forge-flags-ignored", file: setup, before: "if ([kind, repo, tokenEnv, endpoint].every(value => value === undefined)) return remote && base ? { remote, base } : undefined;", after: "if (true) return remote && base ? { remote, base } : undefined;", test: cli, pattern: "shows the pull request Send will open" },
    { name: "preview-forge-hidden", file: setup, before: 'if (!("forge" in checked) || !checked.forge) return { remote: checked.remote, base: checked.base, recorded };', after: "if (true) return { remote: checked.remote, base: checked.base, recorded };", test: cli, pattern: "shows the pull request Send will open" },
    { name: "remote-binding-unchecked", file: workspaces, before: "try { assertForgeRepositoryBinding(url, forge); }", after: "try { if (false) assertForgeRepositoryBinding(url, forge); }", test: cli, pattern: "refused at setup with what to do" },
    { name: "credential-url-echoed", file: workspaces, before: "if (new Redactor().scrub(url) !== url || /^https:\\/\\/[^/]*@/i.test(url)) throw", after: "if (false) throw", test: cli, pattern: "holding a credential is refused without echoing it" },
    { name: "verification-forge-admitted", file: workspaces, before: 'if (mode !== "delegation") throw new Error("A verification workspace sends a branch only.', after: 'if (false) throw new Error("A verification workspace sends a branch only.', test: cli, pattern: "refused at setup with what to do" },
    { name: "workspace-forge-dropped", file: workspaces, before: '...("forge" in checked ? { forge: checked.forge } : {})', after: "...({})", test: cli, pattern: "rides each new job into its approval destination" },
    { name: "job-forge-dropped", file: jobs, before: "destination = { ...destination, forge };", after: "destination = { ...destination };", test: cli, pattern: "rides each new job into its approval destination" },
    // A missing token is refused before anything is pushed, at each layer, and names the variable.
    { name: "page-token-unchecked", file: page, before: "if (refusal) throw new Error(sendNeedsToken(refusal, parseForgeConfiguration(forge)));", after: "if (false) throw new Error(sendNeedsToken(refusal, parseForgeConfiguration(forge)));", test: send, pattern: "opens a pull request whose description" },
    { name: "page-token-unnamed-before-click", file: page, before: "nextAction = missingToken ? `${settled} ${sendNeedsToken(missingToken, forge!)}` :", after: "nextAction = false ? `${settled} ${sendNeedsToken(missingToken!, forge!)}` :", test: send, pattern: "opens a pull request whose description" },
    { name: "queue-token-unchecked", file: "packages/application/src/commands.ts", before: "    await assertSendCredential(state, command);\n", after: "", test: send, pattern: "opens a pull request whose description" },
    { name: "delivery-token-unchecked", file: "packages/delivery/src/contained.ts", before: "if (credentialRefusal) throw new Error(credentialRefusal);", after: "if (false) throw new Error(credentialRefusal!);", test: send, pattern: "opens a pull request whose description" },
    // The page shows what Send opens and links the open request.
    { name: "page-opens-hidden", file: page, before: "...(forge ? { opens: { request: forgeRequestName(forge.kind), repository: forge.repo, tokenEnv: forge.token_env } } : {})", after: "...({})", test: send, pattern: "opens a pull request whose description" },
    { name: "request-link-dropped", file: "packages/application/src/assistant.ts", before: "...(publication.forge?.url ? { url: publication.forge.url } : {}), ...(publication.forge?.reason", after: "...({}), ...(publication.forge?.reason", test: send, pattern: "opens a pull request whose description" },
    // A branch sent whose request was not opened can be sent again: nothing new is pushed, one request is opened.
    { name: "request-retry-refused", file: "packages/application/src/commands.ts", before: 'if (command.action === "publish" && workspaceRequestRetryable(latest) &&', after: "if (false &&", test: send, pattern: "can be sent again once the cause is fixed" },
    { name: "page-retry-not-offered", file: page, before: "if (requestNotOpened && sends < MAX_SENDS) {", after: "if (false) {", test: send, pattern: "can be sent again once the cause is fixed" },
    { name: "retry-reuses-first-send", file: page, before: 'return await queue(jobId, (await details(jobId)).sendId, "publish"', after: 'return await queue(jobId, purposeId(jobId, current.candidateTree, `send/${current.preparedId}`, 0), "publish"', test: send, pattern: "can be sent again once the cause is fixed" },
    // An HTTPS push authenticates with the same token, for that host only.
    { name: "https-push-uncredentialed", file: forgeSource, before: 'if (url.protocol !== "https:") return null;', after: "return null;", test: forge, pattern: "HTTPS push credential answers only its host" },
    { name: "push-credential-unscoped", file: forgeSource, before: "`credential.${url.origin}.helper=!f()", after: "`credential.helper=!f()", test: forge, pattern: "HTTPS push credential answers only its host" },
    // A GitHub fine-grained token's public "github_pat_" prefix is not a credential fragment.
    { name: "token-prefix-fragment", file: "packages/engine/src/redactor.ts", before: "|github_pat_|gh[pousr]_|gl(?:pat|dt|rt|ptt|ft|cbt|imt|oas|soat)-|sk-(?:proj-|ant-)?)/", after: ")/", test: redactor, pattern: "public type prefix is not a fragment" },
    { name: "token-prefix-fragment-blocks-send", file: "packages/engine/src/redactor.ts", before: "|github_pat_|gh[pousr]_|gl(?:pat|dt|rt|ptt|ft|cbt|imt|oas|soat)-|sk-(?:proj-|ant-)?)/", after: ")/", test: send, pattern: "opens a pull request whose description" },
    // The two fixes carried from work/alpha47.
    { name: "app-dir-file-raw-eexist", file: "packages/application/src/assistant-store.ts", before: 'catch (error: any) { if (error?.code !== "EEXIST" && error?.code !== "ENOTDIR") throw error; throw privateDirectoryRefusal(path, await lstat(path)); }', after: "catch (error: any) { throw error; }", test: doors, pattern: "application directory should be is named" },
    { name: "improvements-superseded-revision", file: setup, before: "await assistantExists(root, `delegation-jobs/${id}.json`) ? await delegationCurrentRevision(root, id) : id", after: "id", test: cli, pattern: "job improvements follows" },
], { baseline: "0c15f44b7d3be5e4f6fe004a09c3eb44e3829df2" });
