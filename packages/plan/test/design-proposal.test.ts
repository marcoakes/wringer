import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileDeclaration, compileExecutionPlan, planningRequestFromPlan, createPlanningAuthority } from "../src";
import { proposeContainedPlan, inspectContainedPlanning } from "../../workflow/src/proposal";
import type { RoleExecutionRequest, RoleExecutionResult } from "@wringer/runtime";

test("contained planner receives exact design authority without a synthetic approval or remote account", async () => {
    const base=compileExecutionPlan(await readFile(new URL("../examples/contained.yaml",import.meta.url),"utf8"),{format:"yaml"});
    const {schema_version,intent_sha256,acceptance_sha256,plan_sha256,...data}=base;
    const plan=compileDeclaration({version:2,...data,intent:"Return the total as 5. Match the approved design.",agents:{...data.agents,planner:data.agents.judge},budget:{...data.budget,max_planner_turns:1},environment:{...data.environment,writable_directories:["preview"]},acceptance:{...data.acceptance,criteria:[...data.acceptance.criteria,{id:"visual",title:"Match reference",quote:"Match the approved design.",kind:"human",required:true,show:{id:"show-visual",argv:["bun","capture.ts"],cwd:".",timeout_seconds:10}}]},design:{snapshotPath:"design/reference.json",snapshotSha256:"a".repeat(64),reviews:[{criterionId:"visual",referenceIds:["mobile","desktop"],captures:[{id:"actual",path:"preview/actual.png",mimeType:"image/png",width:1,height:1}]}]}});
    const request=planningRequestFromPlan(plan,plan.intent),authority=createPlanningAuthority(request,{actor:"Fixture designer",expiresAt:new Date(Date.now()+3600000).toISOString()}),controllerDir=await mkdtemp(join(tmpdir(),"wringer-design-planner-"));
    const calls:RoleExecutionRequest[]=[];
    try {
        const executeRole=async (r:RoleExecutionRequest):Promise<RoleExecutionResult>=>{ calls.push(r);return {status:"completed",text:JSON.stringify({acceptance:plan.acceptance,questions:[],note:"Synthetic design planning fixture; no external service."}),sessionId:crypto.randomUUID(),stopReason:"end_turn",protocolVersion:1,agentInfo:{name:"fixture"},capabilities:{},authMethods:[],authentication:{methodAttempted:null,sessionOpened:true},events:[],stderr:"",provenance:{schema_version:"wringer.runtime.v1",runtimeId:crypto.randomUUID(),role:"planner",kind:r.runtime.kind,image:r.runtime.image,repository:r.repo,clonedInside:true,hostMounts:[],repositoryAccess:"read-only",declared:r.runtime,observed:{},limits:["Synthetic fixture, not runtime containment proof"]}};};
        const result=await proposeContainedPlan({controllerDir,request,authority,source:request.repository,executeRole});
        expect(result.status).toBe("proposal");expect(result.approved).toBe(false);expect(result.plan).toEqual(plan);expect(calls).toHaveLength(1);
        expect(calls[0]!.design).toEqual({snapshotPath:"design/reference.json",snapshotSha256:"a".repeat(64),referenceIds:["desktop","mobile"]});
        expect(calls[0]!.prompt).toContain("Do not replace visual acceptance with an agent opinion");expect(calls[0]!.prompt).not.toContain("planning-show");
        expect((await inspectContainedPlanning(controllerDir)).proposal).toEqual(result);
        const [attempt]=await readdir(join(controllerDir,".wringer/planning/attempts")),path=join(controllerDir,".wringer/planning/attempts",attempt!,"request.json"),saved=JSON.parse(await readFile(path,"utf8"));delete saved.design;await writeFile(path,JSON.stringify(saved));
        await expect(inspectContainedPlanning(controllerDir)).rejects.toThrow("reservation");expect(calls).toHaveLength(1);
    }finally{await rm(controllerDir,{recursive:true,force:true});}
});
