/** Wringer's contained-graph kernel as a Temporal workflow.
 *
 * The kernel makes every decision, unchanged: this file supplies a journal whose
 * durability is Temporal's history and a driver whose operations are activities.
 * Each new event is mirrored, create-once, into the graph's state directory before
 * the kernel acts on it, so `wringer-drive graph status` and `export` read the same
 * records a local run writes, and a second controller is refused at the first
 * event where it diverges.
 *
 * Effects are activities with one attempt: a lost worker or a timeout leaves the
 * dispatch uncertain, and the kernel then only observes. Reads, mirrors and
 * preflights are safe to retry. No effect, file, clock source or environment is
 * touched here; the workflow clock is Temporal's. */
import { ActivityFailure, allHandlersFinished, ApplicationFailure, CancellationScope, condition, continueAsNew, defineQuery, defineUpdate, isCancellation, proxyActivities, setHandler, workflowInfo } from '@temporalio/workflow';
import { hashValue } from '@wringer/records/canonical';
import { checkGraphAuthority, checkGraphDigest, graphVersion, type ContainedGraphPlan, type GraphAuthority } from '@wringer/plan/graph-shape';
import { advanceJournaledGraph, decideJournaledGraph, graphDecisionRecord, graphSendRecord, readJournaledGraph, sendJournaledGraph, type ContainedGraphOptions, type GraphDecision, type GraphDriver, type GraphEvent, type GraphJournal, type GraphObservation, type GraphSend, type GraphState } from '@wringer/scheduler/kernel';

/** The workflow code's own revision; a change to its command sequence needs patched(). */
export const WORKFLOW_REVISION = 1;
export interface GraphWorkflowInput {
    /** The graph's state directory on the worker host: admitted there by `wringer-drive graph init`. */
    directory: string;
    /** The retained history this run continues, read from that directory. */
    plan: ContainedGraphPlan; authority: GraphAuthority; events: GraphEvent[];
    settings?: { reconcileSeconds?: number; heartbeatSeconds?: number; reconcileAfterExpirySeconds?: number };
}
export interface GraphSummary {
    revision: string; phase: GraphState['phase']; reason: string | null; events: number;
    active: string[]; cancelled: string[]; reserved: GraphState['reserved'];
    holds: (GraphState['holds'][number] & { inputSha256?: string; preparedSha256?: string })[];
    lastEffectFailure: string | null; workflowRevision: number;
}
export interface EffectRequest { directory: string; graphSha256: string; node: string; }
export interface GraphActivities {
    record(input: { directory: string; graphSha256: string; event: GraphEvent }): Promise<void>;
    preflight(input: EffectRequest & { operation: 'dispatch' | 'send' }): Promise<void>;
    dispatch(input: EffectRequest): Promise<void>;
    observe(input: EffectRequest): Promise<GraphObservation | null>;
    send(input: EffectRequest): Promise<void>;
    screen(input: { entries: { text: string; label: string }[] }): Promise<void>;
}
export const decideUpdate = defineUpdate<GraphSummary, [GraphDecision]>('decide');
export const sendUpdate = defineUpdate<GraphSummary, [GraphSend]>('send');
export const statusQuery = defineQuery<GraphSummary | null>('status');

function fail(message: string): never { throw ApplicationFailure.nonRetryable(message, 'GraphRefused'); }
const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number) => {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`Workflow setting ${value} is outside ${minimum}–${maximum}`);
    return value;
};
const message = (error: unknown) => error instanceof ActivityFailure ? `${error.activityType}: ${(error.cause as Error | undefined)?.message ?? error.message}` : (error as Error).message;
const AUTHORITY_FIELDS = ['schema_version', 'graphSha256', 'repository', 'actor', 'grantedAt', 'expiresAt', 'budget', 'maySend', 'sha256'];

/** Temporal's history is this journal's durability; the state directory is its mirror. */
function workflowJournal(input: GraphWorkflowInput, mirror: (event: GraphEvent) => Promise<void>, diverged: (reason: string) => void): GraphJournal & { events(): GraphEvent[] } {
    const events = [...input.events];
    let tail: Promise<unknown> = Promise.resolve();
    return {
        directory: input.directory,
        events: () => [...events],
        async read() { return { plan: input.plan, authority: input.authority, events: [...events] }; },
        async open() {},
        async create() { fail('A workflow continues a history admitted by wringer-drive graph init; it never creates one'); },
        async append(event) {
            if (event.sequence !== events.length) fail('Graph history moved during this transition');
            try { await CancellationScope.nonCancellable(() => mirror(event)); }
            catch (error) {
                // Another controller wrote this directory: stop, never overwrite or race it.
                if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure && error.cause.type === 'GraphDiverged') diverged(error.cause.message);
                throw error;
            }
            events.push(event);
        },
        exclusive(_name, action) { const run = tail.then(action); tail = run.then(() => undefined, () => undefined); return run; },
        // The full contract was checked when the history was admitted, and every
        // effect revalidates it from the mirrored directory. Here: version, digest,
        // and the grant's binding, expiry and digest.
        validatePlan(value) { graphVersion(value); checkGraphDigest(value as Record<string, unknown>); return value as ContainedGraphPlan; },
        validateAuthority(value, plan, at) {
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== AUTHORITY_FIELDS.length || Object.keys(value).some(key => !AUTHORITY_FIELDS.includes(key))) fail('graph authority has missing or unknown fields');
            checkGraphAuthority(value as Record<string, unknown>, plan, at);
            return value as GraphAuthority;
        },
    };
}

export function graphWorkflow(options: Pick<ContainedGraphOptions, 'now'> = {}) {
    return async function containedGraph(input: GraphWorkflowInput): Promise<GraphSummary> {
        const settings = input.settings ?? {};
        const reconcileSeconds = bounded(settings.reconcileSeconds, 30, 1, 3600), heartbeatSeconds = bounded(settings.heartbeatSeconds, 60, 5, 600), afterExpirySeconds = bounded(settings.reconcileAfterExpirySeconds, 3600, 0, 86400);
        const safe = proxyActivities<GraphActivities>({ startToCloseTimeout: '2 minutes', retry: { maximumAttempts: 10, initialInterval: '1 second', maximumInterval: '30 seconds', nonRetryableErrorTypes: ['GraphDiverged', 'GraphEffectRefused', 'GraphCredential'] } });
        // One attempt, bounded by the graph's own root wall clock.
        const once = (deadline: string) => proxyActivities<GraphActivities>({ startToCloseTimeout: Math.max(1000, Date.parse(deadline) - Date.now()), heartbeatTimeout: heartbeatSeconds * 1000, retry: { maximumAttempts: 1 } });
        let divergence: string | null = null;
        const journal = workflowJournal(input, event => safe.record({ directory: input.directory, graphSha256: input.plan.sha256, event }), reason => { divergence ??= reason; });
        const effect = (node: string): EffectRequest => ({ directory: input.directory, graphSha256: input.plan.sha256, node });
        const driver: GraphDriver = {
            preflight: (request, operation) => safe.preflight({ ...effect(request.node), operation }),
            dispatch: request => once(request.reservation.deadline).dispatch(effect(request.node)),
            observe: request => safe.observe(effect(request.node)),
            send: request => once(request.reservation.deadline).send(effect(request.node)),
        };
        let last: GraphState | null = null, changed = 0, lastEffectFailure: string | null = null;
        const summary = (state: GraphState): GraphSummary => ({
            revision: state.revision, phase: state.phase, reason: state.reason, events: state.events.length, active: state.active, cancelled: state.cancelled, reserved: state.reserved,
            holds: state.holds.map(hold => ({ ...hold, ...(hold.kind === 'human' ? { inputSha256: hashValue(state.nodes[hold.node]!.reservation.input) } : {}), ...(hold.kind === 'send' ? { preparedSha256: hashValue(state.nodes[hold.node]!.prepared) } : {}) })),
            lastEffectFailure, workflowRevision: WORKFLOW_REVISION,
        });
        const guarded = async (action: () => Promise<GraphState>) => {
            try { return await action(); }
            catch (error) {
                if (isCancellation(error) || error instanceof ApplicationFailure) throw error;
                throw ApplicationFailure.nonRetryable(message(error), divergence ? 'GraphDiverged' : 'GraphRefused');
            }
        };
        setHandler(statusQuery, () => last && summary(last));
        // Validators refuse before anything enters the history; the kernel checks again under the journal's exclusion.
        setHandler(decideUpdate, async decision => guarded(async () => {
            await safe.screen({ entries: [{ text: decision.actor, label: 'Decision actor' }, { text: decision.note, label: 'Decision note' }] });
            last = await decideJournaledGraph(journal, decision, options); changed++;
            return last;
        }).then(summary), { validator: value => {
            const decision = graphDecisionRecord(value), hold = last?.holds.find(row => row.node === decision.node && row.kind === 'human');
            if (!last || !hold) throw new Error(`${decision.node} is not waiting for a decision`);
            if (decision.expectedRevision !== last.revision) throw new Error('Decision is not bound to the current graph revision; reload before deciding');
        } });
        setHandler(sendUpdate, async send => guarded(async () => {
            await safe.screen({ entries: [{ text: send.actor, label: 'Send actor' }, { text: send.note, label: 'Send note' }] });
            try { last = await sendJournaledGraph(journal, send, driver, options); }
            // The Send marker is durable; an unconfirmed push is reconciled by observation, never repeated.
            catch (error) { if (!(error instanceof ActivityFailure) || error.activityType !== 'send') throw error; lastEffectFailure = message(error); last = await readJournaledGraph(journal, options); }
            changed++;
            return last;
        }).then(summary), { validator: value => {
            const send = graphSendRecord(value), hold = last?.holds.find(row => row.node === send.node && row.kind === 'send');
            if (!last || !hold) throw new Error(`${send.node} has no prepared delivery waiting for Send`);
            if (send.expectedRevision !== last.revision) throw new Error('Send is not bound to the current graph revision; reload before sending');
        } });

        for (;;) {
            last = await guarded(async () => {
                try { return await advanceJournaledGraph(journal, driver, options); }
                catch (error) {
                    // A dispatch that failed or timed out after its marker is uncertain: observe only.
                    if (!(error instanceof ActivityFailure) || error.activityType !== 'dispatch') throw error;
                    lastEffectFailure = message(error);
                    return readJournaledGraph(journal, options);
                }
            });
            const state = last;
            if (state.phase === 'complete' || state.phase === 'failed') return summary(state);
            const open = state.active.filter(id => state.nodes[id]?.dispatched && !state.nodes[id]?.result && !(state.nodes[id]?.prepared && !state.nodes[id]?.sent));
            if (state.phase === 'expired') {
                const reconcileUntil = Date.parse(state.deadline) + afterExpirySeconds * 1000;
                if (!open.length || Date.now() >= reconcileUntil) return summary(state);
            }
            if (workflowInfo().continueAsNewSuggested) {
                await condition(allHandlersFinished);
                await continueAsNew<typeof containedGraph>({ ...input, events: journal.events() });
            }
            const seen = changed;
            // Holds wait for their decision or Send until the graph expires; anything still running is observed again.
            const holding = !open.length && (state.phase === 'human-hold' || state.phase === 'send-hold');
            const wait = holding ? Math.max(1000, Math.min(Date.parse(state.deadline), Date.parse(state.authority.expiresAt)) - Date.now() + 1000) : reconcileSeconds * 1000;
            await condition(() => changed !== seen || divergence !== null, wait);
            if (divergence) throw ApplicationFailure.nonRetryable(`${divergence} This workflow stopped; the directory's history is intact.`, 'GraphDiverged');
        }
    };
}
