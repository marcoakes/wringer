/** The verification door, as a newcomer meets it: what each answer says happened
 * and which command comes next. Found by walking it on 2026-10-31 at alpha.39. */
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "@wringer/engine";
import { dispatch } from "../src/app";

const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });

async function repository(checkPasses: boolean) {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "wringer-verification-door-"))); cleanup.push(repo);
    await git(repo, ["init", "--initial-branch=main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { test: "node check.mjs" } }));
    await writeFile(join(repo, "check.mjs"), `process.exit(${checkPasses ? 0 : 1});\n`);
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    return repo;
}
const nextLine = (text: string) => text.split("\n").find(line => line.startsWith("Next: "));

test("start says what it wrote and that the next step is to run the checks", async () => {
    const repo = await repository(true), answer = await dispatch(["start", "--repo", repo]);
    expect(answer.text).toContain("Created .wringer.yaml and .gitignore");
    expect(answer.text).toContain("wring verify runs them on this computer");
    expect(nextLine(answer.text!)).toBe("Next: wring verify");
    expect(answer.text).not.toContain("wringer-drive authority");
    // A second start wrote nothing, so it says nothing about writing.
    expect((await dispatch(["start", "--repo", repo])).text).not.toContain("Created .wringer.yaml");
}, 30000);

test("after a failed verify the answer is the failing check and how to read it", async () => {
    const repo = await repository(false);
    await dispatch(["init", "--repo", repo]);
    const verified = await dispatch(["verify", "--repo", repo]);
    expect(verified.exit).toBe(1);
    expect(verified.text).toContain("Failed: test.");
    expect(verified.text).toContain("wring explain");
    expect(verified.text).not.toContain("wringer-drive plan");
    const start = await dispatch(["start", "--repo", repo]);
    expect(nextLine(start.text!)).toBe("Next: wring explain");
    expect(start.text).toMatch(/✗ last verify/);
    const explained = await dispatch(["explain", "--repo", repo]);
    expect(explained.text!.match(/Next: /g)?.length).toBe(1);
}, 30000);

test("a green verify says so first, drops empty sections and offers delegation, not a contained plan", async () => {
    const repo = await repository(true);
    await dispatch(["init", "--repo", repo]);
    const verified = await dispatch(["verify", "--repo", repo]);
    expect(verified.exit).toBe(0);
    expect(verified.text!.split("\n")[2]).toBe("All 1 recorded check passed. This does not prove a product requirement.");
    expect(verified.text).toContain("wring setup --help");
    expect(verified.text).not.toContain("wringer-drive plan");
    expect(verified.text).not.toContain("## Every requirement");
    expect(verified.text).not.toContain("Not reported tokens");
    const start = await dispatch(["start", "--repo", repo]);
    expect(nextLine(start.text!)).toBe("Next: wring setup --help");
    expect(start.text).toMatch(/✓ last verify/);
    // Delivery says why it refuses a record with no requirements, rather than ending on nothing.
    const refused: any = await dispatch(["deliver", "--repo", repo]).then(() => new Error("Delivery proceeded"), error => error);
    expect(refused.message).toContain("no requirements on record");
    expect(refused.message).toContain("wringer.spec.yaml");
    expect(refused.next_move).toBe("wring setup --help");
}, 30000);

test("the demo points at evidence that exists, wherever it was run from", async () => {
    const answer: any = await dispatch(["demo"]);
    cleanup.push(answer.value.repo);
    const evidence = answer.text.split("\n").find((line: string) => line.startsWith("Evidence: ")).slice("Evidence: ".length);
    expect(isAbsolute(evidence)).toBeTrue();
    expect(await Bun.file(join(evidence, "manifest.json")).exists()).toBeTrue();
    expect(answer.text).toContain("Next: wring start");
}, 30000);
