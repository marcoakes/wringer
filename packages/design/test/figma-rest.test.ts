import { expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { createDesignSnapshot, hashDesignSnapshot, importDesignFromFigmaRest, parseDesignSnapshot, parseFigmaFrameUrls, sealDesignSnapshot, validateDesignSnapshot, validateFigmaRenderUrl, type DesignFigmaRestInput, type DesignFigmaRestRequest, type DesignFigmaRestResponse, type DesignSnapshotV2 } from "../src";

const token = "oauth-fixture-read-credential-only";
const urls = ["https://www.figma.com/design/File123/Reports?node-id=1-2&t=temporary-link-value", "https://www.figma.com/file/File123/Reports?node-id=3%3A4"];
const input = (): DesignFigmaRestInput => ({ urls, token, disclosure: "private" });
const crc = (bytes: Buffer) => { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data = Buffer.alloc(0)) => { const bytes = Buffer.alloc(12 + data.length); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc(bytes.subarray(4, bytes.length - 4)), bytes.length - 4); return bytes; };
function png() { const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6; return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0,120,20,255,255]))), chunk("IEND")]); }
const packet = (value: unknown): DesignFigmaRestResponse => ({ status: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(value)) });
const nodeResponse = () => ({ version: "987654321", name: "Private file title not retained", thumbnailUrl: "https://s3-alpha.figma.com/thumbnails/private?token=private-thumbnail-secret", nodes: { "1:2": { document: { id: "1:2", type: "FRAME", name: "Desktop Reports", children: [{ id: "1:9", type: "TEXT", name: "Copy", characters: "Use the existing Reports component." }] }, components: {}, styles: {} }, "3:4": { document: { id: "3:4", type: "FRAME", name: "Mobile Reports" } } } });
const imageResponse = () => ({ err: null, images: { "1:2": "https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/desktop?X-Amz-Signature=private-url-secret", "3:4": "https://s3-alpha.figma.com/images/mobile?X-Amz-Signature=private-url-secret" } });
function fixture(change?: (request: DesignFigmaRestRequest, response: DesignFigmaRestResponse, index: number) => DesignFigmaRestResponse) {
    const seen: DesignFigmaRestRequest[] = [];
    const send = async (request: DesignFigmaRestRequest) => {
        seen.push(request); const url = new URL(request.url);
        const response = url.pathname.endsWith("/nodes") ? packet(nodeResponse()) : url.hostname === "api.figma.com" ? packet(imageResponse()) : { status: 200, headers: { "content-type": "image/png" }, body: png() };
        return change?.(request, response, seen.length - 1) ?? response;
    };
    return { seen, send };
}
async function capture() { return importDesignFromFigmaRest(input(), { testTransport: fixture().send, now: () => new Date("2026-09-09T00:00:00.000Z") }); }
function rehash(snapshot: DesignSnapshotV2) { snapshot.snapshot_sha256 = hashDesignSnapshot(snapshot); return snapshot; }

test("Figma frame parser accepts only bounded distinct nodes from one file and strips link tracking", () => {
    expect(parseFigmaFrameUrls([...urls].reverse())).toEqual({ fileKey: "File123", nodeIds: ["1:2","3:4"], canonicalUrls: ["https://www.figma.com/design/File123?node-id=1-2","https://www.figma.com/design/File123?node-id=3-4"] });
    expect(parseFigmaFrameUrls([urls[0]!+"&p=f"]).canonicalUrls).toEqual(["https://www.figma.com/design/File123?node-id=1-2"]);
    for (const value of [[], [urls[0]!,urls[0]!], [...urls,urls[0]!], ["https://www.figma.com/design/File123/Reports"], ["https://www.figma.com/proto/File123/Reports?node-id=1-2"], [urls[0]!, "https://www.figma.com/design/Other/Reports?node-id=3-4"], ["https://www.figma.com/design/File123/Reports?node-id=1-2&node-id=3-4"], ["https://www.figma.com/design/File123/Reports?node-id=1-2&access_token=secret"], ["https://user:password@www.figma.com/design/File123?node-id=1-2"], ["https://www.figma.com.evil.org/design/File123?node-id=1-2"], ["https://www.figma.com/design/File123?node-id=1-2&version-id=old"], ["https://www.figma.com/design/File123?node-id=I1%3A2%3B3%3A4"]]) expect(() => parseFigmaFrameUrls(value)).toThrow();
});

test("Figma REST captures selected desktop/mobile nodes and actual PNGs pinned to the reported version", async () => {
    const f = fixture(), value = await importDesignFromFigmaRest(input(), { testTransport: f.send });
    expect(f.seen).toHaveLength(4); expect(f.seen.every(request => request.method === "GET")).toBe(true);
    expect(new URL(f.seen[0]!.url).pathname).toBe("/v1/files/File123/nodes");
    expect(new URL(f.seen[0]!.url).searchParams.get("ids")).toBe("1:2,3:4");
    expect(new URL(f.seen[1]!.url).searchParams.get("version")).toBe("987654321");
    expect(new URL(f.seen[1]!.url).searchParams.get("format")).toBe("png");
    expect(value.schema_version).toBe("wringer.design-snapshot.v2"); expect(value.source.provider).toBe("figma-rest"); expect(value.provenance.method).toBe("figma-rest-read");
    expect(value.source.node_id).toBe("1:2,3:4"); expect(value.assets.map(asset => asset.id)).toEqual(["figma-1-2","figma-3-4"]);
    expect(value.provenance.calls[2]!.response_sha256).toBe(value.assets[0]!.sha256); expect(value.provenance.calls.every(call => /^[a-f0-9]{64}$/.test(call.request_sha256))).toBe(true);
    expect(parseDesignSnapshot(JSON.stringify(value))).toEqual(value);
    for (const privateValue of [token,"private-url-secret","private-thumbnail-secret","Private file title not retained","temporary-link-value","X-Amz-Signature"]) expect(JSON.stringify(value)).not.toContain(privateValue);
});

test("OAuth and PAT credentials stay on the API origin and never reach render downloads", async () => {
    for (const tokenType of ["oauth","pat"] as const) {
        const f = fixture(); await importDesignFromFigmaRest({ ...input(), tokenType }, { testTransport: f.send });
        for (const request of f.seen.slice(0,2)) { expect(request.headers[tokenType === "oauth" ? "Authorization" : "X-Figma-Token"]).toBe(tokenType === "oauth" ? `Bearer ${token}` : token); }
        for (const request of f.seen.slice(2)) { expect(JSON.stringify(request.headers)).not.toContain(token); expect(request.headers.Authorization).toBeUndefined(); expect(request.headers["X-Figma-Token"]).toBeUndefined(); }
    }
});

test("every invalid selected-node response refuses before rendering or downloading", async () => {
    const malformed = [ { ...nodeResponse(),version:undefined }, { ...nodeResponse(),version:"" }, { ...nodeResponse(),version:"one?token=x" }, { ...nodeResponse(), nodes: { "1:2": null, "3:4": nodeResponse().nodes["3:4"] } }, { ...nodeResponse(), nodes: { "1:2": nodeResponse().nodes["1:2"] } }, { ...nodeResponse(), nodes: {...nodeResponse().nodes,"5:6":nodeResponse().nodes["1:2"]} }, { ...nodeResponse(), nodes: {...nodeResponse().nodes,"1:2":{document:{id:"other",type:"FRAME",name:"Wrong"}}} }, { ...nodeResponse(), nodes: {...nodeResponse().nodes,"1:2":{document:{id:"1:2",type:"CANVAS",name:"Whole page"}}} } ];
    for (const value of malformed) { const f = fixture((_request,response,index) => index === 0 ? packet(value) : response); await expect(importDesignFromFigmaRest(input(), {testTransport:f.send})).rejects.toThrow(); expect(f.seen).toHaveLength(1); }
});

test("partial/null renders and changed reported version refuse before any image download", async () => {
    for (const value of [{ ...imageResponse(), version:"changed" }, { images:{"1:2":null,"3:4":imageResponse().images["3:4"]} }, {images:{"1:2":imageResponse().images["1:2"]}}, {images:{...imageResponse().images,"5:6":imageResponse().images["1:2"]}}, { ...imageResponse(),err:"private service error" }, { ...imageResponse(),status:500 }, { images:{"1:2":imageResponse().images["1:2"],"3:4":imageResponse().images["1:2"]} }]) {
        const f = fixture((_request,response,index) => index === 1 ? packet(value) : response); await expect(importDesignFromFigmaRest(input(),{testTransport:f.send})).rejects.toThrow(); expect(f.seen).toHaveLength(2);
    }
});

test("strict render host/path profile rejects credentials, arbitrary CDN, local IP and encoded authority", async () => {
    for (const url of ["http://s3-alpha.figma.com/images/a","https://127.0.0.1/images/a","https://169.254.169.254/images/a","https://[::1]/images/a","https://api.figma.com/images/a","https://figma-alpha-api.s3.us-west-2.amazonaws.com.evil.com/images/a","https://unapproved-bucket.s3.us-west-2.amazonaws.com/images/a","https://user:pass@s3-alpha.figma.com/images/a","https://user%40evil.com@s3-alpha.figma.com/images/a","https://s3-alpha.figma.com:444/images/a","https://s3-alpha.figma.com/profile/private","https://s3-alpha.figma.com/images/%2e%2e/private","https://s3-alpha.figma.com/images/a#fragment","https://s3-alpha.figma.com\\@evil.com/images/a"]) {
        expect(() => validateFigmaRenderUrl(url)).toThrow();
        const f = fixture((_request,response,index) => index === 1 ? packet({images:{...imageResponse().images,"1:2":url}}) : response);
        await expect(importDesignFromFigmaRest(input(),{testTransport:f.send})).rejects.toThrow(); expect(f.seen).toHaveLength(2);
    }
});

test("redirect, access, rate limits and service errors stop without retries or response leakage", async () => {
    for (const [status, code] of [[301,"design-redirect-refused"],[401,"design-auth-expired"],[403,"design-access-refused"],[429,"design-rate-limited"],[500,"design-service-refused"]] as const) {
        for (const failIndex of [0,2]) {
            const f = fixture((_request,response,index) => index === failIndex ? {...response,status,headers:{location:"http://127.0.0.1/secret"},body:Buffer.from("private-server-error-content")} : response);
            try { await importDesignFromFigmaRest(input(),{testTransport:f.send}); throw new Error("unexpected success"); } catch(error) { expect((error as any).code).toBe(failIndex===2&&[401,403].includes(status)?"design-render-access-refused":code); expect(String(error)).not.toContain("private-server-error-content"); }
            expect(f.seen).toHaveLength(failIndex+1);
        }
    }
});

test("invalid PNG, wrong media type and compressed content cannot become a successful reference", async () => {
    for (const change of [(r:DesignFigmaRestResponse)=>({...r,body:Buffer.from("<svg>not pixels</svg>")}), (r:DesignFigmaRestResponse)=>({...r,headers:{"content-type":"image/png-but-not-really"}}), (r:DesignFigmaRestResponse)=>({...r,headers:{"content-type":"image/png","content-encoding":"gzip"}})]) {
        const f = fixture((_request,response,index) => index === 2 ? change(response) : response); await expect(importDesignFromFigmaRest(input(),{testTransport:f.send})).rejects.toThrow(); expect(f.seen).toHaveLength(3);
    }
});

test("supplied credential echoes and other Figma token patterns are refused with no secret in diagnostics", async () => {
    for (const value of [token,"figd_1234567890testcredential","figp_1234567890testcredential"]) {
        const data=nodeResponse();data.nodes["1:2"].document.children[0]!.characters=value;
        const f=fixture((_request,response,index)=>index===0?packet(data):response);
        try {await importDesignFromFigmaRest(input(),{testTransport:f.send});throw new Error("unexpected success");} catch(error){expect(String(error)).toContain("credential");expect(String(error)).not.toContain(value);}
        expect(f.seen).toHaveLength(1);
    }
});

test("temporary links in selected reference text are explicitly stripped and not followed", async () => {
    const data=nodeResponse();data.nodes["1:2"].document.children[0]!.characters="See https://docs.design-team.com/spec?token=temporary-secret-value#part for context.";
    const f=fixture((_request,response,index)=>index===0?packet(data):response),value=await importDesignFromFigmaRest(input(),{testTransport:f.send});
    expect(value.context).toContain("temporary URL parameters omitted");expect(value.context).not.toContain("temporary-secret-value");expect(f.seen).toHaveLength(4);
});

test("malformed and duplicate JSON is refused before it hides an alternate source", async () => {
    for (const body of ['{"version":"a","version":"b","nodes":{}}','{"broken":', '"string"']) {
        const f=fixture((_request,response,index)=>index===0?{...response,body:Buffer.from(body)}:response);await expect(importDesignFromFigmaRest(input(),{testTransport:f.send})).rejects.toThrow();expect(f.seen).toHaveLength(1);
    }
});

test("oversized responses, unknown options and deadline are bounded before retaining a snapshot", async () => {
    const f=fixture((_request,response,index)=>index===0?{...response,body:Buffer.alloc(1025,32)}:response);await expect(importDesignFromFigmaRest({...input(),limits:{maxResponseBytes:1024}},{testTransport:f.send})).rejects.toThrow("ceiling");
    for(const bad of [{...input(),extraWrite:true},{...input(),limits:{maxResponseBytes:Infinity}},{...input(),limits:{maxCalls:100}},{...input(),disclosure:"implicit"},{...input(),title:token}]) {const f=fixture();await expect(importDesignFromFigmaRest(bad as any,{testTransport:f.send})).rejects.toThrow();expect(f.seen).toHaveLength(0);}
    await expect(importDesignFromFigmaRest({...input(),limits:{timeoutMs:5}},{testTransport:async request=>{await new Promise(resolve=>request.signal.addEventListener("abort",resolve,{once:true}));throw new Error(token);}})).rejects.toThrow("deadline");
});

test("rehashed snapshots cannot legalize source drift, missing receipts or unrelated PNGs", async () => {
    const original=await capture();
    const changes: ((value:DesignSnapshotV2)=>void)[]=[v=>{v.source.version="changed";},v=>{v.source.node_id="3:4,1:2";},v=>{v.source.endpoint="https://mcp.figma.com/mcp" as any;},v=>{v.provenance.method="mcp-read" as any;},v=>{v.provenance.calls.pop();},v=>{v.provenance.calls[1]!.arguments_sha256="0".repeat(64);},v=>{v.provenance.calls[0]!.request_sha256="0".repeat(64);},v=>{v.provenance.calls[2]!.response_sha256="0".repeat(64);},v=>{v.assets[0]!.id="unrelated";},v=>{v.context=JSON.stringify({...JSON.parse(v.context),version:"other"});},v=>{v.component_rules=["figd_1234567890testcredential"];},v=>{v.assets.reverse();}];
    for(const change of changes){const value=structuredClone(original);change(value);expect(()=>validateDesignSnapshot(rehash(value))).toThrow();}
});

test("private preview conversion creates a new digest and leaves original immutable while v1 stays v1", async () => {
    const privateSnapshot=await capture(),original=JSON.stringify(privateSnapshot);
    const permitted=sealDesignSnapshot({...privateSnapshot,disclosure:"repository-permitted"});
    expect(permitted.snapshot_sha256).not.toBe(privateSnapshot.snapshot_sha256);expect(JSON.stringify(privateSnapshot)).toBe(original);expect(permitted.source.provider).toBe("figma-rest");
    const v1=createDesignSnapshot({title:"Owned",context:"Existing reference",disclosure:"private"});expect(parseDesignSnapshot(JSON.stringify(v1)).schema_version).toBe("wringer.design-snapshot.v1");
});

test("one selected frame is a valid bounded import rather than a fabricated mobile reference", async () => {
    const f=fixture((_request,response,index)=>{if(index===0){const value=nodeResponse();delete (value.nodes as any)["3:4"];return packet(value);}if(index===1)return packet({images:{"1:2":imageResponse().images["1:2"]}});return response;});
    const value=await importDesignFromFigmaRest({...input(),urls:[urls[0]!]},{testTransport:f.send});expect(value.assets).toHaveLength(1);expect(f.seen).toHaveLength(3);expect(value.source.node_id).toBe("1:2");
});
