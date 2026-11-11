/** alpha.47: the evidence layer rides the pull request. `wring setup` records a forge beside the
 * destination, its preview says what Send will open, and every new job carries it. Real trusted-local
 * workspaces in scratch folders; no agent, model, network or token is used. The Send itself, against a
 * local fake forge, is packages/application/test/forge-send.test.ts. */
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantService, createDelegationJob, delegationControllerRoot, listWorkspaces, readAssistantRecord, readWorkspace } from "@wringer/application";
import { git } from "@wringer/engine";
import { dispatch } from "../src/app";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
const TOKEN = "WRINGER_ALPHA47_FIXTURE_TOKEN_NEVER_SET";

async function repository(root: string, remote: string) {
    const repo = join(root, "repo"); await mkdir(join(repo, "src"), { recursive: true });
    await git(repo, ["init", "--initial-branch=main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "src/value.ts"), "export const value = 1;\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ packageManager: "bun@1.4.2", scripts: { test: "bun src/value.ts" } }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    await git(repo, ["remote", "add", "origin", remote]);
    return repo;
}
async function fixture(remote = "https://github.com/acme/example.git") {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-alpha47-"))); cleanup.push(() => rm(root, { recursive: true, force: true }));
    return { root, repo: await repository(root, remote), app: join(root, "app") };
}
const setupArgs = (app: string, repo: string, extra: string[] = []) => ["setup", "--app-dir", app, "--repo", repo, "--client", "claude-code", "--mode", "delegation", "--runtime", "trusted-local", "--worker-adapter", "claude-agent-acp", "--judge-adapter", "claude-agent-acp", "--source", "local", "--dependencies", "none", "--writable", "src", ...extra];
const github = ["--remote", "origin", "--base", "main", "--forge", "github", "--forge-repo", "acme/example", "--forge-token-env", TOKEN];
const refusal = (args: string[]) => dispatch(args).then(() => new Error("Accepted"), error => error as Error);

test("the setup preview shows the pull request Send will open and the token variable it reads, outside the profile's identity", async () => {
    const f = await fixture();
    delete process.env[TOKEN];
    const shown: any = await dispatch([...setupArgs(f.app, f.repo, github), "--dry-run"]);
    expect(shown.value.destination.forge).toEqual({ request: "GitHub pull request", repository: "acme/example", endpoint: "https://api.github.com", tokenEnv: TOKEN, tokenSetHere: false, remoteUrl: "https://github.com/acme/example.git" });
    expect(shown.value.destination.recorded).toContain(`also opens a GitHub pull request on acme/example whose description is the job's evidence, with the token in ${TOKEN}`);
    expect(shown.value.destination.recorded).toContain("refuses Send before any push without it");
    expect(shown.text).toContain("Send also opens a GitHub pull request on acme/example, described by the job's evidence");
    expect(shown.text).toContain(`token in ${TOKEN} (not set in this terminal: set it before wring job open, or Send will refuse)`);
    const plain: any = await dispatch([...setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main"]), "--dry-run"]);
    expect(plain.value.destination).toEqual({ remote: "origin", base: "main", recorded: expect.stringContaining("only after the person's Send") });
    expect(shown.value.identity).toBe(plain.value.identity);
    // Presence only: a set variable is reported as set, and its value appears nowhere.
    process.env[TOKEN] = "fixture-value-that-must-not-appear-0001";
    try {
        const set: any = await dispatch([...setupArgs(f.app, f.repo, github), "--dry-run"]);
        expect(set.value.destination.forge.tokenSetHere).toBe(true); expect(set.text).toContain("(set in this terminal)");
        expect(JSON.stringify(set)).not.toContain("fixture-value-that-must-not-appear-0001");
    } finally { delete process.env[TOKEN]; }
}, 30000);

test("a forge that does not match the remote, or is half-named, is refused at setup with what to do, before anything is kept", async () => {
    const f = await fixture();
    const mismatch = await refusal([...setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main", "--forge", "github", "--forge-repo", "other/name", "--forge-token-env", TOKEN]), "--dry-run"]);
    expect(mismatch.message).toBe("Remote origin is https://github.com/acme/example.git, which is not other/name on github.com. The GitHub pull request is opened on the repository the branch is pushed to: name the remote for other/name, or give the --forge-repo that origin names.");
    expect((await refusal([...setupArgs(f.app, f.repo, ["--forge", "github", "--forge-repo", "acme/example", "--forge-token-env", TOKEN]), "--dry-run"])).message).toContain("select --remote NAME --base BRANCH with --forge");
    expect((await refusal([...setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main", "--forge", "bitbucket", "--forge-repo", "acme/example", "--forge-token-env", TOKEN]), "--dry-run"])).message).toBe("Choose --forge github or --forge gitlab explicitly");
    expect((await refusal([...setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main", "--forge", "github", "--forge-repo", "acme/example"]), "--dry-run"])).message).toContain("--forge-token-env NAME. Send reads the token from that variable; Wringer never stores or prints it.");
    expect((await refusal([...setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main", "--forge", "github", "--forge-repo", "acme/example", "--forge-token-env", "not a name"]), "--dry-run"])).message).toContain("a --forge-token-env variable name");
    expect((await refusal([...setupArgs(f.app, f.repo, ["--remote", "upstream", "--base", "main", ...github.slice(4)]), "--dry-run"])).message).toContain("Remote upstream is not configured");
    // A verification workspace sends a branch only.
    expect((await refusal(["setup", "--app-dir", f.app, "--repo", f.repo, "--client", "claude-code", "--mode", "verification", ...github, "--apply"])).message).toContain("A verification workspace sends a branch only");
    // Apply refuses the same mismatch before the profile or workspace is kept.
    const preview: any = await dispatch([...setupArgs(f.app, f.repo), "--dry-run"]);
    const applied = await refusal([...setupArgs(f.app, f.repo, ["--remote", "origin", "--base", "main", "--forge", "github", "--forge-repo", "other/name", "--forge-token-env", TOKEN]), "--apply", "--expected", preview.value.identity, "--actor", "Automated fixture operator", "--cooperative-local"]);
    expect(applied.message).toContain("which is not other/name on github.com");
    expect((await listWorkspaces(f.app).catch(() => ({ workspaces: [] }))).workspaces).toEqual([]);
}, 30000);

test("a remote URL holding a credential is refused without echoing it", async () => {
    const f = await fixture("https://someone:fixture-secret-in-url-0002@github.com/acme/example.git");
    const refused = await refusal([...setupArgs(f.app, f.repo, github), "--dry-run"]);
    expect(refused.message).toContain("Remote origin's URL holds a user name or credential");
    expect(refused.message).toContain("https://github.com/acme/example");
    expect(refused.message).not.toContain("fixture-secret-in-url-0002");
}, 30000);

test("the forge is recorded on a v3 workspace and rides each new job into its approval destination; a workspace without one keeps v2", async () => {
    const f = await fixture();
    const preview: any = await dispatch([...setupArgs(f.app, f.repo, github), "--dry-run"]);
    const applied: any = await dispatch([...setupArgs(f.app, f.repo, github), "--apply", "--expected", preview.value.identity, "--actor", "Automated fixture operator", "--cooperative-local"]);
    const workspace = await readWorkspace(f.app, applied.value.workspace.id);
    const forge = { kind: "github" as const, repo: "acme/example", token_env: TOKEN, endpoint: "https://api.github.com" };
    expect(workspace.schema_version).toBe("wringer.workspace.v3");
    expect(workspace.preferences.destination).toEqual({ remote: "origin", base: "main", forge });
    const job = await createDelegationJob(f.app, workspace.id, { intent: "Return the value as 5.", idempotencyKey: crypto.randomUUID() });
    const context: any = await readAssistantRecord(f.app, `delegation-contexts/${workspace.id}/${job.contextId}.json`);
    expect(context.schema_version).toBe("wringer.delegation-context.v2");
    expect(context.destination).toEqual({ remote: "https://github.com/acme/example.git", sourceBranch: "wringer/job", targetBranch: "main", forge });
    const controller = await createAssistantService(await delegationControllerRoot(f.app, workspace.id, job.contextId));
    expect(await controller.destination(job.id)).toEqual({ remote: "https://github.com/acme/example.git", sourceBranch: `wringer/job/${job.id}`, targetBranch: "main", forge });
    // The same setup without --forge records the v2 workspace and v1 context it always did.
    const g = await fixture(), plainPreview: any = await dispatch([...setupArgs(g.app, g.repo, ["--remote", "origin", "--base", "main"]), "--dry-run"]);
    const plain: any = await dispatch([...setupArgs(g.app, g.repo, ["--remote", "origin", "--base", "main"]), "--apply", "--expected", plainPreview.value.identity, "--actor", "Automated fixture operator", "--cooperative-local"]);
    expect((await readWorkspace(g.app, plain.value.workspace.id)).schema_version).toBe("wringer.workspace.v2");
    const plainJob = await createDelegationJob(g.app, plain.value.workspace.id, { intent: "Return the value as 5.", idempotencyKey: crypto.randomUUID() });
    const plainContext: any = await readAssistantRecord(g.app, `delegation-contexts/${plain.value.workspace.id}/${plainJob.contextId}.json`);
    expect(plainContext.schema_version).toBe("wringer.delegation-context.v1"); expect(plainContext.destination.forge).toBeUndefined();
    // No token value is kept anywhere in the application directory.
    expect(Bun.spawnSync(["grep", "-r", "-l", "fixture-value", f.app]).stdout.toString()).toBe("");
}, 60000);

test("GitLab: a nested group over SSH, with a self-hosted endpoint or gitlab.com's", async () => {
    const f = await fixture("git@gitlab.example.com:group/sub/example.git");
    const args = ["--remote", "origin", "--base", "main", "--forge", "gitlab", "--forge-repo", "group/sub/example", "--forge-token-env", TOKEN, "--forge-endpoint", "https://gitlab.example.com/api/v4"];
    const shown: any = await dispatch([...setupArgs(f.app, f.repo, args), "--dry-run"]);
    expect(shown.value.destination.forge).toMatchObject({ request: "GitLab merge request", repository: "group/sub/example", endpoint: "https://gitlab.example.com/api/v4" });
    expect(shown.text).toContain("Send also opens a GitLab merge request on group/sub/example");
    const g = await fixture("https://gitlab.com/group/example.git");
    const hosted: any = await dispatch([...setupArgs(g.app, g.repo, ["--remote", "origin", "--base", "main", "--forge", "gitlab", "--forge-repo", "group/example", "--forge-token-env", TOKEN]), "--dry-run"]);
    expect(hosted.value.destination.forge.endpoint).toBe("https://gitlab.com/api/v4");
    // The endpoint names the host: gitlab.com's API is not the self-hosted remote's.
    expect((await refusal([...setupArgs(f.app, f.repo, args.slice(0, -2)), "--dry-run"])).message).toContain("which is not group/sub/example on gitlab.com");
}, 30000);

test("the help names the forge flags and that the token is never stored or printed", async () => {
    const help: any = await dispatch(["setup", "--help"]);
    expect(help.text).toContain("--forge github|gitlab --forge-repo OWNER/NAME");
    expect(help.text).toContain("never stores or prints it, and refuses Send before any push when it is missing");
    expect(await readFile(join(import.meta.dir, "../src/adoption-cli.ts"), "utf8")).not.toContain("GITHUB_TOKEN");
});
