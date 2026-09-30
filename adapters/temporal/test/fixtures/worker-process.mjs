// TEST FIXTURE ONLY. A graph worker in its own process, so a test can kill it.
//   node worker-process.mjs ADDRESS TASK_QUEUE CAPTURED LEDGER BEHAVIOUR_JSON [WORKFLOWS]
import { readFileSync } from 'node:fs';
import { DefaultLogger, NativeConnection, Runtime } from '@temporalio/worker';
import { commandEffects } from '../../src/activities.mjs';
import { createGraphWorker } from '../../src/worker-factory.mjs';
import { recordedEffects } from './recorded-effects.mjs';

Runtime.install({ logger: new DefaultLogger('WARN') });
const [address, taskQueue, captured, ledger, behaviourText, workflowsPath] = process.argv.slice(2), behaviour = JSON.parse(behaviourText || '{}');
const connection = await NativeConnection.connect({ address });
const worker = await createGraphWorker({ connection, taskQueue, workflowsPath: workflowsPath || new URL('./workflows.ts', import.meta.url).pathname, effects: behaviour.command ? commandEffects(behaviour.command) : recordedEffects({ captured: JSON.parse(readFileSync(captured, 'utf8')), ledger, behaviour }) });
console.log(`worker ready ${process.pid}`);
await worker.run();
