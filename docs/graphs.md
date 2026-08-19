# Graphs of loops

*Wringer composes AI software work as graphs of evidence-producing loops. Each
loop can use any coding agent. Each transition is explicit. Each stop is
explainable. Each delivery requires evidence. Each graph resumes from disk.*

This is [specs/SPEC_GRAPH_V0.md](../SPEC_GRAPH_V0.md), built. It is deliberately
small: a local, resumable, evidence-driven workflow file that composes the
primitives Wringer already has. It is **not** an agent framework, not a
scheduler, and not a second implementation of anything — a graph node *names a
Wringer capability*, and the capability does what it has always done, with the
same refusals, the same evidence, the same laws.

The one-sentence test applied to every design question here: **would this
widen what Wringer can execute, contact, or write?** If yes, it is wrong. A
graph adds sequencing and stopping, never power.

![a graph parks, a person decides, the graph resumes](graph.svg)

*Captured, not written. `scripts/demo.sh` regenerates it by running the real
commands through a real pty; [`graph.cast.json`](graph.cast.json) beside it is
the transcript, and the hand edit in the middle is filmed as its own step
because the interlock has no flag to press.*

**Every console block below is real captured output**, pasted from a run and
not composed. Where a run id appears it is the one that run produced.

---

## The six verbs

```
wring graph validate graph.yaml     exit 0/2 — schema, dataflow, DAG checks
wring graph run graph.yaml          execute until done, failed, or parked
wring graph run graph.yaml --send   ...allowing the deliver node to send
wring graph resume GRAPH_DIR        continue a parked or killed graph
wring graph status GRAPH_DIR        one screen: where it is, why
wring graph explain GRAPH_DIR       why it stopped, and the next action
wring graph render GRAPH_DIR        Mermaid, of a graph file or a finished run
```

**Exit codes.** `0` reached `done` · `1` reached `fail`, a node failed, or a
budget ran out · `2` config or an invalid graph file · `3` a refused
precondition · `4` interrupted · **`5` parked — a human must act before the
graph can continue.**

`5` used to belong to `wring judge` alone. A parked graph makes the same claim
that code exists for — *nothing was decided; a person must act* — and `0`
there would make `wring graph run && deploy` ship a graph nobody approved.
SPEC_JUDGE §2 says so in its own words rather than being quietly contradicted.
`wring verify` and `wring run` still provably never return it, and neither do
`status` and `explain`: they report on the claim, they do not make it.

## The graph file

House config rules, verbatim: `version: 1`, unknown keys are hard errors,
strict validation everywhere, and **no command strings, anywhere**.

```yaml
version: 1
id: issue-to-mr                 # a slug; it names directories

inputs:
  task: examples/tasks/example-issue.md

state:                          # initial routing state — strings only in v0
  approved: "false"

budgets:
  wall_clock: 7200              # whole-graph, seconds — REQUIRED

nodes:
  read-intent:
    kind: intent
    input: inputs.task          # a dotted reference, never "${...}" templating
    writes:
      brief: state.brief
    then: approve-plan

  approve-plan:
    kind: human
    prompt: "Review the brief, then set approved: true by hand."
    then: build

  build:
    kind: loop
    budgets: {max_iterations: 4, wall_clock: 2700}
    writes: {status: state.build-status}
    then: route

  route:
    kind: router
    routes:
      - when: "state.build-status == 'converged'"
        to: deliver
    default: fail

  deliver:
    kind: deliver
    then: done
```

That file is real: [`examples/graphs/issue-to-mr.yaml`](../examples/graphs/issue-to-mr.yaml).

Connectivity is `then:` and `routes:` — **there is no separate `edges:`
block**. One representation, so the validator, the renderer and the executor
cannot disagree about what connects to what. The start node is the one no edge
targets; zero or several is a validation error.

### The five node kinds

| kind | wraps | stops the graph when |
|---|---|---|
| `intent` | staging an input file into evidence | the file is missing |
| `human` | the `approved: false` interlock | always, until a person edits the decision file |
| `loop` | `loop.run` — the whole repair loop | never; its outcome routes |
| `router` | three comparison forms over state | a route targets `fail` |
| `deliver` | `deliver.plan`/`send` and **all its refusals** | the delivery is refused |

Routes may target a node id or the sinks **`done`** and **`fail`**, so a graph
never needs a terminal node whose only job is to stop.

### What `validate` catches

```console
$ wring graph validate examples/graphs/issue-to-mr.yaml
✓ examples/graphs/issue-to-mr.yaml is a valid wringer.graph.v1 graph
✓ 5 nodes, starting at 'read-intent'
✓ 1 intent
✓ 1 human
✓ 1 loop
✓ 1 router
✓ 1 deliver
✓ acyclic, every route reachable, every routed value written
```

Every problem is reported, not just the first — fixing a graph one error per
run is a guessing game. The checks: a missing or wrong `version`, a
non-slug `id`, empty `nodes`, an unknown node kind, an unknown key anywhere, a
`then`/`to` naming nothing, zero or several start nodes, unreachable nodes,
**any cycle**, a router with no `default`, a missing whole-graph `wall_clock`,
and **dataflow** — every state path a router reads must be in the initial
`state:` block or written by some node upstream of it.

That last one is the authoring error nothing else catches. A router comparing
a value nobody sets can only ever fall through to `default`, so the graph
looks correct and quietly does one thing forever. It is checked by walking
forward from the start and accumulating what has been written, so a writer
placed *after* the reader does not count.

## The three rules that matter

### 1. A graph names capabilities, never commands

There is no `command:` key, and a key that looks like one — `run`, `shell`,
`argv`, `exec`, `script`, `cmd` — is a hard error naming the reason:

```console
$ wring graph validate hostile.yaml
wring graph validate: hostile.yaml: node 'build' carries 'command:'. A graph
names capabilities, never commands — there is no key here that puts a command
into Wringer's mouth, and the only file that may is .wringer.yaml, whose gates
are already reviewed as code (SPEC_GRAPH_V0 ruling 1)
```

Refused by key *name* rather than by inspecting a value, because the danger is
the capability, not the string: `argv: [...]` is no safer than
`command: "..."`. The one file allowed to put a command into Wringer's mouth
is still `.wringer.yaml`, whose trust story is documented, reviewed and
guarded. **Validating and running a stranger's graph file is exactly as safe
as running the same Wringer commands by hand.**

There is also no expression engine. A router understands three forms and
nothing else:

```
state.X == 'value'   ·   state.X != 'value'   ·   state.X in ['a', 'b']
```

Parsed by grammar, strings only, first match wins, a missing state path
matches nothing, `default` required. Anything outside those three is a
validation error naming them. There is no `eval` in this module and there
never will be.

### 2. State routes; only bundles gate

This is the difference between a graph engine and a liar.

A human node's `state_updates` can write anything into routing state,
including `build-status: converged` for a repo whose gates never passed. It
will route the graph straight at the deliver node. **The delivery will still
refuse**, because the deliver node hands `deliver.plan` a *bundle path* and
the protections are the shipped refusals: gates-passed, tree-unchanged-since-
verify, vacuity, and the rest.

```console
$ wring graph resume .wringer/graphs/20260808-190736-384b --send
graph forged — resuming 20260808-190736-384b
→ approve  (human)
→ route  (router)
→ send-it  (deliver)

✗ failed — refusing to deliver 20260808-190736-8f43 — its gates did not pass
(`test` failed). An unverified change does not get a branch

Graph evidence: .wringer/graphs/20260808-190736-384b/
```

Exit 1. The decision file said `approved: true` and
`state_updates: {build-status: "converged"}`, and `--send` was typed. Nothing
moved.

The forgery *did* route — that is what state is for, and pretending otherwise
would be testing the wrong thing. It shipped nothing, because delivery
re-reads the evidence. Wringer's thesis, applied to Wringer's own feature.

`tests/test_graph_deliver.py::test_a_forged_converged_state_still_cannot_deliver`
plants exactly that lie and watches the refusal.

### 3. `--send` is typed on the invocation, and no file may carry it

The amended law 6 says git history moves only on a flag a human typed. So the
flag is typed on the graph invocation:

```bash
wring graph run graph.yaml --send
wring graph resume .wringer/graphs/<id> --send
```

It authorises the deliver node **that invocation** reaches, **once**. Without
it the node completes as a dry run — the patch, message, branch and MR body
land on disk, git is untouched, and the report says what to type next.

A graph file may not declare it and a decision file may not carry it, because
**a file is not a typed flag**:

```console
$ wring graph validate carries-send.yaml
wring graph validate: carries-send.yaml: node 'deliver' 'send:' is not a key a
file may carry. `--send` is typed on the invocation — `wring graph run …
--send` or `wring graph resume … --send` — and authorises the deliver node
that invocation reaches, once. A file is not a typed flag (SPEC_GRAPH_V0
ruling 5)
```

Resuming a parked graph means typing it again: parking ends the invocation
that was authorised, and if the authorisation survived the park, the park
itself would be the file that carried the flag. The flag is held in memory for
the length of one process and is written into no artifact — a test reads the
ledger, the manifest, the state snapshot and the resolved graph to prove it.

**A deliver node never opens a merge request.** The spec names `deliver.plan`
and `deliver.send`, and the forge is a socket this program opens rather than
git in a subprocess. Widening that is a spec change, not a slice. So
`wring graph run --send` is the fourth command in Wringer that can put bytes
on a network, and it reaches one only by running the same `deliver.send` a
person would have run by hand — see [SECURITY.md](../SECURITY.md).

## Which run bundle a deliver node ships

**Decided, not guessed at runtime.** A deliver node ships the run bundle *this
graph's loop node recorded*: `nodes/<loop>/loop.ref.json` names the loop
bundle, and that loop's manifest names the `final_run` its last verification
wrote. The last loop node to finish wins, read from the ledger rather than
from the graph's shape — after a router, the shape has more than one answer.

It is deliberately **not** `evidence.latest_run`. The newest directory under
`.wringer/runs/` is whatever was written last, which includes a `wring verify`
somebody typed by hand while the graph was parked. Shipping that would attach
this graph's approval to a run this graph never saw. A graph with no completed
loop node therefore fails and says so, rather than reaching for whatever is
nearest.

## Budgets nest and are hard

The whole-graph `budgets.wall_clock` is required — a graph without a wall
clock is exactly the thing that runs all night. A loop node's own
`max_iterations`/`wall_clock` are clamped to the graph's *remaining* budget
before the loop starts, and passed to `loop.run` as its own parameters, so
enforcement is the loop's existing enforcement rather than a second timer to
keep honest.

Every loop outcome — `converged`, `max_iterations`, `no_progress`,
`oscillating`, `budget_exhausted`, `flaky_gate`, `authority_moved`,
`environment`, `interrupted` — is a **routing fact, never a graph failure**.
A loop node ending any of them reads `failed` or `done`, never `parked`:
`parked` is reachable only through the `Parked` exception, which ends the whole
invocation. The node
completes and writes the reason into its declared state path; the router
decides what it means. A graph that treated `no_progress` as a crash could not
express "escalate to a human", which is the whole point of having a router.

The repo's own `.wringer.yaml` supplies the worker and the gates. A graph
cannot substitute either, and `run.prove: true` binds here as everywhere: a
graph cannot loosen it.

## The bundle

`.wringer/graphs/<graph_run_id>/`, schema `wringer.graph.v1`, obeying every
house rule the other bundles obey:

```
graph.jsonl          append-only, prev_hash-chained — THE TRUTH
graph.resolved.json  the validated graph AS EXECUTED
state.json           a convenience snapshot, never read back as authority
manifest.json        schema-versioned index over the ledger
summary.md           the human read-out, including what to type next
digests.json         written LAST, covering everything above
nodes/<id>/          brief.md · prompt.md · decision.yaml
                     loop.ref.json · deliver.ref.json
```

- **The ledger is the truth.** Resume reconstructs from `graph.jsonl` and
  never trusts the snapshot. Doctor `state.json` all you like; it changes
  nothing.
- **The bundle owns a `Redactor`** built from every credential name the config
  declares, and every write goes through it — including the intent node's
  staged file, which is a copy of something that may hold a secret in
  cleartext. `tests/test_no_secret_in_any_bundle.py` drives a whole graph run
  and then reads every file under `.wringer/`.
- **Loop and delivery bundles are referenced by path, never nested.** One run,
  one bundle, one place.
- **Completed nodes are never re-run.** Re-running an intent node would
  restage its input; re-running a loop node would spend a worker's time again
  on work that was already done.

## Parking, and resuming

The `human` node is [SPEC_INTENT](../SPEC_INTENT_V0.md) §3's interlock, again
and on purpose. Its first execution writes `prompt.md` and `decision.yaml`
into the node's directory and parks the graph at exit 5:

```yaml
approved: false      # written as a constant
comments: ""
state_updates: {}    # applied to state on approval; strings only
```

Three rules hold verbatim: **`approved: false` is written as a constant; no
flag, environment variable or model reply may flip it; resume re-reads the
file from disk every time.** Unapproved on resume is still parked, exit 5, and
one `node.parked` event per park rather than one per look.

A `kill -9` leaves a ledger that simply stops. That is *interrupted*, not
parked — `wring graph status` says so, because calling it parked would send
somebody to edit a decision file nobody is waiting on. Resume picks up at the
next node either way.

```console
$ wring graph explain .wringer/graphs/20260808-190736-384b
graph forged — 20260808-190736-384b

It stopped at 'approve' (human) — parked.

Why:
  a person must approve this node

Next:
  1. Edit this file by hand and set `approved: true`:
       .wringer/graphs/20260808-190736-384b/nodes/approve/decision.yaml
     Nothing else can approve it — no flag, no environment
     variable, no model reply.
  2. Then:
       wring graph resume .wringer/graphs/20260808-190736-384b
```

`explain` only ever offers actions that would work. A failed graph has a
`graph.finished` event, so `wring graph resume` refuses it — and `explain`
does not offer it there.

## Rendering

```bash
wring graph render graph.yaml            # what the file says today
wring graph render .wringer/graphs/<id>  # what actually ran
wring graph render graph.yaml --output docs/flow.mmd
```

Both forms use one renderer, generated from the same object the executor
walks, so the two can never become two pictures. A test parses the Mermaid
back and compares nodes and edges against the resolved graph — derived on both
sides, because four hand-maintained lists went stale in one release this month
and a diagram is the easiest of all to let rot.

## What a graph is not

Binding non-goals: any new network path · any new command execution surface ·
LLM calls · `fanout`/`join` · sub-graphs · cron or watch modes · a TUI or web
UI · OpenTelemetry · graph templates or a registry · cross-repo graphs ·
numeric or boolean router comparisons · editing `.wringer.yaml` from a graph ·
Windows.

Parallelism belongs to the fleet. When parallel branches arrive they will
arrive as a `fleet` node wrapping the real fleet, with its invariants
included — not as a second unsupervised pool.
