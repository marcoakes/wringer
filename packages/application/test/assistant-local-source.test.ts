import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalPlanJson, compileDeclaration, compileExecutionPlan, hashBytes, type ExecutionPlan } from "@wringer/plan";
import { createLocalSourceBundle, processDriver } from "@wringer/runtime";
import { initializeAssistant } from "../src/assistant";
import { LOCAL_SOURCE_MISSING, localSourceSiblings, readAssistantLocalSource } from "../src/assistant-local-source";

// Real Git and bundles; the siblings are written here as a tamperer would.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const example = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
async function git(cwd: string, ...args: string[]) {
    const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", cwd, ...args]);
    if (result.code !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
}
async function repository() {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-local-source-"))); dirs.push(dir);
    const repo = join(dir, "repo");
    await git(dir, "init", "--initial-branch=main", repo);
    await git(repo, "config", "user.name", "Local source fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
    await writeFile(join(repo, "README.md"), "one\n"); await git(repo, "add", "."); await git(repo, "commit", "-m", "root");
    const parent = await git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "README.md"), "two\n"); await git(repo, "commit", "-am", "child");
    return { dir, repo, parent, head: await git(repo, "rev-parse", "HEAD"), root: await git(repo, "rev-list", "--max-parents=0", "HEAD") };
}
type Fixture = Awaited<ReturnType<typeof repository>>;
function localPlan(url: string, commit: string): ExecutionPlan {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...declaration } = structuredClone(example);
    return compileDeclaration({ ...declaration, version: 4, repository: { url, commit } });
}
/** A profile with its pair beside it; `edit` changes the record before it is written. */
async function prepared(f: Fixture, options: { bundleCommit?: string; url?: string; edit?: (record: Record<string, unknown>) => void } = {}) {
    const directory = join(f.dir, `profile-${crypto.randomUUID()}`); await mkdir(directory, { mode: 0o700 });
    const profilePath = join(directory, "profile.json"), siblings = localSourceSiblings(profilePath);
    const made = await createLocalSourceBundle(f.repo, options.bundleCommit ?? f.head, siblings.bundle);
    const plan = localPlan(options.url ?? made.url, f.head), rootCommit = (options.url ?? made.url).slice("local://".length);
    const record: Record<string, unknown> = { schema_version: "wringer.local-source.v1", planSha256: plan.plan_sha256, url: plan.repository.url, commit: f.head, rootCommit, bundleSha256: made.bundleSha256, bundleBytes: made.bundleBytes };
    options.edit?.(record);
    await writeFile(profilePath, canonicalPlanJson(plan)); await writeFile(siblings.record, JSON.stringify(record, null, 2) + "\n");
    return { plan, siblings, made };
}
const absent = async (path: string) => lstat(path).then(() => false, () => true);

test("init verifies the prepared pair and privately keeps exactly the verified bytes", async () => {
    const f = await repository(), p = await prepared(f), controller = join(f.dir, "controller");
    const first = await initializeAssistant(controller, { plan: p.plan, cooperativeLocal: true, localSource: p.siblings });
    expect(first.created).toBe(true); expect(first.workspace.profile.repository).toEqual({ url: `local://${f.root}`, commit: f.head });
    const kept = await readAssistantLocalSource(controller, p.plan);
    expect(kept.bundlePath.startsWith(controller + "/local-source/")).toBe(true);
    expect(hashBytes(await readFile(kept.bundlePath))).toBe(p.made.bundleSha256); expect(kept.record.rootCommit).toBe(f.root);
    expect((await initializeAssistant(controller, { plan: p.plan, cooperativeLocal: true, localSource: p.siblings })).created).toBe(false);
    await writeFile(kept.bundlePath, Buffer.concat([await readFile(kept.bundlePath), Buffer.from("changed")]));
    await expect(readAssistantLocalSource(controller, p.plan)).rejects.toThrow("This controller keeps no verified copy of its local-only source, or the copy changed. No work can start from it; initialise a controller from the prepared profile.");
}, 30_000);

// Real Git per case, about a second each: Bun's 5 s default would kill a fetch
// mid-flight and report it as an unreadable bundle.
test("init refuses a missing, changed, stale, foreign or wrong-root pair and creates no controller", async () => {
    const f = await repository(), refuse = (why: string) => `The prepared local source beside this profile ${why}. Nothing was initialised; repeat prepare --local.`;
    const cases: [string, Awaited<ReturnType<typeof prepared>>, string][] = [];
    const bare = await prepared(f);
    cases.push(["no pair given", { ...bare, siblings: undefined as never }, LOCAL_SOURCE_MISSING]);
    cases.push(["pair absent beside the profile", { ...bare, siblings: localSourceSiblings(join(f.dir, "elsewhere.json")) }, LOCAL_SOURCE_MISSING]);
    // Still a readable bundle holding the commit, so only the recorded SHA-256 can catch the extra branch it smuggles.
    const smuggled = await prepared(f);
    await git(f.repo, "checkout", "--quiet", "-b", "side", f.parent); await writeFile(join(f.repo, "SIDE.md"), "smuggled\n"); await git(f.repo, "add", "."); await git(f.repo, "commit", "-m", "Smuggled side branch");
    await git(f.repo, "checkout", "--quiet", "main"); await git(f.repo, "update-ref", "refs/heads/base", f.head);
    await rm(smuggled.siblings.bundle); await git(f.repo, "bundle", "create", smuggled.siblings.bundle, "refs/heads/base", "refs/heads/side");
    cases.push(["a readable bundle smuggling another branch, record unchanged", smuggled, refuse("changed after preparation: its bundle no longer matches the SHA-256 its record names")]);
    const tampered = await prepared(f), bytes = await readFile(tampered.siblings.bundle), middle = Math.floor(bytes.length / 2); bytes[middle] = bytes[middle]! ^ 0xff; await writeFile(tampered.siblings.bundle, bytes);
    cases.push(["one bundle byte changed", tampered, refuse("changed after preparation: its bundle no longer matches the SHA-256 its record names")]);
    cases.push(["bundle of an older commit, record resealed", await prepared(f, { bundleCommit: f.parent }), refuse("does not hold the profile's commit; it was bundled from another state of the checkout")]);
    cases.push(["record of another profile", await prepared(f, { edit: record => { record.planSha256 = "f".repeat(64); } }), refuse("was prepared for a different profile")]);
    cases.push(["profile names a root the history does not have", await prepared(f, { url: `local://${"f".repeat(40)}` }), refuse("does not have the single root commit the profile names")]);
    for (const [label, p, sentence] of cases) {
        const controller = join(f.dir, `controller-${crypto.randomUUID()}`);
        await expect(initializeAssistant(controller, { plan: p.plan, cooperativeLocal: true, ...(p.siblings ? { localSource: p.siblings } : {}) }), label).rejects.toThrow(sentence);
        expect(await absent(controller), label).toBe(true);
    }
}, 60_000);
