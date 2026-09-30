/** The workflows a production worker registers: the contained graph on Temporal's clock. */
import { graphWorkflow } from './graph-workflow';
export { decideUpdate, sendUpdate, statusQuery, WORKFLOW_REVISION } from './graph-workflow';
export const containedGraph = graphWorkflow();
