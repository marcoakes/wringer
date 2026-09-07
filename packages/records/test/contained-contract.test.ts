import { test, expect } from "bun:test";
import { openReader } from "../src/read";
const root = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
test("contained view contract preserves explicit unknowns and rejects extra or invented facts", async () => {
    const reader = await openReader(`${root}/schema`), path = `${root}/schema/fixtures/contained-delivery-view-v1.json`;
    expect((await reader.read(path)).ok).toBe(true);
    const value = await Bun.file(path).json();
    for (const change of [(v: any) => { v.usage.costUsd = 0; }, (v: any) => { v.status = "delivered"; }, (v: any) => { v.source.codeCommit = "HEAD"; }, (v: any) => { v.criteria[0].state = "probably-met"; }, (v: any) => { v.approved = true; }]) {
        const wrong = structuredClone(value); change(wrong); expect((await reader.validate(wrong, "contained-delivery-view-v1.schema.json")).ok).toBe(false);
    }
});
test("forge v2 published outcomes require open state and exact repository/commit identity", async () => {
    const reader = await openReader(`${root}/schema`), value = {schema_version:"wringer.forge-publication.v2",status:"published",state_directory:"/controller/publication",request_sha256:"a".repeat(64),next_move:"wringer-drive status --state /controller",url:"https://github.com/owner/repo/pull/1",number:1,hosted_state:"open",head_commit:"b".repeat(40),repository:"github.com/owner/repo"};
    expect((await reader.validate(value, "forge-publication-v2.schema.json")).ok).toBe(true);
    expect((await reader.validate({...value,hosted_state:"closed"}, "forge-publication-v2.schema.json")).ok).toBe(false);
    const absent = {...value} as any; delete absent.head_commit;
    expect((await reader.validate(absent, "forge-publication-v2.schema.json")).ok).toBe(false);
});
