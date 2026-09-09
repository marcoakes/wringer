import { describe, test, expect } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatch } from "../src/app";
import { compileDeclaration, loadExecutionPlan, canonicalPlanJson } from "@wringer/plan";
import { readDesignSnapshot } from "@wringer/design";
import { unitPng } from "../../runtime/test/fixtures/png";
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-design-cli-"))), repo = join(root, "source"), privateDir = join(root, "private");
    await mkdir(repo); await mkdir(privateDir, { mode: 0o700 }); await chmod(privateDir, 0o700);
    await writeFile(join(repo, "input.json"), JSON.stringify({ title: "Owned test reference", source: { label: "UNIT FIXTURE, not Figma" }, context: "The result is readable.", assets: [{ id: "desktop", title: "Tiny parser fixture, not screenshot", path: "desktop.png" }] }));
    await writeFile(join(repo, "desktop.png"), Buffer.from(unitPng(), "base64"));
    const call = (args: string[]) => dispatch(["design", ...args, "--repo", repo]);
    return { root, repo, privateDir, call };
}
describe("design CLI entry path", () => {
    test("help offers read import, inspect, bind and truthful permission boundary", async () => {
        const answer = await dispatch(["design", "--help"]);
        expect(answer.text).toContain("--token-env"); expect(answer.text).toContain("outside the");
        expect(answer.text).toContain("/PRIVATE_OPERATOR_DIR/design-profile.json");
        expect(answer.text).toContain("0700");
        expect((await dispatch(["--help"])).text).toContain("wring design");
    });
    test("owned PNG paths import and inspect without exposing image bytes; overwrite refuses", async () => {
        const f = await fixture(), args = ["reference", "--input", "input.json", "--output", "design/snapshot.json", "--allow-repository-storage"];
        const answer = await f.call(args), snapshot = await readDesignSnapshot(join(f.repo, "design/snapshot.json"));
        expect(snapshot.source.provider).toBe("owned-reference"); expect(snapshot.assets[0]?.id).toBe("desktop");
        expect(snapshot.disclosure).toBe("repository-permitted"); expect(JSON.stringify(answer)).not.toContain(unitPng());
        const inspected = await f.call(["inspect", "--snapshot", "design/snapshot.json"]);
        expect(JSON.stringify(inspected)).not.toContain(unitPng()); expect(inspected.text).toContain("capture-only");
        expect(inspected.text).toContain("Reference IDs for reviews.json:");
        expect(inspected.text).toContain("- desktop: Tiny parser fixture, not screenshot (1 × 1 PNG)");
        await expect(f.call(args)).rejects.toThrow("exists");
    });
    test("private references cannot be accidentally written under the source repo", async () => {
        const f = await fixture();
        await expect(f.call(["reference", "--input", "input.json", "--output", "private.json"])).rejects.toThrow("outside");
        const output = join(f.privateDir, "private.json");
        await f.call(["reference", "--input", "input.json", "--output", output]);
        expect((await readDesignSnapshot(output)).disclosure).toBe("private");
        await chmod(f.privateDir, 0o755);
        await expect(f.call(["reference", "--input", "input.json", "--output", join(f.privateDir, "other.json")])).rejects.toThrow("private folder");
    });
    test("duplicate fields, inline tokens, symlinks and metadata output refuse", async () => {
        const f = await fixture();
        await writeFile(join(f.repo, "duplicate.json"), '{"title":"first","title":"hidden"}');
        await expect(f.call(["reference", "--input", "duplicate.json", "--output", "out.json", "--allow-repository-storage"])).rejects.toThrow("duplicate");
        await writeFile(join(f.repo, "bad.json"), JSON.stringify({ token: "DO_NOT_ECHO", provider: "figma" }));
        await expect(f.call(["import", "--recipe", "bad.json", "--output", "out.json", "--allow-repository-storage"])).rejects.toThrow("unknown field");
        await symlink(join(f.repo, "input.json"), join(f.repo, "linked.json"));
        await expect(f.call(["reference", "--input", "linked.json", "--output", "out.json", "--allow-repository-storage"])).rejects.toThrow();
        await expect(f.call(["reference", "--input", "input.json", "--output", ".git/unknown.json", "--allow-repository-storage"])).rejects.toThrow("metadata");
        await expect(f.call(["reference", "--input", "input.json", "--output", "out.json", "--allow-repository-storage", "--token", "DO_NOT_ECHO"])).rejects.toThrow("Unknown option");
    });
    test("a selected subdirectory cannot hide that private output is still in Git", async () => {
        const f = await fixture();
        await mkdir(join(f.repo, ".git")); await mkdir(join(f.repo, "nested")); await mkdir(join(f.repo, "private"), { mode: 0o700 });
        await expect(dispatch(["design", "reference", "--repo", join(f.repo, "nested"), "--input", "unused.json", "--output", join(f.repo, "private/out.json")])).rejects.toThrow("Git working tree");
    });
    test("bind reads the committed snapshot and creates a distinct unapproved v2 profile", async () => {
        const f = await fixture();
        const git = async (...args: string[]) => {
            const p = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd: f.repo, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Design CLI fixture", GIT_AUTHOR_EMAIL: "fixture@localhost", GIT_COMMITTER_NAME: "Design CLI fixture", GIT_COMMITTER_EMAIL: "fixture@localhost" }, stdout: "pipe", stderr: "pipe" });
            const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); if (code) throw new Error(err); return out.trim();
        };
        await git("init", "-q");
        await f.call(["reference", "--input", "input.json", "--output", "design/snapshot.json", "--allow-repository-storage"]);
        const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...base } = await loadExecutionPlan(new URL("../../plan/examples/contained.yaml", import.meta.url).pathname);
        const plan = compileDeclaration({ version: 1, ...base, intent: "The result is readable.", environment: { ...base.environment, writable_directories: [".evidence"] }, acceptance: { criteria: [{ id: "design-review", title: "Readable", quote: "The result is readable.", kind: "human", required: true, show: { id: "show", argv: ["true"], cwd: ".", timeout_seconds: 5 } }], checks: [], protected_paths: ["README.md"] } });
        const profile = join(f.privateDir, "base.json"), output = join(f.privateDir, "design.json");
        await writeFile(profile, canonicalPlanJson(plan)); await writeFile(join(f.repo, "reviews.json"), JSON.stringify([{ criterionId: "design-review", referenceIds: ["desktop"], captures: [{ id: "desktop", path: ".evidence/desktop.png", mimeType: "image/png", width: 1, height: 1 }] }]));
        const args = ["bind", "--plan", profile, "--snapshot", "design/snapshot.json", "--reviews", "reviews.json", "--output", output];
        await expect(f.call(args)).rejects.toThrow();
        await git("add", "."); await git("commit", "-qm", "Pinned owned reference");
        const answer = await f.call(args), compiled = await loadExecutionPlan(output);
        expect(compiled.schema_version).toBe("wringer.execution-plan.v2"); expect(compiled.repository.commit).toBe(await git("rev-parse", "HEAD"));
        expect(compiled.budget).toEqual(plan.budget); expect(compiled.acceptance.protected_paths).toContain("design/snapshot.json");
        expect(answer.value).toMatchObject({ approval: "not-granted" });
        expect(await readFile(profile, "utf8")).toBe(canonicalPlanJson(plan));
        await expect(f.call(args)).rejects.toThrow();
        const input = JSON.parse(await readFile(join(f.repo, "input.json"), "utf8")); input.title = "Moved design";
        await writeFile(join(f.repo, "moved.json"), JSON.stringify(input));
        await f.call(["reference", "--input", "moved.json", "--output", "design/other.json", "--allow-repository-storage"]);
        await expect(f.call(["bind", "--plan", profile, "--snapshot", "design/other.json", "--reviews", "reviews.json", "--output", join(f.privateDir, "other.json")])).rejects.toThrow();
    });
});
