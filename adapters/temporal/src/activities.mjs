// The graph workflow's activities, on the worker host that holds the graph's state
// directory. `record` mirrors each kernel event into that directory with the local
// journal's create-once protocol and byte format; `screen` refuses credentials this
// host holds, which workflow code cannot see. Effects are delegated: in production
// to `wringer-drive graph effect`, which runs one driver operation only for the
// durable marker the directory records, at most once per marker.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { Context } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import { Redactor } from '../../../packages/engine/src/redactor.ts';

const HEX64 = /^[a-f0-9]{64}$/, NODE = /^[a-z][a-z0-9-]*$/;
const refuse = (message, type = 'GraphEffectRefused') => { throw ApplicationFailure.nonRetryable(message, type); };
const eventName = sequence => `events/${String(sequence).padStart(4, '0')}.json`;

async function realDirectory(path, label) {
    const stat = await lstat(path).catch(() => null);
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) refuse(`${label} must be a real directory: ${path}`, 'GraphDiverged');
}
/** The state directory must hold this graph: the digest of its admitted plan. */
async function graphDirectory(directory, graphSha256) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) refuse('The graph state directory must be an absolute path on the worker host');
    if (!HEX64.test(graphSha256)) refuse('The graph digest is invalid');
    await realDirectory(directory, 'Graph state');
    const plan = JSON.parse(await readFile(join(directory, 'plan.json'), 'utf8').catch(() => refuse(`No admitted graph at ${directory}; run wringer-drive graph init first`)));
    if (plan.sha256 !== graphSha256) refuse(`${directory} holds another graph`, 'GraphDiverged');
}
/** Complete bytes appear under their final name or not at all; an identical retry is a no-op. */
async function createOnce(directory, name, content) {
    await realDirectory(join(directory, 'events'), 'Graph events');
    const staging = join(directory, '.wringer/graph-pending');
    await mkdir(staging, { recursive: true, mode: 0o700 });
    await realDirectory(staging, 'Graph staging');
    const temp = join(staging, `${randomUUID()}.tmp`), handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await link(temp, join(directory, name)); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (await readFile(join(directory, name), 'utf8') !== content) refuse(`${name} already holds a different event: another controller advanced this graph. Nothing was overwritten.`, 'GraphDiverged');
        return;
    }
    finally { await unlink(temp).catch(() => undefined); }
    const events = await open(join(directory, 'events'), 'r'); try { await events.sync(); } finally { await events.close(); }
}
function screen(entries) {
    const redactor = new Redactor();
    for (const { text, label } of entries) if (typeof text === 'string' && redactor.scrub(text) !== text) refuse(`${label} contains a detected credential`, 'GraphCredential');
}
function checked(input) {
    if (!NODE.test(input?.node ?? '')) refuse('Effect names an invalid node');
    return input;
}

/** Effects through a command: `wringer-drive graph effect OPERATION --state DIR --node ID --json`. */
export function commandEffects(prefix, { heartbeatMs = 10000 } = {}) {
    if (!Array.isArray(prefix) || !prefix.length || prefix.some(part => typeof part !== 'string' || !part)) throw new Error('The effect command must be a non-empty argument list');
    return {
        async run(operation, { directory, node }) {
            const context = Context.current(), child = spawn(prefix[0], [...prefix.slice(1), 'graph', 'effect', operation, '--state', directory, '--node', node, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            child.stdout.on('data', chunk => { if (stdout.length < 8 * 1024 * 1024) stdout += chunk; });
            child.stderr.on('data', chunk => { if (stderr.length < 1024 * 1024) stderr += chunk; });
            const beat = setInterval(() => context.heartbeat({ operation, node }), heartbeatMs);
            const cancel = () => child.kill('SIGTERM');
            context.cancellationSignal.addEventListener('abort', cancel);
            try {
                const exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => resolve(code)); });
                if (context.cancellationSignal.aborted) throw new CancelledFailure(`${operation} of ${node} was cancelled`);
                let value = null; try { value = JSON.parse(stdout.trim().split('\n').at(-1) ?? 'null'); } catch { /* reported below */ }
                if (exit !== 0) refuse(value?.message ?? (stderr.trim() || `graph effect exited ${exit}`));
                if (!value || value.node !== node || value.operation !== operation) refuse(`graph effect did not report ${operation} of ${node}`);
                return value;
            } finally { clearInterval(beat); context.cancellationSignal.removeEventListener('abort', cancel); }
        },
    };
}

/** @param {{ run(operation: string, request: { directory: string, node: string }): Promise<{ observation?: unknown }> }} effects */
export function graphActivities(effects) {
    return {
        async record({ directory, graphSha256, event }) {
            await graphDirectory(directory, graphSha256);
            if (!event || event.graphSha256 !== graphSha256 || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || !HEX64.test(event.sha256 ?? '')) refuse('The mirrored event does not belong to this graph', 'GraphDiverged');
            await createOnce(directory, eventName(event.sequence), JSON.stringify(event, null, 2) + '\n');
        },
        async preflight(input) {
            await graphDirectory(input.directory, input.graphSha256);
            if (!['dispatch', 'send'].includes(input.operation)) refuse('Unknown preflight');
            await effects.run(`preflight-${input.operation}`, checked(input));
        },
        async dispatch(input) { await graphDirectory(input.directory, input.graphSha256); await effects.run('dispatch', checked(input)); },
        async send(input) { await graphDirectory(input.directory, input.graphSha256); await effects.run('send', checked(input)); },
        async observe(input) {
            await graphDirectory(input.directory, input.graphSha256);
            const observation = (await effects.run('observe', checked(input))).observation ?? null;
            if (observation?.kind === 'held') screen([{ text: observation.reason, label: 'Child hold reason' }]);
            return observation;
        },
        async screen({ entries }) { screen(entries); },
    };
}
