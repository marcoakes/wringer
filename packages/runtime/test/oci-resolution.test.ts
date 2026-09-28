import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as runtime from "../src/index";
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
test("T20 provisioning resolves an actual index and one host-platform manifest without retrieving a user credential", async () => {
    const resolve = (runtime as any).resolveOfficialBase;
    expect(typeof resolve).toBe("function");
    const manifest = JSON.stringify({ schemaVersion: 2, config: { digest: "sha256:" + "a".repeat(64), size: 17 }, layers: [{ digest: "sha256:" + "b".repeat(64), size: 1234 }] });
    const index = JSON.stringify({ schemaVersion: 2, manifests: [{ digest: hash(manifest), platform: { os: "linux", architecture: "arm64" } }, { digest: "sha256:" + "c".repeat(64), platform: { os: "linux", architecture: "amd64" } }] });
    const requests: string[] = [];
    const transport = async (url: string, init?: RequestInit) => {
        requests.push(url);
        expect(new Headers(init?.headers).has("authorization")).toBeFalse();
        const body = url.endsWith("/1.4.2") ? index : manifest;
        return new Response(body, { headers: { "docker-content-digest": hash(body) } });
    };
    const result = await resolve("bun", "linux/arm64", transport);
    expect(result.reference).toBe(`docker.io/oven/bun@${hash(index)}`);
    expect(result.platformManifest).toBe(hash(manifest)); expect(result.compressedBytes).toBe(1251);
    expect(requests).toHaveLength(2); expect(requests.every(url => url.startsWith("https://registry-1.docker.io/v2/oven/bun/manifests/"))).toBeTrue();
});
test("T20 resolution refuses swapped bytes, a missing architecture, and unsafe registry authentication challenges", async () => {
    const resolve = (runtime as any).resolveOfficialBase; expect(typeof resolve).toBe("function");
    await expect(resolve("bun", "linux/arm64", async () => new Response("{}", { headers: { "docker-content-digest": "sha256:" + "f".repeat(64) } }))).rejects.toThrow("digest");
    const index = JSON.stringify({ schemaVersion: 2, manifests: [{ digest: "sha256:" + "c".repeat(64), platform: { os: "linux", architecture: "amd64" } }] });
    await expect(resolve("node", "linux/arm64", async () => new Response(index))).rejects.toThrow("platform");
    const requests: string[] = [];
    await expect(resolve("bun", "linux/arm64", async (url: string) => { requests.push(url); return new Response("", { status: 401, headers: { "www-authenticate": 'Bearer realm="https://attacker.invalid/token",service="registry.docker.io",scope="repository:oven/bun:pull"' } }); })).rejects.toThrow("challenge");
    expect(requests).toHaveLength(1);
});
test("T20 runtime recipes retain an installable transitive lock and consume it frozen", async () => {
    const root = new URL("../../../", import.meta.url), recipe = await Bun.file(new URL("runtime/Containerfile", root)).text();
    expect(recipe).toContain("COPY runtime/bun.lock ./bun.lock");
    expect(recipe).toContain("bun install --frozen-lockfile --ignore-scripts");
    const lock = await Bun.file(new URL("runtime/bun.lock", root)).text();
    expect(lock).toContain('"lockfileVersion": 2'); expect(lock).toContain('"sha512-');
});
