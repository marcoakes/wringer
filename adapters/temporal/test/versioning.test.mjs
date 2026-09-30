// Workflow code versions and retained histories. Committed histories recorded from
// this code must replay; a change to the workflow's commands must be caught by replay
// unless it is guarded by patched(), and a guarded change must continue an open
// workflow. A history the local backend started continues on Temporal unchanged, and
// continue-as-new carries the history into a new run.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from '@temporalio/worker';
import { createGraphWorker, graphBundle } from '../src/worker-factory.mjs';
import { recordedEffects } from './fixtures/recorded-effects.mjs';
import { drive, eventFiles, fixtureWorkflows, prepare, replay, repo, scenarioScript, startServer, waitFor, workflowInput } from './harness.mjs';

const histories = fileURLToPath(new URL('./histories/', import.meta.url)), generated = fileURLToPath(new URL('./.generated/', import.meta.url));
const source = readFileSync(fileURLToPath(new URL('../src/graph-workflow.ts', import.meta.url)), 'utf8');
/** A later revision of the workflow: one more activity after each advance. */
function variant(name, insertion) {
    const directory = join(generated, name), anchor = '            const state = last;\n';
    assert.equal(source.split(anchor).length, 2, 'the variant anchor must be unique');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'graph-workflow.ts'), source.replace("import { ActivityFailure,", "import { patched, ActivityFailure,").replace(anchor, anchor + insertion));
    writeFileSync(join(directory, 'workflows.ts'), "import { graphWorkflow } from './graph-workflow';\nexport const containedGraph = graphWorkflow();\n");
    return join(directory, 'workflows.ts');
}
const retained = () => readdirSync(histories).filter(name => name.endsWith('.json')).map(name => [name, JSON.parse(readFileSync(join(histories, name), 'utf8'))]);
function decisions(files) {
    const events = files.map(text => JSON.parse(text)), positions = new Map(events.map((event, index) => [event.sha256, `#${index}`]));
    const walk = value => typeof value === 'string' ? positions.get(value) ?? value : Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['at', 'sha256', 'previousSha256'].includes(key)).map(([key, item]) => [key, walk(item)])) : value;
    return events.map(walk);
}

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });

test('every retained history replays against the current workflow code', async () => {
    const bundle = await graphBundle(), rows = retained();
    assert.ok(rows.length >= 3);
    for (const [name, history] of rows) await assert.doesNotReject(Worker.runReplayHistory({ workflowBundle: bundle }, history), name);
});
test('an unguarded change to the workflow commands is caught by replay; the same change under patched() is not', async () => {
    const unguarded = await graphBundle(variant('unguarded', '            await safe.screen({ entries: [] });\n'));
    const guarded = await graphBundle(variant('guarded', "            if (patched('wringer-graph-upgrade-example')) await safe.screen({ entries: [] });\n"));
    for (const [name, history] of retained()) {
        await assert.rejects(Worker.runReplayHistory({ workflowBundle: unguarded }, history), error => /Nondeterminism|DeterminismViolation/i.test(`${error.name} ${error.message} ${error.cause?.message ?? ''}`), name);
        await assert.doesNotReject(Worker.runReplayHistory({ workflowBundle: guarded }, history), name);
    }
});
test('a workflow held at a decision continues on upgraded, patched workflow code', async () => {
    const fixture = prepare('serial'), taskQueue = 'upgrade', effects = () => recordedEffects({ captured: fixture.captured, ledger: fixture.ledger });
    const handle = await server.client.workflow.start('containedGraph', { taskQueue, workflowId: `upgrade-${Date.now()}`, args: [workflowInput(fixture.temporal, { reconcileSeconds: 1 })] });
    const before = await createGraphWorker({ connection: server.native, taskQueue, effects: effects() });
    await before.runUntil(async () => {
        await drive(handle, fixture.captured.actions, { stopAfter: 1 });
        await waitFor(async () => { const summary = await handle.query('status'); return summary?.holds.some(row => row.node === 'review'); }, { label: 'the review hold' });
    });
    const after = await createGraphWorker({ connection: server.native, taskQueue, effects: effects(), workflowsPath: variant('upgrade-live', "            if (patched('wringer-graph-upgrade-example')) await safe.screen({ entries: [] });\n") });
    await after.runUntil(async () => { assert.equal((await drive(handle, fixture.captured.actions.slice(1))).status, 'COMPLETED'); });
    assert.equal((await handle.result()).phase, 'complete');
    assert.deepEqual(decisions(eventFiles(fixture.temporal)), decisions(eventFiles(fixture.local)));
});
test('a history the local backend advanced to a hold continues on Temporal, byte-identical to a local run', async () => {
    for (const scenario of ['serial', 'tournament']) {
        const fixture = prepare(scenario), taskQueue = `handoff-${scenario}`;
        const local = spawnSync('bun', [scenarioScript, 'local-until', scenario, fixture.temporal, fixture.at, '1'], { cwd: repo, encoding: 'utf8' });
        assert.equal(local.status, 0, local.stderr);
        assert.ok(['human-hold', 'send-hold'].includes(JSON.parse(local.stdout).phase), local.stdout);
        const worker = await createGraphWorker({ connection: server.native, taskQueue, workflowBundle: await graphBundle(fixtureWorkflows), effects: recordedEffects({ captured: fixture.captured, ledger: fixture.ledger }) });
        await worker.runUntil(async () => {
            const handle = await server.client.workflow.start('containedGraphAtFixedTime', { taskQueue, workflowId: `${taskQueue}-${Date.now()}`, args: [{ ...workflowInput(fixture.temporal, { reconcileSeconds: 1 }), fixedAt: fixture.at }] });
            assert.equal((await drive(handle, fixture.captured.actions.slice(1))).status, 'COMPLETED');
        });
        assert.deepEqual(eventFiles(fixture.temporal), eventFiles(fixture.local), scenario);
    }
});
test('continue-as-new carries the retained history into a new run without repeating work', async () => {
    // A service that suggests continue-as-new after 60 history events, so a small graph crosses runs.
    const small = await startServer(['--dynamic-config-value', 'limit.historyCount.suggestContinueAsNew=60']);
    const fixture = prepare('parallel'), taskQueue = 'continue-as-new', workflowId = `continue-as-new-${Date.now()}`, runs = [];
    try {
        const worker = await createGraphWorker({ connection: small.native, taskQueue, effects: recordedEffects({ captured: fixture.captured, ledger: fixture.ledger }) });
        await worker.runUntil(async () => {
            await small.client.workflow.start('containedGraph', { taskQueue, workflowId, args: [workflowInput(fixture.temporal, { reconcileSeconds: 1 })] });
            await drive(small.client.workflow.getHandle(workflowId), fixture.captured.actions, { timeoutMs: 120000 });
            assert.equal((await small.client.workflow.getHandle(workflowId).result()).phase, 'complete');
        });
        await waitFor(async () => { runs.length = 0; for await (const row of small.client.workflow.list({ query: `WorkflowId = '${workflowId}'` })) runs.push(row.status.name); return runs.includes('COMPLETED'); }, { label: 'the run listing' });
    } finally { await small.stop(); }
    assert.ok(runs.includes('CONTINUED_AS_NEW'), `runs: ${runs.join(', ')}`);
    for (const line of ['start dispatch build-a', 'start dispatch build-b', 'start dispatch merge']) assert.equal(readFileSync(fixture.ledger, 'utf8').split('\n').filter(row => row === line).length, 1, line);
    assert.deepEqual(decisions(eventFiles(fixture.temporal)), decisions(eventFiles(fixture.local)));
    assert.equal(replay(fixture.temporal).phase, 'complete');
});
