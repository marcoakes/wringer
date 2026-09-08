import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Readable, Writable } from "node:stream";
import { Redactor } from "@wringer/engine";
import { processDriver, type RuntimeDriver } from "@wringer/runtime";
import { inspectCandidateHistory, StreamingSourceSecretInspector, SOURCE_INSPECTION_LIMITS } from "../src/source-inspection";

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
async function scratch() { const path = await mkdtemp(join(tmpdir(), "wringer-source-inspection-")); temporary.push(path); return path; }
const redactor = () => new Redactor([], {});
function inspectText(text: string | Uint8Array, width: number, r = redactor()): boolean {
    try { const inspector = new StreamingSourceSecretInspector(r), bytes = typeof text === "string" ? Buffer.from(text) : text; for (let offset = 0; offset < bytes.length; offset += width) inspector.write(bytes.subarray(offset, offset + width)); inspector.finish(); return false; }
    catch (error: any) { if (error.code === "source-secret") return true; throw error; }
}
describe("source secrets survive streamed object/chunk boundaries", () => {
    test("known values, partial known credentials, shapes and private-key headers are detected at every boundary", () => {
        const known = "private-fake-credential-for-this-fixture-only", r = new Redactor(["TEST_KEY"], { TEST_KEY: known });
        for (const token of [known, known.slice(0, 10), known.slice(-11), "sk-" + "a".repeat(24), "sk-ant-" + "b".repeat(30), "ghp_" + "C".repeat(24), "AKIA" + "D".repeat(16), "-----BEGIN RSA PRIVATE KEY-----"]) {
            for (let width = 1; width < token.length + 5; width++) expect(inspectText(`start ${token} end`, width, r)).toBe(true);
        }
    });
    test("unknown long provider tokens and arbitrarily long private-key type fields do not escape the overlap window", () => {
        for (const value of ["sk-" + "z".repeat(90000), "ghu_" + "Z".repeat(90000), "-----BEGIN " + "Q".repeat(90000) + "PRIVATE KEY-----"]) expect(inspectText(value, 37)).toBe(true);
        expect(inspectText("ghu_" + "Z".repeat(90000) + "_", 37)).toBe(false);
        expect(inspectText("-----BEGIN invalid-with-dash " + "Q".repeat(10000) + "PRIVATE KEY-----", 39)).toBe(false);
    });
    test("bounded tokens and fragments wait for the real right boundary; UTF-8 survives one-byte chunks", () => {
        const r = new Redactor(["TEST_KEY"], { TEST_KEY: "sensitive-fixture-value" });
        for (const clean of ["AKIA" + "A".repeat(17), "sensitiveX", "xsensitive", "文🙂 harmless café", "-----BEGIN [^-]*PRIVATE KEY-----"]) for (const width of [1, 4, 8, 20]) expect(inspectText(clean, width, r)).toBe(false);
        expect(inspectText("文🙂 SECRET-café-字 🙂", 1, new Redactor(["TEST_KEY"], { TEST_KEY: "SECRET-café-字" }))).toBe(true);
    });
    test("streamed detection matches whole-text Redactor checks across adversarial boundary placements", () => {
        const r = new Redactor(["TEST_KEY"], { TEST_KEY: "sensitive-fixture-value" });
        for (const left of ["", " ", "X", "-", "_", "\n", "文"]) for (const right of ["", " ", "X", "-", "_", "\n"]) for (const token of ["sensitive", "xture-value", "AKIA" + "A".repeat(16), "sk-" + "a".repeat(12), "ghp_" + "b".repeat(20)]) {
            const value = left + token + right, expected = r.scrub(value) !== value;
            for (const width of [1, 7, 16]) expect(inspectText(value, width, r)).toBe(expected);
        }
    });
    test("binary objects are inspected without retaining or returning their raw contents", () => {
        const value = Buffer.concat([Buffer.from([0, 255, 128]), Buffer.from("sk-" + "z".repeat(30)), Buffer.from([0, 255])]);
        expect(inspectText(value, 2)).toBe(true);
        const inspector = new StreamingSourceSecretInspector(redactor());
        expect(() => inspector.write(value)).toThrow("detected credential");
        try { inspector.write(value); } catch (error: any) { expect(error.message).not.toContain("z".repeat(20)); }
    });
});

const oid = "a".repeat(40);
function fake(wire: string, inventory = oid + "\n", stalled = false, closeAfterWrite = false) {
    let connects = 0, terminated = 0;
    const driver: Pick<RuntimeDriver, "connect"> = { connect: async argv => {
        connects++; const batch = argv.includes("cat-file"), output = new PassThrough();
        let complete!: (value: { code: number }) => void;
        const exited = new Promise<{ code: number }>(resolve => { complete = resolve; });
        const input = new Writable({ write(_chunk, _encoding, callback) { if (batch) { output.write(wire); if (closeAfterWrite) { output.end(); complete({ code: 0 }); } } callback(); }, final(callback) { if (!stalled) { if (!batch) output.write(inventory); output.end(); complete({ code: 0 }); } callback(); } });
        let stopped = false;
        return { input, output, errors: Readable.from([]), exited, async terminate() { if (!stopped) { stopped = true; terminated++; input.destroy(); output.destroy(); complete({ code: 143 }); } } };
    } };
    return { driver, counts: () => ({ connects, terminated }) };
}
describe("source inspection process boundaries and explicit limits", () => {
    test("malformed, oversized and truncated objects cannot produce a passed inspection", async () => {
        for (const wire of [`${oid} commit 999999999999999999999999999\n`, `${oid} commit 999\n`, `${"b".repeat(40)} commit 1\nx\n`, `${oid} commit 1\nx!`, "private raw diagnostic should not escape\n"]) {
            const fixture = fake(wire);
            await expect(inspectCandidateHistory("/fixture/objects.git", oid, redactor(), { driver: fixture.driver, limits: { objectBytes: 100, timeoutMs: 200 } })).rejects.toThrow();
            expect(fixture.counts().terminated).toBe(2);
        }
        const truncated = fake(`${oid} commit 4\nsa`, oid + "\n", false, true);
        await expect(inspectCandidateHistory("/fixture", oid, redactor(), { driver: truncated.driver })).rejects.toThrow("body ended early");
        expect(truncated.counts().terminated).toBe(2);
    });
    test("inventory/count/aggregate ceilings and extra bytes are fail-closed", async () => {
        for (const [wire, inventory, limits] of [[`${oid} commit 4\nsafe\n`, `${oid}\n${oid}\n`, { objects: 1 }], [`${oid} commit 4\nsafe\n`, `${oid}\n${oid}\n`, { totalBytes: 7 }], [`${oid} commit 4\nsafe\nextra`, `${oid}\n`, {}], [`${oid} commit 4\nsafe\n`, "not-an-object\n", {}], [`${oid} blob 4\nsafe\n`, `${oid}\n`, {}]] as const) {
            const fixture = fake(wire, inventory);
            await expect(inspectCandidateHistory("/fixture/objects.git", oid, redactor(), { driver: fixture.driver, limits })).rejects.toThrow();
        }
        const fixture = fake("");
        await expect(inspectCandidateHistory("/fixture", oid, redactor(), { driver: fixture.driver, limits: { totalBytes: SOURCE_INSPECTION_LIMITS.totalBytes + 1 } })).rejects.toThrow("only be reduced");
        expect(fixture.counts().connects).toBe(0);
    });
    test("cancellation and deadline kill owned readers and never declare partial inspection passed", async () => {
        const before = fake(""), aborted = new AbortController(); aborted.abort();
        await expect(inspectCandidateHistory("/fixture", oid, redactor(), { signal: aborted.signal, driver: before.driver })).rejects.toThrow(); expect(before.counts().connects).toBe(0);
        const during = fake("", oid + "\n", true), controller = new AbortController();
        const pending = inspectCandidateHistory("/fixture", oid, redactor(), { signal: controller.signal, driver: during.driver });
        setTimeout(() => controller.abort(), 20);
        await expect(pending).rejects.toThrow("interrupted"); expect(during.counts().terminated).toBe(2);
        const deadline = fake("", oid + "\n", true);
        await expect(inspectCandidateHistory("/fixture", oid, redactor(), { driver: deadline.driver, limits: { timeoutMs: 20 } })).rejects.toThrow("deadline"); expect(deadline.counts().terminated).toBe(2);
    });
});

async function git(repo: string, args: string[], input?: string) {
    const result = await processDriver.command(["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "-C", repo, ...args], { input, env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    if (result.code) throw new Error(result.stderr); return result.stdout.trim();
}
test("the exact candidate includes deleted historical secrets but excludes unrelated/evidence refs", async () => {
    const repo = await scratch(); await git(repo, ["init", "--initial-branch=main"]); await writeFile(join(repo, "file.txt"), "safe source\n"); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "safe"]);
    const safe = await git(repo, ["rev-parse", "HEAD"]), store = join(repo, ".git"), before = await inspectCandidateHistory(store, safe, redactor());
    await writeFile(join(repo, "private.txt"), "ghp_" + "T".repeat(30)); await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "historical fixture"]); await git(repo, ["rm", "private.txt"]); await git(repo, ["commit", "-m", "deleted from current tree"]);
    const secretHistory = await git(repo, ["rev-parse", "HEAD"]);
    await git(repo, ["update-ref", "refs/heads/wringer/evidence-fixture", secretHistory]);
    const again = await inspectCandidateHistory(store, safe, redactor()); expect(again).toEqual(before);
    await expect(inspectCandidateHistory(store, secretHistory, redactor())).rejects.toThrow("detected credential");
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("safe source\n");
}, 30000);
