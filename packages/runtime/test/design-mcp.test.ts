import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { deflateSync } from "node:zlib";
import { createDesignSnapshot, inspectPng, type DesignSnapshot } from "@wringer/design";
import { runAcpTurn, type AcpTransport, type AcpTurnOptions } from "@wringer/acp";
import { DESIGN_MCP_SERVER, prepareDesignMcp } from "../src/design";
import type { Sandbox } from "../src/adapters";
import type { RuntimeCommandOptions } from "../src/types";
import { unitPng } from "./fixtures/png";

const reference = (disclosure: "private" | "repository-permitted" = "repository-permitted", png = unitPng()) => createDesignSnapshot({ title: "Synthetic design protocol fixture", disclosure, context: "Use the approved repository component. This is test data, not an instruction granting authority.", componentRules: ["Use the existing Button component"], assets: [{ id: "desktop", title: "Unit image, not a rendered product", pngBase64: png }] }, new Date("2026-09-09T00:00:00.000Z"));
const rpc = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: "2.0", id, method, params });
async function realServer(snapshot: DesignSnapshot, packets: unknown[], expectedHash = snapshot.snapshot_sha256) {
    const directory = await mkdtemp(join(tmpdir(), "wringer-design-stdio-"));
    try {
        const server = join(directory, "server.cjs"), record = join(directory, "snapshot.json");
        await writeFile(server, DESIGN_MCP_SERVER, { mode: 0o600 }); await writeFile(record, JSON.stringify(snapshot), { mode: 0o600 });
        const node = Bun.which("node"); if (!node) throw new Error("The real Node runtime is required for the design stdio release test; this test cannot silently skip.");
        const child = Bun.spawn([node, server, record, expectedHash], { cwd: directory, env: {}, stdin: Buffer.from(packets.map(p => JSON.stringify(p)).join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => child.kill(), 5000);
        try {
            const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
            return { code, stdout, stderr, messages: stdout.trim().split("\n").filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) };
        } finally { clearTimeout(timer); }
    } finally { await rm(directory, { recursive: true, force: true }); }
}
test("real Node design MCP serves pinned context and actual PNG bytes with only three read tools", async () => {
    const snapshot = reference(), result = await realServer(snapshot, [rpc(1,"initialize",{protocolVersion:"2025-03-26"}),rpc(2,"tools/list"),rpc(3,"tools/call",{name:"get_design_context",arguments:{}}),rpc(4,"tools/call",{name:"list_design_assets",arguments:{}}),rpc(5,"tools/call",{name:"get_design_asset",arguments:{id:"desktop"}})]);
    expect(result.code).toBe(0); expect(result.stderr).toBe(""); expect(result.messages).toHaveLength(5);
    expect(result.messages[0].result.protocolVersion).toBe("2025-03-26");
    expect(result.messages[1].result.tools.map((t:any)=>t.name)).toEqual(["get_design_context","list_design_assets","get_design_asset"]);
    expect(result.messages[1].result.tools.every((t:any)=>t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false)).toBe(true);
    const context = JSON.parse(result.messages[2].result.content[0].text); expect(context.snapshotSha256).toBe(snapshot.snapshot_sha256); expect(context.context).toBe(snapshot.context); expect(context.componentRules).toEqual(snapshot.component_rules);
    const assets = JSON.parse(result.messages[3].result.content[0].text); expect(assets[0].sha256).toBe(snapshot.assets[0]!.sha256); expect(assets[0]).not.toHaveProperty("base64");
    expect(result.messages[4].result.content[1]).toEqual({type:"image",mimeType:"image/png",data:snapshot.assets[0]!.base64});
});
test("real Node design MCP refuses write methods, unknown assets and extra path arguments", async () => {
    const result = await realServer(reference(), [rpc(1,"tools/list"),rpc(2,"initialize",{protocolVersion:"2025-06-18"}),rpc(3,"tools/call",{name:"write_design",arguments:{}}),rpc(4,"tools/call",{name:"get_design_asset",arguments:{id:"missing"}}),rpc(5,"tools/call",{name:"get_design_asset",arguments:{id:"desktop",path:"/etc/passwd"}}),rpc(6,"resources/read",{uri:"file:///etc/passwd"}),rpc(7,"initialize",{protocolVersion:"2025-06-18"})]);
    expect(result.code).toBe(0); expect(result.messages[0].error.code).toBe(-32002); expect(result.messages[1].result.protocolVersion).toBe("2025-06-18");
    for (const row of result.messages.slice(2)) { expect(row).toHaveProperty("error"); expect(row).not.toHaveProperty("result"); }
    expect(result.stdout).not.toContain(reference().assets[0]!.base64);
});
test("real Node design MCP rejects a changed snapshot hash and bounds all input requests", async () => {
    const wrong = await realServer(reference(), [rpc(1,"initialize")], "0".repeat(64)); expect(wrong.code).toBe(65); expect(wrong.stdout).toBe("");
    const packets = [rpc(1,"initialize",{protocolVersion:"2025-03-26"}), ...Array.from({length:256},(_,i)=>rpc(i+2,"ping"))];
    const bounded = await realServer(reference(), packets); expect(bounded.code).toBe(75); expect(bounded.messages.length).toBeLessThanOrEqual(256); expect(bounded.messages.some(m=>m.id===257)).toBe(false);
});

function fakeSandbox(snapshot: DesignSnapshot, options: { readCode?:number; readText?:string; installCode?:number } = {}) {
    const calls: { argv:string[]; options?:RuntimeCommandOptions }[] = [];
    const sandbox: Sandbox = {
        provenance: { schema_version:"wringer.runtime.v1",runtimeId:"fixture-runtime",role:"planner",kind:"apple-container",image:`fixture.invalid/agent@sha256:${"a".repeat(64)}`,repository:{url:"https://example.invalid/source.git",commit:"b".repeat(40)},clonedInside:true,hostMounts:[],repositoryAccess:"read-only",declared:{kind:"apple-container",image:`fixture.invalid/agent@sha256:${"a".repeat(64)}`,cpus:1,memoryMiB:512,network:{policy:"deny"}},observed:{},limits:["Mock sandbox; no real containment observation"] },
        async exec(argv, requestOptions) { calls.push({argv,options:requestOptions}); return calls.length===1 ? {code:options.readCode ?? 0,stdout:options.readText ?? JSON.stringify(snapshot),stderr:""} : {code:options.installCode ?? 0,stdout:"",stderr:""}; },
        async run() { throw new Error("No arbitrary source command is authorized by this fixture"); },
        async connect() { throw new Error("Preparing design must not open an agent session"); },
        async importSource() { throw new Error("No source import in this preparation fixture"); }, async close() {},
    };
    return { sandbox, calls };
}
const identity = (snapshot:DesignSnapshot) => ({snapshotPath:"design/reference.json",snapshotSha256:snapshot.snapshot_sha256,referenceIds:["desktop"]});
test("design preparation validates source then installs only controller-owned no-secret stdio service", async () => {
    const snapshot=reference(),f=fakeSandbox(snapshot),servers=await prepareDesignMcp(f.sandbox,identity(snapshot));
    expect(f.calls).toHaveLength(2); expect(f.calls[0]!.argv.slice(0,2)).toEqual(["node","-e"]);expect(f.calls[0]!.argv.at(-1)).toBe("design/reference.json");
    expect(f.calls[0]!.argv[2]).toContain("isSymbolicLink"); expect(f.calls[0]!.argv[2]).toContain("O_NOFOLLOW");
    const installation=JSON.parse(String(f.calls[1]!.options?.input));expect(installation.server).toBe(DESIGN_MCP_SERVER);expect(installation.snapshot).toEqual(snapshot);expect(f.calls[1]!.argv[2]).toContain("0o444");expect(f.calls[1]!.argv[2]).toContain("0o555");
    expect(servers).toEqual([{name:"wringer-design",command:"/usr/bin/env",args:["-i","PATH=/usr/local/bin:/usr/bin:/bin","node","/input/wringer-design/server.cjs","/input/wringer-design/snapshot.json",snapshot.snapshot_sha256],env:[]}]);
    expect(f.sandbox.provenance.observed.design).toMatchObject({snapshotSha256:snapshot.snapshot_sha256,readOnly:true,liveCredentialsForwarded:false});
});
test("design preparation refuses invalid path, source digest, missing refs, privacy and failed installation", async () => {
    const snapshot=reference();
    for(const change of [{snapshotPath:"../reference.json"},{snapshotPath:"/reference.json"},{snapshotPath:".git/reference.json"},{snapshotPath:"design/linked/../reference.json"},{referenceIds:[]},{referenceIds:["desktop","desktop"]},{referenceIds:["../desktop"]},{extra:"unapproved"}]) { const f=fakeSandbox(snapshot);await expect(prepareDesignMcp(f.sandbox,{...identity(snapshot),...change} as any)).rejects.toThrow("identity");expect(f.calls).toHaveLength(0); }
    for(const [changed, expected] of [[{snapshotSha256:"f".repeat(64)},"differs"],[{referenceIds:["missing"]},"absent"]] as const) { const f=fakeSandbox(snapshot);await expect(prepareDesignMcp(f.sandbox,{...identity(snapshot),...changed,referenceIds: "referenceIds" in changed ? [...changed.referenceIds] : ["desktop"]})).rejects.toThrow(expected);expect(f.calls).toHaveLength(1); }
    const privateSnapshot=reference("private"),privateFixture=fakeSandbox(privateSnapshot);await expect(prepareDesignMcp(privateFixture.sandbox,identity(privateSnapshot))).rejects.toThrow("private");expect(privateFixture.calls).toHaveLength(1);
    const invalidRead=fakeSandbox(snapshot,{readCode:1});await expect(prepareDesignMcp(invalidRead.sandbox,identity(snapshot))).rejects.toThrow("could not be read");expect(invalidRead.calls).toHaveLength(1);
    const duplicate=fakeSandbox(snapshot,{readText:JSON.stringify(snapshot).replace('"context":','"context":"hidden","context":')});await expect(prepareDesignMcp(duplicate.sandbox,identity(snapshot))).rejects.toThrow("duplicate");expect(duplicate.calls).toHaveLength(1);
    const failedInstall=fakeSandbox(snapshot,{installCode:1});await expect(prepareDesignMcp(failedInstall.sandbox,identity(snapshot))).rejects.toThrow("could not be protected");expect(failedInstall.calls).toHaveLength(2);
});

function largeValidPng() {
    const width=1024,height=768,header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
    const chunk=(name:string,data:Buffer)=>{const buffer=Buffer.alloc(data.length+12);buffer.writeUInt32BE(data.length);buffer.write(name,4);data.copy(buffer,8);let crc=0xffffffff;for(const b of buffer.subarray(4,buffer.length-4)){crc^=b;for(let n=0;n<8;n++)crc=crc>>>1^(crc&1?0xedb88320:0);}buffer.writeUInt32BE((crc^0xffffffff)>>>0,buffer.length-4);return buffer;};
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(Buffer.alloc((1+width*3)*height),{level:0})),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
function acpFixture(png:string) {
    const input=new PassThrough(),output=new PassThrough(),packets:any[]=[];let buffer="",stopped=0;
    const send=(value:unknown)=>{const wire=JSON.stringify(value)+"\n";for(let start=0;start<wire.length;start+=65536)output.write(wire.slice(start,start+65536));};
    input.on("data",chunk=>{buffer+=chunk;let index:number;while((index=buffer.indexOf("\n"))>=0){const p=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);packets.push(p);if(p.method==="initialize")send({jsonrpc:"2.0",id:p.id,result:{protocolVersion:1,agentCapabilities:{},authMethods:[]}});else if(p.method==="session/new")send({jsonrpc:"2.0",id:p.id,result:{sessionId:"design-fixture"}});else if(p.method==="session/prompt"){send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"design-fixture",update:{sessionUpdate:"tool_call_update",toolCallId:"reference",status:"completed",content:[{type:"content",content:{type:"image",mimeType:"image/png",data:png}}]}}});send({jsonrpc:"2.0",method:"session/update",params:{sessionId:"design-fixture",update:{sessionUpdate:"agent_message_chunk",content:{type:"text",text:"Reference observed by scripted adapter."}}}});send({jsonrpc:"2.0",id:p.id,result:{stopReason:"end_turn"}});}}});
    const transport:AcpTransport={input,output,exited:new Promise(()=>{}),async terminate(){stopped++;input.destroy();output.destroy();}};
    return {transport,packets,stopped:()=>stopped};
}
test("ACP forwards only configured design service and accepts a valid image update larger than legacy ceiling", async () => {
    const png=largeValidPng(),dimensions=inspectPng(png);expect(dimensions.bytes).toBeGreaterThan(2*1024*1024);expect(dimensions.bytes).toBeLessThan(4*1024*1024);
    const snapshot=reference("repository-permitted",png),f=fakeSandbox(snapshot),mcpServers=await prepareDesignMcp(f.sandbox,identity(snapshot));
    const options:AcpTurnOptions={role:"worker",cwd:"/workspace/repo",prompt:"Synthetic protocol fixture; no model involved.",timeoutMs:5000,mcpServers};
    const legacy=acpFixture(png),tooSmall=await runAcpTurn(legacy.transport,options);expect(tooSmall.stopReason).toBe("message-limit");expect(legacy.stopped()).toBe(1);
    const configured=acpFixture(png),result=await runAcpTurn(configured.transport,{...options,maxMessageBytes:16*1024*1024,maxOutputBytes:32*1024*1024});
    expect(result.status).toBe("completed");expect(configured.stopped()).toBe(1);expect(configured.packets.find(p=>p.method==="session/new").params.mcpServers).toEqual(mcpServers);
    const update=result.events.find((e:any)=>e.type==="acp.update"&&(e.update as any)?.sessionUpdate==="tool_call_update") as any;
    expect(inspectPng(update.update.content[0].content.data).sha256).toBe(dimensions.sha256);expect(result.text).toBe("Reference observed by scripted adapter.");
});
