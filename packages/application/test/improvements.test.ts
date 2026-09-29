import { test, expect, spyOn } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileExecutionPlan, compileDeclaration, hashValue } from "@wringer/plan";
import { initializeAssistant, createAssistantService, issueAssistantCapability } from "../src/assistant";
import { connectImprovements, futureImprovementTemplate, inspectImprovements, prepareImprovementTest } from "../src/improvements";
import { registerExperiment } from "../src/experiments";
import { exclusiveJson, stamped } from "../src/experiment-store";
import * as improvementModule from "../src/improvements";
import * as experimentModule from "../src/experiments";

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
        const authored = { intent: profile.intent, title: profile.name, criteria: profile.acceptance.criteria, checks: profile.acceptance.checks.map(({ id, criteria }) => ({ id, criteria })) };
        const validation: any = await service.call(capability.token, "wringer.validate_proposal", { workspaceId: workspace.id, proposal: authored });
        expect(validation.plan?.playbook?.adoption?.sha256).toBe(receipt.sha256);
        expect(validation.canonicalIdentity).toBe(validation.plan.plan_sha256);
        const typedRequest = { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), proposal: authored };
        const typed = await service.call(capability.token, "wringer.propose", typedRequest);
        expect(typedRequest).not.toHaveProperty("plan");
        expect(typed.outcome).toBe("awaiting-approval");
        expect((await service.inspectProposal(String(typed.jobId))).plan?.playbook?.adoption?.sha256).toBe(receipt.sha256);
        const pending = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: profile.intent, title: profile.name, questions: ["Which result?"] } });
        const revisionRequest = { jobId: pending.jobId, expectedRevision: pending.revision, idempotencyKey: crypto.randomUUID(), proposal: authored };
        const revised = await service.call(capability.token, "wringer.revise_proposal", revisionRequest);
        expect(revised.outcome).toBe("awaiting-approval");
        expect((await service.inspectProposal(String(revised.jobId))).plan?.playbook?.adoption?.sha256).toBe(receipt.sha256);
        const { schema_version: schema, plan_sha256: planHash, intent_sha256: intentHash, acceptance_sha256: acceptHash, ...data } = profile;
        const changed = compileDeclaration({ version: 3, ...data, repository: { ...profile.repository, commit: "f".repeat(40) } });
        expect((await futureImprovementTemplate(controller, changed)).plan).toEqual(changed);
        for (const change of [
            { runtime: { ...profile.runtime, cpus: profile.runtime.cpus + 1 } },
            { agents: { ...profile.agents, worker: { ...profile.agents.worker, args: [...(profile.agents.worker.args ?? []), "--fixture-model-change"] } } },
            { environment: { ...profile.environment, context: [...profile.environment.context, "OTHER.md"] } },
            { acceptance: { ...profile.acceptance, checks: profile.acceptance.checks.map(check => ({ ...check, argv: [...check.argv, "--fixture-check-change"] })) } }
        ]) {
            const different = compileDeclaration({ version: 3, ...data, ...change });
            expect((await futureImprovementTemplate(controller, different)).plan).toEqual(different);
        }
        const { schema_version: experimentSchema, sha256: experimentHash, ...registeredInput } = registration.plan;
        const reusedDirectory = join(research, "experiments", "new-source"); await mkdir(reusedDirectory, { mode: 0o700 });
        const reused = structuredClone(registeredInput); reused.id = "new-source";
        for (const task of reused.tasks) for (const arm of ["baseline", "candidate"] as const) {
            const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...body } = task[arm];
            task[arm] = compileDeclaration({ version: 3, ...body, repository: changed.repository });
        }
        await registerExperiment(reusedDirectory, reused);
        expect((await futureImprovementTemplate(controller, changed)).plan).toEqual(changed);
        expect((await inspectImprovements(controller, profile)).experiments[0]!.result.eligibility).toBe("inconclusive");
        const rows = await experimentModule.listExperiments(research);
        // Fuzz the domain projection's output capacity, without storing invented
        // research evidence or mistaking it for an eligible comparison.
        const sizeSpy = spyOn(experimentModule, "listExperiments").mockResolvedValue(rows.map(row => ({ ...row, result: { ...row.result, findings: Array(200).fill("x".repeat(16384)) } })));
        try { await expect(improvementModule.inspectJobImprovements(controller, profile, String(submitted.jobId))).rejects.toThrow("bounded view"); }
        finally { sizeSpy.mockRestore(); }
        await expect(prepareImprovementTest(controller, profile, { experimentId: "example", expectedPlanSha256: "0".repeat(64), actor: "Fixture", expiresAt: new Date(Date.now() + 60000).toISOString() })).rejects.toThrow("changed");
        const downgraded = compileDeclaration({ version: 3, ...data, acceptance: { ...profile.acceptance, checks: profile.acceptance.checks.map(({ evidence, ...check }) => check) } });
        expect((await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: profile.intent, plan: downgraded })).outcome).toBe("refused");
        expect(hashValue(await service.inspectProposal(submitted.jobId as string))).toBe(hashValue(retained));
        const changedSelection = compileDeclaration({ version: 3, ...data, playbook: { path: "guide.json", sha256: "c".repeat(64), taskFamily: "reports" } });
        expect((await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), intent: profile.intent, plan: changedSelection })).outcome).toBe("refused");
        const { sha256: ignored, ...receiptBody } = receipt;
        const rollbackReceipt = stamped({ ...receiptBody, action: "rollback", previousRevision: receipt.sha256, previousDigest: receipt.selectedDigest, selectedDigest: null });
        const racePending = await service.call(capability.token, "wringer.propose", { workspaceId: workspace.id, idempotencyKey: crypto.randomUUID(), proposal: { intent: profile.intent, title: profile.name, questions: ["Which evidence?"] } });
        const raceRequest = { jobId: racePending.jobId, expectedRevision: racePending.revision, idempotencyKey: crypto.randomUUID(), proposal: authored };
        let ready!: () => void, release!: () => void, held = false;
        const entered = new Promise<void>(resolve => { ready = resolve; }), barrier = new Promise<void>(resolve => { release = resolve; }), originalTemplate = improvementModule.futureImprovementTemplate;
        const spy = spyOn(improvementModule, "futureImprovementTemplate").mockImplementation(async (...args) => {
            const value = await originalTemplate(...args); if (!held) { held = true; ready(); await barrier; } return value;
        });
        try {
            const slow = service.call(capability.token, "wringer.revise_proposal", raceRequest); await entered;
            await exclusiveJson(registry, "adoptions/000002.json", rollbackReceipt);
            const winner = await service.call(capability.token, "wringer.revise_proposal", raceRequest); release();
            const observed = await slow;
            expect(winner.outcome).toBe("awaiting-approval"); expect(observed.outcome).toBe("awaiting-approval"); expect(observed.jobId).toBe(winner.jobId);
            expect((await service.inspectProposal(String(winner.jobId))).plan?.approachAdoption?.sha256).toBe(rollbackReceipt.sha256);
        } finally { release(); spy.mockRestore(); }
        expect((await futureImprovementTemplate(controller, changedSelection)).plan).toEqual(changedSelection);
        const rolledBack = (await futureImprovementTemplate(controller, future.plan)).plan;
        expect(rolledBack.playbook).toBeUndefined();
        expect(rolledBack.approachAdoption?.sha256).toBe(rollbackReceipt.sha256);
        expect((await futureImprovementTemplate(controller, profile)).plan.approachAdoption?.sha256).toBe(rollbackReceipt.sha256);
        const replay = await service.call(capability.token, "wringer.propose", typedRequest);
        expect(replay.outcome).toBe("awaiting-approval"); expect(replay.jobId).toBe(typed.jobId);
        const revisedReplay = await service.call(capability.token, "wringer.revise_proposal", revisionRequest);
        expect(revisedReplay.outcome).toBe("awaiting-approval"); expect(revisedReplay.jobId).toBe(revised.jobId);
        expect((await service.inspectProposal(String(typed.jobId))).plan?.playbook?.adoption?.sha256).toBe(receipt.sha256);
        expect(hashValue(await service.inspectProposal(submitted.jobId as string))).toBe(hashValue(retained));
        await chmod(registry, 0o755); // Future selection is unavailable; retained jobs still replay.
        expect((await service.call(capability.token, "wringer.propose", typedRequest)).outcome).toBe("awaiting-approval");
        expect((await service.call(capability.token, "wringer.revise_proposal", revisionRequest)).outcome).toBe("awaiting-approval");
    } finally { await rm(root, { recursive: true, force: true }); }
});
