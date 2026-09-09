import { hashValue, type ExecutionPlan } from "@wringer/plan";
import { Redactor } from "@wringer/engine";
import { FigmaConnectionService } from "@wringer/figma-connect";
import { importDesignFromFigmaRest, parseFigmaFrameUrls, readDesignSnapshot, sealDesignSnapshot, writeDesignSnapshot, type DesignSnapshot } from "@wringer/design";
import { assistantId, assistantPath, assistantExists, assistantInventory, readAssistantRecord, writeAssistantRecord } from "./assistant-store";
import { readAssistantDesignBinding } from "./assistant-design-binding";

export interface AssistantDesignWorkspace { id: string; profile: ExecutionPlan }
export interface AssistantDesignDependencies {
    connection: Pick<FigmaConnectionService, "status" | "begin" | "poll" | "withAccessToken" | "disconnect" | "requireReconnect">;
    importSnapshot: typeof importDesignFromFigmaRest;
}
interface ImportRequest { schema_version: "wringer.assistant-design-request.v1"; importId: string; requestId: string; workspaceId: string; profileSha256: string; urls: string[] }
const redactor = new Redactor(["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*"]);
const file = (id: string, name: string) => `design-imports/${assistantId(id)}/${name}`;
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const stopReasons: Record<string, string> = {
    "design-auth-expired": "Figma refused the API credential. Reconnect before a new preview request.",
    "design-access-refused": "Figma refused access. Check access to the selected file or reconnect; this response does not distinguish file permission from expired access.",
    "design-render-access-refused": "The temporary image download was refused. This does not establish that Figma sign-in expired.",
    "design-render-host-refused": "Figma returned an image host outside the supported public HTTPS profile. No fallback was attempted.",
    "design-rate-limited": "Figma rate-limited the selected read. Wait before making a new explicit preview request.",
    "design-response-limit": "The selected design response exceeded the bounded import size.",
    "design-timeout": "The selected design import exceeded its time limit.",
    "design-content-refused": "Figma did not return the required supported design or image content.",
    "design-secret-detected": "Detected credentials in design content prevented retention.",
    "design-source-mismatch": "The selected design source or pinned version did not match.",
    "design-endpoint-refused": "The endpoint did not meet the public HTTPS import policy.",
    "design-redirect-refused": "An unexpected redirect was refused; credentials were not forwarded.",
    "design-connection-failed": "The selected Figma request could not be completed.",
    "design-service-refused": "Figma did not return a successful supported response.",
};
function fields(input: unknown, allowed: string[]): Record<string, any> {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw new Error("Use only the design fields shown for this action. Credentials, paths and approval cannot be supplied by an assistant.");
    return input as Record<string, any>;
}

/** A bounded design intake, not a model loop. The assistant can prepare/read a
 * request. Only the separate operator surface may connect, fetch or disclose.
 * The cooperative-local boundary does not prove physical human presence. */
export function createAssistantDesignService(root: string, workspace: AssistantDesignWorkspace, options: Partial<AssistantDesignDependencies> = {}) {
    const connection = options.connection ?? new FigmaConnectionService();
    const importer = options.importSnapshot ?? importDesignFromFigmaRest;
    const pending = new Map<string, Promise<unknown>>();
    const scope = hashValue(workspace.profile);
    async function request(importId: string): Promise<ImportRequest> {
        const value = await readAssistantRecord<ImportRequest>(root, file(importId, "request.json"));
        if (value.schema_version !== "wringer.assistant-design-request.v1" || value.importId !== importId || value.workspaceId !== workspace.id || value.profileSha256 !== scope) throw new Error("This design import does not belong to the selected source/profile. Nothing was attached.");
        parseFigmaFrameUrls(value.urls);
        return value;
    }
    async function readSnapshot(importId: string, name = "preview.json") {
        await request(importId);
        return readDesignSnapshot(await assistantPath(root, file(importId, name)));
    }
    async function get(importId: string) {
        const saved = await request(importId);
        let outcome = "needs-preview", nextAction = "Open the private PM workspace, connect Figma and preview the selected frames. No design bytes have been imported.";
        let snapshot: DesignSnapshot | undefined;
        if (await assistantExists(root, file(importId, "preview.json"))) {
            snapshot = await readSnapshot(importId);
            outcome = "needs-retention-permission"; nextAction = "Review the exact desktop/mobile previews and confirm permission to retain those bytes in the private repository and handover. This does not approve work or design acceptance.";
        } else if (await assistantExists(root, file(importId, "attempt.json"))) {
            outcome = pending.has(importId) ? "importing" : "stopped";
            nextAction = pending.has(importId) ? "The bounded Figma API import is running. No build has started." : "This import stopped or its result is uncertain. Inspect the recorded stop. A new explicit preview request is required; no network import is silently repeated.";
        }
        let stopCode: string | null = null;
        if (await assistantExists(root, file(importId, "stop.json"))) {
            const stop = await readAssistantRecord(root, file(importId, "stop.json"));
            stopCode = stop.code ?? "design-import-stopped";
            outcome = "stopped"; nextAction = stop.message;
        }
        let retainedSha256: string | null = null;
        if (await assistantExists(root, file(importId, "consent.json"))) {
            const consent = await readAssistantRecord(root, file(importId, "consent.json"));
            const retained = await readSnapshot(importId, "retained.json");
            if (!snapshot || consent.workspaceId !== workspace.id || consent.profileSha256 !== scope || consent.previewSha256 !== snapshot.snapshot_sha256 || consent.retainedSha256 !== retained.snapshot_sha256 || retained.disclosure !== "repository-permitted") throw new Error("Design retention no longer matches the exact preview and workspace. Attachment refused.");
            retainedSha256 = retained.snapshot_sha256;
            outcome = "retained"; nextAction = "Permission to retain this exact reference is recorded. Attach it to a new source-bound profile before proposing work; no existing plan or approval has changed.";
        }
        let attachment: { profileSha256: string; sourceCommit: string } | null = null;
        if (await assistantExists(root, file(importId, "binding.json"))) {
            const binding = await readAssistantDesignBinding(root, workspace, importId);
            attachment = { profileSha256: binding.profile.plan_sha256, sourceCommit: binding.profile.repository.commit };
            outcome = "attached"; nextAction = "This exact reference is attached to a new immutable source profile. Ask the assistant to inspect setup and propose using this designImportId. Plan approval, design judgement and sending remain separate human decisions.";
        }
        return { importId, workspaceId: saved.workspaceId, outcome, nextAction, stopCode, attachment, route: "Figma REST API through Wringer; not Figma's official remote MCP server", previewSha256: snapshot?.snapshot_sha256 ?? null, retainedSha256, assets: snapshot?.assets.map(({ id, title, width, height, sha256 }) => ({ id, title, width, height, sha256 })) ?? [] };
    }
    async function prepare(raw: unknown) {
        const input = fields(raw, ["workspaceId", "idempotencyKey", "urls"]);
        if (input.workspaceId !== workspace.id) throw new Error("Use the selected workspace handle.");
        const requestId = assistantId(input.idempotencyKey);
        const parsed = parseFigmaFrameUrls(input.urls);
        if (redactor.scrub(JSON.stringify(input.urls)) !== JSON.stringify(input.urls)) throw new Error("Credentials cannot enter a design request.");
        const hash = hashValue({ workspaceId: workspace.id, requestId });
        const importId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
        const value: ImportRequest = { schema_version: "wringer.assistant-design-request.v1", importId, requestId, workspaceId: workspace.id, profileSha256: scope, urls: parsed.canonicalUrls };
        await writeAssistantRecord(root, file(importId, "request.json"), value);
        return get(importId);
    }
    async function inspect() {
        const names = await assistantInventory(root, "design-imports");
        if (names.length > 100) throw new Error("Too many design imports for a compact view; use a returned import handle.");
        return { workspaceId: workspace.id, connection: await connection.status(), expectedDisplays: workspace.profile.design?.reviews.flatMap(review => review.captures.map(capture => ({ width: capture.width, height: capture.height }))) ?? [], attachmentReady: !!workspace.profile.design?.reviews.length, imports: await Promise.all(names.map(get)), nextAction: "Paste one desktop and optionally one mobile Figma frame/layer link from the same file. Connect and retention permission belong to the private PM workspace." };
    }
    async function preview(raw: unknown) {
        const input = fields(raw, ["importId", "confirmPrivatePreview"]), importId = assistantId(input.importId);
        if (input.confirmPrivatePreview !== true) throw new Error("Explicitly request a private preview of the selected frames before retrieval. This is not repository disclosure permission.");
        const saved = await request(importId);
        if (pending.has(importId)) { await pending.get(importId); return get(importId); }
        if (await assistantExists(root, file(importId, "attempt.json"))) return get(importId);
        const operation = (async () => {
            // Install the claim before network I/O. Process loss leaves a visible
            // uncertain stop; reopening never restarts a request automatically.
            await writeAssistantRecord(root, file(importId, "attempt.json"), { schema_version: "wringer.assistant-design-attempt.v1", importId, workspaceId: workspace.id, profileSha256: scope, attemptId: crypto.randomUUID(), startedAt: new Date().toISOString() });
            try {
                const snapshot = await connection.withAccessToken(token => importer({ urls: saved.urls, token, tokenType: "oauth", disclosure: "private" }));
                if (snapshot.disclosure !== "private") throw new Error("Preview was not private.");
                await writeDesignSnapshot(await assistantPath(root, file(importId, "preview.json")), snapshot);
            } catch (error) {
                // Provider errors can contain private URLs or credentials. Only
                // fixed safe status text crosses this boundary.
                if (error && typeof error === "object" && "code" in error && error.code === "design-auth-expired") await connection.requireReconnect().catch(() => undefined);
                const state = await connection.status().catch(() => null);
                const measuredCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" && Object.hasOwn(stopReasons, error.code) ? error.code : "design-import-stopped";
                const reason = stopReasons[measuredCode] ?? (state?.state === "reconnect-required" ? "Figma access needs reconnecting." : "The Figma API preview could not be completed or safely validated.");
                await writeAssistantRecord(root, file(importId, "stop.json"), { schema_version: "wringer.assistant-design-stop.v1", importId, code: measuredCode, message: `${reason} Check connection and selected frame access before a new explicit preview request. No design was attached and no result is claimed.` });
            }
        })();
        pending.set(importId, operation);
        try { await operation; } finally { pending.delete(importId); }
        return get(importId);
    }
    async function confirm(raw: unknown) {
        const input = fields(raw, ["importId", "expectedPreviewSha256", "actor", "confirmRetention"]), importId = assistantId(input.importId);
        if (input.confirmRetention !== true || !digest(input.expectedPreviewSha256) || typeof input.actor !== "string" || !input.actor.trim() || Buffer.byteLength(input.actor) > 200 || redactor.scrub(input.actor) !== input.actor) throw new Error("Review these exact previews, enter your name and confirm permission to retain their bytes in the private repository and its handover.");
        const snapshot = await readSnapshot(importId);
        if (snapshot.snapshot_sha256 !== input.expectedPreviewSha256) throw new Error("The design preview changed. Review the exact displayed snapshot before permitting retention.");
        const retained = sealDesignSnapshot({ ...snapshot, disclosure: "repository-permitted" });
        if (await assistantExists(root, file(importId, "retained.json"))) {
            if ((await readSnapshot(importId, "retained.json")).snapshot_sha256 !== retained.snapshot_sha256) throw new Error("A different retained design already exists. Nothing was overwritten.");
        } else await writeDesignSnapshot(await assistantPath(root, file(importId, "retained.json")), retained);
        await writeAssistantRecord(root, file(importId, "consent.json"), { schema_version: "wringer.assistant-design-consent.v1", importId, workspaceId: workspace.id, profileSha256: scope, previewSha256: snapshot.snapshot_sha256, retainedSha256: retained.snapshot_sha256, actor: input.actor, declaration: "I have permission to retain these exact design bytes in the private test repository and its handover.", boundary: "cooperative-local; recorded name, not verified identity" });
        return get(importId);
    }
    async function operatorView(importId: string) { const saved = await request(importId); return { ...await get(importId), urls: saved.urls }; }
    async function asset(importId: string, assetId: string, expectedPreviewSha256: string) {
        if (!digest(expectedPreviewSha256) || typeof assetId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(assetId)) throw new Error("Use an image from this exact preview.");
        const snapshot = await readSnapshot(importId);
        if (snapshot.snapshot_sha256 !== expectedPreviewSha256) throw new Error("The preview changed. Refresh before deciding.");
        const found = snapshot.assets.find(row => row.id === assetId); if (!found) throw new Error("This image does not belong to the selected preview.");
        return Buffer.from(found.base64, "base64");
    }
    async function confirmedSnapshot(importId: string) {
        const view = await get(importId);
        if (!["retained", "attached"].includes(view.outcome)) throw new Error("Permission to retain this exact snapshot has not been recorded.");
        return { path: await assistantPath(root, file(importId, "retained.json")), snapshot: await readSnapshot(importId, "retained.json") };
    }
    return { inspect, prepare, get, operatorView, preview, confirm, asset, confirmedSnapshot, connect: () => connection.begin(), pollConnection: () => connection.poll(), disconnect: () => connection.disconnect() };
}
