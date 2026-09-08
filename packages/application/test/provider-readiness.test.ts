import { expect, test } from "bun:test";
import { inspectProviderReadiness } from "../src/provider-readiness";

test("provider diagnostic uses fixed metadata GET and does not expose keys or response bodies", async () => {
    for (const vendor of ["openai", "anthropic"] as const) {
        let calls = 0;
        const name = vendor === "openai" ? "CODEX_API_KEY" : "ANTHROPIC_API_KEY";
        const result = await inspectProviderReadiness(vendor, { env: { [name]: "synthetic-never-a-real-key" }, load: async names => { expect(names).toEqual([name]); return [{ name, available: true, source: "environment" }]; }, request: async (url, init) => {
            calls++; expect(url).toBe(vendor === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models?limit=1"); expect(init.method).toBe("GET"); expect(init.redirect).toBe("error"); expect(init.body).toBeUndefined();
            const headers = new Headers(init.headers); expect(headers.get(vendor === "openai" ? "authorization" : "x-api-key")).toContain("synthetic-never-a-real-key");
            return new Response("PRIVATE-RESPONSE-NOT-FOR-REPORTS", { status: 200 });
        } });
        expect(calls).toBe(1); expect(result.outcome).toBe("metadata-authenticated"); expect(result.modelInvocations).toBe(0); expect(result.billingAvailable).toBeNull(); expect(JSON.stringify(result)).not.toContain("synthetic-never"); expect(JSON.stringify(result)).not.toContain("PRIVATE-RESPONSE");
    }
});
test("missing, rejected, restricted and unreachable credentials are distinct without retries", async () => {
    const load = async () => [{ name: "CODEX_API_KEY", available: true, source: "keychain" as const }];
    let calls = 0;
    expect((await inspectProviderReadiness("openai", { load, env: {}, request: async () => { calls++; throw new Error("Must not run"); } })).outcome).toBe("credential-unavailable"); expect(calls).toBe(0);
    for (const [status, outcome] of [[401, "credential-rejected"], [403, "metadata-access-refused"], [429, "provider-unavailable"], [500, "provider-unavailable"]] as const) {
        calls = 0;
        const result = await inspectProviderReadiness("openai", { load, env: { CODEX_API_KEY: "fixture" }, request: async () => { calls++; return new Response("ignored", { status }); } });
        expect(result.outcome).toBe(outcome); expect(calls).toBe(1);
    }
    const result = await inspectProviderReadiness("openai", { load, env: { CODEX_API_KEY: "fixture" }, request: async () => { throw new Error("secret provider error"); } });
    expect(result.outcome).toBe("connection-unavailable"); expect(JSON.stringify(result)).not.toContain("secret provider error");
    await expect(inspectProviderReadiness("https://attacker.invalid" as any)).rejects.toThrow("arbitrary API routes");
});
