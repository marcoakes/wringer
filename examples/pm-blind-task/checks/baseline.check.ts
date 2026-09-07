import assert from "node:assert/strict";
import { runPipeline, type Step } from "../src/pipeline";
import { renderReport } from "../src/report";
import { checkAll } from "./support";

const value = (id: string, text = id): Step => ({ id, needs: [], operation: "literal", value: text });
await checkAll({
    "successful dataflow": () => {
        const result = runPipeline([value("first", "hello"), { id: "upper", needs: ["first"], operation: "uppercase" }, value("last", "world"), { id: "joined", needs: ["upper", "last"], operation: "join", value: " / " }]);
        assert.equal(result.ok, true); assert.equal(result.steps.at(-1)?.value, "HELLO / world");
        assert.deepEqual(result.attempted, ["first", "upper", "last", "joined"]);
    },
    "out-of-order dependencies": () => {
        const result = runPipeline([{ id: "upper", needs: ["input"], operation: "uppercase" }, value("input", "ready")]);
        assert.deepEqual(result.attempted, ["input", "upper"]); assert.equal(result.steps[1]?.value, "READY");
    },
    "independent failure stays unsuccessful": () => {
        const result = runPipeline([{ id: "broken", needs: [], operation: "fail", value: "Expected failure" }, value("unrelated")]);
        assert.equal(result.ok, false); assert.equal(result.steps[0]?.error, "Expected failure"); assert.equal(result.steps[1]?.value, "unrelated");
    },
    "invalid graph runs nothing": () => {
        const attempted: string[] = [], options = { onAttempt: (id: string) => attempted.push(id) };
        assert.throws(() => runPipeline([value("same"), value("same")], options), /unique/);
        assert.throws(() => runPipeline([{ ...value("one"), needs: ["absent"] }], options), /Unknown prerequisite/);
        assert.throws(() => runPipeline([{ ...value("one"), needs: ["two"] }, { ...value("two"), needs: ["one"] }], options), /cycle/);
        assert.deepEqual(attempted, []);
    },
    "empty pipeline": () => assert.deepEqual(runPipeline([]), { ok: true, steps: [], attempted: [] }),
    "existing successful report": () => assert.equal(renderReport(runPipeline([value("hello", "Hello")])) , "Pipeline succeeded\nSTEP | RESULT | DETAIL\nhello | PASSED | Hello\nAttempted 1 of 1 steps.\n"),
});
