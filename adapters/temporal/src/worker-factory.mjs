// One graph worker: the bundled kernel workflow plus the activities of this host.
// The workflow sandbox has no node:crypto; the bundle substitutes a pure SHA-256
// for it, which test/sandbox-crypto.test.mjs compares with node:crypto.
import { fileURLToPath } from 'node:url';
import { bundleWorkflowCode, Worker } from '@temporalio/worker';
import webpack from 'webpack';
import { graphActivities } from './activities.mjs';

const shim = fileURLToPath(new URL('./sandbox-crypto.js', import.meta.url)), packages = fileURLToPath(new URL('../../../packages/', import.meta.url));
export const PRODUCTION_WORKFLOWS = fileURLToPath(new URL('./workflows.ts', import.meta.url));
/** The sandbox-safe entry points of Wringer's packages, which have no host imports. */
const ALIASES = { '@wringer/scheduler/kernel': 'scheduler/src/contained-kernel.ts', '@wringer/plan/graph-shape': 'plan/src/graph-shape.ts', '@wringer/records/canonical': 'records/src/canonical.ts' };
export function bundlerOptions() {
    const alias = Object.fromEntries(Object.entries(ALIASES).map(([name, path]) => [name, packages + path]));
    // webpack reads node: URIs before aliases apply, so the digest's import is replaced
    // outright. Temporal's disallowed-module check reads the import as written, so
    // `crypto` is listed as ignored: what runs is the deterministic shim, never Node's.
    const crypto = new webpack.NormalModuleReplacementPlugin(/^node:crypto$/, resource => { resource.request = shim; });
    return { ignoreModules: ['crypto'], webpackConfigHook: config => ({ ...config, plugins: [...(config.plugins ?? []), crypto], resolve: { ...config.resolve, alias: { ...(config.resolve?.alias ?? {}), ...alias } } }) };
}
export async function graphBundle(workflowsPath = PRODUCTION_WORKFLOWS) {
    return bundleWorkflowCode({ workflowsPath, ...bundlerOptions(), logger: quiet });
}
const quiet = { log() {}, trace() {}, debug() {}, info() {}, warn(message, meta) { console.warn(message, meta ?? ''); }, error(message, meta) { console.error(message, meta ?? ''); } };
export async function createGraphWorker({ connection, namespace = 'default', taskQueue, effects, workflowBundle, workflowsPath }) {
    return Worker.create({ connection, namespace, taskQueue, workflowBundle: workflowBundle ?? await graphBundle(workflowsPath), activities: graphActivities(effects) });
}
