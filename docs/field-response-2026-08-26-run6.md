# Response to the field report of 2026-08-26 (run 6)

The report is
[`docs/field-report-2026-08-26-run6.md`](field-report-2026-08-26-run6.md),
landed verbatim and never edited. This file is the disposition: what was done
about each finding, what was banked, and what is owed. Where this document
disagrees with the report, the report stays as written and the disagreement is
stated here with its evidence.

**Every finding is accepted and every one is fixed.** All four shipped in
`0.4.9`, each red-watched — the fix reverted, one at a time, to watch its own
guard go red.

**The headline is the report's own and it is worth quoting before the
defects:** *"Wringer did the thing it claims: it built working code, passed
every gate it had, and then refused to say 'done' because one requirement
needed a human."* That is the first time the whole chain has run for someone
who is not the author, on a machine the author does not own.

---

## The machine, which is the variable this project keeps failing to hold still

| | |
|---|---|
| Host | macOS 25.5.0, Apple silicon, IT-managed |
| Policy | `forceLoginMethod: claudeai` |
| Builder auth | `authMethod: claude.ai`, enterprise |
| wring | `0.4.8`, from PyPI |
| Worker | `acp: claude-agent-acp`, bare name, **no key** |

Run 5 was made on the same class of machine and its report said so; the
diagnostics window shipped `0.4.7` against it. This run is the first where the
login-only route was actually *driven to a build*, and that is what surfaced
finding 1 — a defect that is invisible on every unmanaged machine, because on
one of those the key route is declared explicitly and no Keychain read ever
happens.

---

## Finding 1 — `worker_env()` dropped `USER`. **The gate-blocker, and it is one name.**

**Accepted, reproduced, fixed.** The report's bisection is now a test fixture.

`acp.worker_env` handed a worker `PATH`, `HOME`, `LANG`. On this machine the
credential is in the macOS Keychain and the agent needs `USER` to resolve its
own item there — so a **logged-in** agent reported `loggedIn: false`, the drive
stopped at `stopped:worker-signed-out`, and the one route an org-pinned machine
has was the one route that could not work. `run_turn` builds its environment
through the same function, so the paid turn would have been equally blind had
the preflight been bypassed. The report is right that this is the highest
severity thing in it.

**`USER` is now the fourth name in the base set**, not something an operator
declares. It is identity rather than authority: it names who is running, opens
nothing on its own, and `HOME` — which has always crossed — already points at
that same person's files. A name every operator on the affected class of
machine would have to declare by hand, to fix a failure whose message points
the other way, is a default in the wrong place. It is absent rather than empty
when this process has none, because handing a worker `USER=""` would be
Wringer asserting an identity nobody has.

The report offers a narrower alternative — *"`agents.py` could declare a
per-agent set of environment names required for credential resolution."*
**Not taken, and the reason is the report's own diagnosis.** A per-agent table
would be a second hand-kept list about somebody else's binary, discovered the
same way this one was: by a person losing a run. Four names for every worker is
smaller than four names plus a table.

### Consequence 2 was worse than the false red, and it is fixed too

> *"The remedy it prints is wrong for this machine in a way that makes things
> worse. … The refusal message walks the operator into the one configuration
> the rest of the documentation exists to warn them off."*

Accepted in full. The stop offered two routes; the operator had already done
the login, so the only apparently-untried route was `env_passthrough` of a key
— which on a pinned machine **is** the refusal.

`worker_auth.refusal` is machine-aware now. It asks the question `wring doctor`
already asks — a `stat` for a coding-agent policy file, through `agents.py`,
**never a read** — and on a machine that has one it names ONE route, says the
key route is refused there, and says to REMOVE a key already declared. Absence
takes the other branch unchanged, because absence is one path checked and never
proof that a machine is unmanaged.

### And the preflight now says so when it PASSES

Fable's ruling on the full run's Q1, landed here because this is the window
that touched the file. The drive emits a `worker-auth` `show` step before it
spends anything — *"the coding agent that will do the building says it is
logged in (…) — checked before anything was spent"*, or a step saying the
question could not be asked when nobody could answer it. **Rendered on the line
that emits it**, which is the full run's finding 2 applied before it could
recur: emitting a step and showing one are different acts.

The engine is asked **once**. The finding the person is shown is the finding the
refusal decided on.

---

## Finding 2 — a subscription login serves a build turn. **Previously unmeasured; now measured.**

Accepted, and it retires a sentence rather than fixing a defect. The runbook
said *"Still unmeasured: whether a subscription login specifically serves a turn
through this adapter, because no machine here has one."* One now has:

    iteration 1/2   ✓ lint  ✓ test  ✗ gb-skip-downstream   → worker 4m 40s (exit 0)
    iteration 2/2   ✓ lint  ✓ test  ✓ gb-skip-downstream

`authMethod: claude.ai`, enterprise, no key anywhere, 5 files changed
(+203 −6). The login route does not merely avoid the refusal — it builds.

`docs/vendors.md`'s anthropic/worker row moves `2026-08-22` → `2026-08-26` and
**the status does not**. It was already `MEASURED-WORKING` on the strength of
the key arm; what this adds is the other credential route. Two arms, one row,
same four words, and the paragraph beneath the matrix says exactly that so
nobody reads a promotion into a date change.

---

## Finding 3 — the travelling surfaces carried no acceptance count

Accepted, and the report is right that this is the product's own thesis aimed
at the product. `board.html` said `NOTHING CHECKS` six times; `acceptance.json`
said it per criterion; `mr.md` and the bundle's `summary.md` said it zero times
between them — and `mr.md` points at `summary.md` as *"the human-readable
report"*. Both were literally true. A reviewer saw three green ticks and the
word `passed`.

Both surfaces now carry the counts, from **one renderer** they quote verbatim.
Fixing this on the surface where the gap was noticed and leaving the other to
catch up is the mistake of 2026-08-22, whose second reader quoted the stale face
four days later.

Two decisions inside it:

- **The counts always travel; the warning only when there is a gap.** A caveat
  printed over a record that proved everything it was asked to prove is how a
  reader learns to skip caveats.
- **`human` renders as "for a person to judge", not "human-judged".**
  `summary.md` is written at verify time, when such a row is usually
  unanswered, and one wording has to be true on both surfaces.

**This is the proto-`CERTIFICATE` surface.** The master plan's next cycle is a
portable, offline-verifiable proof, and the question it has to answer first is
*what does a record say to somebody who was not there*. These two files are the
only ones that currently travel, and until today they said less than the page
that stayed behind. The next cycle starts here.

---

## Finding 4 — `AGENTS.md` step 6 could not be followed after a clean install

Accepted. Step 2 says *"There is nothing to clone and nothing to chain"* — true
of the tool — and step 6 then said `cd wringer-drive/examples/pipeline`. No such
directory exists after `uv tool install wringer`, and the wheel ships no
`examples/`. The run only got past it because a source clone from three weeks
earlier happened to be on the machine.

Step 6 now states that the examples are not in the package, gives the clone
command, and says which half of step 2's sentence is about what.

**The guard is the interesting part, because an existing one was green
throughout.** `test_every_path_the_runbook_names_exists_in_this_repository`
strips a `wringer-drive/` prefix and checks the remainder against *this* tree —
a fact about the repository, not about the reader's machine. The new guard asks
the reader's question instead: it walks the runbook's fenced commands in
document order carrying a working directory, and every relative `cd`/`sh`
target must be produced by one of the page's own earlier steps. A clone of this
repository resolves against this tree, so `sh setup.sh` is checked against the
real file. Red-watched four ways, and it refuses to pass while having walked
nothing.

**Banked, not built: shipping `examples/` in the wheel.** The clone is one
command and the examples are a source artifact with a `setup.sh` that copies a
project; putting them in a wheel is a packaging change with its own questions
(what `wring` does with an installed example path, whether `setup.sh` still
makes sense from `site-packages`). Revisit if the field hits this again after
the fix — which is a checkable trigger, not an intention.

---

## The transport note — not a product defect, and the page still owns it

> *"its polling loop recomputed 'steps seen so far' at the start of each check,
> so a step that arrived between two checks was counted as already-seen and
> never relayed."*

Accepted as written, including that it was the transport's fault and not the
engine's — `resume.json` had `last_question` right throughout, which is what
proved it.

The page had a whole paragraph about writing an answer **too early** and not one
sentence about reading a step **too late**, and only one of those two has ever
been hit twice. Both are the transport's burden, so both are on the page now,
with a guard holding the pair together.

---

## What the report says worked, kept here so it is not quietly broken later

Four of these are load-bearing and none of them is an accident:

- **The preflight stopped before spending** — even while its answer was wrong,
  it refused before the drafting call and said *"Nothing was built and nothing
  has been spent."* Finding 1 fixed the answer and did not touch the ordering.
- **`wring deliver` diagnosed its own staleness.** The report calls this *"the
  best thing in this run"*: a refusal that named the command that would make it
  wrong. That sentence shipped in `0.4.8` in answer to the full run's finding 4,
  and this is the first time a stranger met it.
- **The human criterion held the handover.** Gates green, work done, and it
  still would not deliver until a person judged the one thing no check can.
- **`DECIDED WITHOUT ASKING YOU` surfaced six decisions the drafter took
  unasked**, each with the question it replaced.

---

## Found by shipping this, and it is the same disease the report is about

`USER` joined the base set in `acp.worker_env`, which is where that fact is
made. **Three other surfaces had written the old set out in prose** —
`SECURITY.md`'s "what IS bounded" section, `worker_auth.py`'s module docstring,
and `SPEC_START_V0.md` §3a-ii, which also cited two line ranges that had both
moved. Each was true when written; none was derived. Fixing the fact and
leaving those three is exactly the shape of the report's own Law 1 complaint.

A guard now derives it: anywhere in `src/` or in a non-capture reader-facing
page that names `PATH`, `HOME` and `LANG` close together is describing this
environment and must name every other member of the base set. It found the
third surface, which nobody had looked at.

---

## Owed

Nothing blocking.

- **`examples/` in the wheel** — banked above with its trigger.
- **The claim ceiling on finding 2 is one turn, one machine, one adapter.** The
  row says `MEASURED-WORKING` because it already did; the subscription arm is
  worth exactly one capture and no more.
- **The managed-settings PRESENT branch has now been seen in the field** — run
  5 and run 6, same machine. It is no longer the unexercised branch the
  2026-08-25 response listed as owed. What is still true is that no machine
  available to this repository has such a file, so its own tests drive a path
  they control.
