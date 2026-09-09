import { expect, test } from "bun:test";
import { mkdtemp, rm, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createDesignSnapshot, validateDesignSnapshot, parseDesignJson, parseDesignSnapshot, assertRepositoryDisclosure, readDesignSnapshot, writeDesignSnapshot, inspectPng, hashDesignSnapshot, importDesignFromMcp, validateDesignEndpoint, isPublicDesignAddress, type DesignMcpInput, type DesignHttpRequest, type DesignHttpResponse } from "../src";

const crc = (b: Buffer) => { let c = 0xffffffff; for (const byte of b) { c ^= byte; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data = Buffer.alloc(0)) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, b.length - 4)), b.length - 4); return b; };
function png(width = 1, height = 1, metadata = false) {
    const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), ...(metadata ? [chunk("tEXt", Buffer.from("private metadata"))] : []), chunk("IDAT", deflateSync(Buffer.from([0,255,0,0,255]))), chunk("IEND")]).toString("base64");
}
const owned = () => createDesignSnapshot({ title: "Owned button", disclosure: "private", context: "Use the repository button component.", assets: [{ id: "reference", title: "Red button reference", pngBase64: png() }] }, new Date("2026-09-09T00:00:00.000Z"));
const input = (): DesignMcpInput => ({ provider: "figma", endpoint: "https://mcp.figma.com/mcp", source: { label: "Approved checkout frame", fileKey: "file123", nodeId: "1:2" }, disclosure: "private", recipe: [{ tool: "get_design_context", arguments: { fileKey: "file123", nodeId: "1:2" } }], token: "explicit-test-credential-value" });
function transport(options: { sse?: boolean; toolResult?: any; change?: (packet: any, response: DesignHttpResponse) => DesignHttpResponse; annotations?: any; toolName?: string } = {}) {
    const seen: any[] = [], headers: Record<string,string>[] = [];
    const send = async (request: DesignHttpRequest): Promise<DesignHttpResponse> => {
        const packet = JSON.parse(request.body); seen.push(packet); headers.push(request.headers);
        let result: any;
        if (packet.method === "initialize") result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "test fixture", version: "1" } };
        else if (packet.method === "notifications/initialized") return { status: 202, headers: {}, body: "" };
        else if (packet.method === "tools/list") result = { tools: [{ name: options.toolName ?? "get_design_context", annotations: options.annotations ?? { readOnlyHint: true, destructiveHint: false } }] };
        else if (packet.method === "tools/call") result = options.toolResult ?? { content: [{ type: "text", text: "Use the existing Button and spacing tokens." }, { type: "image", mimeType: "image/png", data: png() }] };
        else throw new Error("unexpected request");
        const body = JSON.stringify({ jsonrpc: "2.0", id: packet.id, result });
        const response = { status: 200, headers: { "content-type": options.sse ? "text/event-stream" : "application/json", "mcp-session-id": "fixture-session" }, body: options.sse ? `event: message\ndata: ${body}\n\n` : body };
        return options.change?.(packet, response) ?? response;
    };
    return { send, seen, headers };
}

test("owned reference is content-bound, explicitly not an MCP or Figma measurement", () => {
    const value = owned(); expect(value.source.provider).toBe("owned-reference"); expect(value.source.version_basis).toBe("capture-only"); expect(value.provenance.calls).toEqual([]); expect(value.assets[0]?.width).toBe(1); expect(validateDesignSnapshot(value)).toEqual(value);
    expect(() => validateDesignSnapshot({ ...value, context: "changed" })).toThrow("digest");
    expect(() => assertRepositoryDisclosure(value)).toThrow("private");
    const permitted = { ...value, disclosure: "repository-permitted" as const }; permitted.snapshot_sha256 = hashDesignSnapshot(permitted); expect(() => assertRepositoryDisclosure(permitted)).not.toThrow();
});
test("snapshot files are exclusive immutable private regular files and links are refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wringer-design-test-"));
    try {
        const path = join(dir, "reference.json"); await writeDesignSnapshot(path, owned()); expect(await readDesignSnapshot(path)).toEqual(owned());
        await expect(writeDesignSnapshot(path, owned())).rejects.toThrow();
        const link = join(dir, "link.json"); await symlink(path, link); await expect(readDesignSnapshot(link)).rejects.toThrow(); expect((await readFile(path, "utf8")).includes("owned-reference")).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
test("PNG validation checks canonical encoding, exact dimensions, CRC, data and safe chunks", () => {
    expect(inspectPng(png()).width).toBe(1);
    expect(() => inspectPng(png() + "\n")).toThrow();
    expect(() => inspectPng(Buffer.from("<svg onload='bad'/>").toString("base64"))).toThrow();
    expect(() => inspectPng(png(9000))).toThrow("bounded");
    expect(() => inspectPng(png(2))).toThrow("dimensions");
    expect(() => inspectPng(png(1,1,true))).toThrow("metadata");
    const broken = Buffer.from(png(), "base64"); broken[29] = broken[29]! ^ 1; expect(() => inspectPng(broken.toString("base64"))).toThrow("integrity");
    expect(() => inspectPng(Buffer.concat([Buffer.from(png(),"base64"),chunk("IEND")]).toString("base64"))).toThrow("ordering");
});
test("JSON MCP handshake executes only the exact predeclared read and retains no credentials", async () => {
    const fixture = transport(), value = await importDesignFromMcp(input(), { testTransport: fixture.send, now: () => new Date("2026-09-09T00:00:00.000Z") });
    expect(fixture.seen.map(p => p.method)).toEqual(["initialize","notifications/initialized","tools/list","tools/call"]);
    expect(fixture.seen[3].params).toEqual({ name: "get_design_context", arguments: input().recipe[0]!.arguments });
    expect(fixture.headers[3]?.Authorization).toBe(`Bearer ${input().token}`);
    expect(fixture.headers[3]?.["Mcp-Session-Id"]).toBe("fixture-session");
    expect(value.assets).toHaveLength(1); expect(value.provenance.calls).toHaveLength(1); expect(value.source.version_basis).toBe("capture-only"); expect(JSON.stringify(value)).not.toContain(input().token!); expect(JSON.stringify(value)).not.toContain("fixture-session");
});
test("bounded SSE response is accepted without following resource links", async () => {
    const fixture = transport({ sse: true }); const value = await importDesignFromMcp(input(), { testTransport: fixture.send }); expect(value.context).toContain("spacing tokens");
});
test("private and ambiguous endpoints are rejected before even an injected transport is called", async () => {
    for (const endpoint of ["http://localhost:3845/mcp", "https://127.0.0.1/mcp", "https://169.254.169.254/mcp", "https://[::1]/mcp", "https://service.internal/mcp", "https://public.test/mcp", "https://user:pass@api.vendor.com/mcp", "https://api.vendor.com/mcp?token=value", "https://api.vendor.com:444/mcp"]) {
        const value = input(); value.provider = "generic-mcp"; value.endpoint = endpoint; let called = false;
        await expect(importDesignFromMcp(value, { testTransport: async () => { called = true; throw new Error(); } })).rejects.toThrow(); expect(called).toBe(false);
    }
    expect(validateDesignEndpoint("https://api.vendor.com/mcp", "generic-mcp").hostname).toBe("api.vendor.com");
    for (const addr of ["0.0.0.0","10.1.1.1","127.0.0.1","100.64.1.1","169.254.1.1","172.31.1.1","192.168.1.1","192.0.0.1","192.0.2.1","198.18.1.1","198.51.100.1","203.0.113.1","224.0.0.1","255.255.255.255","::1","::ffff:127.0.0.1"]) expect(isPublicDesignAddress(addr)).toBe(false);
    expect(isPublicDesignAddress("8.8.8.8")).toBe(true);
});
test("write tools, unknown Figma tools, wrong source and ignored fields fail before network", async () => {
    for (const tool of ["create_file","write_design","get_and_update_file","send_message","unknown_tool","generate_design"]) { const value = input(); value.recipe[0]!.tool = tool; const f = transport(); await expect(importDesignFromMcp(value, { testTransport: f.send })).rejects.toThrow(); expect(f.seen).toHaveLength(0); }
    const value = input(); value.recipe[0]!.arguments.nodeId = "other"; await expect(importDesignFromMcp(value, { testTransport: transport().send })).rejects.toThrow("exactly");
});
test("all recipe tools must have unambiguous read-only advertisements before any call", async () => {
    for (const annotations of [{}, { readOnlyHint: false }, { readOnlyHint: true, destructiveHint: true }]) { const f = transport({ annotations }); await expect(importDesignFromMcp(input(), { testTransport: f.send })).rejects.toThrow("read-only"); expect(f.seen.filter(p => p.method === "tools/call")).toHaveLength(0); }
});
test("Figma client/access rejection and redirect remain explicit, never login or fabricated success", async () => {
    for (const status of [401,403,302]) { const f = transport({ change: (_p,r) => ({ ...r,status,headers: { location: "http://169.254.169.254" },body: "private-error-value" }) }); await expect(importDesignFromMcp(input(), { testTransport: f.send })).rejects.toThrow(status === 302 ? "redirects" : "approved-client"); expect(f.seen).toHaveLength(1); }
});
test("credential echo in text or structured data refuses the entire snapshot without echoing secret", async () => {
    for (const result of [{ content: [{ type:"text",text: input().token }] }, { content: [], structuredContent: { secret: input().token } }]) { try { await importDesignFromMcp(input(), { testTransport: transport({ toolResult: result }).send }); throw new Error("unexpected success"); } catch (e) { expect(String(e)).toContain("credential"); expect(String(e)).not.toContain(input().token!); } }
});
test("unsupported external links, SVG and server errors cannot become empty successful imports", async () => {
    for (const result of [{ content: [] }, {content:[{type:"text",text:"   "}],structuredContent:{}}, { isError: true, content: [{type:"text",text:"error"}] }, {content:[{type:"resource_link",uri:"https://internal/resource"}]}, {content:[{type:"image",mimeType:"image/svg+xml",data:"bad"}]}]) await expect(importDesignFromMcp(input(), { testTransport: transport({toolResult:result}).send })).rejects.toThrow();
});
test("response identity, unknown protocol and changed session fail closed", async () => {
    for (const change of [(p:any,r:DesignHttpResponse) => ({...r,body:JSON.stringify({jsonrpc:"2.0",id:p.id+1,result:{}})}), (p:any,r:DesignHttpResponse) => p.method === "initialize" ? {...r,body:JSON.stringify({jsonrpc:"2.0",id:p.id,result:{protocolVersion:"unknown",capabilities:{tools:{}}}})} : r, (p:any,r:DesignHttpResponse) => p.method === "tools/list" ? {...r,headers:{...r.headers,"mcp-session-id":"changed"}} : r]) await expect(importDesignFromMcp(input(), {testTransport:transport({change}).send})).rejects.toThrow();
});
test("call, response and time budgets are enforced with no background paid work", async () => {
    const value = input(); value.recipe.push(value.recipe[0]!); value.limits = {maxCalls:1}; const f = transport(); await expect(importDesignFromMcp(value,{testTransport:f.send})).rejects.toThrow("budget"); expect(f.seen).toHaveLength(0);
    await expect(importDesignFromMcp({...input(),limits:{maxResponseBytes:1024}},{testTransport:transport({toolResult:{content:[{type:"text",text:"x".repeat(1100)}]}}).send})).rejects.toThrow("ceiling");
    await expect(importDesignFromMcp({...input(),limits:{timeoutMs:5}},{testTransport:async request => { await new Promise(resolve => request.signal.addEventListener("abort",resolve,{once:true})); throw new Error("fixture cancelled"); }})).rejects.toThrow("deadline");
});
test("reported source version requires matching source and mismatches refuse", async () => {
    const result = {content:[{type:"text",text:"Design tokens"}],structuredContent:{source:{fileKey:"file123",nodeId:"1:2",version:"v42"}}};
    const value = await importDesignFromMcp(input(),{testTransport:transport({toolResult:result}).send}); expect(value.source.version).toBe("v42"); expect(value.source.version_basis).toBe("reported");
    const request = input(); request.source.version = "v99"; await expect(importDesignFromMcp(request,{testTransport:transport({toolResult:result}).send})).rejects.toThrow("unexpected");
});
test("generic read recipe is honestly labeled and still uses advertised read authority", async () => {
    const request = input(); request.provider = "generic-mcp"; request.endpoint = "https://api.designvendor.com/mcp"; request.recipe = [{tool:"read_components",arguments:{collection:"approved"}}];
    const value = await importDesignFromMcp(request,{testTransport:transport({toolName:"read_components"}).send}); expect(value.source.provider).toBe("generic-mcp"); expect(value.provenance.limits.join(" ")).toContain("server assertions");
});
test("unknown options and credential-bearing source labels fail before network", async () => {
    const fixture = transport();
    await expect(importDesignFromMcp({ ...input(), silentlyIgnoredPermission: "write" } as any, { testTransport: fixture.send })).rejects.toThrow("unknown");
    await expect(importDesignFromMcp({ ...input(), source: { ...input().source, label: input().token! } }, { testTransport: fixture.send })).rejects.toThrow("credential");
    expect(fixture.seen).toHaveLength(0);
});
test("self-consistent digests cannot legalize malicious endpoint links, duplicate assets or false dimensions", async () => {
    const value = await importDesignFromMcp({ ...input(), provider: "generic-mcp", endpoint: "https://api.vendor.com/mcp" }, { testTransport: transport().send });
    for (const endpoint of ["javascript:alert(1)","https://127.0.0.1/mcp","https://user:secret@api.vendor.com/mcp"]) { const changed = { ...value, source: { ...value.source, endpoint } }; changed.snapshot_sha256 = hashDesignSnapshot(changed); expect(() => validateDesignSnapshot(changed)).toThrow("endpoint"); }
    const duplicate = owned(); duplicate.assets.push(duplicate.assets[0]!); duplicate.snapshot_sha256 = hashDesignSnapshot(duplicate); expect(() => validateDesignSnapshot(duplicate)).toThrow("identity");
    const changed = owned(); changed.assets[0]!.width = 2; changed.snapshot_sha256 = hashDesignSnapshot(changed); expect(() => validateDesignSnapshot(changed)).toThrow("identity");
});
test("exact snapshot JSON rejects duplicate and unicode-aliased keys before their hidden bytes can enter approval", () => {
    const wire=JSON.stringify(owned());expect(parseDesignSnapshot(wire)).toEqual(owned());
    expect(()=>parseDesignSnapshot(wire.replace('"context":','"context":"hidden instruction","context":'))).toThrow("duplicate");
    expect(()=>parseDesignSnapshot(wire.replace('"context":','"contex\\u0074":"hidden instruction","context":'))).toThrow("duplicate");
});
test("generic design JSON keeps data types while refusing nested duplicates and excessive resource use", () => {
    expect(parseDesignJson('{"rows":[{"scope":"read","a":null},true,12,"escaped\\\"text"]}')).toEqual({rows:[{scope:"read",a:null},true,12,'escaped"text']});
    expect(()=>parseDesignJson('{"recipe":[{"tool":"read_one","tool":"write_two"}]}')).toThrow("duplicate");
    expect(()=>parseDesignJson('"123456"',3)).toThrow("ceiling");
    expect(()=>parseDesignJson("[".repeat(70)+"0"+"]".repeat(70))).toThrow("nesting");
    expect(()=>parseDesignJson('{broken}')).toThrow("valid JSON");
});
test("Figma screenshot recipes explicitly request inline PNG rather than an unfetched URL", async () => {
    for (const flag of [undefined,false]) {
        const request=input();request.recipe=[{tool:"get_screenshot",arguments:{fileKey:"file123",nodeId:"1:2",...(flag===undefined?{}:{enableBase64Response:flag})}}];
        const fixture=transport({toolName:"get_screenshot"});await expect(importDesignFromMcp(request,{testTransport:fixture.send})).rejects.toThrow("enableBase64Response");expect(fixture.seen).toHaveLength(0);
    }
    const request=input();request.recipe=[{tool:"get_screenshot",arguments:{fileKey:"file123",nodeId:"1:2",enableBase64Response:true}}];
    expect((await importDesignFromMcp(request,{testTransport:transport({toolName:"get_screenshot"}).send})).assets).toHaveLength(1);
});
test("even an unusually short explicit credential cannot be echoed into a snapshot", async () => {
    const request={...input(),token:"xyz"};
    await expect(importDesignFromMcp(request,{testTransport:transport({toolResult:{content:[{type:"text",text:"echo xyz"}]}}).send})).rejects.toThrow("credential");
});
