import { expect, spyOn, test } from "bun:test";
import * as improvements from "../../application/src/improvements";
import { improvementCollections } from "../src/improvement-collections";
test("explicit collection has one dispatch, observes abort and rejects admission while stopping", async () => {
    let stopped = false, dispatched = 0, aborted = false;
    const spy = spyOn(improvements, "prepareImprovementTest").mockImplementation(async () => ({ experimentId: "fixture", reservationKey: "a".repeat(64), run: async (signal?: AbortSignal) => {
        dispatched++; await new Promise<void>(resolve => signal!.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true })); return {} as any;
    } }));
    const manager = improvementCollections(() => { if (stopped) throw new Error("Owner stopping"); });
    try {
        await manager.collect("/fixture", {} as any, {} as any);
        await expect(manager.collect("/fixture", {} as any, {} as any)).rejects.toThrow("already dispatched");
        expect(dispatched).toBe(1); expect(manager.messages("/other")).toEqual({}); expect(manager.messages("/fixture").fixture).toContain("running");
        stopped = true; await manager.stop(); expect(aborted).toBeTrue();
        await expect(manager.collect("/fixture", {} as any, {} as any)).rejects.toThrow("stopping"); expect(dispatched).toBe(1);
    } finally { stopped = true; await manager.stop(); spy.mockRestore(); }
});
test("a collection prepared concurrently with shutdown is never dispatched and failure messages contain no private prose", async () => {
    let stopped = false, dispatched = 0;
    const spy = spyOn(improvements, "prepareImprovementTest").mockImplementation(async () => {
        stopped = true;
        return { experimentId: "fixture", reservationKey: "b".repeat(64), run: async () => { dispatched++; throw new Error("PRIVATE_PATH_AND_KEY"); } };
    });
    try {
        const manager = improvementCollections(() => { if (stopped) throw new Error("Owner stopping"); });
        await expect(manager.collect("/fixture", {} as any, {} as any)).rejects.toThrow("stopping"); expect(dispatched).toBe(0); await manager.stop();
        const running = improvementCollections(() => {}); await running.collect("/fixture", {} as any, {} as any); await running.stop();
        expect(dispatched).toBe(1); expect(JSON.stringify(running.messages("/fixture"))).not.toContain("PRIVATE_PATH_AND_KEY");
    } finally { spy.mockRestore(); }
});
