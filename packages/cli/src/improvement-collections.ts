import { prepareImprovementTest } from "@wringer/application";
import type { ExecutionPlan } from "@wringer/plan";
/** One local owner supervises explicit collections. Durable collector reservations
 * remain authoritative across restart; stopping never implies unpaid work. */
export function improvementCollections(assertAccepting: () => void) {
    const rows = new Map<string, { experimentId: string; root: string; abort: AbortController; work: Promise<unknown>; message: string }>();
    return {
        messages(root: string) { return Object.fromEntries([...rows.values()].filter(row => row.root === root).map(row => [row.experimentId, row.message])); },
        async collect(root: string, profile: ExecutionPlan, input: Parameters<typeof prepareImprovementTest>[2]) {
            assertAccepting(); const prepared = await prepareImprovementTest(root, profile, input); assertAccepting();
            if (rows.has(prepared.reservationKey)) throw new Error("This comparison was already dispatched. Refresh its retained result; it is never automatically replayed");
            const row = { experimentId: prepared.experimentId, root, abort: new AbortController(), work: Promise.resolve() as Promise<unknown>, message: "Comparison is running within its separate finite allowance." };
            rows.set(prepared.reservationKey, row);
            row.work = prepared.run(row.abort.signal).then(() => { row.message = "Comparison stopped. Review all retained outcomes before adoption."; }, () => { row.message = "Comparison stopped or refused. Inspect the retained evidence and reservations. No paid work was replayed."; });
            return { outcome: "accepted", experimentId: row.experimentId, note: "Separate comparison accepted. Current jobs and production approvals are unchanged." };
        },
        async stop() { for (const row of rows.values()) row.abort.abort(); await Promise.all([...rows.values()].map(row => row.work)); }
    };
}
