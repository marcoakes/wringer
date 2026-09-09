import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileExecutionPlan, compileDeclaration, hashValue } from "@wringer/plan";
import { initializeAssistant, createAssistantService, issueAssistantCapability } from "../src/assistant";
import { connectImprovements, futureImprovementTemplate, inspectImprovements, prepareImprovementTest } from "../src/improvements";
import { registerExperiment } from "../src/experiments";
import { exclusiveJson, stamped } from "../src/experiment-store";

test("adoption changes only a future unapproved template; stale source and evidence downgrade cannot inherit it", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-future-approach-")));
    try {
        const controller = join(root, "controller"), research = join(root, "research"), registry = join(root, "registry"), experiment = join(research, "experiments", "example");
        for (const path of [controller, research, registry, join(research, "experiments"), experiment]) await mkdir(path, { mode: 0o700 });
        const old = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
        const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...declaration } = old;
        const profile = compileDeclaration({ version: 3, ...declaration, acceptance: { ...old.acceptance, protected_paths: [...old.acceptance.protected_paths, "guide.json"], checks: old.acceptance.checks.map(check => ({ ...check, evidence: { kind: "assertions", format: "wringer-check.v1" } })) } });
        const proposed = (intent: string, selected: boolean) => {
            const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...data } = profile;
            return compileDeclaration({ version: 3, ...data, intent, ...(selected ? { playbook: { path: "guide.json", sha256: "a".repeat(64), taskFamily: "reports" } } : {}) });
        };
        // Synthetic registry/source identities test selection wiring, never measured benefit.
        const registration = await registerExperiment(experiment, { id: "example", taskFamily: "reports", repository: profile.repository.url, baselinePlaybook: null, candidatePlaybook: "a".repeat(64), changedVariable: "worker-playbook", tasks: Array.from({ length: 4 }, (_, index) => ({ id: `task-${index}`, sourceTree: String(index + 1).repeat(40), split: "held-out" as const, baseline: proposed(profile.intent + ` Task ${index}`, false), candidate: proposed(profile.intent + ` Task ${index}`, true) })), repetitions: 1, order: "alternating-pairs", stratum: { platform: "darwin", modelSelection: "fixture-only", adapterSelection: "fixture-only" }, prediction: { statement: "Reduce worker attempts by at least one without regressions", metric: "worker-attempts", minimumImprovement: 1, minimumHeldOutPairs: 4, maximumSignProbability: 0.05, visualQualityClaim: false }, limits: { maxTrials: 8, maxRoleSessions: 4096, wallClockSeconds: 3600 }, dataScope: "this-repository-only", holdout: { corpusId: "fixture", candidateIteration: 1, maximumCandidateIterations: 1, candidateAuthorSawHeldOutSolutions: false }, accounting: "all-planned-trials-including-failures", stoppingRule: "fixed-sample-no-extension" });
        const { workspace } = await initializeAssistant(controller, { plan: profile, cooperativeLocal: true });
        await connectImprovements(controller, { researchRoot: research, registryRoot: registry, taskFamily: "reports" });
        const service = await createAssistantService(controller), capability = await issueAssistantCapability(controller, new Date(Date.now() + 60000).toISOString());
        const submitted = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: profile.intent, plan: profile });
        expect(submitted.outcome).toBe("awaiting-approval");
        const retained = await service.inspectProposal(submitted.jobId as string);
        const receipt = stamped({ schema_version: "wringer.playbook-adoption.v1", repository: profile.repository.url, taskFamily: "reports", action: "promote", actor: "Synthetic selection fixture", note: "Tests future-template wiring only, not eligibility", at: new Date().toISOString(), previousRevision: "0".repeat(64), previousDigest: null, selectedDigest: "a".repeat(64), experimentSha256: registration.plan.sha256, evidenceRevision: "b".repeat(64), appliesTo: "future-plans-only", executionApproved: false });
        await exclusiveJson(registry, "adoptions/000001.json", receipt);
        const originalEnvironment = process.env; let credentialReads = 0;
        // YAML's LOG_TOKENS debug switch is not a provider credential.
        process.env = new Proxy(originalEnvironment, { get(target, key) { if (typeof key === "string" && key !== "LOG_TOKENS" && /(?:KEY|TOKEN|SECRET|PASSWORD)/.test(key)) { credentialReads++; throw new Error("Read-only selection consulted credentials"); } return Reflect.get(target, key); } });
        let future: Awaited<ReturnType<typeof futureImprovementTemplate>>;
        try { future = await futureImprovementTemplate(controller, profile); } finally { process.env = originalEnvironment; }
        expect(credentialReads).toBe(0);
        expect(future.plan.playbook?.sha256).toBe("a".repeat(64)); expect(future.plan.playbook?.adoption?.sha256).toBe(receipt.sha256);
        expect(await service.inspectProposal(submitted.jobId as string)).toEqual(retained);
        expect(await service.inspectApproval(submitted.jobId as string)).toBeNull();
        const { schema_version: schema, plan_sha256: planHash, intent_sha256: intentHash, acceptance_sha256: acceptHash, ...data } = profile;
        const changed = compileDeclaration({ version: 3, ...data, repository: { ...profile.repository, commit: "f".repeat(40) } });
        expect((await futureImprovementTemplate(controller, changed)).plan).toEqual(changed);
        expect((await inspectImprovements(controller, profile)).experiments[0]!.result.eligibility).toBe("inconclusive");
        await expect(prepareImprovementTest(controller, profile, { experimentId: "example", expectedPlanSha256: "0".repeat(64), actor: "Fixture", expiresAt: new Date(Date.now() + 60000).toISOString() })).rejects.toThrow("changed");
        const downgraded = compileDeclaration({ version: 3, ...data, acceptance: { ...profile.acceptance, checks: profile.acceptance.checks.map(({ evidence, ...check }) => check) } });
        expect((await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: profile.intent, plan: downgraded })).outcome).toBe("refused");
        expect(hashValue(await service.inspectProposal(submitted.jobId as string))).toBe(hashValue(retained));
        const changedSelection = compileDeclaration({ version: 3, ...data, playbook: { path: "guide.json", sha256: "c".repeat(64), taskFamily: "reports" } });
        expect((await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: profile.intent, plan: changedSelection })).outcome).toBe("refused");
        const { sha256: ignored, ...receiptBody } = receipt;
        const rollbackReceipt = stamped({ ...receiptBody, action: "rollback", previousRevision: receipt.sha256, previousDigest: receipt.selectedDigest, selectedDigest: null });
        await exclusiveJson(registry, "adoptions/000002.json", rollbackReceipt);
        expect((await futureImprovementTemplate(controller, changedSelection)).plan).toEqual(changedSelection);
        const rolledBack = (await futureImprovementTemplate(controller, future.plan)).plan;
        expect(rolledBack.playbook).toBeUndefined();
        expect(rolledBack.approachAdoption?.sha256).toBe(rollbackReceipt.sha256);
        expect((await futureImprovementTemplate(controller, profile)).plan.approachAdoption?.sha256).toBe(rollbackReceipt.sha256);
        expect(hashValue(await service.inspectProposal(submitted.jobId as string))).toBe(hashValue(retained));
    } finally { await rm(root, { recursive: true, force: true }); }
});
