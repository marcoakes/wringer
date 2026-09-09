import { expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutionAuthority, hashValue } from "@wringer/plan";
import { auditContained, deliverContained } from "@wringer/delivery";
import { controllerStatus, readController, reviewControllerDecisions } from "../src/controller";
import { hasActiveWorkspaceCommand, latestWorkspacePublication, queueWorkspaceCommand, readWorkspaceCommand } from "../src/commands";

// Real application/journal/delivery with explicitly synthetic ACP and display
// observations. No provider, live containment, UI or external publication.
test("explicit operator choice derives attribution, preserves absent comments and reaches an auditable handover", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "wringer-human-decision-"))), state = join(directory, "state"), driver = fileURLToPath(new URL("../../../scripts/fixtures/contained-driver.ts", import.meta.url));
    const fixture = async (action: string) => {
        const child = Bun.spawn([process.execPath, driver, action, directory], { stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw new Error(`Synthetic fixture ${action} failed: ${err}`); return JSON.parse(out);
    };
    try {
        await fixture("prepare");
        const plan = JSON.parse(await readFile(join(directory, "plan.canonical.json"), "utf8"));
        const authority = createExecutionAuthority(plan, { actor: "Initial bounded approver", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
        await writeFile(join(directory, "authority.json"), JSON.stringify(authority));
        await fixture("run"); await fixture("display");
        const display = JSON.parse(await readFile(join(directory, "display.json"), "utf8")), first = await controllerStatus(state);
        const input = { criterionId: "readable", displayId: display.id, verdict: "met" as const };
        await expect(reviewControllerDecisions(state, { decisions: [{ ...input, by: "Assistant-invented reviewer" } as any] })).rejects.toThrow("Choose");
        expect((await controllerStatus(state)).revision).toBe(first.revision);
        const original = "  My exact words: this needs more contrast.\nDo not change my comment.  ";
        const no = await reviewControllerDecisions(state, { decisions: [{ ...input, verdict: "not_met", note: original }], expectedRevision: first.revision, expectedCandidateTree: first.candidateTree });
        expect(no.result.status).toBe("human-hold"); expect(no.judgements[0]).toMatchObject({ by: authority.actor, note: original, attribution: "initial-execution-approval", authoritySha256: hashValue(authority) });
        const current = await controllerStatus(state), request = { idempotencyKey: crypto.randomUUID(), expectedRevision: current.revision, expectedCandidateTree: current.candidateTree, action: "review-decision", payload: input };
        let forbiddenCalls = 0;
        await queueWorkspaceCommand(state, request, { executeRole: async () => { forbiddenCalls++; throw new Error("A human choice cannot require another model turn"); }, runCommands: async () => { forbiddenCalls++; throw new Error("A current display cannot require repeated verification"); } });
        let completed = await readWorkspaceCommand(state, request.idempotencyKey);
        for (let count = 0; count < 500 && (completed.status === "running" || await hasActiveWorkspaceCommand(state)); count++) { await Bun.sleep(10); completed = await readWorkspaceCommand(state, request.idempotencyKey); }
        expect(completed.status).toBe("completed"); expect(forbiddenCalls).toBe(0);
        const result = completed.result as any;
        expect(result.result.status).toBe("review-ready"); expect(result.judgement.note).toBeNull(); expect(result.judgements).toEqual([result.judgement]);
        expect(result.judgement.by).toBe(authority.actor); expect(result.judgement.verdict).toBe("met");
        const history = await readController(state);
        expect(history.events.filter(e => e.type === "human-decisions-recorded")).toHaveLength(2);
        expect((await queueWorkspaceCommand(state, request)).status).toBe("completed");
        expect((await readController(state)).events.length).toBe(history.events.length);
        const delivery = await deliverContained({ stateDir: state, publication: { remote: join(directory, "origin.git"), sourceBranch: "review/explicit-choice", targetBranch: "main" } });
        const audit = await auditContained(delivery.bundleDir);
        expect(audit.status).toBe("passed");
        expect((await latestWorkspacePublication(state))?.deliveryId).toBe(delivery.deliveryId);
        const certificate = JSON.parse(await readFile(join(delivery.bundleDir, "certificate.json"), "utf8"));
        expect(certificate.view.criteria.find((c: any) => c.id === "readable")).toMatchObject({ state: "met", note: null, by: authority.actor });
        for (const name of ["summary.md", "mr.md", "board.html"]) expect(await readFile(join(delivery.bundleDir, name), "utf8")).not.toContain("null —");
        const carried = JSON.parse(await readFile(join(delivery.bundleDir, "human/readable.json"), "utf8"));
        expect(carried.judgement).toEqual(result.judgement);
    } finally { await rm(directory, { recursive: true, force: true }); }
}, 90000);
