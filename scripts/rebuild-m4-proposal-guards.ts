import { runReversions } from "./rebuild-reversions";
const source = "packages/application/src/assistant.ts", test = "packages/application/test/proposal-revision.test.ts", composition = "packages/application/src/proposal-composition.ts", compositionTest = "packages/application/test/proposal-composition.test.ts";
await runReversions("m4-proposal", [test, compositionTest], [
    { name: "superseded-approval", file: source, before: 'insist(!await assistantExists(root, jobFile(p.id, "supersession")), "superseded"', after: 'insist(true, "superseded"', test, pattern: "question revision keeps" },
    { name: "original-request", file: source, before: "args.proposal.intent === parent.intent", after: "true", test, pattern: "stale revisions and rewritten" },
    { name: "stale-proposal", file: source, before: "args.expectedRevision === hashValue(parent)", after: "true", test, pattern: "stale revisions and rewritten" },
    { name: "approved-supersession", file: source, before: '!await approval(root, parent) && !await lifecycleMarker(root, parent, "started")', after: '!await lifecycleMarker(root, parent, "started")', test, pattern: "question revision keeps" },
    { name: "approval-lock", file: source, before: "return withAssistantProposalLock(root, () => approveCurrentProposal(root, input));", after: "return approveCurrentProposal(root, input);", test, pattern: "held decision lock" },
    { name: "superseded-status", file: source, before: 'const effectiveStatus = supersession ? "superseded" : cancelled', after: 'const effectiveStatus = false ? "superseded" : cancelled', test, pattern: "question revision keeps" },
    { name: "mutable-ceiling", file: composition, before: "Number(value) > budget[key as keyof ExecutionBudget]", after: "false", test: compositionTest, pattern: "useful field errors" },
    { name: "pinned-policy", file: composition, before: "!allowed.includes(key)", after: "false", test: compositionTest, pattern: "useful field errors" },
]);
