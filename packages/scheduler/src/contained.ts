/** The local backend of the contained-graph kernel: a hash-chained event history
 * on the file system, one create-once file per event, under a directory lock.
 * Every decision is in ./contained-kernel; this file stores, locks and screens.
 * A retained history reads the same on every host; credentials the writing
 * host holds are refused when a decision, Send or hold reason is written. */
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Redactor } from '@wringer/engine';
import { validateContainedGraph, validateGraphAuthority, type ContainedGraphPlan, type GraphAuthority } from '@wringer/plan';
import { locked, safePath } from '@wringer/workflow';
import { advanceJournaledGraph, decideJournaledGraph, initializeJournaledGraph, readJournaledGraph, sendJournaledGraph, type GraphJournal } from './contained-kernel';
import type { GraphDecision, GraphDriver, ContainedGraphOptions, GraphSend, GraphState } from './contained-types';
export * from './contained-types';
export { advanceJournaledGraph, decideJournaledGraph, graphDecisionRecord, graphSendRecord, initializeJournaledGraph, readJournaledGraph, sendJournaledGraph, type GraphJournal } from './contained-kernel';

const MAX_EVENT_BYTES = 1024 * 1024, MAX_EVENTS = 4096, MAX_PLAN_BYTES = 8 * 1024 * 1024, MAX_AUTHORITY_BYTES = 64 * 1024;
function fail(message: string): never { throw new Error(message); }
/** A retained record is judged by its own content, never by this host's credentials. */
const REPLAY = { credentialEnvironment: {} };

async function boundedFile(directory: string, name: string, maximum: number): Promise<string> {
    const path = await safePath(directory, name), stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(`${name} must be a regular file`);
    if (stat.size > maximum) fail(`${name} exceeds its bound`);
    return readFile(path, 'utf8');
}
function parse(text: string, label: string): unknown { try { return JSON.parse(text); } catch { fail(`${label} is not valid JSON`); } }
async function syncDirectory(path: string) { const handle = await open(path, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
/** Complete bytes appear under their final name or not at all; never overwritten. */
async function durableCreate(directory: string, name: string, content: string) {
    const target = await safePath(directory, name), staging = await safePath(directory, '.wringer/graph-pending');
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const stat = await lstat(staging);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('Graph staging must be a real directory');
    const temp = join(staging, `${randomUUID()}.tmp`), handle = await open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try { await link(temp, target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail(`${name} already exists; graph records are never overwritten`); throw error; }
    finally { await unlink(temp).catch(() => undefined); }
    await syncDirectory(dirname(target));
}
const eventName = (sequence: number) => `events/${String(sequence).padStart(4, '0')}.json`;

/** The graph's history as create-once files under one directory. */
export function fileGraphJournal(directory: string): GraphJournal {
    return {
        directory,
        async read() {
            const plan = parse(await boundedFile(directory, 'plan.json', MAX_PLAN_BYTES), 'plan.json');
            const eventsPath = await safePath(directory, 'events'), stat = await lstat(eventsPath);
            if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Graph events must be a real directory');
            const names = (await readdir(eventsPath)).sort();
            if (!names.length) fail('Graph history has no events');
            if (names.length > MAX_EVENTS) fail('Graph history exceeds its event bound');
            names.forEach((name, index) => { if (`events/${name}` !== eventName(index)) fail('Graph events are not one contiguous sequence'); });
            const events: unknown[] = [];
            for (const name of names) { const file = `events/${name}`; events.push(parse(await boundedFile(directory, file, MAX_EVENT_BYTES), file)); }
            return { plan, authority: parse(await boundedFile(directory, 'authority.json', MAX_AUTHORITY_BYTES), 'authority.json'), events };
        },
        async open() {
            await mkdir(directory, { recursive: true, mode: 0o700 });
            const root = await lstat(directory);
            if (root.isSymbolicLink() || !root.isDirectory()) fail('Graph state must be a real directory');
        },
        async create(plan, authority) {
            const present = (await readdir(directory)).filter(name => name !== '.wringer');
            if (present.length) fail('This graph state directory is not empty. Inspect it with graph status or continue with graph resume; nothing was overwritten.');
            await durableCreate(directory, 'plan.json', JSON.stringify(plan, null, 2) + '\n');
            await durableCreate(directory, 'authority.json', JSON.stringify(authority, null, 2) + '\n');
            await mkdir(await safePath(directory, 'events'), { mode: 0o700 });
        },
        append: event => durableCreate(directory, eventName(event.sequence), JSON.stringify(event, null, 2) + '\n'),
        exclusive: (name, action) => locked(directory, name, action),
        validatePlan: (value, purpose) => validateContainedGraph(value, purpose === 'replay' ? REPLAY : {}),
        validateAuthority: (value, plan, at, purpose) => validateGraphAuthority(value, plan, at, purpose === 'replay' ? REPLAY : {}),
    };
}
/** Credentials held in this host's environment, refused when text is written. */
function hostScreen(text: string, label: string) { if (new Redactor().scrub(text) !== text) fail(`${label} contains a detected credential`); }
const local = (options: ContainedGraphOptions): ContainedGraphOptions => ({ ...options, screen: options.screen ?? hostScreen });

export async function initializeContainedGraph(directory: string, planInput: ContainedGraphPlan, authorityInput: GraphAuthority, options: ContainedGraphOptions = {}): Promise<GraphState> {
    return initializeJournaledGraph(fileGraphJournal(directory), planInput, authorityInput, local(options));
}
/** Lock-free: replay the complete retained history. Expiry is a phase, never a read refusal. */
export async function readContainedGraph(directory: string, options: Pick<ContainedGraphOptions, 'now'> = {}): Promise<GraphState> {
    return readJournaledGraph(fileGraphJournal(directory), options);
}
export async function advanceContainedGraph(directory: string, driver: GraphDriver, options: ContainedGraphOptions = {}): Promise<GraphState> {
    return advanceJournaledGraph(fileGraphJournal(directory), driver, local(options));
}
export async function decideContainedGraph(directory: string, decisionInput: GraphDecision, options: ContainedGraphOptions = {}): Promise<GraphState> {
    return decideJournaledGraph(fileGraphJournal(directory), decisionInput, local(options));
}
export async function sendContainedGraph(directory: string, sendInput: GraphSend, driver: GraphDriver, options: ContainedGraphOptions = {}): Promise<GraphState> {
    return sendJournaledGraph(fileGraphJournal(directory), sendInput, driver, local(options));
}
