import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContainedGraph, createGraphAuthority, hashValue } from '@wringer/plan';
import { initializeContainedGraph, readContainedGraph, advanceContainedGraph, type GraphDriver, type GraphObservation, type ContainedGraphOptions } from '../src/contained';
import { tournamentFixture } from '../../plan/test/graph-fixtures';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const at = new Date('2026-09-30T12:00:00Z'), now = () => at;
const letters: Record<string, string> = { 'build-a': 'a', 'build-b': 'b', 'build-c': 'c' };
type Pick = (input: any, candidateOf: (node: string, owner?: string) => any) => GraphObservation;
async function fixture(options: { stopped?: string[]; pick?: Pick; edit?: (v: any) => void } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-tournament-graph-')); directories.push(dir);
    const raw: any = structuredClone(tournamentFixture()); options.edit?.(raw); const plan = compileContainedGraph(raw);
    const authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-30T13:00:00Z' });
    const observed = new Map<string, GraphObservation>(), calls: string[] = [], inputs = new Map<string, any>();
    const candidateOf = (node: string, owner = node) => ({ source: { ...plan.repository, commit: (letters[node] ?? 'f').repeat(40) }, tree: (letters[node] ?? 'f').repeat(40).replace(/^./, '1'), owner });
    const pick: Pick = options.pick ?? ((input, of) => ({ kind: 'complete', outcome: 'selected', candidate: of(input.branches.find((row: any) => row.outcome === 'ready').branch, 'pick'), evidenceSha256: hashValue(input.branches) }));
    const driver: GraphDriver = {
        async dispatch(request) {
            calls.push(request.node); inputs.set(request.node, structuredClone(request.reservation.input));
            const kind = plan.nodes[request.node]!.kind, input = request.reservation.input;
            observed.set(request.node, kind === 'tournament' ? pick(input, candidateOf)
                : options.stopped?.includes(request.node) ? { kind: 'complete', outcome: 'stopped', candidate: null, evidenceSha256: hashValue(request.node) }
                : { kind: 'complete', outcome: 'ready', candidate: candidateOf(request.node), evidenceSha256: hashValue(request.node) });
        },
        async observe(request) { return observed.get(request.node) ?? null; },
        async send() { throw new Error('No Send in these tests'); },
    };
    await initializeContainedGraph(dir, plan, authority, { now });
    return { dir, plan, calls, inputs, driver, observed };
}

test('every branch arrives at the tournament, a stopped one included, in declared order', async () => {
    const f = await fixture({ stopped: ['build-b'] }), state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('human-hold'); expect(state.active).toEqual(['review']);
    expect(f.inputs.get('pick').branches.map((row: any) => [row.branch, row.outcome, row.candidate?.owner ?? null])).toEqual([['build-a', 'ready', 'build-a'], ['build-b', 'stopped', null], ['build-c', 'ready', 'build-c']]);
    expect(state.nodes.pick!.result!.candidate!.owner).toBe('pick'); expect(state.nodes.review!.reservation.input.candidate!.owner).toBe('pick');
    expect(state.reserved.roleSessions).toBe(f.plan.budget.maxRoleSessions);
});
test('a stopped branch of a join still fails the graph', async () => {
    const { parallelFixture } = await import('../../plan/test/graph-fixtures');
    const dir = await mkdtemp(join(tmpdir(), 'wringer-join-stop-')); directories.push(dir);
    const plan = compileContainedGraph(parallelFixture()), observed = new Map<string, GraphObservation>();
    await initializeContainedGraph(dir, plan, createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-30T13:00:00Z' }), { now });
    const driver: GraphDriver = { async dispatch(request) { const ready = request.node !== 'build-b'; observed.set(request.node, { kind: 'complete', outcome: ready ? 'ready' : 'stopped', candidate: ready ? { source: { ...plan.repository, commit: 'a'.repeat(40) }, tree: '1' + 'a'.repeat(39), owner: request.node } : null, evidenceSha256: hashValue(request.node) }); }, async observe(request) { return observed.get(request.node) ?? null; }, async send() {} };
    const state = await advanceContainedGraph(dir, driver, { now });
    expect(state.phase).toBe('failed'); expect(state.nodes.merge).toBeUndefined();
});
test('a tournament cannot select a candidate that no branch delivered', async () => {
    const f = await fixture({ pick: (input, of) => ({ kind: 'complete', outcome: 'selected', candidate: { ...of('build-a', 'pick'), tree: 'e'.repeat(40) }, evidenceSha256: hashValue(input.branches) }) });
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('no branch delivered');
});
test('a tournament cannot select a disqualified branch that has no candidate', async () => {
    const f = await fixture({ stopped: ['build-a'], pick: (input) => ({ kind: 'complete', outcome: 'selected', candidate: { source: { url: input.source.url, commit: 'a'.repeat(40) }, tree: '1' + 'a'.repeat(39), owner: 'pick' }, evidenceSha256: hashValue(input.branches) }) });
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('no branch delivered');
});
test('a tournament must own the candidate it selects', async () => {
    const f = await fixture({ pick: (input, of) => ({ kind: 'complete', outcome: 'selected', candidate: of('build-a'), evidenceSha256: hashValue(input.branches) }) });
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('must own');
});
test('no winner carries no candidate and a required tournament then fails the graph', async () => {
    const forged = await fixture({ pick: (input, of) => ({ kind: 'complete', outcome: 'no-winner', candidate: of('build-a', 'pick'), evidenceSha256: hashValue(input.branches) }) });
    await expect(advanceContainedGraph(forged.dir, forged.driver, { now })).rejects.toThrow('with a candidate');
    const f = await fixture({ pick: input => ({ kind: 'complete', outcome: 'no-winner', candidate: null, evidenceSha256: hashValue(input.branches) }) });
    const state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('failed'); expect(state.reason).toContain('pick'); expect(state.nodes.review).toBeUndefined();
});
test('a tournament dispatched without a retained outcome is uncertain and never dispatched again', async () => {
    const f = await fixture();
    const crash: ContainedGraphOptions = { now, async checkpoint(event) { if (event.kind === 'dispatch' && event.node === 'pick') throw new Error('simulated crash after the tournament marker'); } };
    await expect(advanceContainedGraph(f.dir, f.driver, crash)).rejects.toThrow('simulated crash');
    const after = await advanceContainedGraph(f.dir, { ...f.driver, async observe() { return null; } }, { now });
    expect(after.phase).toBe('uncertain'); expect(f.calls.filter(node => node === 'pick')).toHaveLength(0);
    const resumed = await advanceContainedGraph(f.dir, { ...f.driver, async observe(request) { return request.node === 'pick' ? { kind: 'complete', outcome: 'no-winner', candidate: null, evidenceSha256: hashValue('reconciled') } : null; } }, { now });
    expect(resumed.nodes.pick!.result!.outcome).toBe('no-winner'); expect(f.calls.filter(node => node === 'pick')).toHaveLength(0);
});
test('a tournament writes version 3 events', async () => {
    const f = await fixture(); await advanceContainedGraph(f.dir, f.driver, { now });
    const state = await readContainedGraph(f.dir);
    expect(new Set(state.events.map(event => event.schema_version))).toEqual(new Set(['wringer.contained-graph-event.v3']));
});
