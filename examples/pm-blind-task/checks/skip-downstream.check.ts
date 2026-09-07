import assert from "node:assert/strict";
import { runPipeline, type PipelineResult } from "../src/pipeline";
import { renderReport } from "../src/report";
import { checkAll, fixture } from "./support";

const row = (result: PipelineResult, id: string) => { const found = result.steps.find(step => step.id === id); assert.ok(found, `Missing result for ${id}`); return found; };
await checkAll({
    direct: async () => {
        const attempted: string[] = [], result = runPipeline(await fixture("chain"), { onAttempt: id => attempted.push(id) });
        assert.equal(row(result, "clean-orders").status, "skipped");
        assert.equal(attempted.includes("clean-orders"), false, "A blocked step must never reach the attempt hook");
        assert.equal(result.attempted.includes("clean-orders"), false);
        assert.deepEqual(row(result, "clean-orders").blockedBy, ["load-orders"]);
    },
    transitive: async () => {
        const attempted: string[] = [], result = runPipeline(await fixture("chain"), { onAttempt: id => attempted.push(id) });
        assert.equal(row(result, "publish-orders").status, "skipped");
        assert.equal(attempted.includes("publish-orders"), false);
        assert.deepEqual(row(result, "publish-orders").blockedBy, ["load-orders"], "Name the original failure, not the skipped intermediate step");
    },
    branches: async () => {
        const result = runPipeline(await fixture("chain"));
        assert.equal(row(result, "clean-orders").status, "skipped");
        assert.equal(row(result, "publish-stock").status, "passed");
        assert.equal(row(result, "publish-stock").value, "STOCK IS CURRENT");
        assert.deepEqual(result.attempted, ["load-orders", "load-stock", "publish-stock"]);
    },
    attribution: async () => {
        const result = runPipeline(await fixture("two-failures"));
        assert.equal(row(result, "clean-orders").status, "skipped");
        assert.deepEqual(row(result, "clean-orders").blockedBy, ["load-orders"]);
        assert.deepEqual(row(result, "publish-stock").blockedBy, ["load-stock"]);
        assert.equal(row(result, "daily-notice").status, "passed");
    },
    multiple: async () => {
        const result = runPipeline(await fixture("two-failures"));
        assert.equal(row(result, "merge-imports").status, "skipped");
        assert.deepEqual(row(result, "merge-imports").blockedBy, ["load-orders", "load-stock"], "Root causes must be distinct and sorted by id, not by discovery order");
        assert.equal(result.attempted.includes("merge-imports"), false);
    },
    summary: async () => {
        const result = runPipeline(await fixture("two-failures")), text = renderReport(result);
        assert.equal(result.ok, false);
        assert.match(text, /Pipeline unsuccessful/);
        for (const id of ["load-orders", "load-stock"]) assert.match(text.split("\n").find(line => line.startsWith(id + " |")) ?? "", /FAILED/);
        for (const id of ["clean-orders", "publish-stock", "merge-imports"]) {
            const line = text.split("\n").find(line => line.startsWith(id + " |")) ?? "";
            assert.match(line, /SKIPPED|NOT ATTEMPTED/i, `${id} must be distinguishable from a failed attempt`);
            for (const cause of row(result, id).blockedBy) assert.ok(line.includes(cause), `${id} must name ${cause} on its own report row`);
        }
        assert.match(text, /Attempted 3 of 6 steps/);
    },
}, process.argv[2]);
