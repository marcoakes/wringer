import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { DesignError, type DesignFigmaRestInput, type DesignFigmaRestOptions, type DesignFigmaRestRequest, type DesignFigmaRestResponse, type DesignSnapshotV2 } from "./types";
import { assertNoDesignSecrets, designCanonicalJson, designPngAsset, figmaRestReceiptArguments, hashDesignBytes, MAX_CONTEXT_BYTES, MAX_IMAGE_BYTES, parseDesignJson, sealDesignSnapshot } from "./snapshot";
import { isPublicDesignAddress } from "./mcp";

const API = "https://api.figma.com";
const mapping = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const hashJson = (value: unknown) => hashDesignBytes(designCanonicalJson(value));
const nodePattern = /^(?:0|[1-9]\d{0,19}):(?:0|[1-9]\d{0,19})$/;
const versionPattern = /^[A-Za-z0-9._-]{1,200}$/;
const secretPattern = /\bfig[dp]_[A-Za-z0-9_-]{8,}/i;

/** Only the selected node ids cross the API boundary, never a whole-file download. */
export function parseFigmaFrameUrls(urls: string[]): { fileKey: string; nodeIds: string[]; canonicalUrls: string[] } {
    if (!Array.isArray(urls) || !urls.length || urls.length > 2) throw new DesignError("Paste one or two authorised Figma frame/layer links from the same file.", "design-frame-link-required");
    let fileKey: string | undefined;
    const nodes = new Set<string>();
    for (const raw of urls) {
        if (typeof raw !== "string" || raw.length > 4096 || raw.trim() !== raw || /[\u0000-\u0020\\]/.test(raw)) throw new DesignError("Figma frame links must be bounded, explicit HTTPS URLs.", "design-frame-link-required");
        let url: URL; try { url = new URL(raw); } catch { throw new DesignError("Paste a Figma frame/layer link, not a file name.", "design-frame-link-required"); }
        const match = /^\/(?:design|file)\/([A-Za-z0-9]{1,128})(?:\/[^/]*)?\/?$/.exec(url.pathname);
        if (url.protocol !== "https:" || !["www.figma.com","figma.com"].includes(url.hostname) || url.username || url.password || url.port && url.port !== "443" || url.hash || !match || url.searchParams.getAll("node-id").length !== 1 || url.searchParams.has("version-id")) throw new DesignError("Use an HTTPS Figma design/file link with one node-id; whole files, prototypes, branches via query, credentials and ambiguous version links are not imported.", "design-frame-link-required");
        for (const key of url.searchParams.keys()) if (!["node-id","t","m","p","mode","type","scaling","page-id","starting-point-node-id","show-proto-sidebar","content-scaling","embed-host"].includes(key)) throw new DesignError("Figma link contains an unknown query setting; use the frame's standard Copy link action.", "design-frame-link-required");
        const id = url.searchParams.get("node-id")!.replace(/^(\d+)-(\d+)$/, "$1:$2");
        if (!nodePattern.test(id) || nodes.has(id)) throw new DesignError("Select one or two distinct Figma frame/layer ids.", "design-frame-link-required");
        if (fileKey && match[1] !== fileKey) throw new DesignError("Desktop and mobile reference links must belong to the same Figma file.", "design-source-mismatch");
        fileKey = match[1]!; nodes.add(id);
    }
    const nodeIds = [...nodes].sort();
    return { fileKey: fileKey!, nodeIds, canonicalUrls: nodeIds.map(id => `https://www.figma.com/design/${fileKey}?node-id=${id.replace(":", "-")}`) };
}

/** Narrow compatibility profile, not a claim that Figma guarantees these hosts forever. */
export function validateFigmaRenderUrl(raw: string): URL {
    if (typeof raw !== "string" || raw.length > 8192 || /[\u0000-\u0020\\]/.test(raw)) throw new DesignError("Figma render URL is malformed or oversized.", "design-render-host-refused");
    let url: URL; try { url = new URL(raw); } catch { throw new DesignError("Figma did not return a supported PNG download URL.", "design-render-host-refused"); }
    if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443" || isIP(url.hostname) || !["figma-alpha-api.s3.us-west-2.amazonaws.com","s3-alpha.figma.com"].includes(url.hostname) || !/^\/images\/[A-Za-z0-9][A-Za-z0-9._/-]{0,2047}$/.test(url.pathname) || url.pathname.includes("..")) throw new DesignError("Figma returned a render host or path outside this connector's supported public HTTPS profile. No download or fallback was attempted.", "design-render-host-refused");
    return url;
}

/** The caller fixes API requests; the only other routes are exact returned render URLs. */
async function pinnedGet(input: DesignFigmaRestRequest): Promise<DesignFigmaRestResponse> {
    const url = new URL(input.url);
    if (url.origin !== API) validateFigmaRenderUrl(input.url);
    else if (!/^\/v1\/(?:files\/[A-Za-z0-9]{1,128}\/nodes|images\/[A-Za-z0-9]{1,128})$/.test(url.pathname) || url.username || url.password || url.hash) throw new DesignError("Figma API route was not an approved read.", "design-endpoint-refused");
    const addresses = await lookup(url.hostname, { all: true, family: 4 });
    if (!addresses.length || addresses.some(address => !isPublicDesignAddress(address.address))) throw new DesignError("Figma endpoint resolved to a non-public address; no connection was made.", "design-endpoint-refused");
    if (input.signal.aborted) throw new DesignError("Figma import deadline expired.", "design-timeout");
    const address = addresses[0]!.address;
    return await new Promise((resolve, reject) => {
        const req = httpsRequest(url, { method: "GET", headers: input.headers, signal: input.signal, maxHeaderSize: 8192, lookup: (_hostname, options: any, callback: any) => { if (options.all) callback(null, [{ address, family: 4 }]); else callback(null, address, 4); } }, res => {
            const chunks: Buffer[] = []; let length = 0;
            const headers = Object.fromEntries(Object.entries(res.headers).flatMap(([key, value]) => typeof value === "string" ? [[key.toLowerCase(), value]] : []));
            res.on("error", reject);
            if (headers["content-length"] && (!/^\d+$/.test(headers["content-length"]) || Number(headers["content-length"]) > input.maxBytes)) { const error = new DesignError("Figma response exceeded its byte ceiling.", "design-response-limit"); res.destroy(error); req.destroy(error); return; }
            res.on("data", (bytes: Buffer) => { length += bytes.length; if (length > input.maxBytes) { const error = new DesignError("Figma response exceeded its byte ceiling.", "design-response-limit"); res.destroy(error); req.destroy(error); } else chunks.push(bytes); });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) }));
        });
        req.on("error", error => reject(error instanceof DesignError ? error : new DesignError(input.signal.aborted ? "Figma import deadline expired." : "Figma request failed; no response or credentials were retained.", input.signal.aborted ? "design-timeout" : "design-connection-failed")));
        req.end();
    });
}

function stripTemporaryLinks(value: unknown): unknown {
    if (typeof value === "string") return value.replace(/https?:\/\/[^\s"<>]+/g, raw => { try { const url = new URL(raw); if (url.username || url.password) throw new DesignError("Selected design data contains a credential-bearing link.", "design-secret-detected"); return url.search || url.hash ? `${url.origin}${url.pathname} [temporary URL parameters omitted]` : raw; } catch (error) { if (error instanceof DesignError) throw error; return "[unparseable URL omitted]"; } });
    if (Array.isArray(value)) return value.map(stripTemporaryLinks);
    if (mapping(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stripTemporaryLinks(item)]));
    return value;
}

/** Two bounded API reads and one PNG fetch per selected node; no agent or design-account writes. */
export async function importDesignFromFigmaRest(input: DesignFigmaRestInput, options: DesignFigmaRestOptions = {}): Promise<DesignSnapshotV2> {
    if (!mapping(input) || Object.keys(input).some(key => !["urls","token","tokenType","disclosure","title","componentRules","limits"].includes(key)) || !["private","repository-permitted"].includes(input.disclosure) || input.tokenType !== undefined && !["oauth","pat"].includes(input.tokenType)) throw new DesignError("A Figma import needs an explicit disclosure and supported read credential; unknown settings are refused.");
    if (typeof input.token !== "string" || !input.token.trim() || input.token.length > 16384 || /[\r\n\0]/.test(input.token)) throw new DesignError("Connect Figma with a supported read credential; no token may be passed in a design link.", "design-access-required");
    const { token, ...publicInput } = input; assertNoDesignSecrets(publicInput, [token]);
    if (secretPattern.test(designCanonicalJson(publicInput))) throw new DesignError("Design input contains a detected Figma credential.", "design-secret-detected");
    const { fileKey, nodeIds } = parseFigmaFrameUrls(input.urls);
    if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim() || Buffer.byteLength(input.title) > 500) || input.componentRules !== undefined && (!Array.isArray(input.componentRules) || input.componentRules.length > 100 || input.componentRules.some(rule => typeof rule !== "string" || !rule.trim() || Buffer.byteLength(rule) > 8192))) throw new DesignError("Design title and component rules must be bounded text.");
    if (input.limits !== undefined && (!mapping(input.limits) || Object.keys(input.limits).some(key => !["timeoutMs","maxResponseBytes"].includes(key)))) throw new DesignError("Unknown Figma import resource limit.");
    const timeoutMs = input.limits?.timeoutMs ?? 30000, maxBytes = input.limits?.maxResponseBytes ?? 4 * 1024 * 1024;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 8 * 1024 * 1024) throw new DesignError("Figma import limits must be bounded integers.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs), signal = controller.signal, transport = options.testTransport ?? pinnedGet;
    const measurements: { request: string; response: string }[] = [];
    let aggregateBytes = 0;
    async function get(url: string, png = false): Promise<DesignFigmaRestResponse> {
        if (png) validateFigmaRenderUrl(url);
        if (signal.aborted) throw new DesignError("Figma import deadline expired.", "design-timeout");
        // Auth is fixed to the API origin and is never forwarded to a render CDN.
        const headers: Record<string, string> = { Accept: png ? "image/png" : "application/json", "Accept-Encoding": "identity", ...(!png ? input.tokenType === "pat" ? { "X-Figma-Token": token } : { Authorization: `Bearer ${token}` } : {}) };
        let response: DesignFigmaRestResponse, listener: (() => void) | undefined;
        try {
            response = await Promise.race([transport({ url, method: "GET", headers, maxBytes: png ? Math.min(maxBytes, MAX_IMAGE_BYTES) : maxBytes, signal }), new Promise<never>((_resolve, reject) => { listener = () => reject(new DesignError("Figma import deadline expired; no partial snapshot was retained.", "design-timeout")); signal.addEventListener("abort", listener, { once: true }); })]);
        } catch (error) { if (error instanceof DesignError) throw error; throw new DesignError("Figma request failed; private response details and credentials were not retained.", "design-connection-failed"); }
        finally { if (listener) signal.removeEventListener("abort", listener); }
        if (!(response.body instanceof Uint8Array) || response.body.byteLength > (png ? Math.min(maxBytes, MAX_IMAGE_BYTES) : maxBytes) || (aggregateBytes += response.body.byteLength) > 16 * 1024 * 1024) throw new DesignError("Figma response or whole-import byte ceiling exceeded.", "design-response-limit");
        if (response.status >= 300 && response.status < 400) throw new DesignError("Figma redirects are refused; no token or download was forwarded.", "design-redirect-refused");
        if (png && [401,403].includes(response.status)) throw new DesignError("The Figma render download was refused or expired. No API credential was sent to the image host, so this does not establish that your Figma connection expired. No snapshot was retained.", "design-render-access-refused");
        if (response.status === 401) throw new DesignError("Figma authentication was refused. Reconnect Figma; no snapshot was retained.", "design-auth-expired");
        if (response.status === 403) throw new DesignError("Figma access was refused. Reconnect with file content read permission and check access to the selected file; the service did not distinguish file access from an expired credential. No snapshot was retained.", "design-access-refused");
        if (response.status === 429) throw new DesignError("Figma rate limit reached. No automatic retry or partial snapshot was retained; try again when the service permits.", "design-rate-limited");
        if (response.status !== 200) throw new DesignError(`Figma returned HTTP ${Number.isInteger(response.status) ? response.status : "unknown"}; no snapshot was retained.`, "design-service-refused");
        if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity" || (response.headers["content-type"] ?? "").toLowerCase().split(";")[0]!.trim() !== (png ? "image/png" : "application/json")) throw new DesignError("Figma response was not the requested uncompressed JSON or PNG.", "design-content-refused");
        if (Buffer.from(response.body).includes(Buffer.from(token))) throw new DesignError("Figma response echoed a credential; no snapshot was retained.", "design-secret-detected");
        measurements.push({ request: hashJson({ method: "GET", url }), response: hashDesignBytes(response.body) });
        return response;
    }
    try {
        const nodesUrl = new URL(`${API}/v1/files/${fileKey}/nodes`); nodesUrl.searchParams.set("ids", nodeIds.join(","));
        const nodesResponse = parseDesignJson((await get(nodesUrl.href)).body, maxBytes);
        if (!mapping(nodesResponse) || nodesResponse.err || !mapping(nodesResponse.nodes) || Object.keys(nodesResponse.nodes).sort().join(",") !== nodeIds.join(",") || typeof nodesResponse.version !== "string" || !versionPattern.test(nodesResponse.version)) throw new DesignError("Figma did not return every selected node with a usable reported version.", "design-source-mismatch");
        const version = nodesResponse.version, selected: Record<string, unknown> = {};
        for (const id of nodeIds) {
            const block = nodesResponse.nodes[id];
            if (!mapping(block) || !mapping(block.document) || block.document.id !== id || typeof block.document.name !== "string" || !block.document.name.trim() || typeof block.document.type !== "string" || ["DOCUMENT","CANVAS"].includes(block.document.type)) throw new DesignError("Figma returned a missing, partial or wrong frame/layer; whole files and pages are not accepted.", "design-source-mismatch");
            selected[id] = Object.fromEntries(["document","components","componentSets","styles"].filter(key => block[key] !== undefined).map(key => [key, block[key]]));
        }
        assertNoDesignSecrets(selected, [token]);
        if (secretPattern.test(designCanonicalJson(selected))) throw new DesignError("Selected Figma data contains a detected credential.", "design-secret-detected");
        const context = designCanonicalJson({ format: "figma-rest-selected-nodes-v1", file_key: fileKey, version, nodes: stripTemporaryLinks(selected) });
        if (Buffer.byteLength(context) > MAX_CONTEXT_BYTES) throw new DesignError("Selected Figma context exceeds its byte ceiling; select smaller frames.", "design-response-limit");
        const imagesUrl = new URL(`${API}/v1/images/${fileKey}`); imagesUrl.searchParams.set("ids", nodeIds.join(",")); imagesUrl.searchParams.set("format", "png"); imagesUrl.searchParams.set("scale", "1"); imagesUrl.searchParams.set("version", version);
        const imagesResponse = parseDesignJson((await get(imagesUrl.href)).body, maxBytes);
        if (!mapping(imagesResponse) || imagesResponse.err || imagesResponse.status !== undefined && imagesResponse.status !== 200 || !mapping(imagesResponse.images) || Object.keys(imagesResponse.images).sort().join(",") !== nodeIds.join(",") || imagesResponse.version !== undefined && imagesResponse.version !== version) throw new DesignError("Figma render response is partial or does not match the pinned design version.", "design-source-mismatch");
        const renders = nodeIds.map(id => validateFigmaRenderUrl(imagesResponse.images[id]).href);
        if (new Set(renders).size !== renders.length) throw new DesignError("Figma returned the same render URL for different selected nodes; no ambiguous snapshot was retained.", "design-source-mismatch");
        const assets = [];
        for (let index = 0; index < nodeIds.length; index++) {
            const id = nodeIds[index]!, bytes = (await get(renders[index]!, true)).body;
            assets.push(designPngAsset({ id: `figma-${id.replace(":", "-")}`, title: nodesResponse.nodes[id].document.name, pngBase64: Buffer.from(bytes).toString("base64") }));
        }
        const calls = figmaRestReceiptArguments(fileKey, nodeIds, version).map((call, index) => ({ tool: call.tool, arguments_sha256: hashJson(call.arguments), request_sha256: measurements[index]!.request, response_sha256: measurements[index]!.response }));
        const snapshot = sealDesignSnapshot({ schema_version: "wringer.design-snapshot.v2", title: input.title ?? "Figma design reference", source: { provider: "figma-rest", label: input.title ?? "Selected Figma frames/layers", endpoint: API, file_key: fileKey, node_id: nodeIds.join(","), version, version_basis: "reported" }, captured_at: (options.now?.() ?? new Date()).toISOString(), disclosure: input.disclosure, context, component_rules: input.componentRules ?? [], assets, provenance: { method: "figma-rest-read", calls, limits: [
            "Wringer executed fixed Figma REST reads, not Figma's remote MCP or an agent/model loop.",
            "The nodes API reported the version; the PNG request explicitly pinned that version. The image response does not independently attest its renderer's version.",
            "Only selected node data and static PNGs are retained. Temporary link parameters and unrelated file metadata are omitted; signed render URLs and credentials are not retained.",
            "Request digests cover exact credential-free-header GET URLs, including temporary render URL parameters; argument digests bind stable file, node and version identities; response digests cover actual response bytes.",
            "Imported design text is untrusted reference data, never execution instructions or approval authority. No provider-generated code or live variable API coverage is claimed.",
            "PNG downloads permit only this connector's explicit Figma render host/path profile, public IPv4 DNS pinning, no redirects and no forwarded API credentials. Unknown hosts are refused, not silently substituted.",
            "File access is not proof of ownership, repository disclosure permission, visual correctness or image privacy. Human retention consent and visual acceptance are separate decisions.",
            "The snapshot pins captured bytes. Subsequent remote changes require a new import and cannot silently replace approved evidence."
        ] } });
        assertNoDesignSecrets(snapshot, [token]);
        return snapshot;
    } finally { clearTimeout(timer); controller.abort(); }
}
