import { createHash } from "node:crypto";
export const OFFICIAL_BASES = {
    bun: { repository: "oven/bun", tag: "1.4.2" },
    node: { repository: "library/node", tag: "24-bookworm-slim" },
} as const;
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const validDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
type Transport = (url: string, init?: RequestInit) => Promise<Response>;
async function bounded(response: Response, maximum = 4 * 1024 * 1024) {
    if (Number(response.headers.get("content-length")) > maximum || !response.body) throw new Error("Registry response exceeds its bound or is absent");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
        for (;;) { const row = await reader.read(); if (row.done) break; size += row.value.length; if (size > maximum) { await reader.cancel(); throw new Error("Registry response exceeds its bound"); } chunks.push(row.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
}
/** Resolve public, fixed official sources. Anonymous registry bearer tokens are
 * scoped to pull, stay in memory, and never use the user's registry login. */
export async function resolveOfficialBase(kind: keyof typeof OFFICIAL_BASES, platform: "linux/arm64" | "linux/amd64", transport: Transport = fetch) {
    if (!Object.hasOwn(OFFICIAL_BASES, kind) || !["linux/arm64", "linux/amd64"].includes(platform)) throw new Error("Choose a supported official base and one platform");
    const source = OFFICIAL_BASES[kind], scope = `repository:${source.repository}:pull`, origin = `https://registry-1.docker.io/v2/${source.repository}/manifests/`;
    let bearer: string | null = null;
    async function manifest(reference: string) {
        const headers: Record<string, string> = { accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json" };
        if (bearer) headers.authorization = `Bearer ${bearer}`;
        let response = await transport(origin + reference, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
        if (response.status === 401 && !bearer) {
            const challenge = response.headers.get("www-authenticate") ?? "";
            if (challenge.length > 4096 || !challenge.startsWith("Bearer ")) throw new Error("Unsupported public registry authentication challenge");
            const pairs = [...challenge.slice(7).matchAll(/([a-z_]+)="([^"\\]*)"/g)], fields = Object.fromEntries(pairs.map(row => [row[1], row[2]]));
            if (pairs.length !== 3 || new Set(pairs.map(row => row[1])).size !== 3 || fields.realm !== "https://auth.docker.io/token" || fields.service !== "registry.docker.io" || fields.scope !== scope) throw new Error("Unsafe public registry authentication challenge");
            const tokenUrl = new URL(fields.realm); tokenUrl.searchParams.set("service", fields.service); tokenUrl.searchParams.set("scope", scope);
            const authenticated = await transport(tokenUrl.href, { redirect: "error", signal: AbortSignal.timeout(15000) });
            if (!authenticated.ok) throw new Error("Anonymous public registry access was not available");
            const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await bounded(authenticated, 65536))), token = value.token ?? value.access_token;
            if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{1,16384}$/.test(token)) throw new Error("Invalid anonymous registry token");
            bearer = token; headers.authorization = `Bearer ${bearer}`;
            response = await transport(origin + reference, { headers, redirect: "error", signal: AbortSignal.timeout(15000) });
        }
        if (!response.ok) throw new Error(`Official image metadata unavailable (HTTP ${response.status}); no image was pulled`);
        const bytes = await bounded(response), measured = digest(bytes), declared = response.headers.get("docker-content-digest");
        if (declared && measured !== declared || validDigest(reference) && measured !== reference) throw new Error("Registry manifest digest differs from the actual bytes");
        return { digest: measured, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
    }
    const index = await manifest(source.tag), architecture = platform.split("/")[1];
    if (index.value.schemaVersion !== 2 || !Array.isArray(index.value.manifests) || index.value.manifests.length > 256) throw new Error("Official base has no bounded platform index");
    const choices = index.value.manifests.filter((row: any) => row.platform?.os === "linux" && row.platform.architecture === architecture && (!row.platform.variant || row.platform.variant === "v8"));
    if (choices.length !== 1 || !validDigest(choices[0]?.digest)) throw new Error("The selected platform has no unique image manifest");
    const selected = await manifest(choices[0].digest);
    if (selected.value.schemaVersion !== 2 || !Array.isArray(selected.value.layers) || selected.value.layers.length > 256) throw new Error("Malformed selected image manifest");
    const blobs = [selected.value.config, ...selected.value.layers];
    if (blobs.some(row => !row || !validDigest(row.digest) || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > 8 * 1024 ** 3)) throw new Error("Invalid image blob inventory");
    return { source: `docker.io/${source.repository}:${source.tag}`, reference: `docker.io/${source.repository}@${index.digest}`, platform, platformManifest: selected.digest, config: selected.value.config.digest as string, compressedBytes: blobs.reduce((sum, row) => sum + row.size, 0) as number, measuredAt: new Date().toISOString(), limits: ["Resolved registry metadata, not a downloaded or executed image. Compressed size excludes unpacking, build cache and installed project dependencies."] };
}
