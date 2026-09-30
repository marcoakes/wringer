// TEST FIXTURE ONLY. Effects answered from observations the local backend captured.
// A shared ledger file counts every effect start and end across worker processes, so
// a test can prove an effect never ran twice and can finish an interrupted effect
// the way a child process would, without the controller.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';

export function ledgerLines(path) { return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : []; }
export function count(path, line) { return ledgerLines(path).filter(row => row === line).length; }
export function recordedEffects({ captured, ledger, behaviour = {} }) {
    const log = line => appendFileSync(ledger, `${line}\n`);
    async function slow(operation, node, milliseconds, heartbeat) {
        const context = Context.current(), started = Date.now();
        while (Date.now() - started < milliseconds) {
            if (context.cancellationSignal.aborted) { log(`cancelled ${operation} ${node}`); throw new CancelledFailure(`${operation} of ${node} cancelled`); }
            if (heartbeat) context.heartbeat({ node });
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    return {
        async run(operation, { node }) {
            if (operation.startsWith('preflight-')) {
                log(`${operation} ${node}`);
                if (behaviour.refusePreflight === node) throw ApplicationFailure.nonRetryable('Containment unavailable on this fixture host', 'GraphEffectRefused');
                return { operation, node };
            }
            if (operation === 'observe') {
                if (behaviour.hold?.node === node) return { operation, node, observation: { kind: 'held', reason: behaviour.hold.reason } };
                const lines = ledgerLines(ledger), rows = captured.observations[node] ?? {};
                const observation = lines.includes(`end send ${node}`) ? rows.send : lines.includes(`end dispatch ${node}`) ? rows.dispatch : null;
                return { operation, node, observation: observation ?? null };
            }
            log(`start ${operation} ${node}`);
            const delay = behaviour.slow?.[`${operation} ${node}`];
            if (delay) await slow(operation, node, delay, !behaviour.silent);
            if (behaviour.unfinished === `${operation} ${node}`) return { operation, node };
            log(`end ${operation} ${node}`);
            return { operation, node };
        },
    };
}
