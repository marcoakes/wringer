import { expect, test } from "bun:test";
import { dispatch } from "../src/app";
test("installed Node reporter is an explicit inert source export", async () => {
    const value = await dispatch(["reporter", "node-test"]);
    expect(value.text).toBe(await Bun.file(new URL("../../../runtime/node-reporter.mjs", import.meta.url)).text());
    await expect(dispatch(["reporter", "unknown"])).rejects.toThrow("node-test");
    await expect(dispatch(["reporter", "node-test", "--apply"])).rejects.toThrow();
});
