/** Collect retained measurements and the current source identity; never execute a validation or runtime. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Redactor } from "../packages/engine/src/io";

const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const mapping = (value: any): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const cleanPath = (root: string, path: string) => {
    const name = relative(root, path).split(sep).join("/");
    if (!name || name === ".." || name.startsWith("../") || isAbsolute(name) || /[\x00-\x1f\x7f]/.test(name)) throw Error("Evidence and output must stay inside the repository");
    return name;
};
export function assertPortableFacts(value: unknown) {
    const redactor = new Redactor();
    const visit = (row: unknown, depth: number) => {
        if (depth > 20) throw Error("Facts exceed the nesting limit");
        if (typeof row === "string") {
            if (row.length > 8192 || row.startsWith("/") || redactor.scrub(row) !== row || /-----BEGIN .*PRIVATE KEY-----|(?:^|[\s"'=])\/(?:Users|private|tmp|home|var\/folders)\/|file:\/\/|[A-Za-z]:[\\/]/.test(row)) throw Error("Facts contain a credential, local path, or oversized text; supply a portable inventory without raw logs");
        } else if (Array.isArray(row)) {
            if (row.length > 10000) throw Error("Facts exceed the array limit");
            for (const item of row) visit(item, depth + 1);
        } else if (mapping(row)) {
            for (const [key, item] of Object.entries(row)) {
                if (/^(?:env|environment|credentials?|secrets?|tokens?|passwords?|authorization|(?:api|access|private)[_-]?key|access[_-]?token|raw|.*(?:stdout|stderr|logs?))$/i.test(key)) throw Error("Facts cannot carry environment, credentials, or raw logs");
                visit(key, depth + 1); visit(item, depth + 1);
            }
        } else if (row !== null && typeof row !== "boolean" && !(typeof row === "number" && Number.isFinite(row))) throw Error("Facts must be JSON values");
    };
    visit(value, 0);
}
async function boundedFile(root: string, path: string, maxBytes = 8 * 1024 * 1024) {
    const name = cleanPath(root, resolve(root, path)), target = resolve(root, name), info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw Error(`Not a bounded regular file: ${name}`);
    cleanPath(root, await realpath(target));
    const bytes = await readFile(target), after = await lstat(target);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino) throw Error(`File changed during collection: ${name}`);
    return { reference: { path: name, bytes: bytes.length, sha256: hash(bytes) }, bytes };
}
export function testSummaries(text: string) {
    const results: { passed: number | null; failed: number | null; skipped: number | null; assertions: number | null; tests: number; files: number; duration: string }[] = [];
    let counts = { passed: null as number | null, failed: null as number | null, skipped: null as number | null, assertions: null as number | null };
    for (const line of text.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
        const count = /^\s*(\d+) (pass|fail|skip)\s*$/.exec(line), assertions = /^\s*(\d+) expect\(\) calls\s*$/.exec(line);
        if (count) counts[({ pass: "passed", fail: "failed", skip: "skipped" } as const)[count[2] as "pass" | "fail" | "skip"]] = Number(count[1]);
        if (assertions) counts.assertions = Number(assertions[1]);
        const ran = /^Ran (\d+) tests? across (\d+) files?\. \[([\d.]+(?:ms|s))\]\s*$/.exec(line);
        if (ran) {
            results.push({ ...counts, tests: Number(ran[1]), files: Number(ran[2]), duration: ran[3]! });
            counts = { passed: null, failed: null, skipped: null, assertions: null };
        }
    }
    return results;
}
export async function collectValidation(root: string, directory: string) {
    directory = resolve(await realpath(root), cleanPath(root, resolve(root, directory)));
    root = await realpath(root);
    const receipt = await boundedFile(root, resolve(root, directory, "result.json"), 1024 * 1024), value = JSON.parse(receipt.bytes.toString("utf8"));
    if (!mapping(value) || !Array.isArray(value.results) || !value.results.length || value.results.length > 64) throw Error("Validation receipt needs 1–64 actual stage results");
    const names = new Set<string>(), stages = [];
    for (const row of value.results) {
        if (!mapping(row) || typeof row.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(row.name) || names.has(row.name) || !Number.isInteger(row.exit_code) || typeof row.timed_out !== "boolean" || !Number.isFinite(row.duration_ms) || row.duration_ms < 0) throw Error("Malformed or duplicate validation stage");
        names.add(row.name);
        const streams = [];
        for (const stream of ["stdout", "stderr"]) {
            const file = await boundedFile(root, resolve(root, directory, `${row.name}.${stream}.log`));
            streams.push({ stream, artifact: file.reference, test_summaries: testSummaries(file.bytes.toString("utf8")) });
        }
        stages.push({ name: row.name, exit_code: row.exit_code, timed_out: row.timed_out, duration_ms: row.duration_ms, streams });
    }
    return { receipt: receipt.reference, stages };
}
export function sourcePathIncluded(path: string) {
    if (path.split("/").some(part => [".git", ".wringer", "dist", "node_modules", "docs"].includes(part)) || /(?:^|\/)\.env(?:\.|$)|(?:^|\/)[^/]*\.local(?:\.|$)|\.(?:log|bundle|sqlite|pem|key)$/.test(path)) return false;
    return /^(?:packages|scripts|schema|runtime|examples|\.github)\//.test(path) || ["package.json", "bun.lock", "tsconfig.json", "bunfig.toml", ".gitignore", ".dockerignore", ".wringer.yaml", "action.yml", "Dockerfile", "AGENTS.md"].includes(path);
}
async function git(root: string, args: string[]) {
    const child = Bun.spawn(["git", "--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_NO_REPLACE_OBJECTS: "1" }, stdout: "pipe", stderr: "ignore", signal: AbortSignal.timeout(15000) });
    const text = await new Response(child.stdout).text();
    if (await child.exited || Buffer.byteLength(text) > 8 * 1024 * 1024) throw Error("Bounded read-only Git source inventory failed");
    return text;
}
async function sourceManifest(root: string, output: string) {
    const paths = [...new Set((await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])).split("\0").filter(path => path && sourcePathIncluded(path) && resolve(root, path) !== output))].sort();
    if (paths.length > 10000) throw Error("Source manifest exceeds 10,000 files");
    let total = 0;
    const files = [];
    for (const path of paths) {
        try {
            const file = await boundedFile(root, path, 32 * 1024 * 1024);
            total += file.reference.bytes;
            if (total > 256 * 1024 * 1024) throw Error("Source manifest exceeds 256 MiB");
            files.push(file.reference);
        } catch (error: any) {
            if (error.code !== "ENOENT") throw error;
            files.push({ path, deleted: true as const });
        }
    }
    return { sha256: hash(JSON.stringify(files)), files };
}
export interface CheckpointOptions { root: string; validations: string[]; output: string; runtimeSmoke?: string; imageInventory?: string }
export async function collectCheckpoint(options: CheckpointOptions) {
    const root = await realpath(options.root), output = resolve(root, options.output), outputName = cleanPath(root, output);
    if (!options.validations.length || options.validations.length > 16 || new Set(options.validations.map(p => resolve(root, p))).size !== options.validations.length) throw Error("Provide 1–16 distinct explicit validation directories");
    try { await lstat(output); throw Error("Output already exists; retained evidence is never overwritten"); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
    const baseCommit = (await git(root, ["rev-parse", "HEAD"])).trim();
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(baseCommit)) throw Error("No exact Git base commit");
    const source = await sourceManifest(root, output), validations = [];
    for (const directory of options.validations) validations.push(await collectValidation(root, directory));
    let runtimeSmoke = null, imageInventory = null;
    if (options.runtimeSmoke) {
        const file = await boundedFile(root, options.runtimeSmoke, 1024 * 1024), report = JSON.parse(file.bytes.toString("utf8"));
        if (report?.schema_version !== "wringer.live-runtime-smoke.v1" || !["pass", "fail", "inconclusive"].includes(report.status) || !mapping(report.runtime) || !Array.isArray(report.rows) || report.rows.length > 256) throw Error("Unrecognized actual runtime smoke report");
        const { kind, image, cpus, memoryMiB } = report.runtime;
        const facts = { status: report.status, started: report.started, finished: report.finished, declared_runtime: { kind, image, cpus, memoryMiB }, source_commit: report.sourceCommit, model_prompts_sent: report.modelPromptsSent, provider_credentials_forwarded: report.providerCredentialsForwarded, provider_authentication_measured: report.providerAuthenticationMeasured, blind_journey_measured: report.blindJourneyMeasured, limitations: report.limitations, stages: report.rows.map((row: any) => { if (!mapping(row) || typeof row.id !== "string" || !/^[A-Za-z0-9-]{1,160}$/.test(row.id) || !["pass", "fail", "inconclusive"].includes(row.status)) throw Error("Malformed smoke stage"); return { id: row.id, status: row.status }; }) };
        assertPortableFacts(facts);
        runtimeSmoke = { artifact: file.reference, reported_facts: facts, omitted: "Raw per-stage details, process output, and complete runtime configuration" };
    }
    if (options.imageInventory) {
        const file = await boundedFile(root, options.imageInventory, 1024 * 1024), facts = JSON.parse(file.bytes.toString("utf8"));
        if (!mapping(facts)) throw Error("Image inventory must be a JSON object");
        assertPortableFacts(facts);
        imageInventory = { artifact: file.reference, declared_facts: facts, independently_verified_by_collector: false };
    }
    const after = await sourceManifest(root, output);
    if (after.sha256 !== source.sha256 || (await git(root, ["rev-parse", "HEAD"])).trim() !== baseCommit) throw Error("Source changed during evidence collection; no checkpoint written");
    const value = { schema_version: "wringer.checkpoint-evidence.v1", collected_at: new Date().toISOString(), git_base_commit: baseCommit, source, validations, runtime_smoke: runtimeSmoke, image_inventory: imageInventory, limitations: ["Source hashes describe the current working files, including selected untracked files and tracked deletions. They do not claim that earlier validation logs were produced from this exact snapshot.", "Relative artifact paths identify separately retained evidence; raw artifacts are not copied into this summary.", "Only explicitly supplied measurements are included. Missing test counts and optional measurements remain null. No remote CI, provider, containment, publication, or blind-test outcome is inferred."] };
    assertPortableFacts(value);
    let parent = root;
    for (const part of relative(root, dirname(output)).split(sep).filter(Boolean)) {
        parent = resolve(parent, part);
        try { await mkdir(parent, { mode: 0o700 }); } catch (error: any) { if (error.code !== "EEXIST") throw error; }
        const info = await lstat(parent);
        if (!info.isDirectory() || info.isSymbolicLink()) throw Error("Output parents must be real repository directories");
    }
    cleanPath(root, resolve(await realpath(dirname(output)), "checkpoint.json"));
    await writeFile(output, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    return { path: outputName, source_files: source.files.length, validation_runs: validations.length };
}
if (import.meta.main) {
    const args = process.argv.slice(2);
    if (args.includes("--help")) console.log("bun scripts/checkpoint-evidence.ts --validation DIRECTORY [--validation DIRECTORY] --output NEW.json [--runtime-smoke REPORT.json] [--image-inventory INVENTORY.json]\nAll paths resolve from the source repository root. Reads retained evidence only; refuses overwrite, unsafe inventory facts, and source changes during collection.");
    else try {
        const options: CheckpointOptions = { root: resolve(import.meta.dir, ".."), validations: [], output: "" }, used = new Set<string>();
        for (let i = 0; i < args.length; i += 2) {
            const flag = args[i]!, value = args[i + 1];
            if (!value || value.startsWith("--") || !["--validation", "--output", "--runtime-smoke", "--image-inventory"].includes(flag) || flag !== "--validation" && used.has(flag)) throw Error("Use --help for the explicit checkpoint invocation");
            used.add(flag);
            if (flag === "--validation") options.validations.push(value);
            else if (flag === "--output") options.output = value;
            else if (flag === "--runtime-smoke") options.runtimeSmoke = value;
            else options.imageInventory = value;
        }
        if (!options.output) throw Error("An explicit new output path is required");
        console.log(JSON.stringify(await collectCheckpoint(options)));
    } catch (error) { console.error(new Redactor().scrub(error instanceof Error ? error.message : String(error))); process.exitCode = 1; }
}
