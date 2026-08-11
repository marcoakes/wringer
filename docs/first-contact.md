# First contact — a real model at both ends, and what it measured

*The first cycle since this repository began in which a real model stood at
both ends of the goal sentence: a real drafter turning a PRD into a spec, and
a real coding agent handed a repair brief. It ships **no feature**. It is a
measurement, and per `~/Claude/WRINGER_FACTORY.md` §5 that is said out loud
rather than implied: the one commit of code it carries
(`8053f90`) is a defect fix that had to land before the measurement could mean
anything, and everything else here is evidence.*

**The headline, stated before the detail, because it is not the comfortable
half.** The drafting half worked: a real model turned an eight-line PRD into a
spec that passed every parser on the first try. It also produced **zero
installable gates and zero criterion bindings**, so nothing it drafted can
evidence anything. The agent half never started: Wringer's `session/new` omits
a field the Agent Client Protocol's own schema marks **required**, so the
agent refused the session in 502 ms and no turn ever ran.

Both are findings this program existed to produce, and neither could have been
found by the test suite. 1216 tests pass against the code that does this.

---

## What ran, and where the evidence is

| half | command | outcome | evidence |
|---|---|---|---|
| F | `wring spec PRD.md --send` | exit 0, a spec written | `.wringer/specs/20260811-111842-1762/` |
| B | `wring bench` | exit 0, two rows, neither a winner | `.wringer/benches/20260811-112248-ed0a/` |

The scenario for both is the committed fleet-scale scenario, **re-staged by
extraction rather than by transcription** — the gate scripts, the worker, the
spec, the sidecar and `.wringer.yaml` lifted out of `scripts/demo.sh`'s
`fleetscale` section, and the PRD lifted out of the fenced block in
[pm-loop.md](pm-loop.md). Nothing in the probe's scaffolding names a gate or
counts them; the staging script reports the set only after reading the staged
config back off disk:

```
derived from /Users/marc/Claude/wringer at 8053f900…
  scenario: scripts/demo.sh  section 'fleetscale'
  files:    10 — .wringer.yaml, build.sh, g_cents.py, g_hdr.py, g_rows.py,
            patch.py, reports.py, test_reports.py, wringer.gates.yaml,
            wringer.spec.yaml
  PRD:      docs/pm-loop.md  sha256 f579c43d…

  gates installed, HEAD 8c36d944…

gate set, read back off the staged config: 4 — test, g-hdr, g-rows, g-cents
(derived, never named by this script)
```

The acceptance gates arrived through the repository's own committed pipeline —
`wring plan --json | python3 patch.py | git apply` — so they came from the
committed sidecar through Wringer's own renderer and a human-applied diff.

That mattered immediately. The first extractor bounded the section at the
first `fi`, which sits **inside** the worker's own heredoc, and silently staged
a plausible five-file scenario. A transcribed scenario would have been wrong in
a way nothing could have noticed.

---

## The F-half — a real drafter

```
$ wring spec PRD.md --send

Drafted wringer.spec.yaml — CSV export button on the reports page
  7 criteria (1 need a human) · 1 proposed gates · 3 tasks
  11 required questions it could not answer for you

  approved: false   ← nothing runs until you change this by hand

Draft evidence: .wringer/specs/20260811-111842-1762/
```

28.7 s end to end, 28.4 s of it the model. `input_tokens: 736`,
`output_tokens: 2049`, `thinking_tokens: 0`.

**The reply passed every parser on the first try** — `spec.parse`, the rubric
validator, `config.parse_gate` — with no hand-fix needed to make it load.
Neither interlock was touched: no `approved` key in the reply, and it did not
answer its own open questions.

### The gate finding, which is the M1 result

The drafter proposed one gate. Wringer discarded it:

```
Already declared, so not proposed: test. Check they run what the spec meant.
```

`wring plan --json` on that spec:

```
gates_proposed: []
gates_already_declared: ['test']
gate_diff: ''
```

And no `wringer.gates.yaml` was written at all. Both halves of that were
pre-decided before the call, and both are structural rather than a bad day:

- **No sidecar, by construction.** The drafter prompt asks for
  `gates: [{id, run}]` and never for `gate_bindings` (`spec.py:595-608`),
  while the sidecar is written only from `gate_bindings` (`spec.py:716`) and
  only `if proposed:`. There is no route from that prompt to that file.
- **No gate either, on this input.** The one gate it proposed was the one the
  repository already declares — which the prompt explicitly told it not to do
  ("Propose only gates that are missing"). Wringer's own renderer caught it,
  which is the renderer working; the net remains zero.

So the drafter produced seven criteria and three tasks, and **nothing that
could evidence any of them**. Vacuity's born-green check never fired — not
because it failed, but because no proposed gate reached the diff for it to
look at. That is a consequence of the above and not a separate result.

### The M1 diff, and exactly how far it reaches

| input | sha256 |
|---|---|
| `PRD.md` (the fenced block in `docs/pm-loop.md`) | `f579c43df3d4bc76088cd0d12f18ff5c9dc31f3cae98baaf163bcaa5e9aa1bab` |
| hand-written sidecar (`scripts/demo.sh`, `gategen` section) | `29f94934b1241b36b5654c83f33d26ee0af4d52b2446b5777d6f881fe95803c5` |
| drafter sidecar | **absent** — the finding above |

The baseline binds three gates to three criteria. The drafter produced none.

**No clause of that difference may be read as a drafter score.** The
hand-written baseline was authored from the spec's own `intent:` block and not
from this PRD, so the comparison spans two different inputs as well as two
different authors. It bounds agreement. It ranks nobody.

### What a person still had to do

Twelve edits, measured by making them on a copy so the drafter's output stays
pristine as evidence: flip `approved`, and answer eleven required questions.
`wring plan` refuses at each stage and names what is missing —

```
wring plan: wringer.spec.yaml says 'approved: false', so nothing was written.
```

```
wring plan: 11 required questions in wringer.spec.yaml are unanswered:
  - column-set-and-headers: Should the CSV include a header row, and should
    column names match the on-screen labels exactly or use internal field names?
  …
Write an 'answer:' under each, or delete the question if it no longer matters.
Building on an assumption is how the wrong thing gets built confidently.
```

— and then accepts:

```
Wrote tasks.jsonl — 3 tasks.
Wrote 3 briefs: briefs/export-data-path.md, briefs/export-control-ui.md,
briefs/export-tests.md
Wrote wringer.rubric.yaml — 7 criteria (1 need a human).
```

Eleven required questions from eight lines of PRD is the drafter obeying its
first instruction ("Never guess") hard. Whether that is the right trade for a
product manager is not something this run measured.

### One number that validates a config ruling

The drafting reply was **2049 output tokens**. Wringer's own
`max_output_tokens` default is 1024. The run set it to 16000 deliberately; at
the default this reply would have been truncated, and the truncation would
have been recorded as a drafter failure.

### The shim, and what it did

`judge.send` speaks Bearer-auth chat-completions and reads
`choices[0].message.content`; the target API speaks `x-api-key` and a
`content[]` array. A local stdlib-only translation shim on `127.0.0.1` bridges
exactly that and nothing else, and logs every translation it makes:

```
[001] POST /v1/chat/completions (2340 bytes)
[001] request: dropped temperature=0 (the target rejects it)
[001] request: lifted the system message to `system`
[001] upstream answered 200 in 28.4s
[001] response: 1 block(s) ['text']; kept 1 text block(s), discarded none
[001] response: stop_reason=end_turn
```

It lives beside the repro scripts and **never in `src/`**: Wringer was not
taught a second wire format for this. Its own source is preserved beside its
output so a reviewer can check it adds nothing. The credential was read from
the Keychain per invocation into the shim's environment only — `wring` itself
was never given it for this half — and a scan of every artifact this cycle
produced (377 files across four trees) found zero occurrences.

---

## The B-half — a real agent, which never got a turn

```
→ acp

iteration 1/5
✓ test passed        0.0s
✗ g-hdr failed       0.0s
→ worker             0.5s  (exit 1)

iteration 2/5
✓ test passed        0.0s
✗ g-hdr failed       0.0s
→ scripted
…
  acp              no_progress      2 iter     0.9s
  scripted         no_progress      4 iter     1.1s
```

| contender | outcome | iterations | wall clock | tokens | cost |
|---|---|---|---|---|---|
| `acp` | no_progress | 2 | 0.9s | — | — |
| `scripted` | no_progress | 4 | 1.1s | — | — |

**A failed row is a measurement.** It was not retried and the agent was not
debugged into working. What the ledger records:

```json
{
  "type": "worker.finished",
  "iteration": 1,
  "exit_code": 1,
  "duration_ms": 502,
  "worker_kind": "acp",
  "acp_error": "Invalid params"
}
```

### Why, established from the protocol's own schema

`Invalid params` is a JSON-RPC rejection. The Agent Client Protocol schema
shipped inside the installed agent (`@agentclientprotocol/sdk`, alongside
`claude-agent-acp` 0.66.0) says:

```
NewSessionRequest   required: ['cwd', 'mcpServers']
InitializeRequest   required: ['protocolVersion']
PromptRequest       required: ['sessionId', 'prompt']
```

Wringer sends `{"cwd": str(root)}` and nothing else (`acp.py`, `session/new`).
`mcpServers` is **required**, not optional. `initialize`'s only required field
is one Wringer does send, and the prompt was never reached, so the rejected
call is `session/new`.

That is dossier §3's first first-contact unknown, and the answer is **no** —
this agent does not accept `session/new` without `mcpServers`. It is a defect
in Wringer, found by contact and by nothing else: the repository's own fake
ACP agent accepts the request, so all 1216 tests pass against it.

**It is recorded here and deliberately not fixed.** The charter that ordered
this probe rules the fix out of its own scope, and a one-line change to a wire
call is exactly the kind of thing that should be ruled rather than improvised
at the end of a measurement session.

### A second, smaller thing the same row shows

The ledger says `Invalid params` and does not say **which request** was
rejected. Wringer's ACP error path carries the agent's message and drops the
method, so diagnosing a first-contact failure meant reading someone else's
schema. Adding the method to that message costs nothing and is the difference
between a five-minute diagnosis and this section.

### The scripted row is not a comparison, and must not be read as one

The scripted contender is the fleet-scale scenario's own worker, which
branches on `WRINGER_TASK_ID` — a variable `wring fleet` sets for its children
and `wring bench` does not. Under bench, the branch that fixes `g-cents` is
unreachable, so that gate could never go green and the row stops on
`no_progress` at four iterations. It closed `g-hdr` and then `g-rows`, each
red first, one per lap.

So both rows read `no_progress` for entirely unrelated reasons: one never
opened a session, the other ran a worker whose relevant branch bench cannot
switch on. **There is no winner here and no comparison was made** — bench
crowns nobody by design, and this pairing would not have supported one even if
it did.

---

## The measurements, one by one

| id | what it asked | answer |
|---|---|---|
| M1 | drafted criteria + sidecar, diffed; schema pass/fail; hand-edits; vacuity on real output | **answered** — pass first try; zero gates and zero bindings; twelve hand-edits; born-green had nothing to check |
| M2 | per-row outcome, iterations, wall clock, tokens, cost | **answered, and one row is a refusal** — table above |
| M3 | does a real agent turn gates green that were never red? | **BLOCKED** — no turn ever ran. Named blocker: `session/new` rejected |
| M4 | per-turn durations vs the 120 s assumption, and four first-contact unknowns | **one answered, three blocked** — below |
| M5 | `wall_clock_ms` for a real-agent repair chain | **the field carries a number and the number is not the thing** — 906 ms, which is a failed handshake and not a repair chain |
| M6 | the first cost number in the OKR's denomination | **no usage on the ACP row** — and the reason is not the one the box anticipated |

### M4's four unknowns

| unknown | answer | evidence |
|---|---|---|
| `session/new` without `mcpServers` | **No.** Rejected as `Invalid params`, with the agent naming the field | the ledger event above; the postscript's direct probe |
| `fs/write_text_file` vs the agent's own filesystem calls | **BLOCKED** — no turn ran | — |
| whether the `terminal` capability is needed | **PARTIAL** — not needed to open a session; unknown for doing work | the postscript |
| whether the agent emits `usage_update` at all | **BLOCKED** — same | — |

Three of four are blocked behind the first, and that is the shape of a
first-contact failure: everything downstream of the handshake is unobservable
until the handshake works.

**Per-turn duration against the 120 s assumption is also unmeasured for a
repair turn** — the only ACP duration this run produced is 502 ms to a
rejection. The one real model latency measured anywhere here is the drafting
call's 28.4 s, which is a different kind of call and bounds nothing about a
repair turn.

### M6, stated with its reason

`usage.json` is absent from the ACP row's loop bundle and the bench table's
`tokens` and `cost` columns read `—`. Per `bench.py`, absent means
**unreported, never zero**.

The pre-decided reading of an absent usage row was "the agent does not report
spend, and the OKR's unit cannot be recorded from this harness". **That is not
what this run shows.** The session never opened, so there was nothing to
report and no model call was made on this row. Whether this agent reports
`usage_update` remains unknown, and the OKR's cost denomination remains
unrecorded for the same reason it was unrecorded yesterday.

---

## Which clauses of the goal sentence were measured

> A product manager writes an advanced spec, hands it to Wringer, it takes in
> the repositories, and hours later there is working software at enterprise
> quality.

- **"A product manager writes an advanced spec, hands it to Wringer"** —
  **measured, for the first time, against a real model.** A real PRD went in
  and a real spec came out, valid on the first try, needing twelve hand-edits
  and carrying nothing that could evidence itself.
- **"hours later there is working software"** — **not measured.** No agent turn
  ran. No claim about elapsed time is made anywhere on this page beyond the
  wall clocks recorded above, and those are 906 ms and 1068 ms of failure and
  scripted repair respectively.
- **"at enterprise quality"** — untouched by this cycle.

One more thing the F-half shows about the first clause, which no gate can
catch: the criteria the drafter wrote describe a web reports page — rendering
a control, a download disposition, pagination — while the repository it drafted
into is a six-line Python module with no web layer at all. The drafter was
shown the PRD and the repository's **gate commands**, never its code. The spec
is coherent, valid, and not buildable where it landed.

---

## What the charter that ordered this run got wrong

Three things, recorded because a probe that reports only its own confirmations
is the failure mode this program exists to catch.

1. ~~**The thinking block.**~~ **WITHDRAWN 2026-08-11 — this finding was wrong,
   and it was wrong in the direction that matters.** It read: the charter ruled
   thinking would be on and a `thinking` block would lead the reply, and the
   first call returned one text block with `thinking_tokens: 0`, so
   `content[0].text` would have worked and the charter's stated reason did not
   occur.

   A later call on the same model, same parameters, returned
   `['thinking', 'text']` with **1149 thinking tokens**. The charter was right;
   the behaviour is simply not deterministic, and one call is not a
   measurement of it. `content[0].text` would have returned a block with no
   `text` key and handed `spec.parse_response` an empty reply — the exact
   failure the charter described, filed as scaffolding's fault.

   Left visible rather than deleted, because a probe that quietly edits out its
   own wrong findings is worth less than one that keeps them: **n=1 against a
   stochastic system is an anecdote**, and this page asserted a general fact
   from a single sample while its own limits section says agents are
   stochastic.
2. **The bench pairing.** The charter chose the fleet-scale scenario for both
   halves so every output would have a hand-authored baseline. It did not
   notice that that scenario's worker branches on a variable only `wring fleet`
   sets, which makes one of its gates unreachable under `wring bench`. The
   scripted row is therefore uninformative as an incumbent.
3. **The pre-decided M6 reading.** The charter pre-decided what an ACP row with
   no usage would mean. The row arrived with no usage for a reason the charter
   had filed under a different heading entirely — a handshake refusal, not a
   silent agent — so the pre-decision, though it fired, was about the wrong
   thing.

---

## What is now known to be broken, and left alone

Neither of these is fixed here. Both are inputs to the next ruling.

- **`session/new` omits `mcpServers`**, which the protocol schema marks
  required. No real agent session can open. The repository's fake agent accepts
  the request, so the whole suite passes over it.
- **The ACP error path drops the method name**, so a wire rejection is recorded
  without saying which call was rejected.

---

## Postscript, 2026-08-11, a few hours later — the handshake, measured

*Everything above is left exactly as it was written. This section adds what a
second, **free** probe established: it stops after `session/new` and never
sends `session/prompt`, so no model call is made and nothing is spent.*

The page above named `session/new` as the rejected call **by elimination** —
`initialize`'s only required field is one Wringer sends, and the prompt was
never reached. That inference is now unnecessary. Run directly against
`claude-agent-acp` 0.66.0, sending exactly what Wringer sends today, the agent
names the field itself:

```json
{"code": -32602, "message": "Invalid params",
 "data": {"_errors": [], "mcpServers": {"_errors": ["Required value is missing"]}}}
```

And the same request with one field added opens a session:

```
A — exactly what Wringer sends today   session/new: REFUSED
B — plus mcpServers: []                session/new: OPENED   sessionId present
```

**So the one field is the whole fix, and that is measured rather than
reasoned.** It matters because a cost estimate was resting on it: if adding
`mcpServers` had merely moved the refusal to the next wall, "one field" would
have been the wrong thing to rule against.

Three smaller things the same probe recorded, all free:

- **`initialize` succeeds and protocol version 1 is negotiated.** The agent
  identifies as `@agentclientprotocol/claude-agent-acp` 0.66.0.
- **The `terminal` capability is not required to open a session.** Wringer
  offers `fs` read/write and no terminal — SPEC_ACP_V0's v0 non-goal — and the
  session opened anyway. That is the third M4 unknown *partially* answered:
  whether the agent needs terminal to do useful **work** still needs a turn,
  and no turn has run.
- The agent advertises `loadSession`, session `fork`/`resume`/`list`, and
  `mcpCapabilities` for http and sse — none of which Wringer uses.

The two defects this page names are still **not fixed**. The probe is a
measurement and lives outside `src/`, like the rest of this cycle's
scaffolding.

---

## Postscript 2, 2026-08-11 — the re-run, and the first agent turn

*Everything above is still unedited. The wire fix landed (`a93f4ef`), the
probe was re-run attended, and **an agent took a turn** — the first in this
program's life. What follows replaces the blocked rows above; it does not
revise them.*

```
→ acp
iteration 1/5    ✗ g-hdr failed    → worker  4m 37s  (exit 0)
iteration 2/5    ✓ test ✓ g-hdr ✓ g-rows ✓ g-cents

  acp        converged     2 iter   277.8s   41301 tokens, 0.750919 USD
  scripted   no_progress   4 iter     1.0s
```

**M2.** The ACP row converged in two iterations. The scripted row is unchanged
and still uninformative for the reason given above — its `g-cents` branch is
keyed to a variable `wring bench` does not set.

**M5.** `wall_clock_ms: 277844`. The goal's own unit, for a real-agent repair
chain, recorded for the first time.

**M6.** **`0.750919 USD`**, 41301 tokens, agent-reported and unverified
(`bench.py:56`). The first cost number this program has ever held in the OKR's
denomination — against a $2 target, for a task of this size, on one run.

### M4 — all four unknowns, answered

| unknown | answer |
|---|---|
| `session/new` without `mcpServers` | refused; **with** it, the session opens and the turn runs |
| `fs/write_text_file` vs the agent's own filesystem calls | **its own.** Wringer served zero writes |
| the `terminal` capability | **not needed** — the string never appears in the session, and the agent ran commands through its own tooling |
| whether the agent emits `usage_update` | **yes** — 49 of them in one turn, the last carrying the cost |

**And the per-turn duration, which is the one that vindicates P1: the turn took
277.3 s.** The cap this cycle removed was 120 s. Without that fix the agent
would have been killed mid-turn, at well under half its working time, and the
ledger would have recorded `timed_out` — a converging agent filed as a failure,
on the first run anybody ever did.

**The `fs` answer deserves its own line.** Wringer advertises
`fs: {readTextFile, writeTextFile}` and the agent used neither: it edited the
file directly, through its own tools, and asked no permission (the binary
launches itself with `--permission-mode dontAsk`). So `_inside()`, the
path-escape refusal that keeps an agent inside the repo it was pointed at,
**never ran**. Whatever containment that check provides, it does not provide
it against this agent. That is not a fix for this cycle; it is a fact this
cycle now knows.

### M3 — E's measurement, and the answer is yes

**The agent closed three gates in one turn, and two of them had never been
red.** Read from the run record: iteration 1 ran `test` then failed `g-hdr`
and stopped there — `wring verify` stops at the first required failure, so
`g-rows` and `g-cents` never ran at all. Iteration 2 ran all four green.

The acceptance artifact on that green run:

```json
"counts": {"evidenced": 0, "unevidenced": 3, "gate-failed": 0,
           "gate-did-not-run": 0, "human": 0}
```

Every criterion `"refuses": true`, each with the same reason — *"passed, but
nothing in the record shows it can fail — a gate born green evidences
nothing."*

So the chain that reaches `wring deliver` when a scripted worker takes one
step per call **does not reach it when a real agent fixes everything at once**.
This is the one-verify-arms-one-gate hole, predicted in `docs/gategen.md`'s
postscript as a candidate blocker and now measured on a real agent rather than
reasoned about.

**Two honest qualifications**, because this row is E's input and must not
overclaim:

- `hdr`'s gate *did* go red, and it is `unevidenced` anyway — but that is **by
  design, not the hole**: the red run happened inside a bench worktree, and
  `accept.py` deliberately never counts a bench-sourced run as a receipt. The
  clean demonstration is `rows` and `cents`, which were never red anywhere.
- Nothing was delivered. Bench does not reach delivery — that is why it was
  the instrument — so this is what the artifact *says*, not a refusal anyone
  hit.

**No fix is proposed here and none was made.** The acceptance→delivery seam is
the next ruling's, and this is its evidence.

### The fix the agent wrote, since a green row is not a good row

```python
def to_csv():
    """The report as CSV — the table's header and every row, amounts as money."""
    header, *rows = table()
    buf = io.StringIO()
    out = csv.writer(buf, lineterminator="\n")
    out.writerow(header)
    for name, amount in rows:
        out.writerow([name, f"{amount:.2f}"])
    return buf.getvalue()
```

Honest: a real implementation using the standard library, no gate touched, and
the agent checked that only `reports.py` had changed before finishing. It also
went and read the installed `wring`, considered running `wring verify` itself,
and declined on the grounds that upgrading the local install was outside what
the task authorised.

### What the goal sentence can now claim

The second clause — **"hours later there is working software"** — has its first
measurement, and the honest form of it is: *four minutes and thirty-seven
seconds later, three acceptance gates were green and none of them could be
evidenced.* Both halves of that sentence are the finding.

---

## Postscript 3, 2026-08-11 — the drafter binds, and the bindings are worthless

*The prompt was amended to ask for `gate_bindings` (`2a16d04`). This is that
change measured against the real model rather than against a test, because
"the prompt asks" and "the model answers usefully" are different claims and
this repo refuses the weaker one.*

**The mechanism works.** Same PRD, same shim, 27s, 972 in / 2049 out. The reply
carried `gate_bindings` for the first time, they survived `parse_bindings` and
`check_bindings`, and **a real model wrote a `wringer.gates.yaml` sidecar** —
something that had never happened.

**The bindings are worthless, and it is not a prompt-tuning problem.** All
three:

```yaml
  - id: bind-export-button
    run: python3 test_reports.py
    proves: export-button-present
  - id: bind-export-filter
    run: python3 test_reports.py       # the same command
    proves: export-respects-filter
  - id: bind-valid-csv
    run: python3 test_reports.py       # and again
    proves: valid-csv-output
```

`python3 test_reports.py` is the repository's existing test and it **passes
today** — so every binding is green at birth, which is the one thing the
prompt explicitly told it not to do ("a command that FAILS today").

The reason is structural, not stylistic. The drafter is shown the PRD and the
repo's **declared gate commands**, never its code, and it cannot create a
file. A gate that fails today for a feature that does not exist has to *be*
something — a test somebody wrote. The drafter can only name a command, so the
only commands it can honestly name are ones that already exist and therefore
already pass. **Naming the binding channel was necessary and is not
sufficient**, and the missing half is not more prompt.

**The safety net held, which is the part that matters.** Applying the diff and
verifying:

```
acceptance: {"evidenced": 0, "unevidenced": 5, "gate-failed": 0,
             "gate-did-not-run": 0, "human": 1}
```

and `summary.md`, where a person actually looks:

```
## Bound gates that have never been red

- ⚠ **`bind-export-button` should be RED.** It proves `export-button-present`,
  and nothing in the record shows it can fail. …
```

Three warnings, one per weak binding, and delivery refuses. **A model proposed
three gates, and the harness declined to call any of them evidence.** That is
the architecture doing exactly what it was built for, on the first occasion it
had ever been tested by a real proposal rather than a fixture.

Worth being precise about one thing, since it looked like a defect for a
minute: `wring plan` printed the diff with no warning at all. That is correct —
`wring plan` runs nothing, by ruling, so it cannot know a proposed gate's
colour. The colour is discovered by the run that follows, and that is where the
warning lives.

---

## Postscript 4, 2026-08-11 — the agent wrote its own acceptance tests, and the chain delivered

*The whole arc was filmed end to end for the first time: real drafter, real
agent, `wring deliver --send`. **The recording is not published**, because of
what it recorded. It is kept as evidence outside this repository, and this is
what it found.*

Ten steps ran. Every one exited the way a demo would want. The result was
`evidenced: 4, unevidenced: 0`, a pushed branch — and it should not have been.

**What happened, in order:**

1. The drafter proposed four bindings, each running a test in
   `test_csv_export.py` — **a file that did not exist**.
2. The gates therefore failed at once, with `ModuleNotFoundError`. Red, but
   for the wrong reason: not *the feature is missing*, but *the test is
   missing*.
3. `wring run` handed that to the agent, which **wrote `test_csv_export.py`
   itself**, along with the feature it checks.
4. `--prove` re-ran the gates on the pre-change tree, where they failed
   (no module), and on the changed tree, where they passed. Fail-then-pass is
   a `sensitive` receipt.
5. Acceptance counted four of them. `wring deliver --send` pushed.

**So the harness certified four criteria whose acceptance tests were written
by the same agent that wrote the code.** That is the shape this product exists
to refuse, reached on the default path, with nothing constructed to provoke it.

### What this is and is not

- **It is not a new hole.** `accept.py`'s limit 4 states it — *a gate whose own
  command arrived with the change reads sensitive for that reason alone* — and
  SPEC_VACUITY_V0 §5a says `--prove` cannot see this class. Both were written
  before any of this ran.
- **What is new is that it happened by itself**, on the first real end-to-end
  run, from an ordinary PRD, with no adversarial input. A documented limit that
  fires unprompted on the happy path is a different thing from a documented
  limit.
- **The tell was there and nothing acted on it.** Each receipt's `cites` reads
  `FAILED (errors=1)`, which is an import error and looks nothing like an
  assertion failure. A person reading the receipt could catch it. The counts
  could not, and delivery did not.

### The other thing the run exposed, which is mine

The recording's human-correction step **did nothing and reported success.**
`rebind.py` matches the criterion ids used in the rehearsal (`hdr`, `rows`,
`cents`); the real drafter named its criteria `csv-column-parity` and so on, so
the script matched nothing, changed nothing, and printed *"rebound the
acceptance gates to the checks that are red today"*. A step that looks like it
worked and did not is worse than a step that fails, and it is exactly what a
rehearsal against hand-made fixtures cannot catch.

**No fix for any of this is made here.** The seam is E's, it was ruled on
2026-08-11 on the evidence available then, and this is new evidence about that
ruling rather than a licence to re-decide it in a build window.

## What this page does not say

- No winner. Two rows stopped for unrelated reasons and neither was scored.
- No cost. Nothing here priced a token, and the one usage figure quoted is the
  drafting call's own report, unverified.
- Nothing about whether the drafted spec is *good*. It is valid, and validity
  is the only claim made.
- Nothing about an agent's ability to repair code. That was the measurement
  this run went looking for and did not get.
