import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileExecutionPlan } from "@wringer/plan";
import { importDesignFromFigmaRest, readDesignSnapshot, type DesignFigmaRestRequest, type DesignFigmaRestResponse } from "@wringer/design";
import { createMcpSession } from "../../mcp/src/server";
import { initializeAssistant, issueAssistantCapability, createAssistantService } from "../src/assistant";
import { createAssistantDesignService, type AssistantDesignDependencies } from "../src/assistant-design";
import { readAssistantRecord } from "../src/assistant-store";
import type { FigmaConnectionStatus } from "../../figma-connect/src";
import { unitPng } from "../../runtime/test/fixtures/png";

const template=await readFile(new URL("../../plan/examples/contained.yaml",import.meta.url),"utf8");
const token="fixture-design-service-oauth-secret",urls=["https://www.figma.com/design/ReportsFixture123/Reports?node-id=1-2","https://www.figma.com/design/ReportsFixture123/Reports?node-id=3-4"];
const roots:string[]=[],services:Awaited<ReturnType<typeof createAssistantService>>[]=[];
afterEach(async()=>{for(const service of services.splice(0))await service.runner.stop(50).catch(()=>undefined);for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const json=(body:unknown):DesignFigmaRestResponse=>({status:200,headers:{"content-type":"application/json"},body:Buffer.from(JSON.stringify(body))});
async function fixture(options:{failStatus?:number;failIndex?:number}={}) {
    const root=await realpath(await mkdtemp(join(tmpdir(),"wringer-assistant-design-test-")));roots.push(root);
    const profile=compileExecutionPlan(template,{format:"yaml"}),workspace=(await initializeAssistant(root,{plan:profile,cooperativeLocal:true})).workspace;
    const counters={credentials:0,reconnect:0,begin:0,poll:0,disconnect:0,network:0},requests:DesignFigmaRestRequest[]=[];
    let state:FigmaConnectionStatus={state:"connected",configured:true,message:"Fixture connection only; no account accessed."};
    const connection:AssistantDesignDependencies["connection"]={
        async status(){return {...state};},
        async begin(){counters.begin++;return {authorizationUrl:"https://www.figma.com/oauth?fixture=not-an-actual-login",expiresAt:new Date(Date.now()+60000).toISOString()};},
        async poll(){counters.poll++;return {...state};},
        async disconnect(){counters.disconnect++;state={state:"needs-connection",configured:true,message:"Fixture disconnected"};return {...state};},
        async requireReconnect(){counters.reconnect++;state={state:"reconnect-required",configured:true,message:"Fixture needs reconnect"};return {...state};},
        async withAccessToken<T>(callback:(value:string)=>Promise<T>):Promise<T>{counters.credentials++;return callback(token);}
    };
    const dependencies:AssistantDesignDependencies={connection,importSnapshot:(input)=>importDesignFromFigmaRest(input,{testTransport:async request=>{
        const index=counters.network++;requests.push(request);
        if(options.failStatus!==undefined&&index===(options.failIndex??0))return {status:options.failStatus,headers:{"content-type":"application/json"},body:Buffer.from(`Private provider stop ${token} https://example.org/private?token=do-not-retain`)};
        const url=new URL(request.url);
        if(url.pathname.endsWith("/nodes"))return json({version:"service-fixture-42",nodes:{"1:2":{document:{id:"1:2",type:"FRAME",name:"Reports desktop fixture"}},"3:4":{document:{id:"3:4",type:"FRAME",name:"Reports mobile fixture"}}}});
        if(url.hostname==="api.figma.com")return json({images:{"1:2":"https://s3-alpha.figma.com/images/desktop-fixture?signature=private-render-url","3:4":"https://s3-alpha.figma.com/images/mobile-fixture?signature=private-render-url"}});
        return {status:200,headers:{"content-type":"image/png"},body:Buffer.from(unitPng(url.pathname.includes("desktop")?20:50),"base64")};
    }})};
    const service=await createAssistantService(root,{design:dependencies});services.push(service);
    const capability=await issueAssistantCapability(root,new Date(Date.now()+60000).toISOString());
    const call=(name:string,args:unknown)=>service.call(capability.token,`wringer.${name}`,args) as Promise<any>;
    const prepare=(extra:Record<string,unknown>={})=>service.design.prepare({workspaceId:workspace.id,idempotencyKey:crypto.randomUUID(),urls,...extra});
    return {root,profile,workspace,counters,requests,service,dependencies,call,prepare};
}

test("MCP design preparation and observation are inert; assistant cannot connect, preview, retain or attach",async()=>{
    const f=await fixture(),session=createMcpSession({version:"fixture",call:()=>{throw new Error("An uninitialised fixture connection must not dispatch tools");}});
    // Exercise a real MCP envelope with the same service-issued capability via the wrapper.
    const authenticated=createMcpSession({version:"fixture",call:(name,args)=>f.call(name.replace(/^wringer\./,""),args)});
    await authenticated.receive(JSON.stringify({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"scripted-test-client",version:"fixture"}}}));
    await authenticated.receive(JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized"}));
    const response:any=await authenticated.receive(JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"wringer.prepare_design_import",arguments:{workspaceId:f.workspace.id,idempotencyKey:crypto.randomUUID(),urls}}}));
    expect(response.result.isError).toBe(false);const prepared=response.result.structuredContent.design;expect(prepared.outcome).toBe("needs-preview");
    expect((await f.call("get_design_import",{importId:prepared.importId})).design.previewSha256).toBeNull();expect((await f.call("inspect_design",{workspaceId:f.workspace.id})).design.imports).toHaveLength(1);
    for(const name of ["connect_figma","preview_design","confirm_design_retention","attach_design_import","publish","record_human_verdict"])expect((await f.call(name,{importId:prepared.importId})).outcome).toBe("refused");
    expect((await f.call("prepare_design_import",{workspaceId:f.workspace.id,idempotencyKey:crypto.randomUUID(),urls,confirmRetention:true})).outcome).toBe("refused");
    expect(f.counters).toEqual({credentials:0,reconnect:0,begin:0,poll:0,disconnect:0,network:0});expect(await f.service.runner.list()).toEqual([]);
    // An uninitialised/unauthorised second protocol instance cannot inherit the first session.
    expect((await session.receive(JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/list"})))!).toHaveProperty("error");
});

test("invalid links, wrong workspace and changed idempotent request refuse before any design retrieval",async()=>{
    const f=await fixture();
    for(const bad of [{urls:["https://www.figma.com/design/ReportsFixture123/Reports"]},{workspaceId:crypto.randomUUID()},{urls:[urls[0]!,"https://www.figma.com/design/Other/Reports?node-id=3-4"]},{urls,token},{urls,sourcePath:"/tmp/private"}])await expect(f.prepare(bad)).rejects.toThrow();
    const idempotencyKey=crypto.randomUUID(),first=await f.prepare({idempotencyKey});expect((await f.prepare({idempotencyKey})).importId).toBe(first.importId);
    await expect(f.prepare({idempotencyKey,urls:[urls[0]!]})).rejects.toThrow("different data");
    expect(f.counters.network).toBe(0);expect(f.counters.credentials).toBe(0);expect((await f.service.design.inspect()).imports).toHaveLength(1);
});

test("operator must explicitly request preview; production REST importer keeps credentials off PNG hosts",async()=>{
    const f=await fixture(),prepared=await f.prepare();
    for(const request of [{importId:prepared.importId},{importId:prepared.importId,confirmPrivatePreview:false},{importId:prepared.importId,confirmPrivatePreview:true,token}])await expect(f.service.design.preview(request)).rejects.toThrow();
    expect(f.counters.network).toBe(0);
    const preview=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true});expect(preview.outcome).toBe("needs-retention-permission");expect(preview.assets).toHaveLength(2);expect(preview.retainedSha256).toBeNull();
    expect(f.counters.credentials).toBe(1);expect(f.counters.network).toBe(4);expect(f.requests.every(request=>request.method==="GET")).toBe(true);expect(new URL(f.requests[1]!.url).searchParams.get("version")).toBe("service-fixture-42");
    expect(f.requests[0]!.headers.Authorization).toBe(`Bearer ${token}`);expect(f.requests.slice(2).every(request=>!request.headers.Authorization&&!request.headers["X-Figma-Token"])).toBe(true);
    const retained=await readDesignSnapshot(join(f.root,"design-imports",prepared.importId,"preview.json"));expect(retained.schema_version).toBe("wringer.design-snapshot.v2");expect(retained.disclosure).toBe("private");
    for(const secret of [token,"private-render-url"])expect(JSON.stringify(retained)).not.toContain(secret);
    await expect(f.service.design.confirmedSnapshot(prepared.importId)).rejects.toThrow("not been recorded");
});

test("preview image bytes are bound to exact hash and selected asset before review",async()=>{
    const f=await fixture(),prepared=await f.prepare(),preview=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true});
    expect(await f.service.design.asset(prepared.importId,"figma-1-2",preview.previewSha256!)).toEqual(Buffer.from(unitPng(20),"base64"));
    for(const [asset,hash] of [["figma-1-2","0".repeat(64)],["figma-99-9",preview.previewSha256!],["../preview.json",preview.previewSha256!]])await expect(f.service.design.asset(prepared.importId,asset!,hash!)).rejects.toThrow();
    expect(f.counters.network).toBe(4);expect(f.counters.credentials).toBe(1);
});

test("retention requires explicit consent for displayed hash and preserves original private snapshot",async()=>{
    const f=await fixture(),prepared=await f.prepare(),preview=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true}),directory=join(f.root,"design-imports",prepared.importId);
    const privateBytes=await readFile(join(directory,"preview.json"),"utf8"),consent={importId:prepared.importId,expectedPreviewSha256:preview.previewSha256!,actor:"SCRIPTED test operator, not a real human",confirmRetention:true};
    for(const changes of [{confirmRetention:false},{actor:""},{expectedPreviewSha256:"0".repeat(64)},{approval:true}])await expect(f.service.design.confirm({...consent,...changes})).rejects.toThrow();
    expect(await readdir(directory)).not.toContain("consent.json");
    const retained=await f.service.design.confirm(consent);expect(retained.outcome).toBe("retained");expect(retained.retainedSha256).not.toBe(retained.previewSha256);expect(await readFile(join(directory,"preview.json"),"utf8")).toBe(privateBytes);
    const confirmed=await f.service.design.confirmedSnapshot(prepared.importId);expect(confirmed.snapshot.disclosure).toBe("repository-permitted");expect(confirmed.snapshot.assets.map(asset=>asset.sha256)).toEqual(preview.assets.map(asset=>asset.sha256));
    expect((await f.service.design.confirm(consent)).retainedSha256).toBe(retained.retainedSha256);
    const record=await readAssistantRecord(f.root,`design-imports/${prepared.importId}/consent.json`);expect(record.previewSha256).toBe(preview.previewSha256);expect(record.retainedSha256).toBe(confirmed.snapshot.snapshot_sha256);expect(record.actor).toBe(consent.actor);expect(record.boundary).toContain("not verified identity");
    expect(retained.attachment).toBeNull();expect(await f.service.runner.list()).toEqual([]);expect(f.counters.network).toBe(4);
});

test("failed preview persists a safe stop across reopening and never retries an existing request",async()=>{
    const f=await fixture({failStatus:429}),prepared=await f.prepare(),first=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true});expect(first.outcome).toBe("stopped");expect(f.counters.network).toBe(1);
    const reopened=createAssistantDesignService(f.root,f.workspace,f.dependencies);expect((await reopened.get(prepared.importId)).outcome).toBe("stopped");expect((await reopened.preview({importId:prepared.importId,confirmPrivatePreview:true})).outcome).toBe("stopped");expect((await reopened.inspect()).imports[0]!.outcome).toBe("stopped");expect(f.counters.network).toBe(1);expect(f.counters.credentials).toBe(1);
    const directory=join(f.root,"design-imports",prepared.importId),stop=await readFile(join(directory,"stop.json"),"utf8");expect(stop).not.toContain(token);expect(stop).not.toContain("example.org/private");expect(await readdir(directory)).not.toContain("preview.json");await expect(reopened.confirmedSnapshot(prepared.importId)).rejects.toThrow();
    const next=await reopened.prepare({workspaceId:f.workspace.id,idempotencyKey:crypto.randomUUID(),urls});expect(next.importId).not.toBe(prepared.importId);expect(f.counters.network).toBe(1);
});

test("only API 401 marks connection for reconnect, not ambiguous 403 or unauthenticated PNG rejection",async()=>{
    for(const [failStatus,failIndex,expected] of [[401,0,1],[403,0,0],[401,2,0],[403,2,0]] as const){const f=await fixture({failStatus,failIndex}),prepared=await f.prepare(),view=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true});expect(view.outcome).toBe("stopped");expect(f.counters.reconnect).toBe(expected);expect(f.counters.network).toBe(failIndex+1);if(expected)expect(view.nextAction).toContain("Reconnect");}
});

test("imports cannot be read, previewed or retained by another workspace or changed source profile",async()=>{
    const f=await fixture(),prepared=await f.prepare(),preview=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true});
    for(const workspace of [{...f.workspace,id:crypto.randomUUID()},{...f.workspace,profile:{...f.profile,repository:{...f.profile.repository,commit:"f".repeat(40)}}}]){
        const foreign=createAssistantDesignService(f.root,workspace,f.dependencies);
        await expect(foreign.get(prepared.importId)).rejects.toThrow("selected source/profile");await expect(foreign.preview({importId:prepared.importId,confirmPrivatePreview:true})).rejects.toThrow("selected source/profile");await expect(foreign.confirm({importId:prepared.importId,expectedPreviewSha256:preview.previewSha256!,actor:"Fixture",confirmRetention:true})).rejects.toThrow("selected source/profile");await expect(foreign.confirmedSnapshot(prepared.importId)).rejects.toThrow("selected source/profile");
    }
    expect(f.counters.network).toBe(4);expect(f.counters.credentials).toBe(1);
});

test("changed preview bytes cannot inherit retention permission even after a successful earlier read",async()=>{
    const f=await fixture(),prepared=await f.prepare(),preview=await f.service.design.preview({importId:prepared.importId,confirmPrivatePreview:true}),path=join(f.root,"design-imports",prepared.importId,"preview.json");
    const value=JSON.parse(await readFile(path,"utf8"));value.title="Changed unapproved reference";await writeFile(path,JSON.stringify(value));
    await expect(f.service.design.confirm({importId:prepared.importId,expectedPreviewSha256:preview.previewSha256!,actor:"Fixture",confirmRetention:true})).rejects.toThrow("digest");expect(await readdir(join(f.root,"design-imports",prepared.importId))).not.toContain("consent.json");expect(f.counters.network).toBe(4);
});
