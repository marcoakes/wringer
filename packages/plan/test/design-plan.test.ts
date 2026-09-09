import { expect, test } from "bun:test";
import { mkdtemp, readFile, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { createDesignSnapshot, hashDesignSnapshot } from "@wringer/design";
import { openReader } from "../../records/src/read";
import { compileExecutionPlan, compileDeclaration, canonicalPlanJson, validateExecutionPlan, createExecutionAuthority, validateExecutionAuthority, planningRequestFromPlan, validatePlanningRequest, compilePlanningRequest, compilePlanningProposal, createPlanningAuthority, validatePlanningAuthority, discoverEnvironment, hashValue, type PlanDeclaration } from "../src";

const original = compileExecutionPlan(await readFile(new URL("../examples/contained.yaml", import.meta.url), "utf8"), { format: "yaml" });
const clone = <T>(v: T): T => structuredClone(v);
function declaration(): PlanDeclaration {
    const { schema_version, intent_sha256, acceptance_sha256, plan_sha256, ...data } = clone(original);
    return { version: 2, ...data, intent: "Return the total as 5. The display matches the approved design.", agents: { ...data.agents, planner: data.agents.judge }, budget: { ...data.budget, max_planner_turns: 1 }, environment: { ...data.environment, writable_directories: ["node_modules", "preview"] }, acceptance: { ...data.acceptance, criteria: [...data.acceptance.criteria, { id: "design-fit", title: "The visual result matches the approved reference", quote: "The display matches the approved design.", kind: "human", required: true, show: { id: "show-design", argv: ["bun", "scripts/capture.ts"], cwd: ".", timeout_seconds: 30 } }], protected_paths: [...data.acceptance.protected_paths, "scripts/capture.ts"] }, design: { snapshotPath: "design/reference.json", snapshotSha256: "a".repeat(64), reviews: [{ criterionId: "design-fit", referenceIds: ["desktop"], captures: [{ id: "desktop-result", path: "preview/desktop.png", mimeType: "image/png", width: 1, height: 1 }] }] } };
}
const at = new Date("2026-09-09T00:00:00.000Z"), expiresAt = "2026-09-09T01:00:00.000Z";
function png() {
    const crc = (b: Buffer) => { let c = 0xffffffff; for (const byte of b) { c ^= byte; for (let i = 0; i < 8; i++) c = c >>> 1 ^ (c & 1 ? 0xedb88320 : 0); } return (c ^ 0xffffffff) >>> 0; };
    const chunk = (kind: string, data: Buffer) => { const v = Buffer.alloc(data.length + 12); v.writeUInt32BE(data.length); v.write(kind,4); data.copy(v,8); v.writeUInt32BE(crc(v.subarray(4,v.length-4)),v.length-4); return v; };
    const h = Buffer.alloc(13); h.writeUInt32BE(1); h.writeUInt32BE(1,4); h[8] = 8; h[9] = 6;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",h),chunk("IDAT",deflateSync(Buffer.from([0,255,0,0,255]))),chunk("IEND",Buffer.alloc(0))]).toString("base64");
}
function reference() { return createDesignSnapshot({ title: "Owned desktop fixture", disclosure: "repository-permitted", context: "Use the existing Button component, not an arbitrary replacement.", assets: [{ id: "desktop", title: "Approved desktop", pngBase64: png() }] }, at); }
async function git(repo: string, ...args: string[]) { const p = Bun.spawn(["git","-c","commit.gpgsign=false","-c","core.hooksPath=/dev/null",...args],{cwd:repo,stdout:"pipe",stderr:"pipe"}); const [out,err,code] = await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]); if(code) throw new Error(err); return out.trim(); }

test("legacy plans retain their v1 shape and acceptance-only digest", () => {
    expect(original.schema_version).toBe("wringer.execution-plan.v1"); expect(original).not.toHaveProperty("design"); expect(original.acceptance_sha256).toBe(hashValue(original.acceptance));
    const {schema_version,intent_sha256,acceptance_sha256,plan_sha256,...data}=original;
    const legacy=compileDeclaration({version:1,...data,agents:{...data.agents,planner:data.agents.judge},budget:{...data.budget,max_planner_turns:1}});
    const request=planningRequestFromPlan(legacy,legacy.intent);expect(request.schema_version).toBe("wringer.planning-request.v1");expect(request).not.toHaveProperty("design");
});
test("design v2 round-trips through YAML and literal TypeScript and protects its input", () => {
    const input = declaration(), plan = compileDeclaration(input);
    expect(plan.schema_version).toBe("wringer.execution-plan.v2"); expect(plan.acceptance.protected_paths).toContain(input.design!.snapshotPath); expect(plan.acceptance_sha256).toBe(hashValue({acceptance:plan.acceptance,design:plan.design}));
    expect(compileExecutionPlan(canonicalPlanJson(plan),{format:"yaml"})).toEqual(plan);
    expect(compileExecutionPlan(`import {definePlan} from '@wringer/plan'; export default definePlan(${JSON.stringify(input)});`,{format:"typescript"})).toEqual(plan);
    expect(Object.isFrozen(plan.design?.reviews)).toBe(true);
});
test("new design, execution and planning record schemas accept measured shapes while old v1 stays closed", async () => {
    const reader=await openReader(new URL("../../../schema",import.meta.url).pathname),plan=compileDeclaration(declaration()),request=planningRequestFromPlan(plan,plan.intent);
    expect((await reader.validate(reference(),"design-snapshot-v1.schema.json")).ok).toBe(true);
    expect((await reader.validate(plan,"execution-plan-v2.schema.json")).ok).toBe(true);
    expect((await reader.validate(request,"planning-request-v2.schema.json")).ok).toBe(true);
    expect((await reader.validate(plan,"execution-plan-v1.schema.json")).ok).toBe(false);
    expect((await reader.validate({...request,approved:true},"planning-request-v2.schema.json")).ok).toBe(false);
});
test("changing reference identity, requirements, dimensions or snapshot revokes existing authority", () => {
    const input = declaration(), plan = compileDeclaration(input), authority = createExecutionAuthority(plan,{actor:"Designer fixture",actions:["build","verify","judge"],expiresAt,at});
    for (const mutate of [(d:PlanDeclaration) => {d.design!.snapshotSha256="b".repeat(64);},(d:PlanDeclaration)=>{d.design!.reviews[0]!.referenceIds=["mobile"];},(d:PlanDeclaration)=>{d.design!.reviews[0]!.captures[0]!.width=2;}]) { const changed=clone(input); mutate(changed); const replacement=compileDeclaration(changed); expect(replacement.acceptance_sha256).not.toBe(plan.acceptance_sha256); expect(()=>validateExecutionAuthority(authority,replacement,at)).toThrow("different"); }
    const changed = clone(plan); changed.design!.snapshotSha256="c".repeat(64); expect(()=>validateExecutionPlan(changed)).toThrow("changed");
});
test("design policy refuses unsupported bytes, missing human display, unknown references and unsafe output paths", () => {
    for (const mutate of [(d:PlanDeclaration)=>{d.version=1;},(d:PlanDeclaration)=>{delete d.design;},(d:PlanDeclaration)=>{d.design!.reviews[0]!.criterionId="total";},(d:PlanDeclaration)=>{delete d.acceptance.criteria[1]!.show;},(d:PlanDeclaration)=>{d.design!.snapshotPath="preview/reference.json";},(d:PlanDeclaration)=>{d.environment.context.push(d.design!.snapshotPath);},(d:PlanDeclaration)=>{d.design!.reviews[0]!.captures[0]!.path="../outside.png";},(d:PlanDeclaration)=>{d.design!.reviews[0]!.captures[0]!.height=4097;},(d:PlanDeclaration)=>{d.design!.reviews[0]!.captures[0]!.width=4096;d.design!.reviews[0]!.captures[0]!.height=4096;},(d:PlanDeclaration)=>{(d.design!.reviews[0]!.captures[0] as any).mimeType="image/svg+xml";},(d:PlanDeclaration)=>{d.design!.reviews[0]!.referenceIds=[];}]) { const d=declaration();mutate(d);expect(()=>compileDeclaration(d)).toThrow(); }
});
test("planning v2 preserves design but never retains synthetic acceptance or grants execution", () => {
    const plan=compileDeclaration(declaration()),request=planningRequestFromPlan(plan,plan.intent),authority=createPlanningAuthority(request,{actor:"Designer",expiresAt,at});
    expect(request.schema_version).toBe("wringer.planning-request.v2"); expect(request).not.toHaveProperty("acceptance"); expect(JSON.stringify(request)).not.toContain("planning-show"); expect(request.design).toEqual(plan.design); expect(validatePlanningRequest(request)).toEqual(request); expect(authority.actions).toEqual(["plan"]);
    const proposal=compilePlanningProposal(request,plan.acceptance); expect(proposal).toEqual(plan);
    const {schema_version,request_sha256,...data}=request;expect(compilePlanningRequest({version:2,...data})).toEqual(request);
    const altered=clone(request);altered.design!.snapshotSha256="e".repeat(64);expect(()=>validatePlanningRequest(altered)).toThrow();
    const newRequest=compilePlanningRequest({version:2,...data,design:{...data.design,snapshotSha256:"f".repeat(64)}});expect(()=>validatePlanningAuthority(authority,newRequest,at)).toThrow("another");
    expect(()=>compilePlanningProposal(request,{...plan.acceptance,criteria:plan.acceptance.criteria.filter(c=>c.kind!=="human")})).toThrow("required human");
});
test("exact Git design snapshot is verified before environment is ready without copying image bytes into context", async () => {
    const repo=await mkdtemp(join(tmpdir(),"wringer-plan-design-"));
    try {
        await git(repo,"init","-q"); await git(repo,"config","user.name","Fixture");await git(repo,"config","user.email","fixture@example.invalid");
        for(const dir of ["design","tests","scripts"])await mkdir(join(repo,dir));
        for(const path of ["README.md","tests/acceptance.test.ts","scripts/capture.ts","package.json","bun.lock"])await writeFile(join(repo,path),path.endsWith(".json")?"{}\n":"Fixture\n");
        const snapshot=reference();await writeFile(join(repo,"design/reference.json"),JSON.stringify(snapshot));await git(repo,"add",".");await git(repo,"commit","-qm","pinned design fixture");
        const d=declaration();d.repository.commit=await git(repo,"rev-parse","HEAD");d.design!.snapshotSha256=snapshot.snapshot_sha256;
        const map=await discoverEnvironment(repo,compileDeclaration(d));expect(map.files.some(f=>f.path==="design/reference.json")).toBe(true);expect(map.context.some(c=>c.path==="design/reference.json")).toBe(false);expect(JSON.stringify(map.context)).not.toContain(snapshot.assets[0]!.base64);
        const bad=clone(d);bad.design!.snapshotSha256="f".repeat(64);await expect(discoverEnvironment(repo,compileDeclaration(bad))).rejects.toThrow("digest");
        const wrongRef=clone(d);wrongRef.design!.reviews[0]!.referenceIds=["absent"];await expect(discoverEnvironment(repo,compileDeclaration(wrongRef))).rejects.toThrow("absent");
        const privateRef={...snapshot,disclosure:"private" as const};privateRef.snapshot_sha256=hashDesignSnapshot(privateRef);await writeFile(join(repo,"design/reference.json"),JSON.stringify(privateRef));await git(repo,"add",".");await git(repo,"commit","-qm","private reference");d.repository.commit=await git(repo,"rev-parse","HEAD");d.design!.snapshotSha256=privateRef.snapshot_sha256;await expect(discoverEnvironment(repo,compileDeclaration(d))).rejects.toThrow("private");
        await rm(join(repo,"design/reference.json"));await symlink("../README.md",join(repo,"design/reference.json"));await git(repo,"add",".");await git(repo,"commit","-qm","symlink reference");d.repository.commit=await git(repo,"rev-parse","HEAD");await expect(discoverEnvironment(repo,compileDeclaration(d))).rejects.toThrow("regular");
    }finally{await rm(repo,{recursive:true,force:true});}
});
