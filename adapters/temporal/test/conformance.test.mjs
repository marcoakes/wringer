// The same captured observations through both backends. With the local run's fixed
// clock, the Temporal backend must write byte-identical event files. On Temporal's
// own clock, every decision, reservation and outcome must match; only times and the
// digests that bind them differ, and they are compared by position, not erased.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphWorker, graphBundle } from '../src/worker-factory.mjs';
import { recordedEffects } from './fixtures/recorded-effects.mjs';
import { drive, eventFiles, fixtureWorkflows, prepare, replay, startServer, workflowInput } from './harness.mjs';

let server, bundle;
before(async () => { server = await startServer(); bundle = await graphBundle(fixtureWorkflows); });
after(async () => { await server?.stop(); });

async function run(scenario, workflowType) {
    const fixture = prepare(scenario), taskQueue = `conformance-${scenario}-${workflowType}`;
    const worker = await createGraphWorker({ connection: server.native, taskQueue, workflowBundle: bundle, effects: recordedEffects({ captured: fixture.captured, ledger: fixture.ledger }) });
    const input = workflowInput(fixture.temporal, { reconcileSeconds: 1 });
    const result = await worker.runUntil(async () => {
        const handle = await server.client.workflow.start(workflowType, { taskQueue, workflowId: `${taskQueue}-${Date.now()}`, args: [workflowType === 'containedGraphAtFixedTime' ? { ...input, fixedAt: fixture.at } : input] });
        await drive(handle, fixture.captured.actions);
        return handle.result();
    });
    return { fixture, result };
}
/** Each chain's own digests become positions; times are dropped. What remains is every decision. */
function decisions(files) {
    const events = files.map(text => JSON.parse(text)), positions = new Map(events.map((event, index) => [event.sha256, `#${index}`]));
    const walk = value => typeof value === 'string' ? positions.get(value) ?? value : Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['at', 'sha256', 'previousSha256'].includes(key)).map(([key, item]) => [key, walk(item)])) : value;
    return events.map(walk);
}

for (const scenario of ['serial', 'parallel', 'tournament', 'delegate', 'rejected', 'check-fails']) {
    test(`${scenario}: identical recorded inputs and clock give byte-identical records on both backends`, async () => {
        const { fixture, result } = await run(scenario, 'containedGraphAtFixedTime');
        assert.equal(result.phase, fixture.captured.phase);
        const temporal = eventFiles(fixture.temporal), local = eventFiles(fixture.local);
        assert.equal(temporal.length, fixture.captured.events);
        assert.deepEqual(temporal, local);
        assert.equal(replay(fixture.temporal).phase, fixture.captured.phase);
    });
}
for (const scenario of ['serial', 'tournament']) {
    test(`${scenario}: on Temporal's clock every decision, reservation and outcome matches the local backend`, async () => {
        const { fixture, result } = await run(scenario, 'containedGraph');
        assert.equal(result.phase, fixture.captured.phase);
        const temporal = eventFiles(fixture.temporal), local = eventFiles(fixture.local);
        assert.notDeepEqual(temporal, local, 'live times must differ from the fixed-clock run');
        assert.deepEqual(decisions(temporal), decisions(local));
        assert.equal(replay(fixture.temporal).phase, fixture.captured.phase);
    });
}
