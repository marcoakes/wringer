import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { compileDeclaration, compileExecutionPlan, hashValue, discoverEnvironment } from "@wringer/plan";
import { importDesignFromFigmaRest, sealDesignSnapshot, writeDesignSnapshot, parseDesignSnapshot } from "@wringer/design";
import { createLocalSourceBundle, prepareRepositorySource, prepareRepositoryArtifactSource } from "@wringer/runtime";
import { initializeAssistant, createAssistantService, issueAssistantCapability, approveAssistantProposal } from "../src/assistant";
import { assistantPath, writeAssistantRecord } from "../src/assistant-store";
import { attachAssistantDesign, readAssistantDesignBinding } from "../src/assistant-design-binding";
import { localSourceSiblings } from "../src/assistant-local-source";

// Real Git plumbing with deterministic HTTP bytes. No Figma account or model.
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function git(cwd: string, ...args: string[]) {
    const process = Bun.spawn(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    if (code) throw new Error(stderr); return stdout.trim();
}
function png() {
    const chunk = (type: string, contents: Buffer) => {
        const b = Buffer.alloc(contents.length + 12); b.writeUInt32BE(contents.length); b.write(type, 4); contents.copy(b, 8);
        let crc = 0xffffffff; for (const byte of b.subarray(4, b.length - 4)) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
        b.writeUInt32BE((crc ^ 0xffffffff) >>> 0, b.length - 4); return b;
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND", Buffer.alloc(0))]);
}
async function fixture() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-design-binding-"))); dirs.push(root);
    const repo = join(root, "repo"), controller = join(root, "controller"); await mkdir(repo);
    await git(repo, "init", "-q"); await git(repo, "config", "user.name", "Fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
    await mkdir(join(repo, "tests")); await mkdir(join(repo, "scripts")); await mkdir(join(repo, "design"));
    for (const file of ["README.md", "tests/acceptance.test.ts", "scripts/capture.ts", "design/old.json", "bun.lock", "package.json"]) await writeFile(join(repo, file), "Fixture data only\n");
    await git(repo, "add", "."); await git(repo, "commit", "-qm", "base fixture"); const commit = await git(repo, "rev-parse", "HEAD");
    const original = compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...declaration } = original;
    const profile = compileDeclaration({ ...declaration, version: 2, intent: original.intent + " The display matches the design.", repository: { url: "https://example.invalid/reports.git", commit }, environment: { ...original.environment, writable_directories: ["node_modules", "preview"] }, acceptance: { ...original.acceptance, criteria: [...original.acceptance.criteria, { id: "design-fit", title: "Display matches design", quote: "The display matches the design.", kind: "human", required: true, show: { id: "preview", argv: ["bun", "scripts/capture.ts"], cwd: ".", timeout_seconds: 30 } }], protected_paths: [...original.acceptance.protected_paths, "scripts/capture.ts"] }, design: { snapshotPath: "design/old.json", snapshotSha256: "a".repeat(64), reviews: [{ criterionId: "design-fit", referenceIds: ["old"], captures: [{ id: "desktop", path: "preview/desktop.png", mimeType: "image/png", width: 1, height: 1 }] }] } });
    const workspace = (await initializeAssistant(controller, { plan: profile, cooperativeLocal: true })).workspace;
    const preview = await importDesignFromFigmaRest({ urls: ["https://www.figma.com/design/Fixture/Reports?node-id=1-2"], token: "synthetic-not-a-real-secret", disclosure: "private" }, { testTransport: async request => {
        const url = new URL(request.url);
        const value = url.pathname.endsWith("/nodes") ? { name: "Synthetic Reports", version: "fixture-v1", nodes: { "1:2": { document: { id: "1:2", type: "FRAME", name: "Desktop" }, components: {}, componentSets: {}, styles: {} } } } : { images: { "1:2": "https://s3-alpha.figma.com/images/fixture.png" } };
        return { status: 200, headers: { "content-type": url.hostname === "api.figma.com" ? "application/json" : "image/png" }, body: url.hostname === "api.figma.com" ? Buffer.from(JSON.stringify(value)) : png() };
    }, now: () => new Date("2026-09-09T12:00:00.000Z") });
    const snapshot = sealDesignSnapshot({ ...preview, disclosure: "repository-permitted" });
    const importId = crypto.randomUUID(), at = (name: string) => `design-imports/${importId}/${name}`;
    await writeAssistantRecord(controller, at("request.json"), { schema_version: "wringer.assistant-design-request.v1", importId, workspaceId: workspace.id, profileSha256: hashValue(profile) });
    await writeDesignSnapshot(await assistantPath(controller, at("preview.json")), preview);
    await writeDesignSnapshot(await assistantPath(controller, at("retained.json")), snapshot);
    const permission = () => writeAssistantRecord(controller, at("consent.json"), { schema_version: "wringer.assistant-design-consent.v1", importId, workspaceId: workspace.id, profileSha256: hashValue(profile), previewSha256: preview.snapshot_sha256, retainedSha256: snapshot.snapshot_sha256, actor: "Synthetic operator" });
    const input = { importId, expectedSnapshotSha256: snapshot.snapshot_sha256, confirmAttachment: true };
    const attach = (override = input) => attachAssistantDesign(controller, workspace, override, undefined, { prepareSource: async (source, artifact, options) => { const bundlePath = join(root, `hosted-${crypto.randomUUID()}.bundle`); await createLocalSourceBundle(repo, source.commit, bundlePath); return prepareRepositoryArtifactSource({ ...source, bundlePath }, artifact, options); } });
    return { root, repo, controller, commit, workspace, profile, snapshot, preview, input, permission, attach };
}
test("approved REST design attaches a single immutable data commit and survives a fresh bundle clone", async () => {
    const f = await fixture(); await f.permission();
    const [binding, concurrent] = await Promise.all([f.attach(), f.attach()]); expect(concurrent).toEqual(binding);
    expect(binding.profile.repository.url).toBe(f.profile.repository.url); expect(binding.profile.repository.commit).not.toBe(f.commit);
    expect(binding.profile.agents).toEqual(f.profile.agents); expect(binding.profile.budget).toEqual(f.profile.budget); expect(binding.profile.scope).toEqual(f.profile.scope);
    expect(binding.profile.acceptance.protected_paths).toContain(f.profile.design!.snapshotPath);
    expect(binding.profile.design!.reviews[0]!.referenceIds).toEqual(["figma-1-2"]);
    expect(await git(f.repo, "rev-parse", "HEAD")).toBe(f.commit); expect(await git(f.repo, "status", "--porcelain")).toBe("");
    expect(await f.attach()).toEqual(binding);
    const clone = join(f.root, "fresh"); await git(f.root, "clone", "-q", "--branch", "design", binding.sourceBundle, clone);
    expect(await git(clone, "rev-parse", "HEAD^")).toBe(f.commit);
    expect(await git(clone, "diff", "--name-only", "HEAD^", "HEAD")).toBe(binding.profile.design!.snapshotPath);
    expect(parseDesignSnapshot(await readFile(join(clone, binding.profile.design!.snapshotPath))).schema_version).toBe("wringer.design-snapshot.v2");
    const transport = await prepareRepositorySource({ ...binding.profile.repository, bundlePath: binding.sourceBundle }, { controllerDir: join(f.root, "new-controller") });
    const map = await discoverEnvironment(transport.objectStore, binding.profile);
    expect(map.files.some(row => row.path === binding.profile.design!.snapshotPath)).toBe(true);
    expect(JSON.stringify(map.context)).not.toContain(f.snapshot.assets[0]!.base64);
});
test("a local-only workspace attaches its design on top of the bundle kept at init, with no source override", async () => {
    const f = await fixture(), controller = join(f.root, "local-controller"), profilePath = join(f.root, "local-profile.json"), siblings = localSourceSiblings(profilePath);
    const made = await createLocalSourceBundle(f.repo, f.commit, siblings.bundle);
    const { schema_version, plan_sha256, intent_sha256, acceptance_sha256, ...declaration } = f.profile;
    const profile = compileDeclaration({ ...declaration, version: 4, repository: { url: made.url, commit: f.commit } });
    await writeFile(siblings.record, JSON.stringify({ schema_version: "wringer.local-source.v1", planSha256: profile.plan_sha256, url: made.url, commit: f.commit, rootCommit: made.rootCommit, bundleSha256: made.bundleSha256, bundleBytes: made.bundleBytes }));
    const workspace = (await initializeAssistant(controller, { plan: profile, cooperativeLocal: true, localSource: siblings })).workspace;
    const importId = crypto.randomUUID(), at = (name: string) => `design-imports/${importId}/${name}`;
    await writeAssistantRecord(controller, at("request.json"), { schema_version: "wringer.assistant-design-request.v1", importId, workspaceId: workspace.id, profileSha256: hashValue(profile) });
    await writeDesignSnapshot(await assistantPath(controller, at("preview.json")), f.preview);
    await writeDesignSnapshot(await assistantPath(controller, at("retained.json")), f.snapshot);
    await writeAssistantRecord(controller, at("consent.json"), { schema_version: "wringer.assistant-design-consent.v1", importId, workspaceId: workspace.id, profileSha256: hashValue(profile), previewSha256: f.preview.snapshot_sha256, retainedSha256: f.snapshot.snapshot_sha256, actor: "Synthetic operator" });
    const binding = await attachAssistantDesign(controller, workspace, { importId, expectedSnapshotSha256: f.snapshot.snapshot_sha256, confirmAttachment: true });
    expect(binding.profile.schema_version).toBe("wringer.execution-plan.v4"); expect(binding.profile.repository.url).toBe(made.url); expect(binding.profile.repository.commit).not.toBe(f.commit);
    const clone = join(f.root, "local-fresh"); await git(f.root, "clone", "-q", "--branch", "design", binding.sourceBundle, clone);
    expect(await git(clone, "rev-parse", "HEAD^")).toBe(f.commit);
    expect(await git(clone, "diff", "--name-only", "HEAD^", "HEAD")).toBe(binding.profile.design!.snapshotPath);
});
test("attachment refuses absent consent, stale hash, changed profile and tampered private transport", async () => {
    const f = await fixture(); await expect(attachAssistantDesign(f.controller, f.workspace, f.input)).rejects.toThrow();
    await f.permission(); await expect(attachAssistantDesign(f.controller, f.workspace, { ...f.input, expectedSnapshotSha256: "f".repeat(64) })).rejects.toThrow("changed");
    await expect(attachAssistantDesign(f.controller, f.workspace, { ...f.input, confirmAttachment: false })).rejects.toThrow("Explicitly");
    const binding = await f.attach();
    await expect(readAssistantDesignBinding(f.controller, { ...f.workspace, id: crypto.randomUUID() }, f.input.importId)).rejects.toThrow();
    await writeFile(binding.sourceBundle, "changed"); await expect(readAssistantDesignBinding(f.controller, f.workspace, f.input.importId)).rejects.toThrow("changed");
});
test("assistant selects the approved overlay without replacing base profile or borrowing old approval", async () => {
    const f = await fixture(); await f.permission(); const binding = await f.attach();
    const capability = await issueAssistantCapability(f.controller, new Date(Date.now() + 60000).toISOString());
    const service = await createAssistantService(f.controller);
    try {
        const setup: any = await service.call(capability.token, "wringer.inspect_setup", { designImportId: f.input.importId });
        expect(JSON.stringify(setup)).not.toContain(binding.sourceBundle);
        const proposed: any = await service.call(capability.token, "wringer.propose", { workspaceId: f.workspace.id, idempotencyKey: crypto.randomUUID(), designImportId: f.input.importId, intent: binding.profile.intent, plan: binding.profile });
        expect(proposed.outcome).not.toBe("refused");
        const view: any = await service.call(capability.token, "wringer.get_approval_request", { jobId: proposed.jobId });
        const approved = await approveAssistantProposal(f.controller, { jobId: proposed.jobId, expectedRevision: view.revision, actor: "Synthetic operator", expiresAt: new Date(Date.now() + 60000).toISOString(), confirmExecution: true });
        expect(approved.authority.repository.commit).toBe(binding.profile.repository.commit);
        expect((await service.call(capability.token, "wringer.propose", { workspaceId: f.workspace.id, idempotencyKey: crypto.randomUUID(), intent: binding.profile.intent, plan: binding.profile }) as any).outcome).toBe("refused");
    } finally { await service.runner.stop(50); }
});
