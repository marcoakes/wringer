import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { compileDeclaration, hashValue, planVersion, validateExecutionPlan, type ExecutionPlan } from "@wringer/plan";
import { prepareRepositoryArtifactSource } from "@wringer/runtime";
import { assertRepositoryDisclosure, designCanonicalJson, hashDesignBytes, readDesignSnapshot, type DesignSnapshot } from "@wringer/design";
import { assistantId, assistantPath, assistantExists, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { isLocalSource, readAssistantLocalSource } from "./assistant-local-source";

interface Workspace { id: string; profile: ExecutionPlan }
interface DesignBinding {
    schema_version: "wringer.assistant-design-binding.v1";
    importId: string;
    workspaceId: string;
    originalProfileSha256: string;
    consentSha256: string;
    snapshotSha256: string;
    sourceCommit: string;
    sourceBundleRelative: string;
    sourceBundleSha256: string;
    profile: ExecutionPlan;
}
const entry = (id: string, name: string) => `design-imports/${assistantId(id)}/${name}`;
async function consented(root: string, workspace: Workspace, importId: string) {
    const request = await readAssistantRecord(root, entry(importId, "request.json"));
    const consent = await readAssistantRecord(root, entry(importId, "consent.json"));
    const preview = await readDesignSnapshot(await assistantPath(root, entry(importId, "preview.json")));
    const snapshot = await readDesignSnapshot(await assistantPath(root, entry(importId, "retained.json")));
    assertRepositoryDisclosure(snapshot);
    if (request.importId !== importId || request.workspaceId !== workspace.id || request.profileSha256 !== hashValue(workspace.profile) || consent.importId !== importId || consent.workspaceId !== workspace.id || consent.profileSha256 !== request.profileSha256 || consent.previewSha256 !== preview.snapshot_sha256 || consent.retainedSha256 !== snapshot.snapshot_sha256 || !consent.actor)
        throw new Error("Design attachment requires the exact recorded preview, retention permission and original workspace profile.");
    const { snapshot_sha256: _p, disclosure: _pd, ...p } = preview;
    const { snapshot_sha256: _s, disclosure: _sd, ...s } = snapshot;
    if (hashValue(p) !== hashValue(s)) throw new Error("Retained design differs from the preview; permission cannot be transferred to new bytes.");
    return { snapshot, consent };
}
function deriveProfile(original: ExecutionPlan, snapshot: DesignSnapshot, commit: string): ExecutionPlan {
    if (!original.design?.reviews.length) throw new Error("This workspace needs a design-ready profile with a contained preview command and desktop/mobile capture sizes. No renderer was invented and no plan changed. Set up a design-ready workspace before attaching a live reference.");
    const reviews = original.design.reviews.map(review => {
        if (review.captures.length !== snapshot.assets.length) throw new Error("Selected frame count does not match the configured visual review. Select the desktop/mobile frames this workspace expects.");
        const ids = review.captures.map(capture => {
            const matches = snapshot.assets.filter(asset => asset.width === capture.width && asset.height === capture.height);
            if (matches.length !== 1) throw new Error(`Reference sizes do not uniquely match the configured ${capture.width} × ${capture.height} review. No review dimensions were silently changed.`);
            return matches[0]!.id;
        });
        if (new Set(ids).size !== snapshot.assets.length) throw new Error("Each configured display needs its own matching reference.");
        return { ...review, referenceIds: ids };
    });
    const { schema_version, plan_sha256: _p, acceptance_sha256: _a, intent_sha256: _i, ...declaration } = original;
    return compileDeclaration({ ...declaration, version: Math.max(2, planVersion(original)), repository: { ...original.repository, commit }, design: { snapshotPath: `.wringer-design/${snapshot.snapshot_sha256}.json`, snapshotSha256: snapshot.snapshot_sha256, reviews } });
}
async function bundleDigest(path: string) {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error("Design source transport is not a bounded regular Git bundle.");
        const bytes = Buffer.alloc(info.size + 1); let offset = 0;
        while (offset < bytes.length) { const next = await handle.read(bytes, offset, bytes.length - offset, null); if (!next.bytesRead) break; offset += next.bytesRead; }
        if (offset !== info.size) throw new Error("Design source transport changed during validation.");
        return hashDesignBytes(bytes.subarray(0, offset));
    } finally { await handle.close(); }
}
/** An immutable, future-proposal-only overlay. Earlier profiles, approvals and
 * jobs remain unchanged; no source is published by attachment. */
const attachments = new Map<string, Promise<Awaited<ReturnType<typeof readAssistantDesignBinding>>>>();
export async function attachAssistantDesign(...args: Parameters<typeof performAttachment>) {
    const key = hashValue({ root: args[0], workspace: args[1], input: args[2], snapshot: args[3]?.snapshot.snapshot_sha256 ?? null });
    let pending = attachments.get(key);
    if (!pending) { pending = performAttachment(...args).finally(() => { attachments.delete(key); }); attachments.set(key, pending); }
    return structuredClone(await pending);
}
async function performAttachment(root: string, workspace: Workspace, input: { importId: string; expectedSnapshotSha256: string; confirmAttachment: boolean }, confirmed?: { path: string; snapshot: DesignSnapshot }, options: { /** Construction-time fixture only; never an HTTP/MCP argument. */ prepareSource?: typeof prepareRepositoryArtifactSource } = {}) {
    const importId = assistantId(input.importId);
    if (input.confirmAttachment !== true) throw new Error("Explicitly attach the permitted reference before proposing work.");
    const { snapshot, consent } = await consented(root, workspace, importId);
    if (input.expectedSnapshotSha256 !== snapshot.snapshot_sha256 || confirmed && confirmed.snapshot.snapshot_sha256 !== snapshot.snapshot_sha256) throw new Error("The reference changed. Review the exact retained snapshot before attachment.");
    deriveProfile(workspace.profile, snapshot, workspace.profile.repository.commit); // refuse before source I/O
    if (await assistantExists(root, entry(importId, "binding.json"))) return readAssistantDesignBinding(root, workspace, importId);
    const contents = designCanonicalJson(snapshot) + "\n";
    // A local-only workspace builds its design commit on the bundle kept at init.
    const base = isLocalSource(workspace.profile) ? { ...workspace.profile.repository, bundlePath: (await readAssistantLocalSource(root, workspace.profile)).bundlePath } : workspace.profile.repository;
    const source = await (options.prepareSource ?? prepareRepositoryArtifactSource)(base, { path:`.wringer-design/${snapshot.snapshot_sha256}.json`, contents, sha256: hashDesignBytes(contents) }, { controllerDir: await assistantPath(root, entry(importId, "attachment")) });
    const sourceBundleRelative = source.bundlePath!.slice(root.length + 1);
    if (await assistantPath(root, sourceBundleRelative) !== source.bundlePath) throw new Error("Source attachment escaped private controller storage.");
    const value: DesignBinding = { schema_version: "wringer.assistant-design-binding.v1", importId, workspaceId: workspace.id, originalProfileSha256: hashValue(workspace.profile), consentSha256: hashValue(consent), snapshotSha256: snapshot.snapshot_sha256, sourceCommit: source.commit, sourceBundleRelative, sourceBundleSha256: await bundleDigest(source.bundlePath!), profile: deriveProfile(workspace.profile, snapshot, source.commit) };
    await writeAssistantRecord(root, entry(importId, "binding.json"), value);
    return readAssistantDesignBinding(root, workspace, importId);
}
export async function readAssistantDesignBinding(root: string, workspace: Workspace, importId: string) {
    const value = await readAssistantRecord<DesignBinding>(root, entry(importId, "binding.json"));
    const { snapshot, consent } = await consented(root, workspace, importId);
    if (value.schema_version !== "wringer.assistant-design-binding.v1" || value.importId !== importId || value.workspaceId !== workspace.id || value.originalProfileSha256 !== hashValue(workspace.profile) || value.consentSha256 !== hashValue(consent) || value.snapshotSha256 !== snapshot.snapshot_sha256 || !/^[a-f0-9]{40,64}$/.test(value.sourceCommit) || !value.sourceBundleRelative.startsWith(entry(importId, "attachment/sources/"))) throw new Error("Design binding no longer matches its exact permission, source and workspace.");
    validateExecutionPlan(value.profile);
    if (hashValue(value.profile) !== hashValue(deriveProfile(workspace.profile, snapshot, value.sourceCommit))) throw new Error("Attached profile changed beyond the approved design reference.");
    const sourceBundle = await assistantPath(root, value.sourceBundleRelative);
    if (await bundleDigest(sourceBundle) !== value.sourceBundleSha256) throw new Error("Attached source bundle changed; no work can start from different bytes.");
    return { importId, profile: value.profile, sourceBundle };
}
