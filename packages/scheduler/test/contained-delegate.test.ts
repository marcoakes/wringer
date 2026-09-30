import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContainedGraph, createGraphAuthority, hashValue } from '@wringer/plan';
import { initializeContainedGraph, readContainedGraph, advanceContainedGraph, type GraphDriver, type GraphObservation, type ContainedGraphOptions } from '../src/contained';
import { delegateFixture } from '../../plan/test/graph-fixtures';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
const at = new Date('2026-09-30T12:00:00Z'), now = () => at;
async function fixture(returned: (input: any, candidateOf: (owner: string) => any) => GraphObservation) {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-delegate-graph-')); directories.push(dir);
    const plan = compileContainedGraph(delegateFixture()), observed = new Map<string, GraphObservation>(), calls: string[] = [], inputs = new Map<string, any>();
    const candidateOf = (owner: string) => ({ source: { ...plan.repository, commit: 'd'.repeat(40) }, tree: 'e'.repeat(40), owner });
    const driver: GraphDriver = {
        async dispatch(request) {
            calls.push(request.node); inputs.set(request.node, structuredClone(request.reservation.input));
            const kind = plan.nodes[request.node]!.kind, input = request.reservation.input;
            observed.set(request.node, kind === 'delegate' ? returned(input, candidateOf) : { kind: 'complete', outcome: 'passed', candidate: input.candidate, evidenceSha256: hashValue(request.node) });
        },
        async observe(request) { return observed.get(request.node) ?? null; },
        async send() {},
    };
    await initializeContainedGraph(dir, plan, createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-30T13:00:00Z' }), { now });
    return { dir, plan, calls, inputs, driver };
}
const returned = (input: any, of: (owner: string) => any): GraphObservation => ({ kind: 'complete', outcome: 'returned', candidate: of('ask'), evidenceSha256: hashValue('record') });

test('a returned candidate is owned by the delegate and reaches only its check first', async () => {
    const f = await fixture(returned), state = await advanceContainedGraph(f.dir, f.driver, { now });
    expect(state.phase).toBe('human-hold'); expect(state.active).toEqual(['review']);
    expect(f.inputs.get('verify').candidate.owner).toBe('ask'); expect(f.calls).toEqual(['ask', 'verify']);
    expect(new Set(state.events.map(event => event.schema_version))).toEqual(new Set(['wringer.contained-graph-event.v4']));
    expect(state.reserved.roleSessions).toBe(1);
});
test('a delegate must own the candidate it returns', async () => {
    const f = await fixture((input, of) => ({ kind: 'complete', outcome: 'returned', candidate: of('verify'), evidenceSha256: hashValue('record') }));
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('must own');
});
test('a failed, canceled or unavailable delegation carries no candidate and a required delegate fails the graph', async () => {
    const forged = await fixture((input, of) => ({ kind: 'complete', outcome: 'failed', candidate: of('ask'), evidenceSha256: hashValue('record') }));
    await expect(advanceContainedGraph(forged.dir, forged.driver, { now })).rejects.toThrow('with a candidate');
    for (const outcome of ['failed', 'canceled', 'unavailable']) {
        const f = await fixture(() => ({ kind: 'complete', outcome, candidate: null, evidenceSha256: hashValue(outcome) })), state = await advanceContainedGraph(f.dir, f.driver, { now });
        expect(state.phase).toBe('failed'); expect(state.nodes.verify).toBeUndefined();
    }
});
test('a delegation dispatched without a retained outcome is uncertain and never sent again', async () => {
    const f = await fixture(returned);
    const crash: ContainedGraphOptions = { now, async checkpoint(event) { if (event.kind === 'dispatch' && event.node === 'ask') throw new Error('simulated crash after the delegation marker'); } };
    await expect(advanceContainedGraph(f.dir, f.driver, crash)).rejects.toThrow('simulated crash');
    const after = await advanceContainedGraph(f.dir, { ...f.driver, async observe() { return null; } }, { now });
    expect(after.phase).toBe('uncertain'); expect(f.calls).toEqual([]);
    expect((await readContainedGraph(f.dir)).nodes.ask!.dispatched).toBe(true);
});
