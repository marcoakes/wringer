// The worker-side mirror and screen, without a Temporal service. The mirror uses the
// local journal's create-once protocol: an identical retry is a no-op, a different
// event at the same position is refused, and the wrong graph or a symlinked event
// directory is refused before anything is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { graphActivities } from '../src/activities.mjs';
import { prepare, scratch } from './harness.mjs';

const activities = graphActivities({ async run() { throw new Error('no effects in this test'); } });
const events = state => readdirSync(join(state, 'events')).sort().map(name => readFileSync(join(state, 'events', name), 'utf8'));

test('the mirror writes the local byte format, repeats idempotently and refuses a divergent event', async () => {
    const fixture = prepare('serial'), local = events(fixture.local), next = JSON.parse(local[1]);
    await activities.record({ directory: fixture.temporal, graphSha256: fixture.captured.graphSha256, event: next });
    assert.equal(events(fixture.temporal)[1], local[1]);
    await activities.record({ directory: fixture.temporal, graphSha256: fixture.captured.graphSha256, event: next });
    await assert.rejects(activities.record({ directory: fixture.temporal, graphSha256: fixture.captured.graphSha256, event: { ...next, at: '2026-01-01T00:00:00.000Z' } }), error => error.type === 'GraphDiverged' && /another controller/.test(error.message));
    assert.equal(events(fixture.temporal)[1], local[1]);
});
test('the mirror refuses another graph, a relative path and a symlinked event directory', async () => {
    const fixture = prepare('serial'), next = JSON.parse(events(fixture.local)[1]);
    await assert.rejects(activities.record({ directory: fixture.temporal, graphSha256: 'f'.repeat(64), event: { ...next, graphSha256: 'f'.repeat(64) } }), /holds another graph/);
    await assert.rejects(activities.record({ directory: 'relative/state', graphSha256: fixture.captured.graphSha256, event: next }), /absolute path/);
    const elsewhere = scratch('elsewhere');
    rmSync(join(fixture.temporal, 'events'), { recursive: true }); symlinkSync(elsewhere, join(fixture.temporal, 'events'));
    await assert.rejects(activities.record({ directory: fixture.temporal, graphSha256: fixture.captured.graphSha256, event: next }), /Graph events must be a real directory/);
    assert.deepEqual(readdirSync(elsewhere), []);
});
test('the screen refuses credentials this host holds and credential shapes', async () => {
    process.env.WRINGER_ADAPTER_SCREEN_TOKEN = 'wr-screen-fixture-4471';
    try {
        await assert.rejects(activities.screen({ entries: [{ text: 'note with wr-screen-fixture-4471', label: 'Decision note' }] }), error => error.type === 'GraphCredential' && /Decision note contains a detected credential/.test(error.message));
        await assert.rejects(activities.screen({ entries: [{ text: 'ghp_abcdefghijklmnopqrstuvwxyz0123', label: 'Send note' }] }), /Send note contains a detected credential/);
        await activities.screen({ entries: [{ text: 'An ordinary note.', label: 'Decision note' }] });
    } finally { delete process.env.WRINGER_ADAPTER_SCREEN_TOKEN; }
});
