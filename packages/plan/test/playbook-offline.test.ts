import { expect, test } from "bun:test";
import { hashBytes, hashValue, parsePlaybookManifest, validatePlaybookManifest, validatePlaybookSnapshot } from "../src";

test("offline playbook preparation can validate exact bytes without reading credential environment values", () => {
    const manifest = { schema_version: "wringer.playbook.v1", id: "offline", revision: "1", title: "Fixture only", role: "worker", applicability: { taskFamily: "reports", context: [], tools: [], checks: [], scope: ["src"], design: false }, guidanceMarkdown: "Inert fixture advice.", limits: ["Not evaluated."], evaluationRefs: [] };
    const content = JSON.stringify(manifest), normalized = validatePlaybookManifest(manifest, { credentialEnvironment: {} });
    const body = { schema_version: "wringer.playbook-snapshot.v1" as const, source: { repository: { url: "https://example.invalid/reports.git", commit: "a".repeat(40) }, path: "wringer/playbooks/reports.json", blob: "b".repeat(40) }, content, manifest: normalized, sha256: hashBytes(content) }, snapshot = { ...body, snapshot_sha256: hashValue(body) };
    expect(parsePlaybookManifest(content, { credentialEnvironment: {} })).toEqual(normalized);
    expect(validatePlaybookSnapshot(snapshot, { credentialEnvironment: {} })).toEqual(snapshot);
    expect(() => validatePlaybookSnapshot(snapshot, { credentialEnvironment: { CODEX_API_KEY: manifest.guidanceMarkdown } })).toThrow("credential");
    expect(() => validatePlaybookSnapshot({ ...snapshot, sha256: "f".repeat(64) }, { credentialEnvironment: {} })).toThrow("source bytes");
});
