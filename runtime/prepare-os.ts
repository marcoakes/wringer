/** Build-only, fixed public archives. Importing this file performs no actions. */
import { createHash } from "node:crypto";
export async function fetchArchiveMetadata(url: string, transport: (url: string, options?: RequestInit) => Promise<Response> = fetch): Promise<Response> {
    const response = await transport(url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (![301, 302, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location"); await response.body?.cancel();
    const target = location ? new URL(location, url) : null;
    if (!target || target.origin !== "https://snapshot.debian.org" || !/^\/file\/[a-f0-9]{40}\/InRelease$/.test(target.pathname) || target.search || target.hash) throw new Error("OS archive redirect escaped its fixed public file store");
    return transport(target.href, { redirect: "error", signal: AbortSignal.timeout(30000) });
}
export async function prepareOsSources(lock: any, transport: (url: string, options?: RequestInit) => Promise<Response> = fetch) {
    const expected = ["debian/bookworm", "debian/bookworm-updates", "debian-security/bookworm-security"];
    if (lock?.schema_version !== "wringer.runtime-os-lock.v1" || !Array.isArray(lock.records) || lock.records.length !== 3) throw new Error("Unsupported OS archive lock");
    let sources = "";
    for (const [index, row] of lock.records.entries()) {
        const base = `https://snapshot.debian.org/archive/${row.archive}/${row.timestamp}/`;
        if (`${row.archive}/${row.suite}` !== expected[index] || !/^\d{8}T\d{6}Z$/.test(row.timestamp) || row.url !== `${base}dists/${row.suite}/InRelease` || !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 1024 ** 2) throw new Error("Invalid fixed OS archive identity");
        const response = await fetchArchiveMetadata(row.url, transport);
        if (!response.ok) throw new Error("Pinned OS archive metadata is unavailable");
        const reader = response.body?.getReader(); if (!reader) throw new Error("Missing OS archive metadata");
        const digest = createHash("sha256"); let size = 0;
        try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > row.bytes) throw new Error("OS archive digest/size mismatch"); digest.update(item.value); } } finally { await reader.cancel(); }
        if (size !== row.bytes || digest.digest("hex") !== row.sha256) throw new Error("OS archive digest/size mismatch");
        // Apt verifies Release signatures and package hashes with the base image's
        // keyring. HTTP permits bootstrapping ca-certificates; metadata was also
        // checked over HTTPS above. No trusted=yes or unauthenticated flag.
        sources += `Types: deb\nURIs: ${base.replace("https:", "http:")}\nSuites: ${row.suite}\nComponents: main\nSigned-By: /usr/share/keyrings/debian-archive-keyring.gpg\nCheck-Valid-Until: no\n\n`;
    }
    return sources;
}
if (import.meta.main) {
    const { readFile, readdir, unlink, writeFile } = await import("node:fs/promises");
    const lock = JSON.parse(await readFile("/opt/wringer-build/os-snapshot.lock.json", "utf8"));
    const sources = await prepareOsSources(lock);
    // These files belong to the disposable pinned image, never the host.
    for (const name of await readdir("/etc/apt/sources.list.d")) if (name.endsWith(".sources") || name.endsWith(".list")) await unlink(`/etc/apt/sources.list.d/${name}`);
    await writeFile("/etc/apt/sources.list", "");
    await writeFile("/etc/apt/sources.list.d/wringer.sources", sources);
}
