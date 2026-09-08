import { loadExistingCredentials } from "./credentials";

export type ReadinessVendor = "openai" | "anthropic";
const routes = {
    openai: { credential: "CODEX_API_KEY", url: "https://api.openai.com/v1/models" },
    anthropic: { credential: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com/v1/models?limit=1" },
} as const;
export interface ProviderReadinessDependencies {
    load: typeof loadExistingCredentials;
    env: Record<string, string | undefined>;
    request: (url: string, init: RequestInit) => Promise<Response>;
}
/** Explicit diagnostic only: fixed metadata GET, no redirects/retries/model
 * invocation, no response bodies/keys/errors echoed. A 200 is not credit,
 * model entitlement, ACP authentication or successful contained work. */
export async function inspectProviderReadiness(vendor: ReadinessVendor, dependencies: Partial<ProviderReadinessDependencies> = {}) {
    if (!Object.hasOwn(routes, vendor)) throw new Error("Choose openai or anthropic; arbitrary API routes are not allowed");
    const deps = { load: loadExistingCredentials, env: process.env, request: fetch, ...dependencies }, route = routes[vendor];
    const observedAt = new Date().toISOString(), loaded = await deps.load([route.credential]);
    const row = loaded.find(item => item.name === route.credential), credential = deps.env[route.credential];
    const base = { schema_version: "wringer.provider-readiness.v1", vendor, credential: route.credential, source: row?.source ?? "unavailable", observedAt, endpoint: route.url, modelInvocations: 0, billingAvailable: null, credentialsChanged: false, note: "Metadata authentication only. Model access, available credit, runtime isolation and live work remain unmeasured. No provider response body or credential value is retained." };
    if (!row?.available || !credential) return { ...base, outcome: "credential-unavailable", httpStatus: null, requests: 0 };
    try {
        const headers: Record<string, string> = vendor === "openai" ? { Authorization: `Bearer ${credential}` } : { "x-api-key": credential, "anthropic-version": "2023-06-01" };
        const response = await deps.request(route.url, { method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(10000) });
        await response.body?.cancel();
        return { ...base, httpStatus: response.status, requests: 1, outcome: response.status === 200 ? "metadata-authenticated" : response.status === 401 ? "credential-rejected" : response.status === 403 ? "metadata-access-refused" : "provider-unavailable" };
    } catch { return { ...base, outcome: "connection-unavailable", httpStatus: null, requests: 1 }; }
}
