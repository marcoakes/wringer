// Shared test harness: a private Temporal dev server, scenario fixtures from the Bun
// kernel, and a driver for the scripted holds. TEMPORAL_CLI names the Temporal CLI
// (default: `temporal` on PATH); `bun` must be on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Connection } from '@temporalio/client';
import { DefaultLogger, NativeConnection, Runtime } from '@temporalio/worker';

Runtime.install({ logger: new DefaultLogger('WARN') });
export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const scenarioScript = fileURLToPath(new URL('./fixtures/scenario.ts', import.meta.url));
export const fixtureWorkflows = fileURLToPath(new URL('./fixtures/workflows.ts', import.meta.url));
export const workerProcess = fileURLToPath(new URL('./fixtures/worker-process.mjs', import.meta.url));
export const scratch = prefix => mkdtempSync(join(tmpdir(), `wringer-temporal-${prefix}-`));
const freePort = () => new Promise((resolve, reject) => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); server.on('error', reject); });
export const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function startServer(extra = []) {
    const port = await freePort(), directory = scratch('server'), address = `127.0.0.1:${port}`;
    const server = spawn(process.env.TEMPORAL_CLI || 'temporal', ['server', 'start-dev', '--headless', '--ip', '127.0.0.1', '--port', String(port), '--db-filename', join(directory, 'dev.db'), '--log-level', 'error', ...extra], { stdio: 'ignore' });
    for (let attempt = 0; attempt < 120; attempt++) {
        try { const connection = await Connection.connect({ address, connectTimeout: 1000 }); await connection.workflowService.getSystemInfo({}); const client = new Client({ connection }); const native = await NativeConnection.connect({ address }); return { address, client, native, async stop() { await native.close(); await connection.close(); server.kill('SIGTERM'); } }; }
        catch { await sleep(500); }
    }
    server.kill('SIGKILL');
    throw new Error('The Temporal dev server did not start');
}
export function prepare(scenario, at = new Date()) {
    const directory = scratch(scenario), iso = new Date(Math.floor(at.getTime() / 1000) * 1000).toISOString();
    const result = spawnSync('bun', [scenarioScript, 'prepare', scenario, directory, iso], { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`scenario ${scenario} failed: ${result.stderr}`);
    return { directory, at: iso, local: join(directory, 'local'), temporal: join(directory, 'temporal'), capturedPath: join(directory, 'captured.json'), captured: JSON.parse(readFileSync(join(directory, 'captured.json'), 'utf8')), ledger: join(directory, 'ledger.txt') };
}
/** The local kernel's replay of a state directory: it revalidates every event. */
export function replay(state) {
    const result = spawnSync('bun', [scenarioScript, 'read', state], { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`replay refused: ${result.stderr || result.stdout}`);
    return JSON.parse(result.stdout);
}
export function eventFiles(state) { return readdirSync(join(state, 'events')).sort().map(name => readFileSync(join(state, 'events', name), 'utf8')); }
export function workflowInput(state, settings) {
    return { directory: state, plan: JSON.parse(readFileSync(join(state, 'plan.json'), 'utf8')), authority: JSON.parse(readFileSync(join(state, 'authority.json'), 'utf8')), events: eventFiles(state).map(text => JSON.parse(text)), ...(settings ? { settings } : {}) };
}
/** Answer each scripted hold in order through the workflow's updates, until it ends. */
export async function drive(handle, actions, { timeoutMs = 60000, stopAfter = Infinity } = {}) {
    const started = Date.now(); let next = 0;
    while (Date.now() - started < timeoutMs) {
        const description = await handle.describe();
        if (description.status.name !== 'RUNNING') return { status: description.status.name, answered: next };
        if (next >= stopAfter) return { status: 'RUNNING', answered: next };
        const summary = await handle.query('status').catch(() => null);
        const action = actions[next], hold = summary?.holds.find(row => row.node === action?.node && row.kind === (action?.kind === 'send' ? 'send' : 'human'));
        if (action && hold) {
            if (action.kind === 'decide') await handle.executeUpdate('decide', { args: [{ node: action.node, expectedRevision: summary.revision, inputSha256: hold.inputSha256, choice: action.choice, actor: action.actor, note: action.note }] });
            else await handle.executeUpdate('send', { args: [{ node: action.node, expectedRevision: summary.revision, preparedSha256: hold.preparedSha256, actor: action.actor, note: action.note }] });
            next++;
            continue;
        }
        await sleep(150);
    }
    throw new Error(`drive timed out after ${next} actions`);
}
export async function waitFor(check, { timeoutMs = 30000, label = 'condition' } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) { const value = await check(); if (value) return value; await sleep(150); }
    throw new Error(`Timed out waiting for ${label}`);
}
/** A worker in its own process, so a test can kill it without warning. */
export function spawnWorker({ address, taskQueue, fixture, behaviour = {}, env = process.env, workflowsPath = '' }) {
    const child = spawn(process.execPath, [workerProcess, address, taskQueue, fixture?.capturedPath ?? '', fixture?.ledger ?? '', JSON.stringify(behaviour), workflowsPath], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let output = '';
    const ready = new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => { output += chunk; if (output.includes('worker ready')) resolve(); });
        child.stderr.on('data', chunk => { output += chunk; });
        child.on('exit', code => reject(new Error(`worker exited ${code}: ${output.slice(-2000)}`)));
    });
    return { child, ready, output: () => output, kill: (signal = 'SIGKILL') => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(signal); }) };
}
