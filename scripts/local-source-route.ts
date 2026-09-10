/** Compiled black-box proof of the local-only source door, NOT a PM blind test.
 * A real Reports starter repository with its own bare origin and no forge
 * account goes through the public entry: prepare --local, setup, init, status.
 * No model, key, image, container or network. Every stop sentence below was
 * captured from the compiled product before it was written here. */
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "../packages/engine/src/process";
import { hashBytes } from "../packages/plan/src/canonical";

const checkout = resolve(import.meta.dir, ".."), binary = join(checkout, "dist/wringer-assistant");
const directory = join(checkout, ".wringer", `local-source-route-${crypto.randomUUID()}`), home = join(directory, "home");
await mkdir(home, { recursive: true, mode: 0o700 });
// The operator's PATH, keys and Git identity never reach the product: what setup
// finds must not depend on who runs this stage.
const env = { PATH: "/usr/bin:/bin", HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", LANG: "C.UTF-8" };
const image = `local.test/reports-browser@sha256:${"3".repeat(64)}`, starterProfile = join(checkout, "examples/reports-design/profile.yaml");
const HELP_LINE = "  prepare --from-plan ABS_PLAN --repo ABS_REPO --image DIGEST_REF --output ABS_JSON --root ABS_DIRECTORY [--source-url HTTPS_OR_SSH_URL | --local]";
const STOP = {
    conflict: "Choose one source: --local names a local-only source from this checkout, --source-url names a hosted one. Nothing was written.",
    neither: "This profile's repository is a compile-only placeholder. Select the actual hosted HTTPS/SSH source with --source-url, or name a local-only source from this checkout with --local. No network request was made.",
    tampered: "The prepared local source beside this profile changed after preparation: its bundle no longer matches the SHA-256 its record names. Nothing was initialised; repeat prepare --local.",
    stale: "The prepared local source beside this profile does not hold the profile's commit; it was bundled from another state of the checkout. Nothing was initialised; repeat prepare --local.",
    moved: "The output already exists with different or unreadable data. It was not overwritten; choose a separate reviewed output.",
    insideRepo: "The prepared profile and controller must be outside the selected source repository. Nothing was written.",
    submodule: "The selected repository contains submodules. Host-side profile preparation cannot attest their separate configuration or source; use a reviewed inert profile and contained source verification. No submodule was inspected or executed.",
    filter: "The repository configures a Git content filter. Host-side profile preparation refuses before status can execute it. Use a separately reviewed inert profile and contained source verification; no filter was run or configuration changed.",
    twoRoots: "This history has 2 root commits, and local identity needs one root; name the remote instead with --source-url. No bundle was written.",
    v3Local: "Repository clone URLs cannot embed credentials or use local/file transports",
};
const transcript: unknown[] = [], checks: string[] = [];
const hide = (text: string) => text.replaceAll(directory, "FIXTURE").replaceAll(checkout, "WRINGER_CHECKOUT");
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function check(name: string, value: unknown) { assert(value, name); checks.push(name); transcript.push({ check: name, status: "passed" }); }
async function run(label: string, argv: string[], cwd = directory) {
    const result = await runProcess(argv, { cwd, env, timeout: 60, maxBytes: 4 * 1024 * 1024 });
    transcript.push({ label, command: argv.map(hide), exit: result.exit_code, stdout: hide(result.stdout), stderr: hide(result.stderr) });
    assert(!result.timed_out, `${label} timed out`);
    return result;
}
async function git(cwd: string, ...args: string[]) {
    const result = await run(`fixture git ${args[0]}`, ["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], cwd);
    assert(result.exit_code === 0, `fixture git ${args.join(" ")} failed: ${result.stderr}`);
    return result.stdout.trim();
}
/** Exit 3 and exactly this sentence on stderr: nothing else counts as the stop. */
async function refuses(label: string, argv: string[], sentence: string) {
    const result = await run(label, argv);
    await check(`${label}: refuses with the product's exact sentence`, result.exit_code === 3 && result.stderr === `Wringer assistant stopped: ${sentence}\n`);
}
const exists = (path: string) => Bun.file(path).exists();
const trio = (profile: string) => [profile, `${profile}.source.json`, `${profile}.source.bundle`];
const digests = (profile: string) => Promise.all(trio(profile).map(async path => hashBytes(await readFile(path))));
const noneOf = async (profile: string) => (await Promise.all(trio(profile).map(exists))).every(present => !present);
const profile = (name: string) => join(directory, "profiles", name);
const prepare = (source: string, output: string, extra: string[] = []) => [binary, "prepare", "--from-plan", starterProfile, "--repo", source, "--image", image, "--output", output, "--root", join(directory, "unused-controller"), ...extra];
const init = (root: string, plan: string) => [binary, "init", "--root", root, "--plan", plan, "--cooperative-local"];
/** A fresh copy of the Reports starter with repo-local identity and its own bare origin. */
async function starter(name: string) {
    const source = join(directory, "sources", name), origin = join(directory, "origins", `${name}.git`);
    await cp(join(checkout, "examples/reports-design"), source, { recursive: true });
    await git(directory, "init", "--initial-branch=main", source);
    await git(source, "config", "user.name", "Local source route fixture"); await git(source, "config", "user.email", "fixture@example.invalid");
    await git(source, "add", "."); await git(source, "commit", "-m", "Reports starter baseline");
    await git(directory, "init", "--bare", "--initial-branch=main", origin); await git(source, "push", origin, "main");
    return source;
}

let failed = true;
try {
    await mkdir(join(directory, "profiles"), { mode: 0o700 });
    const help = await run("help", [binary, "--help"]);
    await check("the compiled help names the local door on the prepare line", help.exit_code === 0 && help.stdout.split("\n").includes(HELP_LINE));

    // Positive: the page's literal command, setup, init with the checkout moved away, status.
    const source = await starter("reports"), controller = join(directory, "controller"), output = profile("reports.json");
    const page = (await readFile(join(checkout, "ASSISTANT_START.md"), "utf8")).split("\n").find(line => line.startsWith("./dist/wringer-assistant prepare ") && line.endsWith(" --local"));
    assert(page, "ASSISTANT_START.md shows no prepare --local command");
    const substitutions: Record<string, string> = { "./dist/wringer-assistant": binary, ABS_EXISTING_PROFILE: starterProfile, ABS_REPO: source, DIGEST_QUALIFIED_IMAGE: image, ABS_NEW_PROFILE: output, ABS_CONTROLLER: controller };
    const prepared = await run("the page's prepare --local command", page.split(" ").map(word => substitutions[word] ?? word));
    const head = await git(source, "rev-parse", "HEAD"), root = await git(source, "rev-list", "--max-parents=0", "HEAD");
    await check("the page's literal prepare --local command succeeds", prepared.exit_code === 0 && prepared.stderr === "");
    const plan = JSON.parse(await readFile(output, "utf8")), record = JSON.parse(await readFile(`${output}.source.json`, "utf8")), bundle = await readFile(`${output}.source.bundle`);
    await check("the profile is plan v4, named by the measured root and pinned to the measured head", plan.schema_version === "wringer.execution-plan.v4" && plan.repository.url === `local://${root}` && plan.repository.commit === head);
    await check("the record beside it names that profile, commit, root and bundle bytes", record.schema_version === "wringer.local-source.v1" && record.planSha256 === plan.plan_sha256 && record.url === plan.repository.url && record.commit === head && record.rootCommit === root && record.bundleBytes === bundle.length && record.bundleSha256 === hashBytes(bundle));
    await check("prepare created no controller", !await exists(controller));
    const setup = await run("setup", [binary, "setup", "--root", controller, "--plan", output, "--cooperative-local", "--json"]), inspected = JSON.parse(setup.stdout);
    const row = (id: string) => inspected.checks.find((c: { id: string }) => c.id === id);
    await check("setup observes the profile and its local-only source", row("profile")?.status === "observed" && row("local-source")?.status === "observed");
    await check("setup's only open items are this runner's absent coding client and container runtime", setup.exit_code === 3 && JSON.stringify(inspected.checks.filter((c: { status: string }) => c.status === "needs-attention").map((c: { id: string }) => c.id)) === JSON.stringify(["client", "runtime"]));
    const moved = join(directory, "sources", "reports-moved-after-prepare"); await rename(source, moved);
    const initialised = await run("init with the source checkout moved away", [...init(controller, output), "--json"]);
    await check("init records the workspace without the source checkout", initialised.exit_code === 0 && JSON.parse(initialised.stdout).created === true);
    await check("the controller keeps exactly the recorded bundle bytes", hashBytes(await readFile(join(controller, "local-source", plan.plan_sha256, "source.bundle"))) === record.bundleSha256);
    const status = await run("status", [binary, "status", "--root", controller, "--json"]), statusValue = JSON.parse(status.stdout);
    await check("status reads the initialised controller with no owner and no job", status.exit_code === 0 && statusValue.outcome === "absent" && statusValue.jobs.length === 0);
    const again = await run("repeated init", [...init(controller, output), "--json"]);
    await check("repeated init verifies instead of recreating", again.exit_code === 0 && JSON.parse(again.stdout).created === false);
    await rename(moved, source);

    // Negatives: each its own invocation, fresh outputs and controllers.
    await refuses("--local with --source-url", prepare(source, profile("conflict.json"), ["--local", "--source-url", "https://example.com/operator/source.git"]), STOP.conflict);
    await check("the conflicting prepare wrote nothing", await noneOf(profile("conflict.json")));
    await refuses("placeholder profile with neither door", prepare(source, profile("neither.json")), STOP.neither);
    await check("the placeholder prepare wrote nothing", await noneOf(profile("neither.json")));

    await mkdir(join(directory, "tampered"), { mode: 0o700 });
    for (const [from, to] of trio(output).map((path, index) => [path, trio(join(directory, "tampered", "profile.json"))[index]!])) await cp(from!, to!);
    const flipped = await readFile(join(directory, "tampered/profile.json.source.bundle")), middle = Math.floor(flipped.length / 2); flipped[middle] = flipped[middle]! ^ 0xff;
    await writeFile(join(directory, "tampered/profile.json.source.bundle"), flipped);
    await refuses("init with one bundle byte changed", init(join(directory, "controller-tampered"), join(directory, "tampered/profile.json")), STOP.tampered);
    await check("the tampered init created no controller", !await exists(join(directory, "controller-tampered")));

    const history = await starter("history");
    const older = await run("prepare at the older commit", prepare(history, profile("older.json"), ["--local"]));
    await writeFile(join(history, "src/NOTE.md"), "a later commit\n"); await git(history, "add", "."); await git(history, "commit", "-m", "Later commit");
    const newer = await run("prepare at the newer commit", prepare(history, profile("newer.json"), ["--local"]));
    await check("both honest preparations succeed", older.exit_code === 0 && newer.exit_code === 0);
    await mkdir(join(directory, "stale"), { mode: 0o700 });
    await cp(profile("newer.json"), join(directory, "stale/profile.json")); await cp(profile("older.json.source.bundle"), join(directory, "stale/profile.json.source.bundle"));
    const olderRecord = JSON.parse(await readFile(profile("older.json.source.json"), "utf8")), newerRecord = JSON.parse(await readFile(profile("newer.json.source.json"), "utf8"));
    await writeFile(join(directory, "stale/profile.json.source.json"), JSON.stringify({ ...newerRecord, bundleSha256: olderRecord.bundleSha256, bundleBytes: olderRecord.bundleBytes }, null, 2) + "\n");
    await refuses("init with an older commit's bundle and a resealed record", init(join(directory, "controller-stale"), join(directory, "stale/profile.json")), STOP.stale);
    await check("the stale init created no controller", !await exists(join(directory, "controller-stale")));

    const before = await digests(profile("newer.json"));
    await writeFile(join(history, "src/NOTE.md"), "moved on again\n"); await git(history, "commit", "-am", "Source moved after preparation");
    await refuses("prepare --local again after the source moved on", prepare(history, profile("newer.json"), ["--local"]), STOP.moved);
    await check("the moved source replaced none of the prepared files", JSON.stringify(await digests(profile("newer.json"))) === JSON.stringify(before));
    const pinned = await run("init the pinned pair after the source moved on", init(join(directory, "controller-pinned"), profile("newer.json")));
    await check("the pinned pair still initialises", pinned.exit_code === 0);

    await refuses("output inside the source repository", prepare(source, join(source, "prepared.json"), ["--local"]), STOP.insideRepo);
    await check("nothing was written inside the source repository", await noneOf(join(source, "prepared.json")) && await git(source, "status", "--porcelain") === "");
    const submodule = await starter("submodule"), gitlink = await git(submodule, "rev-parse", "HEAD");
    await git(submodule, "update-index", "--add", "--cacheinfo", `160000,${gitlink},nested`); await git(submodule, "commit", "-m", "Gitlink");
    await refuses("a repository with a submodule", prepare(submodule, profile("submodule.json"), ["--local"]), STOP.submodule);
    await check("the submodule prepare wrote nothing", await noneOf(profile("submodule.json")));
    const filtered = await starter("filter");
    await writeFile(join(filtered, ".gitattributes"), "src/app.ts filter=unsafe\n"); await git(filtered, "add", ".gitattributes"); await git(filtered, "commit", "-m", "Filter attribute");
    await git(filtered, "config", "filter.unsafe.clean", "cat");
    await refuses("a repository with a content filter", prepare(filtered, profile("filter.json"), ["--local"]), STOP.filter);
    await check("the filtered prepare wrote nothing", await noneOf(profile("filter.json")));
    const twoRoots = await starter("two-roots");
    await git(twoRoots, "checkout", "--quiet", "--orphan", "other"); await git(twoRoots, "rm", "-rf", "--quiet", ".");
    await writeFile(join(twoRoots, "OTHER.md"), "second root\n"); await git(twoRoots, "add", "."); await git(twoRoots, "commit", "-m", "Second root");
    await git(twoRoots, "checkout", "--quiet", "main"); await git(twoRoots, "merge", "--quiet", "--allow-unrelated-histories", "-m", "Join histories", "other");
    await refuses("a history with two roots", prepare(twoRoots, profile("two-roots.json"), ["--local"]), STOP.twoRoots);
    await check("the two-root prepare wrote nothing", await noneOf(profile("two-roots.json")));
    const v3 = (await readFile(starterProfile, "utf8")).replace("url: https://example.invalid/OWNER/REPOSITORY.git", `url: local://${root}`).replace('commit: "0000000000000000000000000000000000000000"', `commit: "${head}"`);
    assert(v3.includes(`url: local://${root}`) && v3.includes(head) && v3.includes("version: 3"), "The v3 local:// fixture was not constructed");
    await writeFile(profile("v3-local.yaml"), v3);
    await refuses("a version 3 plan naming local://", init(join(directory, "controller-v3"), profile("v3-local.yaml")), STOP.v3Local);
    await check("the v3 local:// init created no controller", !await exists(join(directory, "controller-v3")));

    const result = { schema_version: "wringer.local-source-route.v1", status: "passed", fixture: "compiled-local-source-route", checks, negatives: Object.keys(STOP).length, modelCalls: 0, credentialReads: 0, imagesBuilt: 0, containersStarted: 0, forgeAccount: false, limits: ["Engineering proof through the compiled public entry, not a PM blind-test pass.", "Stops at init and status: approval, start, containment and delivery of a local-only source are not exercised, and approval refuses one by design.", "Setup names this runner's absent coding client and container runtime; that is expected here and is not a readiness claim."] };
    await writeFile(join(directory, "result.json"), JSON.stringify(result, null, 2) + "\n");
    failed = false;
    console.log(JSON.stringify({ directory, ...result }, null, 2));
} catch (error) {
    transcript.push({ stop: error instanceof Error ? error.message : String(error) });
    await writeFile(join(directory, "result.json"), JSON.stringify({ status: "failed", checks }, null, 2) + "\n");
    throw new Error(`Local source route failed; retained evidence: ${directory}`, { cause: error });
} finally {
    await writeFile(join(directory, "transcript.json"), JSON.stringify({ fixture: true, failed, transcript }, null, 2) + "\n");
}
