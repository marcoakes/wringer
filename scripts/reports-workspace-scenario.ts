/** Original Reports inputs + scripted source changes + real contained checks.
 * Test construction only: never imported by the production command surface. */
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { assertRepositoryDisclosure, parseDesignSnapshot } from "../packages/design/src";
import { compileDeclaration, hashBytes } from "../packages/plan/src";
import { executeAgentRole, parseRuntimePolicy, runContainedCommands } from "../packages/runtime/src";
import type { RehearsalScenario } from "./rehearsal-scenario";

export const REPORTS_INPUTS = [".gitignore", "README.md", "REQUEST.md", "index.html", "src/app.ts", "ui/components.ts", "ui/tokens.css", "data/reports.json", "checks/acceptance.ts", "checks/browser.ts", "checks/show.ts", "design-input/owned.json", "design-input/desktop.png", "design-input/mobile.png", "design/snapshot.json", "reviews.json", "wringer/playbooks/reports-component-first.json"] as const;
const humanQuote = "I will decide whether the layout, hierarchy and overall feel are right.";
export const REPORTS_CORRECTION = 'SCRIPTED TEST FIXTURE correction: keep the working reports and show the result count as "6 of 6 reports" on the unfiltered list, matching the supplied reference. This is a predetermined test instruction, not Marc’s feedback.';
export const REPORTS_LIMITS = [
    "Engineering rehearsal with SCRIPTED source author, independent-role reply, approval, correction, acceptance and local Send; no real person's decision and no live model convergence claim.",
    "Original request, chat intent, report data, components, checks and both reference PNGs are preserved. Original checks and screenshots execute only in the declared credential-free contained verifier.",
    "Deterministic Node ACP fixtures run in real worker/judge sandboxes. Worker writes source and ignored .evidence; production patch export must capture source and exclude outputs. This measures containment, not model reasoning.",
    "No provider API calls or credential reads. Four role records represent contained scripted ACP calls, not paid model sessions or billing measurements.",
    "Generated isolated local bare origin only; no original destination, hosted forge, merge, deployment or production approval.",
    "Controller and scripted operator use cooperative-local fixture state; a protected controller or human-confirmation OS boundary is not measured.",
    "OS kill, reboot and sleep recovery and live breakage testing are not exercised by this bounded scenario. No target-code host fallback is permitted.",
];

export async function loadReportsWorkspaceScenario(input: { source: string; intentFile: string; image: string }): Promise<RehearsalScenario> {
    const source = await realpath(resolve(input.source));
    const runtime = parseRuntimePolicy({ kind: "apple-container", image: input.image, cpus: 2, memoryMiB: 2048, network: { policy: "deny" }, env: [] });
    const bytes = new Map<string, Buffer>();
    for (const path of REPORTS_INPUTS) {
        const file = join(source, path), info = await lstat(file), real = await realpath(file);
        if (!info.isFile() || info.isSymbolicLink() || !real.startsWith(source + "/") || info.size > 16 * 1024 * 1024) throw new Error(`Reports scenario input is not a bounded regular source file: ${path}`);
        bytes.set(path, await readFile(file));
    }
    const intentPath = resolve(input.intentFile), intentInfo = await lstat(intentPath);
    if (!intentInfo.isFile() || intentInfo.isSymbolicLink() || intentInfo.size > 2 * 1024 * 1024) throw new Error("Intent input must be a bounded regular JSON file");
    const originalRequest = bytes.get("REQUEST.md")!.toString("utf8"), intentRecord = JSON.parse(await readFile(intentPath, "utf8"));
    const intent = intentRecord.intent;
    if (typeof intent !== "string" || intent.length > 1024 * 1024 || !intent.startsWith(originalRequest) || intent.trim() === originalRequest.trim() || !intent.includes(humanQuote)) throw new Error("Reports rehearsal needs the preserved complete REQUEST.md followed by the user's chat intent; no shortened template intent is accepted");
    const snapshot = parseDesignSnapshot(bytes.get("design/snapshot.json")!); assertRepositoryDisclosure(snapshot);
    const captures = [{ id: "desktop", path: ".evidence/desktop.png", mimeType: "image/png" as const, width: 1280, height: 900 }, { id: "mobile", path: ".evidence/mobile.png", mimeType: "image/png" as const, width: 390, height: 844 }];
    if (snapshot.assets.length !== 2) throw new Error("Reports rehearsal requires both original desktop and mobile references");
    for (const expected of captures) {
        const reference = snapshot.assets.find(asset => asset.id === expected.id), png = bytes.get(`design-input/${expected.id}.png`)!;
        if (!reference || reference.width !== expected.width || reference.height !== expected.height || reference.sha256 !== hashBytes(png) || !Buffer.from(reference.base64, "base64").equals(png)) throw new Error(`Original ${expected.id} PNG differs from its pinned snapshot or expected viewport`);
    }
    const sourceManifest = [...bytes].map(([path, content]) => ({ path, sha256: hashBytes(content), bytes: content.length }));
    const originalApp = bytes.get("src/app.ts")!.toString("utf8"), finalApp = await readFile(join(import.meta.dir, "fixtures/reports-app.ts.txt"), "utf8");
    const finalCount = "`${visible.length} of ${reports.length} reports`";
    if (!finalApp.includes(finalCount) || !originalApp.endsWith("\n")) throw new Error("Scripted Reports source or original baseline is not the expected fixture shape");
    const firstApp = finalApp.replace(finalCount, "`${visible.length} reports`");
    if (!bytes.get(".gitignore")!.toString("utf8").split(/\r?\n/).some(line => line === ".evidence/" || line === "/.evidence/")) throw new Error("Reports source must preserve its ignored .evidence output directory");
    const playbookPath = "wringer/playbooks/reports-component-first.json", playbook = JSON.parse(bytes.get(playbookPath)!.toString("utf8")), playbookSha256 = hashBytes(bytes.get(playbookPath)!);
    bytes.set("rehearsal/original-intent.md", Buffer.from(intent));
    bytes.set("rehearsal/scripted-acp.mjs", await readFile(join(import.meta.dir, "fixtures/reports-scripted-acp.mjs")));
    bytes.set("rehearsal/reports-audit.ts", await readFile(join(import.meta.dir, "fixtures/reports-audit.ts.txt")));
    bytes.set("rehearsal/initial-app.ts.txt", Buffer.from(firstApp));
    bytes.set("rehearsal/corrected-app.ts.txt", Buffer.from(finalApp));
    bytes.set("rehearsal/fixture.json", Buffer.from(JSON.stringify({ fixture: true, author: "SCRIPTED TEST FIXTURE (not a model or independent person)", sourceInputs: sourceManifest, originalIntentSha256: hashBytes(intent), correction: REPORTS_CORRECTION, sourceAuthoring: "predetermined test implementation", initialImplementationSha256: hashBytes(firstApp), correctedImplementationSha256: hashBytes(finalApp), limits: REPORTS_LIMITS }, null, 2) + "\n"));
    const manifest = [...bytes].map(([path, content]) => ({ path, sha256: hashBytes(content), bytes: content.length }));
    const verify = async (directory: string, includeApp: boolean) => {
        for (const [path, content] of bytes) if (includeApp || path !== "src/app.ts") {
            if (!content.equals(await readFile(join(directory, path)))) throw new Error(`Reports input changed in the fixture: ${path}`);
        }
    };
    return {
        title: "Actual Reports inputs — SCRIPTED operator and source author, real contained checks", sourceFixtureKind: "original-reports-inputs-contained-verifier", limits: REPORTS_LIMITS, snapshot, captures, manifest,
        playbookId: playbook.id, playbookSha256, runCommands: runContainedCommands, executeRole: executeAgentRole,
        async prepareSource(destination) { for (const [path, content] of bytes) { await mkdir(dirname(join(destination, path)), { recursive: true }); await writeFile(join(destination, path), content, { flag: "wx" }); } await verify(destination, true); },
        plan(commit) {
            return compileDeclaration({ version: 3, name: "Reports original-input automated engineering rehearsal", intent, repository: { url: "https://fixture.invalid/reports-workspace.git", commit }, runtime, agents: { worker: { protocol: "acp", command: "node", args: ["rehearsal/scripted-acp.mjs", "worker"], env: [] }, judge: { protocol: "acp", command: "node", args: ["rehearsal/scripted-acp.mjs", "judge"], env: [] } }, environment: { context: ["README.md", "REQUEST.md", "rehearsal/original-intent.md", "rehearsal/fixture.json", "ui/components.ts", "ui/tokens.css", "data/reports.json"], tools: [{ name: "bun", version: "1.4.2", probe: ["bun", "--version"] }, { name: "browser", version: "1.63.0", probe: ["node", "-p", "require('/opt/wringer-design/node_modules/playwright/package.json').version"] }], setup: [], baseline: [], writable_directories: [".evidence"] }, scope: { writable: ["src"] }, acceptance: { criteria: [{ id: "reports-work", title: "Find and open reports on desktop and phone", quote: "Load the reports from the supplied local report data.", kind: "check", required: true }, { id: "design-review", title: "The layout, hierarchy and overall feel are right", quote: humanQuote, kind: "human", required: true, show: { id: "show-design", argv: ["bun", "checks/show.ts"], cwd: ".", timeout_seconds: 30 } }], checks: [{ id: "reports-acceptance", argv: ["bun", "checks/acceptance.ts"], cwd: ".", timeout_seconds: 45, criteria: ["reports-work"], evidence: { kind: "assertions", format: "wringer-check.v1" }, files: ["checks/acceptance.ts", "checks/browser.ts", "checks/show.ts", "ui/components.ts", "ui/tokens.css", "data/reports.json", "index.html"] }, { id: "reports-supplementary-audit", argv: ["bun", "rehearsal/reports-audit.ts"], cwd: ".", timeout_seconds: 60, criteria: ["reports-work"], evidence: { kind: "assertions", format: "wringer-check.v1" }, files: ["rehearsal/reports-audit.ts", "checks/browser.ts", "ui/components.ts", "ui/tokens.css", "data/reports.json", "index.html"] }], protected_paths: ["checks", "ui", "data", "index.html", "REQUEST.md", "README.md", "design-input", "design/snapshot.json", playbookPath, "rehearsal"] }, budget: { max_sessions: 4, max_worker_turns: 2, max_judge_turns: 2, max_planner_turns: 0, wall_clock_seconds: 900, session_timeout_seconds: 120 }, playbook: { path: playbookPath, sha256: playbookSha256, taskFamily: "reports-design" }, design: { snapshotPath: "design/snapshot.json", snapshotSha256: snapshot.snapshot_sha256, reviews: [{ criterionId: "design-review", referenceIds: ["desktop", "mobile"], captures }] } });
        },
        guided: { correction: REPORTS_CORRECTION, firstResultText: "Captured the actual Reports output", snapshotPath: "design/snapshot.json", sourcePath: "src/app.ts", correctedSourceText: finalCount, designCriterionId: "design-review", requirementText: "layout, hierarchy and overall feel", requiredHumanCount: 1, referenceWidth: 1280, referenceHeight: 900, phaseTimeoutMs: 240000, realVerifier: true, realRoleContainment: true, skipBreakage: true },
        async verifyClone(directory) { await verify(directory, false); if (await readFile(join(directory, "src/app.ts"), "utf8") !== finalApp) throw new Error("Fresh clone does not contain the exact scripted corrected implementation"); },
    };
}
