import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileContainedGraph, compileDeclaration, compileExecutionPlan, createGraphAuthority, hashValue } from '@wringer/plan';
import { initializeContainedGraph, readContainedGraph, advanceContainedGraph, decideContainedGraph, type GraphDriver, type GraphObservation, type GraphState } from '../src/contained';

const directories: string[] = [], variables: string[] = [];
afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
    for (const name of variables.splice(0)) delete process.env[name];
});
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
async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'wringer-graph-durability-')); directories.push(dir);
    const plan = compileContainedGraph(structuredClone(declaration()));
    const authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-29T13:00:00Z' });
    const observed = new Map<string, GraphObservation>(), candidate = { source: { ...plan.repository, commit: 'b'.repeat(40) }, tree: 'c'.repeat(40), owner: 'build' };
    const driver: GraphDriver = {
        async dispatch(request) {
            const kind = plan.nodes[request.node]!.kind;
            observed.set(request.node, kind === 'delivery' ? { kind: 'prepared', candidate, evidenceSha256: hashValue('prepared') } : { kind: 'complete', outcome: kind === 'loop' ? 'ready' : 'passed', candidate, evidenceSha256: hashValue(request.node) });
        },
        async observe(request) { return observed.get(request.node) ?? null; },
        async send() { throw new Error('not sent in this fixture'); },
    };
    await initializeContainedGraph(dir, plan, authority, { now });
    return { dir, plan, driver, observed };
}
const decision = (state: GraphState, note: string) => ({ node: state.cursor, expectedRevision: state.revision, inputSha256: hashValue(state.nodes[state.cursor]!.reservation.input), choice: 'continue' as const, actor: 'Scripted engineering fixture', note });
function secret(name: string, value: string) { variables.push(name); process.env[name] = value; }

test('replaying a retained history does not depend on the reading host environment', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now });
    const note = 'Fixture checkpoint quoting build 7f3c9a21d4e8b6f0.';
    const decided = await decideContainedGraph(f.dir, decision(held, note), { now });
    // A later reader whose environment happens to hold a matching value still reads the record.
    secret('WRINGER_PHASE7_FIXTURE_TOKEN', '7f3c9a21d4e8b6f0');
    const read = await readContainedGraph(f.dir, { now });
    expect(read.revision).toBe(decided.revision);
    expect(read.nodes.review!.decision!.note).toBe(note);
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).phase).toBe('send-hold');
});
test('a new decision carrying a credential from the writing host is still refused before recording', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now });
    secret('WRINGER_PHASE7_FIXTURE_TOKEN', 'wr-fixture-credential-5521');
    await expect(decideContainedGraph(f.dir, decision(held, 'Approved with wr-fixture-credential-5521 attached.'), { now })).rejects.toThrow('Decision note contains a detected credential');
    expect((await readContainedGraph(f.dir, { now })).revision).toBe(held.revision);
});
test('a child hold reason carrying a credential from the writing host is refused', async () => {
    const f = await fixture();
    secret('WRINGER_PHASE7_FIXTURE_TOKEN', 'wr-fixture-credential-7730');
    f.driver.dispatch = async () => undefined;
    f.driver.observe = async request => request.node === 'build' ? { kind: 'held', reason: 'Waiting on wr-fixture-credential-7730.' } : null;
    await expect(advanceContainedGraph(f.dir, f.driver, { now })).rejects.toThrow('Child hold reason contains a detected credential');
});
test('a retained plan and grant read the same when the reading host holds a matching value', async () => {
    const f = await fixture(), held = await advanceContainedGraph(f.dir, f.driver, { now });
    secret('WRINGER_PHASE7_PROMPT_TOKEN', 'Inspect this exact candidate.');
    secret('WRINGER_PHASE7_ACTOR_TOKEN', 'Scripted engineering fixture');
    expect((await readContainedGraph(f.dir, { now })).revision).toBe(held.revision);
    expect((await advanceContainedGraph(f.dir, f.driver, { now })).revision).toBe(held.revision);
});
test('admitting a plan or grant still refuses a credential the writing host holds', async () => {
    const plan = compileContainedGraph(structuredClone(declaration()));
    const authority = createGraphAuthority(plan, { actor: 'Scripted engineering fixture', at, expiresAt: '2026-09-29T13:00:00Z' });
    const dir = await mkdtemp(join(tmpdir(), 'wringer-graph-durability-')); directories.push(dir);
    secret('WRINGER_PHASE7_PROMPT_TOKEN', 'Inspect this exact candidate.');
    await expect(initializeContainedGraph(dir, plan, authority, { now })).rejects.toThrow('Graph contains a detected credential');
    delete process.env.WRINGER_PHASE7_PROMPT_TOKEN;
    secret('WRINGER_PHASE7_ACTOR_TOKEN', 'Scripted engineering fixture');
    await expect(initializeContainedGraph(dir, plan, authority, { now })).rejects.toThrow('Graph authority contains a detected credential');
});
