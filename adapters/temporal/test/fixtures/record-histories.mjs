// Records the Temporal histories committed under test/histories, from the current
// workflow code: one finished serial graph, one finished parallel graph and one
// serial graph held at its review. Paths and identities are neutral, never this host's.
//   TEMPORAL_CLI=... node test/fixtures/record-histories.mjs
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@temporalio/client';
import { Worker } from '@temporalio/worker';
import { graphActivities } from '../../src/activities.mjs';
import { graphBundle } from '../../src/worker-factory.mjs';
import { recordedEffects } from './recorded-effects.mjs';
import { drive, prepare, startServer, workflowInput } from '../harness.mjs';

const output = new URL('../histories/', import.meta.url).pathname, neutral = '/tmp/wringer-temporal-history';
mkdirSync(output, { recursive: true });
const server = await startServer(), bundle = await graphBundle(), client = new Client({ connection: server.client.connection, identity: 'wringer-history-fixture' });
try {
    for (const [name, scenario, stopAfter] of [['serial-complete', 'serial', Infinity], ['parallel-complete', 'parallel', Infinity], ['serial-held-at-review', 'serial', 1]]) {
        const fixture = prepare(scenario), directory = join(neutral, name);
        rmSync(directory, { recursive: true, force: true }); mkdirSync(neutral, { recursive: true }); cpSync(fixture.temporal, directory, { recursive: true });
        const taskQueue = `history-${name}`, workflowId = `history-${name}`;
        const worker = await Worker.create({ connection: server.native, taskQueue, workflowBundle: bundle, identity: 'wringer-history-fixture', activities: graphActivities(recordedEffects({ captured: fixture.captured, ledger: fixture.ledger })) });
        await worker.runUntil(async () => {
            const handle = await client.workflow.start('containedGraph', { taskQueue, workflowId, args: [workflowInput(directory, { reconcileSeconds: 1 })] });
            await drive(handle, fixture.captured.actions, { stopAfter });
            if (stopAfter !== Infinity) await new Promise(resolve => setTimeout(resolve, 1500));
        });
        // The Temporal CLI's JSON is the standard history file format.
        const shown = spawnSync(process.env.TEMPORAL_CLI || 'temporal', ['workflow', 'show', '--workflow-id', workflowId, '--address', server.address, '--output', 'json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
        if (shown.status !== 0) throw new Error(shown.stderr);
        const history = JSON.parse(shown.stdout);
        writeFileSync(join(output, `${name}.json`), JSON.stringify(history, null, 2) + '\n');
        console.log(`${name}: ${history.events.length} history events`);
        rmSync(directory, { recursive: true, force: true });
    }
} finally { await server.stop(); }
