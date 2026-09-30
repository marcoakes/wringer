import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContainedGraph, compileDeclaration, compileExecutionPlan, createGraphAuthority, hashValue } from '@wringer/plan';
import { initializeContainedGraph, readContainedGraph, advanceContainedGraph, decideContainedGraph, sendContainedGraph, type GraphDriver, type GraphObservation, type ContainedGraphOptions, type GraphState } from '../src/contained';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const at = new Date('2026-09-29T12:00:00Z'), now = () => at;
const template = compileExecutionPlan(await Bun.file(new URL('../../plan/examples/contained.yaml', import.meta.url)).text(), { format: 'yaml' });
function declaration() {
    const { schema_version, plan_sha256, acceptance_sha256, intent_sha256, ...raw } = template;
    const plan = compileDeclaration({ version: 3, ...raw, acceptance: { ...raw.acceptance, criteria: raw.acceptance.criteria.filter(row => row.kind === 'check') } });
    return { version: 1, id: 'serial', repository: plan.repository, entry: 'build', required: ['build', 'check', 'review', 'ship'],
        budget: { maxRoleSessions: plan.budget.max_sessions, maxVerificationAttempts: plan.budget.max_sessions + 2, wallClockSeconds: 600 },
        nodes: { build: { kind: 'loop', input: 'root', plan, then: 'check' }, check: { kind: 'check', input: 'build', then: 'review' },
            review: { kind: 'human-hold', input: 'check', prompt: 'Inspect this exact candidate.', then: 'ship' },
            ship: { kind: 'delivery', input: 'review', publication: { remote: 'https://example.test/repo.git', sourceBranch: 'wringer/serial', targetBranch: 'main' }, then: 'done' } } };
}
async function fixture(edit?: (v: any) => void) {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-contained-graph-')); directories.push(dir);
    const raw: any = structuredClone(declaration()); edit?.(raw); const plan = compileContainedGraph(raw);
    const authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-29T13:00:00Z' });
    const observed = new Map<string, GraphObservation>(), calls: string[] = [], sends: string[] = [];
    const candidate = { source: { ...plan.repository, commit: 'b'.repeat(40) }, tree: 'c'.repeat(40), owner: 'build' };
    const driver: GraphDriver = {
        async dispatch(request) {
            calls.push(request.node);
            expect(request.signal?.aborted).not.toBe(true);
            const history = await readContainedGraph(dir);
            expect(history.nodes[request.node]?.dispatched).toBe(true);
            expect(history.reserved.roleSessions).toBeGreaterThan(0);
            const kind = plan.nodes[request.node]!.kind;
            observed.set(request.node, kind === 'delivery' ? { kind: 'prepared', candidate, evidenceSha256: hashValue('prepared') }
                : { kind: 'complete', outcome: kind === 'loop' ? 'ready' : 'passed', candidate, evidenceSha256: hashValue(request.node) });
        },
        async observe(request) { return observed.get(request.node) ?? null; },
        async send(request) { sends.push(request.node); expect((await readContainedGraph(dir)).nodes[request.node]?.sent).toBe(true); observed.set(request.node, { kind: 'complete', outcome: 'delivered', candidate, evidenceSha256: hashValue('sent') }); },
    };
    await initializeContainedGraph(dir, plan, authority, { now });
    return { dir, plan, authority, observed, calls, sends, candidate, driver };
}
function decision(state: GraphState) { return { node: state.cursor, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[state.cursor]!.reservation.input), choice: 'continue' as const, actor: 'Scripted engineering fixture', note: 'Fixture checkpoint, not independent human acceptance.' }; }
function send(state: GraphState) { return { node: state.cursor, expectedRevision: state.revision, preparedSha256: hashValue(state.nodes[state.cursor]!.prepared), actor: 'Scripted engineering fixture', note: 'Explicit fixture Send to a test origin.' }; }
function crash(kind: string): ContainedGraphOptions { let hit = false; return { now, async checkpoint(event) { if (!hit && event.kind === kind) { hit = true; throw new Error(`simulated crash after ${kind}`); } } }; }

test('serial workflow reserves before dispatch, holds exact review and requires a separate Send', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(held.phase).toBe('human-hold'); expect(f.calls).toEqual(['build', 'check']); expect(f.sends).toEqual([]);
    expect(held.nodes.check!.reservation.input.candidate).toEqual(f.candidate);
    await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now }); expect(ready.phase).toBe('send-hold');
    const done = await sendContainedGraph(f.dir, send(ready), f.driver, { now });
    expect(done.phase).toBe('complete'); expect(f.sends).toEqual(['ship']);
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).revision).toBe(done.revision);
    expect(f.calls).toEqual(['build', 'check', 'ship']);
    expect(done.reserved).toEqual({ roleSessions: f.plan.budget.maxRoleSessions, verificationAttempts: f.plan.budget.maxVerificationAttempts });
});
test('reserved but not dispatched work restarts once under its original allowance', async () => {
    const f = await fixture(); await expect(advanceContainedGraph(f.dir, f.driver, crash('reserve'))).rejects.toThrow('simulated crash');
    expect(f.calls).toEqual([]); const reserved = (await readContainedGraph(f.dir)).reserved;
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(f.calls).toEqual(['build', 'check']); expect(state.reserved.roleSessions).toBe(reserved.roleSessions);
    expect(state.events.filter(e => e.kind === 'reserve' && e.node === 'build')).toHaveLength(1);
});
test('dispatch without a durable outcome remains charged and never silently repeats', async () => {
    const f = await fixture(); await expect(advanceContainedGraph(f.dir, f.driver, crash('dispatch'))).rejects.toThrow('simulated crash');
    const first = await readContainedGraph(f.dir);
    for (let i = 0; i < 3; i++) { const state = await advanceContainedGraph(f.dir, f.driver, { now }); expect(state.phase).toBe('uncertain'); expect(state.revision).toBe(first.revision); }
    expect(f.calls).toEqual([]); expect(first.reserved.roleSessions).toBe(f.plan.budget.maxRoleSessions);
});
test('completed child before parent acknowledgement reconciles without another dispatch', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'build') throw new Error('lost acknowledgement'); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('lost acknowledgement');
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('human-hold');
    expect(f.calls).toEqual(['build', 'check']);
});
test('human holds are stable across restart and rejected choices cannot become success', async () => {
    const f = await fixture(), state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).revision).toBe(state.revision);
    const rejected = await decideContainedGraph(f.dir, { ...decision(state), choice: 'reject' }, { now });
    expect(rejected.phase).toBe('failed'); expect(f.calls).toEqual(['build', 'check']);
});
test('stale or forged human decisions refuse before recording or dispatching', async () => {
    const f = await fixture(), state = await advanceContainedGraph(f.dir, f.driver, { now }), base = decision(state);
    for (const bad of [{ expectedRevision: 'a'.repeat(64) }, { inputSha256: 'a'.repeat(64) }, { node: 'build' }, { actor: '' }, { note: '' }, { choice: 'auto-approve' }])
        await expect(decideContainedGraph(f.dir, { ...base, ...bad } as any, { now })).rejects.toThrow();
    expect((await readContainedGraph(f.dir)).revision).toBe(state.revision);
});
test('failed required checks cannot be laundered by later human continuation', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'check') (f.observed.get('check') as any).outcome = 'failed'; };
    const state = await advanceContainedGraph(f.dir, f.driver, { now }); expect(state.phase).toBe('failed'); expect(f.sends).toEqual([]);
});
test('wrong-source, wrong-owner and invalid check outcomes never reach review', async () => {
    for (const change of [(v: any) => v.candidate.owner = 'ship', (v: any) => v.candidate.source.url = 'https://other.test/repo', (v: any) => v.outcome = 'claimed-ready']) {
        const f = await fixture(), dispatch = f.driver.dispatch;
        f.driver.dispatch = async request => { await dispatch(request); const v = structuredClone(f.observed.get(request.node)); change(v); f.observed.set(request.node, v!); };
        await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow(); expect(f.calls).toEqual(['build']);
    }
});
test('a check cannot replace its input candidate', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'check') { const v: any = structuredClone(f.observed.get('check')); v.candidate.tree = 'e'.repeat(40); f.observed.set('check', v); } };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('candidate');
});
test('the root wall clock clips all child deadlines and never resets on resume', async () => {
    const f = await fixture(); await expect(advanceContainedGraph(f.dir, f.driver, crash('reserve'))).rejects.toThrow();
    const reserved = await readContainedGraph(f.dir); expect(reserved.nodes.build!.reservation.deadline).toBe('2026-09-29T12:10:00.000Z');
    expect((await advanceContainedGraph(f.dir, f.driver, { now: () => new Date('2026-09-29T12:10:01Z') })).phase).toBe('expired');
    expect(f.calls).toEqual([]); expect((await readContainedGraph(f.dir)).deadline).toBe(reserved.deadline);
});
test('Send reserves once and reconciles a lost completion without a second push', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now }), dispatch = f.driver.send;
    f.driver.send = async (...args) => { await dispatch(...args); throw new Error('lost Send response'); };
    await expect(sendContainedGraph(f.dir, send(ready), f.driver, { now })).rejects.toThrow('lost Send response');
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('complete'); expect(f.sends).toEqual(['ship']);
    await expect(sendContainedGraph(f.dir, send(ready), f.driver, { now })).rejects.toThrow();
});
test('uncertain Send cannot be reissued by resume or a fresh send command', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now });
    await expect(sendContainedGraph(f.dir, send(ready), f.driver, crash('send'))).rejects.toThrow('simulated crash');
    const uncertain = await advanceContainedGraph(f.dir, f.driver, { now }); expect(uncertain.phase).toBe('uncertain');
    await expect(sendContainedGraph(f.dir, send(uncertain), f.driver, { now })).rejects.toThrow(); expect(f.sends).toEqual([]);
});
test('changed prepared Send identity and stale revision refuse before a push', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now });
    for (const change of [{ preparedSha256: 'b'.repeat(64) }, { expectedRevision: 'c'.repeat(64) }]) await expect(sendContainedGraph(f.dir, { ...send(ready), ...change }, f.driver, { now })).rejects.toThrow();
    expect(f.sends).toEqual([]);
});
test('delivery cannot report delivered before explicit Send', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const dispatch = f.driver.dispatch; f.driver.dispatch = async request => { await dispatch(request); f.observed.set(request.node, { kind: 'complete', outcome: 'delivered', candidate: f.candidate, evidenceSha256: hashValue('forged-send') }); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('Send');
});
test('hash changes, missing events, duplicates and symlink records are detected by the reader', async () => {
    for (const mutation of ['hash', 'missing', 'duplicate', 'symlink']) {
        const f = await fixture(); await advanceContainedGraph(f.dir, f.driver, { now });
        const eventDir = join(f.dir, 'events'), names = (await readdir(eventDir)).sort(), path = join(eventDir, names[1]!);
        const bytes = await readFile(path, 'utf8');
        // A semantically valid edit without a re-hash: only the digest can notice it.
        if (mutation === 'hash') { const v = JSON.parse(bytes); v.at = '2026-09-29T12:00:05.000Z'; await writeFile(path, JSON.stringify(v)); }
        if (mutation === 'missing') await rm(path);
        if (mutation === 'duplicate') await writeFile(join(eventDir, '9999.json'), bytes);
        if (mutation === 'symlink') { const outside = join(f.dir, 'copied-event.json'); await writeFile(outside, bytes); await rm(path); await symlink(outside, path); }
        await expect(readContainedGraph(f.dir)).rejects.toThrow();
    }
});
test('simultaneous advances cannot allocate duplicate effects', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch; let release!: () => void, entered!: () => void;
    const pending = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
    f.driver.dispatch = async request => { if (request.node === 'build') { entered(); await pending; } await dispatch(request); };
    const first = advanceContainedGraph(f.dir, f.driver, { now }); await started;
    try { await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow(); } finally { release(); }
    await first; expect(f.calls).toEqual(['build', 'check']);
});
test('a router cannot carry a failed required check to review, preparation or Send', async () => {
    const f = await fixture(v => { v.nodes.check.then = 'route'; v.nodes.route = { kind: 'router', input: 'check', routes: [{ outcome: 'failed', to: 'review' }], otherwise: 'review' }; });
    const dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'check') (f.observed.get('check') as any).outcome = 'failed'; };
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('failed'); expect(state.reason).toContain('Required node check');
    expect(state.nodes.review).toBeUndefined(); expect(f.calls).toEqual(['build', 'check']); expect(f.sends).toEqual([]);
});
test('a child hold is reported without a graph decision or a second dispatch', async () => {
    const f = await fixture(), observe = f.driver.observe;
    f.driver.observe = async request => request.node === 'build' ? { kind: 'held', reason: 'Child journey waits for its own human review.' } : observe(request);
    const first = await advanceContainedGraph(f.dir, f.driver, { now }), again = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(first.phase).toBe('human-hold'); expect(first.reason).toContain('own human review'); expect(again.revision).toBe(first.revision);
    expect(f.calls).toEqual(['build']);
    const refused = await decideContainedGraph(f.dir, { node: 'build', expectedRevision: first.revision, inputSha256: hashValue(first.nodes.build!.reservation.input), choice: 'continue', actor: 'Scripted engineering fixture', note: 'Cannot satisfy a child criterion.' }, { now }).then(() => null, (error: Error) => error);
    expect((await readContainedGraph(f.dir)).revision).toBe(first.revision); expect(refused?.message).toContain('hold');
});
test('an expired graph records no decision', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now });
    await expect(decideContainedGraph(f.dir, decision(held), { now: () => new Date('2026-09-29T12:10:01Z') })).rejects.toThrow('expired');
    expect((await readContainedGraph(f.dir)).revision).toBe(held.revision);
});
async function lastEvent(dir: string) { const names = (await readdir(join(dir, 'events'))).sort(), path = join(dir, 'events', names.at(-1)!); return { path, event: JSON.parse(await readFile(path, 'utf8')) }; }
const rehash = (event: any) => { const { sha256, ...body } = event; return { ...body, sha256: hashValue(body) }; };
const forgeries: [string, string, (dir: string) => Promise<void>, string][] = [
    ['forged reservation', 'reserve', async dir => { const { path, event } = await lastEvent(dir); event.data.reservation.roleSessions = 0; await writeFile(path, JSON.stringify(rehash(event))); }, 'Reservation'],
    ['forged chain link', 'reserve', async dir => { const { path, event } = await lastEvent(dir); event.previousSha256 = 'a'.repeat(64); await writeFile(path, JSON.stringify(rehash(event))); }, 'chain'],
    ['forged sequence field', 'reserve', async dir => { const { path, event } = await lastEvent(dir); event.sequence = 7; await writeFile(path, JSON.stringify(rehash(event))); }, 'sequence'],
    ['event from another graph', 'reserve', async dir => { const { path, event } = await lastEvent(dir); event.graphSha256 = 'a'.repeat(64); await writeFile(path, JSON.stringify(rehash(event))); }, 'another graph'],
    ['non-canonical event name', 'reserve', async dir => { const { path } = await lastEvent(dir); await writeFile(`${path}.orig`, await readFile(path)); await rm(path); }, 'contiguous'],
    ['repeated dispatch', 'dispatch', async dir => { const { event } = await lastEvent(dir); const next = rehash({ ...event, sequence: event.sequence + 1, previousSha256: event.sha256 }); await writeFile(join(dir, 'events', `${String(next.sequence).padStart(4, '0')}.json`), JSON.stringify(next)); }, 'already dispatched'],
];
for (const [name, at, forge, reason] of forgeries) test(`a rehashed ${name} is refused by transition and chain validation`, async () => {
    const f = await fixture(); await expect(advanceContainedGraph(f.dir, f.driver, crash(at))).rejects.toThrow('simulated crash');
    await forge(f.dir); await expect(readContainedGraph(f.dir)).rejects.toThrow(reason);
});
test('a non-required failed check does not continue along its success edge', async () => {
    const f = await fixture(v => { v.required = v.required.filter((id: string) => id !== 'check'); }), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'check') (f.observed.get('check') as any).outcome = 'failed'; };
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('failed'); expect(state.reason).toBe('check ended failed'); expect(state.nodes.review).toBeUndefined();
});
test('graph authority expiry stops new work before the root wall clock', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-contained-graph-')); directories.push(dir);
    const plan = compileContainedGraph(declaration()), authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-29T12:05:00Z' });
    await initializeContainedGraph(dir, plan, authority, { now }); const calls: string[] = [];
    const state = await advanceContainedGraph(dir, { async dispatch(request) { calls.push(request.node); }, async observe() { return null; }, async send() { throw new Error('unexpected Send'); } }, { now: () => new Date('2026-09-29T12:06:00Z') });
    expect(state.phase).toBe('expired'); expect(calls).toEqual([]); expect(state.events).toHaveLength(1);
});
test('a non-empty unrelated state directory is never adopted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-contained-graph-')); directories.push(dir); await writeFile(join(dir, 'notes.txt'), 'unrelated');
    const plan = compileContainedGraph(declaration()), authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-29T13:00:00Z' });
    await expect(initializeContainedGraph(dir, plan, authority, { now })).rejects.toThrow('not empty');
    expect((await readdir(dir)).filter(name => name !== '.wringer')).toEqual(['notes.txt']);
});
test('delivery cannot prepare a candidate other than its input', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const dispatch = f.driver.dispatch; f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'ship') { const v: any = structuredClone(f.observed.get('ship')); v.candidate.tree = 'e'.repeat(40); f.observed.set('ship', v); } };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('candidate other than its input');
});
test('an expired graph sends nothing', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now }); expect(ready.phase).toBe('send-hold');
    await expect(sendContainedGraph(f.dir, send(ready), f.driver, { now: () => new Date('2026-09-29T12:10:01Z') })).rejects.toThrow('expired');
    expect(f.sends).toEqual([]); expect((await readContainedGraph(f.dir)).revision).toBe(ready.revision);
});
test('a refused preflight leaves work reserved, never dispatched or uncertain', async () => {
    const f = await fixture(); let ready = false;
    f.driver.preflight = async (request, operation) => { if (!ready && operation === 'dispatch') throw new Error(`Containment unavailable for ${request.node}; nothing was dispatched`); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('Containment unavailable');
    const reserved = await readContainedGraph(f.dir, { now });
    expect(reserved.phase).toBe('pending'); expect(reserved.nodes.build!.dispatched).toBe(false); expect(f.calls).toEqual([]);
    ready = true; expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('human-hold'); expect(f.calls).toEqual(['build', 'check']);
    expect((await readContainedGraph(f.dir)).events.filter(e => e.kind === 'dispatch' && e.node === 'build')).toHaveLength(1);
});
test('a refused Send preflight records no Send and pushes nothing', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }); await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now });
    f.driver.preflight = async (_request, operation) => { if (operation === 'send') throw new Error('Publication target branch is absent; nothing was sent'); };
    await expect(sendContainedGraph(f.dir, send(ready), f.driver, { now })).rejects.toThrow('target branch');
    const after = await readContainedGraph(f.dir, { now }); expect(after.phase).toBe('send-hold'); expect(after.revision).toBe(ready.revision); expect(f.sends).toEqual([]);
});
test('changed initialization grant cannot overwrite a retained history', async () => {
    const f = await fixture(); await expect(initializeContainedGraph(f.dir, f.plan, createGraphAuthority(f.plan, { actor: 'Someone else', at, expiresAt: f.authority.expiresAt }), { now })).rejects.toThrow();
    expect((await readContainedGraph(f.dir)).authority).toEqual(f.authority);
});
