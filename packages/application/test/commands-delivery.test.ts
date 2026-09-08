import { test, expect } from "bun:test";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutionAuthority } from "@wringer/plan";
import { deliverContained } from "@wringer/delivery";
import { controllerStatus, resumeController, reviewControllerCandidate } from "../src/controller";
import { latestWorkspacePublication, queueWorkspaceCommand } from "../src/commands";
import { readPmWorkspace } from "../../cli/src/workspace";

// Real controller, bare Git publication and offline audit. The existing fixture
// driver explicitly synthesizes agent/check/display observations: no live agent,
// runtime, provider credential or external publication is exercised here.
test("a direct delivery through the shared domain appears on the workspace without a browser command", async () => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), "wringer-command-delivery-"))), state = join(directory, "state"), driver = fileURLToPath(new URL("../../../scripts/fixtures/contained-driver.ts", import.meta.url));
    const fixture = async (action: string) => {
        const child = Bun.spawn([process.execPath, driver, action, directory], { stdout: "pipe", stderr: "pipe" });
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        if (code !== 0) throw new Error(`Synthetic fixture ${action} failed: ${err}`);
        return JSON.parse(out);
    };
    try {
        await fixture("prepare");
        const plan = JSON.parse(await readFile(join(directory, "plan.canonical.json"), "utf8"));
        const authority = createExecutionAuthority(plan, { actor: "Fixture reviewer", actions: ["build", "verify", "judge"], expiresAt: new Date(Date.now() + 3600000).toISOString() });
        await writeFile(join(directory, "authority.json"), JSON.stringify(authority));
        await fixture("run"); await fixture("display");
        const display = JSON.parse(await readFile(join(directory, "display.json"), "utf8")), before = await controllerStatus(state);
        await reviewControllerCandidate(state, { criterionId: "readable", displayId: display.id, verdict: "met", by: "Fixture reviewer", note: "I reviewed this synthetic display and its expected value is readable.", expectedRevision: before.revision, expectedCandidateTree: before.candidateTree });
        const ready = await resumeController(state, { executeRole: async () => { throw new Error("No further agent should run"); }, runCommands: async () => { throw new Error("No repeated verification should run"); } });
        expect(ready.status).toBe("review-ready");
        expect(await latestWorkspacePublication(state)).toBeNull();
        const publication = { remote: join(directory, "origin.git"), sourceBranch: "review/direct-command", targetBranch: "main" };
        const prepared = await deliverContained({ stateDir: state, publication });
        expect((await latestWorkspacePublication(state))?.status).toBe("prepared");
        const delivered = await deliverContained({ stateDir: state, publication, send: true }), observed = await latestWorkspacePublication(state);
        expect(observed).toEqual(delivered);
        expect(observed?.evidenceCommit).toBe(prepared.evidenceCommit);
        expect(observed?.pushed).toBe(true);
        expect(await readdir(join(state, ".wringer"))).not.toContain("application");
        const board = await readPmWorkspace(state);
        expect(board.publication?.status).toBe("branch-pushed");
        for (const action of ["prepare-delivery", "publish"]) {
            expect(board.actions.find(row => row.id === action)?.enabled).toBe(false);
            expect(board.actions.find(row => row.id === action)?.reason).toContain("already been sent");
        }
        const guard = { expectedRevision: board.revision, expectedCandidateTree: board.candidate?.tree ?? null };
        await expect(queueWorkspaceCommand(state, { ...guard, idempotencyKey: crypto.randomUUID(), action: "prepare-delivery", payload: publication })).rejects.toThrow("already been sent");
        await expect(queueWorkspaceCommand(state, { ...guard, idempotencyKey: crypto.randomUUID(), action: "publish", payload: { preparedId: crypto.randomUUID() } })).rejects.toThrow("already been sent");
        expect(await latestWorkspacePublication(state)).toEqual(observed);
    } finally { await rm(directory, { recursive: true, force: true }); }
}, 90000);
