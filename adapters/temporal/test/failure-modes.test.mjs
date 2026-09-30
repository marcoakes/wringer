// The release gate's failure modes on a local Temporal service: worker loss,
// duplicate delivery, timeout, cancellation, holds, credentials, a second controller
// and a refused preflight through the real CLI. Effects answer from observations the
// local backend captured; a shared ledger counts every effect across processes.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { WorkflowFailedError } from '@temporalio/client';
import { count } from './fixtures/recorded-effects.mjs';
import { drive, eventFiles, prepare, replay, repo, scenarioScript, spawnWorker, startServer, waitFor, workflowInput } from './harness.mjs';

let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });
const settings = { reconcileSeconds: 1, heartbeatSeconds: 5 };
const start = (taskQueue, fixture, extra = settings) => server.client.workflow.start('containedGraph', { taskQueue, workflowId: `${taskQueue}-${Date.now()}`, args: [workflowInput(fixture.temporal, extra)] });
const status = handle => handle.query('status');
/** An update refusal carries its reason in its cause. */
const refused = (promise, pattern) => assert.rejects(promise, error => pattern.test(`${error.message} ${error.cause?.message ?? ''}`));
/** A workflow's end within a bound: a guard that stopped working must fail, not hang. */
const ended = (handle, milliseconds = 30000) => Promise.race([handle.result(), new Promise((_, reject) => setTimeout(() => reject(new Error('the workflow did not end')), milliseconds))]);
/** Decisions only: each chain's digests as positions, without times. */
function decisions(files) {
    const events = files.map(text => JSON.parse(text)), positions = new Map(events.map((event, index) => [event.sha256, `#${index}`]));
    const walk = value => typeof value === 'string' ? positions.get(value) ?? value : Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !['at', 'sha256', 'previousSha256'].includes(key)).map(([key, item]) => [key, walk(item)])) : value;
    return events.map(walk);
}

test('worker loss during a dispatch: never dispatched again; the late outcome is observed', async () => {
    const fixture = prepare('serial'), taskQueue = 'worker-loss';
    const first = spawnWorker({ address: server.address, taskQueue, fixture, behaviour: { slow: { 'dispatch build': 120000 } } });
    await first.ready;
    const handle = await start(taskQueue, fixture);
    await drive(handle, fixture.captured.actions, { stopAfter: 1 });
    await waitFor(() => count(fixture.ledger, 'start dispatch build') === 1, { label: 'the dispatch to start' });
    await first.kill();
    const second = spawnWorker({ address: server.address, taskQueue, fixture });
    await second.ready;
    try {
        const uncertain = await waitFor(async () => { const summary = await status(handle); return summary?.phase === 'uncertain' && summary; }, { label: 'the lost dispatch to be uncertain' });
        assert.match(uncertain.lastEffectFailure, /dispatch/);
        await new Promise(resolve => setTimeout(resolve, 3000));
        assert.equal(count(fixture.ledger, 'start dispatch build'), 1, 'a lost dispatch is never started again');
        // The effect finishes on its own, as a contained child would; the workflow observes it.
        appendFileSync(fixture.ledger, 'end dispatch build\n');
        const outcome = await drive(handle, fixture.captured.actions.slice(1));
        assert.equal(outcome.status, 'COMPLETED');
        assert.equal((await handle.result()).phase, 'complete');
        assert.equal(count(fixture.ledger, 'start dispatch build'), 1);
        assert.deepEqual(decisions(eventFiles(fixture.temporal)), decisions(eventFiles(fixture.local)));
        assert.equal(replay(fixture.temporal).phase, 'complete');
    } finally { await second.kill(); }
});

test('timeout: a dispatch that stops heartbeating is timed out, never retried, and its late outcome is observed', async () => {
    const fixture = prepare('serial'), taskQueue = 'silent-timeout';
    const worker = spawnWorker({ address: server.address, taskQueue, fixture, behaviour: { slow: { 'dispatch build': 9000 }, silent: true } });
    await worker.ready;
    try {
        const handle = await start(taskQueue, fixture);
        await drive(handle, fixture.captured.actions, { stopAfter: 1 });
        const uncertain = await waitFor(async () => { const summary = await status(handle); return summary?.phase === 'uncertain' && summary; }, { label: 'the timed-out dispatch to be uncertain' });
        assert.match(uncertain.lastEffectFailure, /dispatch/i);
        const outcome = await drive(handle, fixture.captured.actions.slice(1));
        assert.equal(outcome.status, 'COMPLETED');
        assert.equal(count(fixture.ledger, 'start dispatch build'), 1);
        assert.equal(count(fixture.ledger, 'end dispatch build'), 1);
        assert.deepEqual(decisions(eventFiles(fixture.temporal)), decisions(eventFiles(fixture.local)));
    } finally { await worker.kill(); }
});

test('cancellation stops the effect and leaves it uncertain; a new workflow from the directory only observes', async () => {
    const fixture = prepare('serial'), taskQueue = 'cancellation';
    const worker = spawnWorker({ address: server.address, taskQueue, fixture, behaviour: { slow: { 'dispatch build': 120000 } } });
    await worker.ready;
    try {
        const handle = await start(taskQueue, fixture);
        await drive(handle, fixture.captured.actions, { stopAfter: 1 });
        await waitFor(() => count(fixture.ledger, 'start dispatch build') === 1, { label: 'the dispatch to start' });
        await handle.cancel();
        await assert.rejects(handle.result(), error => error instanceof WorkflowFailedError);
        await waitFor(() => count(fixture.ledger, 'cancelled dispatch build') === 1, { label: 'the effect to see the cancellation' });
        const retained = replay(fixture.temporal);
        assert.deepEqual(retained.uncertain, ['build']);
    } finally { await worker.kill(); }
    // A fresh workflow continues the same directory: it observes and never dispatches again.
    const resumed = spawnWorker({ address: server.address, taskQueue: 'cancellation-resumed', fixture });
    await resumed.ready;
    try {
        const handle = await start('cancellation-resumed', fixture);
        await waitFor(async () => (await status(handle))?.phase === 'uncertain', { label: 'the resumed workflow to reconcile' });
        appendFileSync(fixture.ledger, 'end dispatch build\n');
        assert.equal((await drive(handle, fixture.captured.actions.slice(1))).status, 'COMPLETED');
        assert.equal(count(fixture.ledger, 'start dispatch build'), 1);
        assert.equal(replay(fixture.temporal).phase, 'complete');
    } finally { await resumed.kill(); }
});

test('holds: duplicate, stale, forged and credential-bearing decisions record nothing extra', async () => {
    const fixture = prepare('serial'), taskQueue = 'holds', variable = 'WRINGER_ADAPTER_FIXTURE_TOKEN', secret = 'wr-adapter-fixture-credential-9911';
    const worker = spawnWorker({ address: server.address, taskQueue, fixture, env: { ...process.env, [variable]: secret } });
    await worker.ready;
    try {
        const handle = await start(taskQueue, fixture);
        const held = await waitFor(async () => { const summary = await status(handle); return summary?.phase === 'human-hold' && summary; }, { label: 'the scope hold' });
        const hold = held.holds[0], base = { node: hold.node, expectedRevision: held.revision, inputSha256: hold.inputSha256, choice: 'continue', actor: 'Scripted engineering fixture' };
        await refused(handle.executeUpdate('decide', { args: [{ ...base, expectedRevision: 'a'.repeat(64), note: 'Stale.' }], updateId: 'stale-decision' }), /not bound to the current graph revision/);
        // Refused by the validator, a stale decision never entered the workflow's history.
        const accepted = (await handle.fetchHistory()).events.filter(event => event.workflowExecutionUpdateAcceptedEventAttributes).map(event => event.workflowExecutionUpdateAcceptedEventAttributes.acceptedRequest?.meta?.updateId);
        assert.equal(accepted.includes('stale-decision'), false);
        await refused(handle.executeUpdate('decide', { args: [{ ...base, node: 'build', note: 'Forged.' }] }), /build is not waiting for a decision/);
        await refused(handle.executeUpdate('decide', { args: [{ ...base, note: 'Includes sk-ant-abcdefghijklmnopqrstu.' }] }), /Decision note contains a detected credential/);
        await refused(handle.executeUpdate('decide', { args: [{ ...base, note: `Includes ${secret}.` }] }), /Decision note contains a detected credential/);
        assert.equal(eventFiles(fixture.temporal).length, held.events);
        const decision = { ...base, note: 'Fixture checkpoint at scope; not independent human acceptance.' };
        const [one, two] = [await handle.executeUpdate('decide', { args: [decision], updateId: 'scope-once' }), await handle.executeUpdate('decide', { args: [decision], updateId: 'scope-once' })];
        assert.equal(one.revision, two.revision);
        await refused(handle.executeUpdate('decide', { args: [decision], updateId: 'scope-again' }), /scope is not waiting for a decision/);
        const kinds = eventFiles(fixture.temporal).map(text => JSON.parse(text)).filter(event => event.node === 'scope' && event.kind === 'decision');
        assert.equal(kinds.length, 1);
        await handle.terminate('test finished');
    } finally { await worker.kill(); }
});

test('a second controller on the same directory stops the workflow at the first divergent event', async () => {
    const fixture = prepare('serial'), taskQueue = 'divergence';
    const worker = spawnWorker({ address: server.address, taskQueue, fixture });
    await worker.ready;
    try {
        const handle = await start(taskQueue, fixture);
        const held = await waitFor(async () => { const summary = await status(handle); return summary?.phase === 'human-hold' && summary; }, { label: 'the scope hold' });
        const local = spawnSync('bun', [scenarioScript, 'decide', fixture.temporal, 'scope'], { cwd: repo, encoding: 'utf8' });
        assert.equal(local.status, 0, local.stderr);
        const before = eventFiles(fixture.temporal);
        const hold = held.holds[0];
        await refused(handle.executeUpdate('decide', { args: [{ node: 'scope', expectedRevision: held.revision, inputSha256: hold.inputSha256, choice: 'continue', actor: 'Scripted engineering fixture', note: 'The workflow checkpoint.' }] }), /another controller advanced this graph/);
        await assert.rejects(ended(handle), error => error instanceof WorkflowFailedError && /another controller advanced this graph/.test(error.cause?.message ?? ''));
        assert.deepEqual(eventFiles(fixture.temporal), before, 'nothing the other controller wrote was overwritten');
        assert.equal(replay(fixture.temporal).phase, 'pending');
    } finally { await worker.kill(); }
});

test('a refused preflight through the real CLI leaves the node reserved, never dispatched', async () => {
    const fixture = prepare('serial'), taskQueue = 'preflight-refused', bun = spawnSync('which', ['bun'], { encoding: 'utf8' }).stdout.trim();
    // No container runtime on PATH: the production driver must refuse before any marker.
    const worker = spawnWorker({ address: server.address, taskQueue, behaviour: { command: [bun, join(repo, 'packages/cli/src/drive-cli.ts')] }, env: { ...process.env, PATH: `${dirname(bun)}:${dirname(process.execPath)}:/usr/bin:/bin` } });
    await worker.ready;
    try {
        const handle = await start(taskQueue, fixture);
        await drive(handle, fixture.captured.actions, { stopAfter: 1 });
        await assert.rejects(ended(handle), error => error instanceof WorkflowFailedError && /Containment unavailable/.test(error.cause?.message ?? ''));
        const retained = replay(fixture.temporal);
        assert.equal(retained.events.filter(event => event.kind === 'dispatch').length, 0);
        assert.ok(retained.events.some(event => event.kind === 'reserve' && event.node === 'build'));
        assert.equal(existsSync(join(fixture.temporal, '.wringer/graph-effects')), false);
    } finally { await worker.kill(); }
});

test('a child hold reason carrying a credential this worker holds is refused, never reported', async () => {
    const fixture = prepare('serial'), taskQueue = 'hold-credential', variable = 'WRINGER_ADAPTER_HOLD_TOKEN', secret = 'wr-adapter-hold-credential-3310';
    const worker = spawnWorker({ address: server.address, taskQueue, fixture, behaviour: { hold: { node: 'build', reason: `Waiting on ${secret}.` } }, env: { ...process.env, [variable]: secret } });
    await worker.ready;
    try {
        const handle = await start(taskQueue, fixture);
        await drive(handle, fixture.captured.actions, { stopAfter: 1 });
        await assert.rejects(ended(handle), error => error instanceof WorkflowFailedError && /Child hold reason contains a detected credential/.test(error.cause?.message ?? ''));
        assert.equal(JSON.stringify(eventFiles(fixture.temporal)).includes(secret), false);
    } finally { await worker.kill(); }
});
test('a tampered plan or grant in the workflow input is refused before any effect', async () => {
    const taskQueue = 'tampered-input';
    const fixture = prepare('serial'), worker = spawnWorker({ address: server.address, taskQueue, fixture });
    await worker.ready;
    try {
        const plan = workflowInput(fixture.temporal);
        plan.plan.nodes.scope.prompt = 'A different prompt.';
        const edited = await server.client.workflow.start('containedGraph', { taskQueue, workflowId: `tampered-plan-${Date.now()}`, args: [plan] });
        await assert.rejects(ended(edited), error => error instanceof WorkflowFailedError && /Compiled graph digest changed/.test(error.cause?.message ?? ''));
        const grant = workflowInput(fixture.temporal);
        grant.authority.expiresAt = '2099-01-01T00:00:00.000Z';
        const widened = await server.client.workflow.start('containedGraph', { taskQueue, workflowId: `tampered-grant-${Date.now()}`, args: [grant] });
        await assert.rejects(ended(widened), error => error instanceof WorkflowFailedError && /Graph authority digest changed/.test(error.cause?.message ?? ''));
        assert.equal(eventFiles(fixture.temporal).length, 1);
        assert.equal(existsSync(fixture.ledger), false);
    } finally { await worker.kill(); }
});
