import { expect, test } from "bun:test";
import { dispatch } from "../src/app";
test("T20 the installed runtime command exposes inspection, exact review and independent readiness", async () => {
    const help = await dispatch(["runtime", "--help"]);
    expect(help.text).toContain("provision"); expect(help.text).toContain("--expected"); expect(help.text).toContain("measure");
    const catalogue: any = (await dispatch(["runtime", "catalogue", "--json"])).value;
    expect(catalogue.schema_version).toBe("wringer.runtime-catalogue.v1");
    expect(catalogue.profiles.every((row: any) => row.modelSelection === "explicit" && row.executionBoundary === "contained")).toBeTrue();
    await expect(dispatch(["runtime", "provision", "--kind", "host"])).rejects.toThrow("contained");
    await expect(dispatch(["runtime", "provision", "--kind", "apple-container", "--apply"])).rejects.toThrow("--id");
});
