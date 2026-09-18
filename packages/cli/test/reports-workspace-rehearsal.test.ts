import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { runAcpTurn } from "../../acp/src";
import { createDesignSnapshot } from "../../design/src";
import { hashBytes, validateExecutionPlan } from "../../plan/src";
import { loadReportsWorkspaceScenario, REPORTS_CORRECTION, REPORTS_INPUTS } from "../../../scripts/reports-workspace-scenario";
import { reportsScenarioArguments } from "../../../scripts/reports-workspace-rehearsal";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const image = `fixture.invalid/browser@sha256:${"a".repeat(64)}`;
const example = resolve(import.meta.dir, "../../../examples/reports-design");
// Parser bytes only: these solid pixels are never claimed as design evidence.
function parserPng(width: number, height: number) {
    const chunk = (name: string, data: Buffer) => {
        const body = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
        for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
        const size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
        return Buffer.concat([size, body, checksum]);
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.alloc((1 + width * 3) * height))), chunk("IEND", Buffer.alloc(0))]);
}
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "reports-scenario-unit-")); directories.push(root);
    const source = join(root, "source"), intentFile = join(root, "intent.json");
    for (const path of REPORTS_INPUTS) {
        if (path.startsWith("design-input/") || path === "design/snapshot.json") continue;
        await mkdir(dirname(join(source, path)), { recursive: true }); await copyFile(join(example, path), join(source, path));
    }
    await mkdir(join(source, "design-input")); await mkdir(join(source, "design"));
    const assets = [];
    for (const [id, width, height] of [["desktop", 1280, 900], ["mobile", 390, 844]] as const) {
        const png = parserPng(width, height); await writeFile(join(source, `design-input/${id}.png`), png);
        assets.push({ id, title: `Synthetic parser ${id}`, pngBase64: png.toString("base64") });
    }
    await writeFile(join(source, "design-input/owned.json"), '{"fixture":"parser only"}\n');
    await writeFile(join(source, "design/snapshot.json"), JSON.stringify(createDesignSnapshot({ title: "Synthetic parser test", disclosure: "repository-permitted", context: "Parser fixture only", assets })));
    const request = await readFile(join(source, "REQUEST.md"), "utf8");
    const intent = request + "\nSCRIPTED parser-test chat words. Preserve my wording exactly.\\\n";
    await writeFile(intentFile, JSON.stringify({ intent, discardedPrivateField: "not-copied-to-source" }));
    return { root, source, intentFile, image, request, intent };
}

test("original-input scenario preserves request, chat, components, checks and both exact PNGs without starting a runtime", async () => {
    const input = await fixture(), scenario = await loadReportsWorkspaceScenario(input), copy = join(input.root, "copy");
    await scenario.prepareSource(copy);
    for (const path of REPORTS_INPUTS) expect(await readFile(join(copy, path))).toEqual(await readFile(join(input.source, path)));
    expect(await readFile(join(copy, "rehearsal/original-intent.md"), "utf8")).toBe(input.intent);
    const metadata = JSON.parse(await readFile(join(copy, "rehearsal/fixture.json"), "utf8"));
    expect(metadata).toMatchObject({ fixture: true, correction: REPORTS_CORRECTION, originalIntentSha256: hashBytes(input.intent) });
    expect(JSON.stringify(metadata)).not.toContain("not-copied-to-source");
    const plan = scenario.plan("a".repeat(40));
    expect(validateExecutionPlan(plan, { credentialEnvironment: {} })).toEqual(plan);
    expect(plan.intent).toBe(input.intent);
    expect(plan.runtime.network.policy).toBe("deny"); expect(plan.runtime.env).toEqual([]);
    expect(plan.agents.worker).toMatchObject({ command: "node", args: ["rehearsal/scripted-acp.mjs", "worker"], env: [] });
    expect(plan.agents.judge).toMatchObject({ command: "node", args: ["rehearsal/scripted-acp.mjs", "judge"], env: [] });
    expect(plan.scope.writable).toEqual(["src"]);
    expect(plan.acceptance.checks).toHaveLength(2);
    expect(plan.acceptance.checks[0]).toMatchObject({ id: "reports-acceptance", argv: ["bun", "checks/acceptance.ts"], evidence: { kind: "assertions", format: "wringer-check.v1" } });
    expect(plan.acceptance.checks[1]).toMatchObject({ id: "reports-supplementary-audit", argv: ["bun", "rehearsal/reports-audit.ts"], timeout_seconds: 60, evidence: { kind: "assertions", format: "wringer-check.v1" } });
    for (const path of ["checks", "ui", "data", "rehearsal", "design/snapshot.json", "wringer/playbooks/reports-component-first.json"]) expect(plan.acceptance.protected_paths).toContain(path);
    expect(plan.budget).toMatchObject({ max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, wall_clock_seconds: 900 });
    expect(plan.design?.reviews[0]?.referenceIds).toEqual(["desktop", "mobile"]);
    expect(scenario.guided).toMatchObject({ realVerifier: true, realRoleContainment: true, skipBreakage: true, correction: REPORTS_CORRECTION });
    const finalApp = await readFile(join(copy, "rehearsal/corrected-app.ts.txt"));
    await writeFile(join(copy, "src/app.ts"), finalApp); await scenario.verifyClone(copy);
    await writeFile(join(copy, "REQUEST.md"), "changed original words\n");
    await expect(scenario.verifyClone(copy)).rejects.toThrow("REQUEST.md");
});

test("scenario refuses shortened intent, mutable images, changed references and source links", async () => {
    const input = await fixture();
    await expect(loadReportsWorkspaceScenario({ ...input, image: "browser:latest" })).rejects.toThrow();
    await writeFile(input.intentFile, JSON.stringify({ intent: input.request }));
    await expect(loadReportsWorkspaceScenario(input)).rejects.toThrow("complete REQUEST.md");
    await writeFile(input.intentFile, JSON.stringify({ intent: input.intent }));
    const desktop = join(input.source, "design-input/desktop.png"), original = await readFile(desktop);
    await writeFile(desktop, parserPng(390, 844));
    await expect(loadReportsWorkspaceScenario(input)).rejects.toThrow("Original desktop PNG");
    await writeFile(desktop, original);
    const data = join(input.source, "data/reports.json"); await rm(data); await symlink(input.intentFile, data);
    await expect(loadReportsWorkspaceScenario(input)).rejects.toThrow("regular source file");
});

test("scripted ACP protocol copies two predetermined versions and writes ignored output; this unit test executes no Reports app code", async () => {
    const input = await fixture(), scenario = await loadReportsWorkspaceScenario(input), copy = join(input.root, "adapter-unit");
    await scenario.prepareSource(copy); await mkdir(join(copy, ".evidence"));
    const execute = async (role: "worker" | "judge") => {
        const child = spawn(process.execPath, [join(copy, "rehearsal/scripted-acp.mjs"), role], { cwd: copy, env: {}, stdio: ["pipe", "pipe", "pipe"] });
        return runAcpTurn({ input: child.stdin, output: child.stdout, errors: child.stderr, exited: new Promise(resolve => child.on("exit", code => resolve({ code }))), async terminate() { child.kill(); } }, { role, cwd: copy, prompt: "SCRIPTED protocol unit test only", timeoutMs: 2000 });
    };
    const sessionIds = new Set<string>();
    for (const variant of ["initial", "corrected"]) {
        const result = await execute("worker"); expect(result.status).toBe("completed");
        expect(result.sessionId).toBeTruthy(); sessionIds.add(result.sessionId!);
        expect(result.text).toContain("SCRIPTED ignored .evidence capture probe written");
        expect(await readFile(join(copy, "src/app.ts"))).toEqual(await readFile(join(copy, `rehearsal/${variant}-app.ts.txt`)));
    }
    const judge = await execute("judge"); expect(judge.text).toContain("Predetermined fixture reply"); sessionIds.add(judge.sessionId!);
    expect(sessionIds.size).toBe(3);
    expect((await execute("worker")).status).not.toBe("completed");
    await scenario.verifyClone(copy);
});

test("scenario CLI has no production-controller or destination override and requires explicit inputs", () => {
    expect(reportsScenarioArguments(["--source", "/test/source", "--intent", "/test/intent.json", "--image", image])).toEqual({ source: "/test/source", intentFile: "/test/intent.json", image });
    for (const args of [[], ["--source", "/x"], ["--state", "/production"], ["--destination", "/original/origin.git"], ["--source", "/x", "--source", "/y"]]) expect(() => reportsScenarioArguments(args)).toThrow();
    expect(() => reportsScenarioArguments(["--source", "relative", "--intent", "/test/intent.json", "--image", image])).toThrow("absolute");
});
