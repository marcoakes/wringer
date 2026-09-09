import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compileDeclaration, compileExecutionPlan, type PlanDeclaration } from "@wringer/plan";
import { createDesignSnapshot, importDesignFromFigmaRest, inspectPng, type DesignSnapshot } from "@wringer/design";
import { referenceImages } from "../../workflow/src/display-visuals";
import { openReader } from "../../records/src/read";
import { experimentSchedule, readExperiment, recordExperimentReview, registerExperiment } from "../src/experiments";
import { stampExperimentResearchDisplay } from "../src/experiment-collect";
import { exclusiveJson, stamped } from "../src/experiment-store";
import type { ExperimentResearchDisplay, ExperimentTrial } from "../src/experiment-types";
import { unitPng } from "../../runtime/test/fixtures/png";

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const original=compileExecutionPlan(await readFile(new URL("../../plan/examples/contained.yaml",import.meta.url),"utf8"),{format:"yaml"});
const schemaDirectory=new URL("../../../schema",import.meta.url).pathname;
const reader=await openReader(schemaDirectory);
async function restReference(){return importDesignFromFigmaRest({urls:["https://www.figma.com/design/ResearchFixture123/Reports?node-id=1-2"],token:"research-fixture-only-not-real-token",disclosure:"repository-permitted",title:"Synthetic REST research reference"},{testTransport:async request=>{
    const url=new URL(request.url),body=url.pathname.endsWith("/nodes")?{version:"research-fixture-v42",nodes:{"1:2":{document:{id:"1:2",type:"FRAME",name:"Synthetic frame"}}}}:{images:{"1:2":"https://s3-alpha.figma.com/images/synthetic-reference"}};
    return url.hostname==="api.figma.com"?{status:200,headers:{"content-type":"application/json"},body:Buffer.from(JSON.stringify(body))}:{status:200,headers:{"content-type":"image/png"},body:Buffer.from(unitPng(),"base64")};
}});}
const ownedReference=()=>createDesignSnapshot({title:"Owned research fixture",context:"Synthetic reference only, not a human observation.",disclosure:"repository-permitted",assets:[{id:"desktop",title:"Unit pixel",pngBase64:unitPng()}]});
async function fixture(snapshot:DesignSnapshot|null){
    const root=await realpath(await mkdtemp(join(tmpdir(),"wringer-research-display-version-")));roots.push(root);
    const {schema_version,plan_sha256,intent_sha256,acceptance_sha256,...base}=original;
    const declaration:PlanDeclaration={...base,version:3,intent:base.intent+" The display is readable.",environment:{...base.environment,setup:[],writable_directories:["preview"]},acceptance:{...base.acceptance,criteria:[...base.acceptance.criteria,{id:"readable",title:"Readable reference",quote:"The display is readable.",kind:"human",required:true,show:{id:"show-reference",argv:["true"],cwd:".",timeout_seconds:5}}],protected_paths:[...base.acceptance.protected_paths,"wringer/playbook.json"]},...(snapshot?{design:{snapshotPath:"design/reference.json",snapshotSha256:snapshot.snapshot_sha256,reviews:[{criterionId:"readable",referenceIds:snapshot.assets.map(asset=>asset.id),captures:[{id:"candidate",path:"preview/candidate.png",mimeType:"image/png",width:1,height:1}]}]}}:{})};
    const baseline=compileDeclaration(declaration),candidate=compileDeclaration({...declaration,playbook:{path:"wringer/playbook.json",sha256:"a".repeat(64),taskFamily:"reports"}});
    const registration=await registerExperiment(root,{id:"design-display-fixture",repository:baseline.repository.url,taskFamily:"reports",baselinePlaybook:null,candidatePlaybook:"a".repeat(64),changedVariable:"worker-playbook",tasks:[{id:"reports",sourceTree:"b".repeat(40),split:"held-out",baseline,candidate}],repetitions:1,order:"alternating-pairs",stratum:{platform:"darwin",modelSelection:"scripted",adapterSelection:"scripted"},prediction:{statement:"Synthetic record compatibility only; not an efficacy claim.",metric:"worker-attempts",minimumImprovement:1,minimumHeldOutPairs:4,maximumSignProbability:0.05,visualQualityClaim:false},limits:{maxTrials:2,maxRoleSessions:16,wallClockSeconds:600},dataScope:"this-repository-only",holdout:{corpusId:"fixture-only",candidateIteration:1,maximumCandidateIterations:1,candidateAuthorSawHeldOutSolutions:false},accounting:"all-planned-trials-including-failures",stoppingRule:"fixed-sample-no-extension"});
    const slot=experimentSchedule(registration.plan).find(slot=>slot.arm==="baseline")!,at=new Date().toISOString(),commit="c".repeat(40),tree="d".repeat(40);
    const trial:ExperimentTrial=stamped({schema_version:"wringer.experiment-trial.v1",experimentSha256:registration.plan.sha256,registrationSha256:registration.sha256,slot,startedAt:at,finishedAt:at,evidenceKind:"deterministic-fixture",outcome:"human-hold",workerAttempts:1,roleSessions:2,functionalCompletion:true,requirements:baseline.acceptance.criteria.map(criterion=>({id:criterion.id,kind:criterion.kind,met:criterion.kind==="check"?true:null})),safety:{authority:"unknown",acceptance:"unknown",containment:"unknown",secrets:"unknown",handoverAudit:"unknown",productionPublication:"not-attempted"},safetyEvidence:{authority:null,acceptance:null,containment:null,secrets:null,handoverAudit:null},candidateCommit:commit,candidateTree:tree,journeyRevision:null,runtimeIds:[],agentIdentitySha256:null,stopReason:"Scripted research fixture awaits an observer; no human or containment measured.",cost:null});
    const capture={id:"candidate",path:"preview/candidate.png",mimeType:"image/png" as const,base64:unitPng(55),...inspectPng(unitPng(55))};
    const display=stampExperimentResearchDisplay({experimentSha256:registration.plan.sha256,trialSha256:trial.sha256,candidateCommit:commit,candidateTree:tree,snapshot,displays:[{criterionId:"readable",success:true,measured:{provenance:{schema_version:"wringer.runtime.v1",runtimeId:"scripted-verifier",role:"verifier",kind:baseline.runtime.kind,image:baseline.runtime.image,repository:{url:baseline.repository.url,commit},clonedInside:true,hostMounts:[],repositoryAccess:"read-only",declared:baseline.runtime,observed:{fixture:true},limits:["Synthetic observation; not live containment."]},results:[{id:"show-reference",code:0,stdout:"Scripted display only.",stderr:"",durationMs:1}],sourceChanged:false,sourceTree:tree,...(snapshot?{artifacts:[capture]}:{})},...(snapshot?{visuals:{snapshotSha256:snapshot.snapshot_sha256,referenceAssets:referenceImages(baseline,"readable",snapshot),captures:[capture]}}:{})}]});
    await exclusiveJson(root,`trials/${slot.id}.json`,trial);await exclusiveJson(root,`displays/${slot.id}.json`,display);
    return {root,registration,trial,display,path:join(root,"displays",`${slot.id}.json`)};
}
function restamp(value:ExperimentResearchDisplay,change:Record<string,unknown>){const {sha256,...body}={...value,...change};return stamped(body);}

test("collector display writer selects v2 only for REST snapshots and both readers preserve the exact reference",async()=>{
    const snapshot=await restReference(),f=await fixture(snapshot);
    expect(f.display.schema_version).toBe("wringer.experiment-research-display.v2");expect(f.display.snapshot).toEqual(snapshot);
    expect((await reader.validate(f.display,"experiment-research-display-v2.schema.json")).ok).toBe(true);expect((await reader.validate(f.display,"experiment-research-display-v1.schema.json")).ok).toBe(false);
    const reopened=await readExperiment(f.root);expect(reopened.displays).toEqual([f.display]);expect(reopened.trials[0]!.evidenceKind).toBe("deterministic-fixture");expect(reopened.reviews).toEqual([]);
});
test("v1/null and v1/owned displays retain their original contract and remain readable",async()=>{
    for(const snapshot of [null,ownedReference()]){const f=await fixture(snapshot);expect(f.display.schema_version).toBe("wringer.experiment-research-display.v1");expect((await reader.validate(f.display,"experiment-research-display-v1.schema.json")).ok).toBe(true);expect((await reader.validate(f.display,"experiment-research-display-v2.schema.json")).ok).toBe(false);expect((await readExperiment(f.root)).displays).toEqual([f.display]);}
});
test("rehashed cross-version relabeling is refused by both schema and application readers",async()=>{
    for(const snapshot of [await restReference(),ownedReference(),null]){const f=await fixture(snapshot),version=snapshot?.schema_version==="wringer.design-snapshot.v2"?"wringer.experiment-research-display.v1":"wringer.experiment-research-display.v2",changed=restamp(f.display,{schema_version:version});await writeFile(f.path,JSON.stringify(changed));expect((await reader.validate(changed,version.endsWith("v1")?"experiment-research-display-v1.schema.json":"experiment-research-display-v2.schema.json")).ok).toBe(false);await expect(readExperiment(f.root)).rejects.toThrow("version");}
});
test("v2 display does not loosen source/PNG bindings or allow unknown authority fields",async()=>{
    const f=await fixture(await restReference());
    const changedVisuals=structuredClone(f.display.displays);changedVisuals[0]!.visuals!.captures[0]!.sha256="f".repeat(64);
    for(const change of [{candidateTree:"e".repeat(40)},{displays:changedVisuals},{approved:true},{schema_version:"wringer.experiment-research-display.v99"},{snapshot:null}]){await writeFile(f.path,JSON.stringify(restamp(f.display,change)));await expect(readExperiment(f.root)).rejects.toThrow();}
});
test("v2 research review binds its display digest and remains fixture-only without production authority",async()=>{
    const f=await fixture(await restReference());
    const request={experimentSha256:f.registration.plan.sha256,trialSha256:f.trial.sha256,candidateTree:f.trial.candidateTree!,actor:"SCRIPTED research observer",independent:true,blinded:true,kind:"deterministic-fixture" as const,criteria:[{id:"readable",met:true,note:"Fixture-only display review; no real human or visual quality claim."}],displayReceiptSha256:f.display.sha256};
    await expect(recordExperimentReview(f.root,{...request,displayReceiptSha256:"0".repeat(64)})).rejects.toThrow("actual retained");
    const review=await recordExperimentReview(f.root,request);expect(review.noProductionAuthority).toBe(true);expect(review.kind).toBe("deterministic-fixture");expect(review.displayReceiptSha256).toBe(f.display.sha256);expect((await readExperiment(f.root)).reviews).toEqual([review]);
});
