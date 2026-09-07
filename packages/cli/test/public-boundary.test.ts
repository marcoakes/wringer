import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatch } from "../src/app";
const repo = await mkdtemp(join(tmpdir(), "wringer-public-boundary-"));
afterAll(() => rm(repo, { recursive: true, force: true }));
test("all retired public agent launchers refuse without running the declared host worker", async () => {
    await Bun.write(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "check", run: "true" }], run: { worker: "printf executed > must-not-exist", max_iterations: 1, worker_timeout: 5 } }));
    for (const args of [["run"], ["run", "--max-iterations", "1"], ["resume", ".wringer/old-loop"], ["fleet"], ["bench", "--send"], ["graph", "run", "legacy.yaml"], ["graph", "resume", ".wringer/old-graph"], ["spec", "PRD.md", "--send"], ["judge", "--send"]]) {
        await expect(dispatch([...args, "--repo", repo])).rejects.toThrow();
        expect(await Bun.file(join(repo, "must-not-exist")).exists()).toBe(false);
    }
});
test("the current front door names contained authority and not retired HTTP or host worker recipes", async () => {
    const help = (await dispatch(["--help"])).text!;
    expect(help).toContain("wring run PLAN.yaml --authority FILE");
    expect(help).not.toContain("wring spec PRD.md --send");
    const drive = (await dispatch(["--help"], "wringer-drive")).text!;
    for (const verb of ["authority", "status", "show", "review", "deliver", "audit", "falsify"])
        expect(drive).toContain(`wringer-drive ${verb}`);
    expect(drive).toContain("No sandbox bypass");
});
