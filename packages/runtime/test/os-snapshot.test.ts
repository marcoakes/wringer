import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
test("T20 OS metadata is digest bound and apt sources preserve signature checking", async () => {
    const { prepareOsSources } = await import("../../../runtime/prepare-os");
    const bytes = new TextEncoder().encode("signed archive metadata"), sha256 = createHash("sha256").update(bytes).digest("hex");
    const records = [["debian", "bookworm"], ["debian", "bookworm-updates"], ["debian-security", "bookworm-security"]].map(([archive, suite]) => ({ archive, suite, timestamp: "20260901T020000Z", url: `https://snapshot.debian.org/archive/${archive}/20260901T020000Z/dists/${suite}/InRelease`, sha256, bytes: bytes.length }));
    const lock = { schema_version: "wringer.runtime-os-lock.v1", records };
    const value = await prepareOsSources(lock, async () => new Response(bytes));
    expect(value).toContain("Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg"); expect(value).toContain("Check-Valid-Until: no"); expect(value).not.toContain("Trusted:");
    await expect(prepareOsSources(lock, async () => new Response(new Uint8Array(bytes.length).fill(46)))).rejects.toThrow("digest");
    await expect(prepareOsSources({ ...lock, records: [{ ...records[0], url: "https://private.invalid/a" }, ...records.slice(1)] }, async () => new Response(bytes))).rejects.toThrow("archive");
    await expect(prepareOsSources(lock, async (url) => url.includes("private.invalid") ? new Response(bytes) : new Response(null, { status: 302, headers: { location: `https://private.invalid/file/${"a".repeat(40)}/InRelease` } }))).rejects.toThrow("redirect");
});
