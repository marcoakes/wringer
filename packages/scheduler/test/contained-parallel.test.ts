import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContainedGraph, createGraphAuthority, hashValue } from '@wringer/plan';
import { initializeContainedGraph, readContainedGraph, advanceContainedGraph, decideContainedGraph, sendContainedGraph, type GraphDriver, type GraphObservation, type ContainedGraphOptions, type GraphState } from '../src/contained';
import { parallelFixture } from '../../plan/test/graph-fixtures';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const at = new Date('2026-09-30T12:00:00Z'), now = () => at;
const commits: Record<string, string> = { 'build-a': 'a', 'build-b': 'b', 'build-c': 'c', merge: 'd', repair: 'e' };
async function fixture(edit?: (v: any) => void, options: { delays?: Record<string, number> } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-parallel-graph-')); directories.push(dir);
    const raw: any = structuredClone(parallelFixture()); edit?.(raw); const plan = compileContainedGraph(raw);
    const authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-30T13:00:00Z' });
    const observed = new Map<string, GraphObservation>(), calls: string[] = [], sends: string[] = [], inputs = new Map<string, any>();
    let running = 0, peak = 0;
    const candidateOf = (node: string) => ({ source: { ...plan.repository, commit: (commits[node] ?? 'f').repeat(40) }, tree: (commits[node] ?? 'f').repeat(40).replace(/^./, '1'), owner: node });
    const driver: GraphDriver = {
        async dispatch(request) {
            calls.push(request.node); inputs.set(request.node, structuredClone(request.reservation.input));
            running++; peak = Math.max(peak, running);
            try {
                expect((await readContainedGraph(dir)).nodes[request.node]?.dispatched).toBe(true);
                await Bun.sleep(options.delays?.[request.node] ?? 5);
                const kind = plan.nodes[request.node]!.kind, input = request.reservation.input;
                observed.set(request.node, kind === 'delivery' ? { kind: 'prepared', candidate: input.candidate!, evidenceSha256: hashValue('prepared') }
                    : kind === 'check' ? { kind: 'complete', outcome: 'passed', candidate: input.candidate, evidenceSha256: hashValue(request.node) }
                    : kind === 'join' ? { kind: 'complete', outcome: 'integrated', candidate: candidateOf(request.node), evidenceSha256: hashValue(input.branches) }
                    : { kind: 'complete', outcome: 'ready', candidate: candidateOf(request.node), evidenceSha256: hashValue(request.node) });
            } finally { running--; }
        },
        async observe(request) { return observed.get(request.node) ?? null; },
        async send(request) { sends.push(request.node); observed.set(request.node, { kind: 'complete', outcome: 'delivered', candidate: request.reservation.input.candidate, evidenceSha256: hashValue('sent') }); },
    };
    await initializeContainedGraph(dir, plan, authority, { now });
    return { dir, plan, observed, calls, sends, inputs, driver, peak: () => peak, candidateOf };
}
const decision = (state: GraphState, node = state.cursor) => ({ node, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[node]!.reservation.input), choice: 'continue' as const, actor: 'Scripted engineering fixture', note: 'Fixture checkpoint, not human acceptance.' });
function crash(kind: string, node?: string): ContainedGraphOptions { let hit = false; return { now, async checkpoint(event) { if (!hit && event.kind === kind && (!node || event.node === node)) { hit = true; throw new Error(`simulated crash after ${kind}`); } } }; }

test('branches run concurrently up to the ceiling and the join receives every exact branch candidate in declared order', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(held.phase).toBe('human-hold'); expect(held.active).toEqual(['review']);
    expect(f.peak()).toBe(2); expect(f.calls.slice(0, 2).sort()).toEqual(['build-a', 'build-b']); expect(f.calls[2]).toBe('merge');
    expect(f.inputs.get('merge').branches.map((row: any) => [row.branch, row.candidate.owner])).toEqual([['build-a', 'build-a'], ['build-b', 'build-b']]);
    expect(f.inputs.get('build-a').candidate).toBeNull(); expect(f.inputs.get('build-b').node).toBe('split');
    expect(held.nodes.review!.reservation.input.candidate!.owner).toBe('merge');
    await decideContainedGraph(f.dir, decision(held), { now });
    const ready = await advanceContainedGraph(f.dir, f.driver, { now }); expect(ready.phase).toBe('send-hold');
    const done = await sendContainedGraph(f.dir, { node: 'ship', expectedRevision: ready.revision, preparedSha256: hashValue(ready.nodes.ship!.prepared), actor: 'Scripted engineering fixture', note: 'Fixture Send.' }, f.driver, { now });
    expect(done.phase).toBe('complete'); expect(done.reserved).toEqual({ roleSessions: f.plan.budget.maxRoleSessions, verificationAttempts: f.plan.budget.maxVerificationAttempts });
});
test('a ceiling of one runs branches one at a time', async () => {
    const f = await fixture(v => v.parallelism = 1); await advanceContainedGraph(f.dir, f.driver, { now });
    expect(f.peak()).toBe(1); expect(f.calls).toEqual(['build-a', 'build-b', 'merge']);
});
test('completion order does not change the recorded history or the join input', async () => {
    const early = await fixture(undefined, { delays: { 'build-a': 5, 'build-b': 60 } }), late = await fixture(undefined, { delays: { 'build-a': 60, 'build-b': 5 } });
    const one = await advanceContainedGraph(early.dir, early.driver, { now }), two = await advanceContainedGraph(late.dir, late.driver, { now });
    expect(one.events.map(e => [e.kind, e.node])).toEqual(two.events.map(e => [e.kind, e.node]));
    expect(hashValue(early.inputs.get('merge'))).toBe(hashValue(late.inputs.get('merge')));
});
test('a lost branch completion reconciles without redispatch and the join still waits for both', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'build-b') throw new Error('lost acknowledgement'); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('lost acknowledgement');
    const partial = await readContainedGraph(f.dir, { now });
    expect(partial.nodes['build-a']!.result!.outcome).toBe('ready'); expect(partial.nodes.merge).toBeUndefined();
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('human-hold');
    expect(f.calls.filter(node => node === 'build-b')).toHaveLength(1); expect(f.calls.filter(node => node === 'merge')).toHaveLength(1);
});
test('a repeated observation is recorded once', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now }), again = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(again.revision).toBe(held.revision);
    for (const node of ['build-a', 'build-b', 'merge']) expect(again.events.filter(e => e.kind === 'result' && e.node === node)).toHaveLength(1);
});
test('a failed branch fails the graph at once and cancels the other branch', async () => {
    const f = await fixture(undefined, { delays: { 'build-a': 5, 'build-b': 5 } }), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'build-b') (f.observed.get('build-b') as any).outcome = 'stopped'; };
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('failed'); expect(state.reason).toContain('build-b'); expect(state.nodes.merge).toBeUndefined(); expect(f.calls).not.toContain('merge');
});
test('a branch that cannot finish leaves the join unreserved', async () => {
    const f = await fixture(), observe = f.driver.observe;
    f.driver.observe = async request => request.node === 'build-b' ? null : observe(request);
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('uncertain'); expect(state.nodes.merge).toBeUndefined(); expect(state.active).toEqual(['build-b']);
});
test('a hold inside one branch waits alone while the other branch finishes', async () => {
    const f = await fixture(v => { v.nodes['build-a'].then = 'look-a'; v.nodes['look-a'] = { kind: 'human-hold', input: 'build-a', prompt: 'Inspect branch A.', then: 'merge' }; });
    const held = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(held.phase).toBe('human-hold'); expect(held.active).toEqual(['look-a']); expect(held.nodes['build-b']!.route!.to).toBe('merge');
    expect(held.holds.map(row => row.node)).toEqual(['look-a']);
    await decideContainedGraph(f.dir, decision(held, 'look-a'), { now });
    const next = await advanceContainedGraph(f.dir, f.driver, { now }); expect(next.active).toEqual(['review']);
    expect(f.inputs.get('merge').branches[0].node).toBe('look-a'); expect(f.inputs.get('merge').branches[0].candidate.owner).toBe('build-a');
});
test('a restart during the join reconciles it without a second integration', async () => {
    const f = await fixture(); await expect(advanceContainedGraph(f.dir, f.driver, crash('dispatch', 'merge'))).rejects.toThrow('simulated crash');
    const uncertain = await advanceContainedGraph(f.dir, f.driver, { now }); expect(uncertain.phase).toBe('uncertain'); expect(f.calls).not.toContain('merge');
    f.observed.set('merge', { kind: 'complete', outcome: 'integrated', candidate: f.candidateOf('merge'), evidenceSha256: hashValue('reconciled') });
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('human-hold'); expect(f.calls).not.toContain('merge');
});
test('a join conflict fails a required join unless a router sends it to a hold', async () => {
    const conflict = async (edit?: (v: any) => void) => { const f = await fixture(edit), dispatch = f.driver.dispatch; f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'merge') f.observed.set('merge', { kind: 'complete', outcome: 'conflict', candidate: null, evidenceSha256: hashValue('conflict') }); }; return { f, state: await advanceContainedGraph(f.dir, f.driver, { now }) }; };
    const plain = await conflict(); expect(plain.state.phase).toBe('failed'); expect(plain.state.reason).toContain('merge ended conflict');
    const routed = await conflict(v => { v.required = v.required.filter((id: string) => id !== 'merge'); v.nodes.merge.then = 'after'; v.nodes.after = { kind: 'router', input: 'merge', routes: [{ outcome: 'integrated', to: 'review' }, { outcome: 'conflict', to: 'resolve' }], otherwise: 'fail' }; v.nodes.resolve = { kind: 'human-hold', input: 'root', prompt: 'Branches conflict; decide how to proceed.', then: 'fail' }; v.required = v.required.filter((id: string) => !['review', 'ship'].includes(id)); });
    expect(routed.state.phase).toBe('human-hold'); expect(routed.state.active).toEqual(['resolve']);
});
test('a join outcome that names a candidate from outside the join is refused', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'merge') f.observed.set('merge', { kind: 'complete', outcome: 'integrated', candidate: f.candidateOf('build-a'), evidenceSha256: hashValue('borrowed') }); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('owner');
});
test('a rehashed arrival at the join from outside the branch is refused on replay', async () => {
    const f = await fixture(); await advanceContainedGraph(f.dir, f.driver, { now });
    const names = (await readdir(join(f.dir, 'events'))).sort();
    for (const name of names) {
        const path = join(f.dir, 'events', name), event = JSON.parse(await readFile(path, 'utf8'));
        if (event.kind !== 'route' || event.node !== 'build-a') continue;
        event.data.to = 'review'; const { sha256, ...body } = event; await writeFile(path, JSON.stringify({ ...body, sha256: hashValue(body) }));
    }
    await expect(readContainedGraph(f.dir)).rejects.toThrow();
});
test('every graph event of a parallel graph uses the version 2 event record', async () => {
    const f = await fixture(), state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(new Set(state.events.map(e => e.schema_version))).toEqual(new Set(['wringer.contained-graph-event.v2']));
    expect(state.events.find(e => e.kind === 'route' && e.node === 'split')!.data.branches).toEqual(['build-a', 'build-b']);
});
test("a failed branch records the other branch's open nodes as cancelled", async () => {
    const f = await fixture(v => { v.nodes['build-a'].then = 'look-a'; v.nodes['look-a'] = { kind: 'human-hold', input: 'build-a', prompt: 'Inspect branch A.', then: 'merge' }; }), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'build-b') (f.observed.get('build-b') as any).outcome = 'stopped'; };
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('failed'); expect(state.cancelled).toEqual(['look-a']); expect(state.active).toEqual([]);
});
test('one refused branch preflight leaves every branch reserved and no marker written', async () => {
    const f = await fixture(); let ready = false;
    f.driver.preflight = async (request, operation) => { if (!ready && operation === 'dispatch' && request.node === 'build-b') throw new Error('Containment unavailable for build-b'); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('Containment unavailable');
    const state = await readContainedGraph(f.dir, { now });
    expect(state.events.filter(e => e.kind === 'dispatch')).toHaveLength(0); expect(state.nodes['build-a']!.dispatched).toBe(false); expect(f.calls).toEqual([]);
    ready = true; expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('human-hold');
});
test('a conflict outcome that names a candidate is refused', async () => {
    const f = await fixture(), dispatch = f.driver.dispatch;
    f.driver.dispatch = async request => { await dispatch(request); if (request.node === 'merge') f.observed.set('merge', { kind: 'complete', outcome: 'conflict', candidate: f.candidateOf('merge'), evidenceSha256: hashValue('conflict') }); };
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('conflict with a candidate');
});
