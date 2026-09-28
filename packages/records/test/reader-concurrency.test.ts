import { test, expect } from "bun:test";
import { fileURLToPath } from "node:url";
import { openReader } from "../src/read";
test("simultaneous first reads share one schema compilation without hiding invalid records", async () => {
    const reader = await openReader(fileURLToPath(new URL("../../../schema", import.meta.url)));
    const results = await Promise.allSettled(Array.from({ length: 16 }, () => reader.validate({}, "judgements-v2.schema.json")));
    expect(results.filter(row => row.status === "rejected")).toEqual([]);
    expect(results.every(row => row.status === "fulfilled" && !row.value.ok && row.value.reason === "does-not-satisfy-what-it-declares")).toBe(true);
    expect(reader.check({}, "judgements-v2.schema.json").ok).toBe(false);
});
