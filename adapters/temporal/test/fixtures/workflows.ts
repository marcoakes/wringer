/** TEST BUNDLE ONLY. The production workflow, plus one with a clock the test
 * supplies, so identical recorded inputs can be compared byte for byte with the
 * local backend. A production worker registers src/workflows.ts, never this. */
import { graphWorkflow, type GraphWorkflowInput } from '../../src/graph-workflow';
export { decideUpdate, sendUpdate, statusQuery } from '../../src/graph-workflow';
export const containedGraph = graphWorkflow();
export async function containedGraphAtFixedTime(input: GraphWorkflowInput & { fixedAt: string }) {
    const { fixedAt, ...rest } = input;
    return graphWorkflow({ now: () => new Date(fixedAt) })(rest);
}
