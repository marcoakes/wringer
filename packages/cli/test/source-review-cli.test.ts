import { expect, test } from "bun:test";
import { dispatch } from "../src/app";
test("source review is an explicit bounded operator route with no broad approval flags", async () => {
    const help = await dispatch(["source-review", "--help"], "wringer-drive"); expect(help.text).toContain("source-review --state"); expect(help.text).toContain("no wildcard exemptions");
    await expect(dispatch(["source-review", "--state", "/nonexistent", "--all", "yes"], "wringer-drive")).rejects.toThrow("Unknown option --all");
    await expect(dispatch(["source-review", "--state", "/nonexistent", "--actor", "Invented name"], "wringer-drive")).rejects.toThrow("First inspect");
    await expect(dispatch(["source-review", "--state", "/nonexistent", "--finding", "*", "--actor-kind", "human"], "wringer-drive")).rejects.toThrow("operator or delegated-agent");
    await expect(dispatch(["source-review", "--state", "/nonexistent", "--decisions", "/decisions.json", "--finding", "*"], "wringer-drive")).rejects.toThrow("do not mix");
});
