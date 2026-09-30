#!/usr/bin/env node
// The Temporal adapter's command line. Admit the graph first, with no effect:
//   wringer-drive graph init GRAPH.yaml --authority AUTH.json --state DIR
// then run one worker on the host that holds DIR, and start the graph on it.
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { Client, Connection } from '@temporalio/client';
import { DefaultLogger, NativeConnection, Runtime } from '@temporalio/worker';
import { commandEffects } from './activities.mjs';
import { createGraphWorker } from './worker-factory.mjs';

const HELP = `wringer temporal adapter · run a contained graph on a Temporal service

  node adapters/temporal/src/cli.mjs worker --task-queue Q [--effect-command JSON] [--address HOST:PORT] [--namespace NS]
  node adapters/temporal/src/cli.mjs start --state DIR --task-queue Q [--workflow-id ID] [--address ...] [--namespace ...]
  node adapters/temporal/src/cli.mjs status --workflow-id ID
  node adapters/temporal/src/cli.mjs decide --workflow-id ID --node N --revision SHA --input SHA (--continue | --reject) --by NAME --note TEXT
  node adapters/temporal/src/cli.mjs send --workflow-id ID --node N --revision SHA --prepared SHA --by NAME --note TEXT
  node adapters/temporal/src/cli.mjs cancel --workflow-id ID

Admit the graph first with wringer-drive graph init. The worker must run on the
host that holds the state directory: every event is mirrored there, create-once,
and every effect runs through the effect command, by default
["wringer-drive"], as: graph effect OPERATION --state DIR --node ID --json.
A dispatch or Send runs at most once per durable marker; a lost worker leaves it
uncertain and the workflow only observes it. Never advance the same directory
with wringer-drive graph resume while a workflow owns it: the first divergent
event stops the workflow and nothing is overwritten.
Default address 127.0.0.1:7233, namespace default. No TLS or Temporal Cloud
connection is offered or claimed.`;

function parse(argv) {
    if (['--help', '-h'].includes(argv[0])) return { command: 'help', flags: new Map() };
    const [command, ...rest] = argv, flags = new Map();
    for (let index = 0; index < rest.length; index++) {
        const word = rest[index];
        if (!word.startsWith('--')) throw new Error(`Unexpected argument ${word}`);
        const name = word.slice(2), next = rest[index + 1];
        if (['continue', 'reject', 'help'].includes(name)) flags.set(name, true);
        else { if (next === undefined) throw new Error(`--${name} needs a value`); flags.set(name, next); index++; }
    }
    return { command, flags };
}
const required = (flags, name) => { const value = flags.get(name); if (typeof value !== 'string' || !value) throw new Error(`--${name} is required`); return value; };
const address = flags => flags.get('address') ?? '127.0.0.1:7233', namespace = flags => flags.get('namespace') ?? 'default';
async function client(flags) { return new Client({ connection: await Connection.connect({ address: address(flags) }), namespace: namespace(flags) }); }
/** The retained history the workflow continues: exactly what graph init (or a run) left. */
function retained(directory) {
    const read = name => JSON.parse(readFileSync(join(directory, name), 'utf8'));
    const events = readdirSync(join(directory, 'events')).sort().map(name => read(join('events', name)));
    return { directory, plan: read('plan.json'), authority: read('authority.json'), events };
}
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function main(argv) {
    const { command, flags } = parse(argv);
    if (!command || flags.get('help') || ['help', '--help', '-h'].includes(command)) return console.log(HELP);
    if (command === 'worker') {
        Runtime.install({ logger: new DefaultLogger('WARN') });
        const effect = JSON.parse(flags.get('effect-command') ?? '["wringer-drive"]');
        const worker = await createGraphWorker({ connection: await NativeConnection.connect({ address: address(flags) }), namespace: namespace(flags), taskQueue: required(flags, 'task-queue'), effects: commandEffects(effect) });
        console.log(`Graph worker polling ${required(flags, 'task-queue')} on ${address(flags)}; effects through ${JSON.stringify(effect)}.`);
        const stop = () => worker.shutdown();
        process.on('SIGINT', stop); process.on('SIGTERM', stop);
        return worker.run();
    }
    const temporal = await client(flags);
    if (command === 'start') {
        const directory = resolve(required(flags, 'state'));
        if (!isAbsolute(directory)) throw new Error('The state directory must resolve to an absolute path');
        const input = retained(directory), workflowId = flags.get('workflow-id') ?? `wringer-graph-${input.plan.sha256.slice(0, 16)}-${input.events.length}`;
        await temporal.workflow.start('containedGraph', { taskQueue: required(flags, 'task-queue'), workflowId, args: [input] });
        return print({ started: workflowId, directory, graph: input.plan.sha256, retainedEvents: input.events.length });
    }
    const handle = temporal.workflow.getHandle(required(flags, 'workflow-id'));
    if (command === 'status') {
        const description = await handle.describe();
        return print({ workflow: description.status.name, graph: description.status.name === 'RUNNING' ? await handle.query('status') : null });
    }
    if (command === 'decide') {
        if (flags.has('continue') === flags.has('reject')) throw new Error('Choose exactly one of --continue or --reject; nothing was recorded');
        return print(await handle.executeUpdate('decide', { args: [{ node: required(flags, 'node'), expectedRevision: required(flags, 'revision'), inputSha256: required(flags, 'input'), choice: flags.has('continue') ? 'continue' : 'reject', actor: required(flags, 'by'), note: required(flags, 'note') }] }));
    }
    if (command === 'send') return print(await handle.executeUpdate('send', { args: [{ node: required(flags, 'node'), expectedRevision: required(flags, 'revision'), preparedSha256: required(flags, 'prepared'), actor: required(flags, 'by'), note: required(flags, 'note') }] }));
    if (command === 'cancel') { await handle.cancel(); return print({ cancelled: handle.workflowId, note: 'A dispatch in flight is cancelled and stays uncertain; a new workflow started from the directory only observes it.' }); }
    throw new Error(`Unknown command ${command}. ${HELP}`);
}
main(process.argv.slice(2)).then(() => { if (!['worker'].includes(process.argv[2])) process.exit(0); }, error => { console.error(`STOP: ${error.cause?.message ?? error.message}`); process.exit(error.cause ? 3 : 2); });
