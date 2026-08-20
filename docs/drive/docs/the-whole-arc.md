# Prose in, a refusal, a correction, work out

One arc, end to end, from real captured bytes. Every block below is output a
run actually produced — nothing here is written to illustrate a point.

**What this shows:** a person writes what they want in plain English; the tool
decides some things for them and says which; they overrule one; it builds;
and it refuses to hand over what it cannot prove.

**What this does NOT show, said here rather than at the bottom:** a stranger
reading the final page and understanding it. Six proxy readers tried on
2026-08-19 and none could say whether the work was done —
`wringer-board/docs/coldread/2026-08-19-six-readers.md`. This arc is the
mechanism working. Whether the last screen of it is *legible* is a separate
question with a worse answer.

---

## 1. Prose

`PRD.md`, written by a person, no format required:

```markdown
# Recently played

People lose their place in the arcade. When someone comes back, the games
they actually played should be right there at the top, not buried in the
grid. Show a few of the most recent ones above everything else.
```

```bash
wringer-drive run ../PRD.md --repo .
```

## 2. It asks — at most three things, and only what a person can answer

From a real drafting reply (`wringer/tests/replies/2026-08-19-arcade-run4`):

```
Does simply opening a game from the cabinet count as having played it, or
should it only be remembered after the person actually plays for a while
(and if so, roughly how long)?
```

Three is a limit the parser enforces, not a request the drafter is trusted to
honour. Four measured runs asked 2, 2, 2 and 3.

## 3. It says what it decided WITHOUT asking

The part that did not exist before 2026-08-19. Measured across those four
runs, the drafter took **fourteen decisions** it never mentioned — writing
them into test guidance, where the person approving never reads them as
decisions. Now:

```
DECIDED WITHOUT ASKING YOU

  These were decided for you. Approving this plan approves them.
  Each one says the question it replaced, so you can ask it after all.

  memory-scope
    The list is remembered per browser only.
    Why: the requirements describe no accounts, so nothing can follow a
    person between devices.
    You were not asked: Should the recent list follow you to another browser?
```

## 4. The plan, in two registers

```
WHAT I WILL BUILD

  A player who finishes a game sees it at the top of their recent list the
  next time they open the page.
    For the engineer: add a browser-local store keyed by game id, written on
    game end and read on page load.

WHAT WILL HAPPEN AT THE END

  1 of 10 have a check bound to them.
  1 is yours to decide — no check can, and you record the answer yourself.
  8 have nothing checking them yet.

  Approving this plan accepts that the ones with nothing checking them will
  not be proved.
```

That last sentence is the consent this whole surface exists to obtain, and no
version of the plan asked for it before this one.

## 5. The correction

The person disagrees with the decision in §3. They do not edit YAML:

```bash
wringer-board revise --id memory-scope --text "No — one browser is fine."
```

Two things happen, and the second is the point:

1. The decision becomes a **question they answered**, in `open_questions` —
   the channel the builder's brief is written from, so their correction
   reaches the work rather than sitting in a sidecar nobody reads.
2. **Their approval is withdrawn.** The plan is rendered again and must be
   approved again. A revision means the plan they agreed to is not the plan
   any more.

The plan now shows it as settled, not as a live decision:

```
  memory-scope
    NO LONGER DECIDED FOR YOU — you answered this: No — one browser is fine.
    (it had been: The list is remembered per browser only.)
```

## 6. It builds

```
[  49.2s] show     build:iteration    the check failed, as it must first
[  71.8s] show     build:worker-turn  the agent changed 2 files
[  96.7s] show     build:converged    the checks it was asked to satisfy are passing
```

The check was seen to fail **before** the work. A check that was green all
along cannot tell satisfied from unsatisfied.

## 7. It refuses

Real ending, real exit code (`verify-drive2/console.txt`):

```
[  97.0s] stopped  stopped:acceptance_unevidenced
          The handover is being held because at least one requirement cannot
          show its proof.

          wring deliver: refusing to deliver 20260819-091946-6180 — its gates
          passed, but the spec is not satisfied by the record:

            heading-reads-as-yours — HUMAN
              nobody has answered this — a person decides it, and records the
              decision in `wringer.judgements.yaml`

=== exit 1 · 2 interview questions · 3 consent gates · 97s ===
```

**The build converged and the handover was still refused**, because one
requirement was a person's to judge and no person had judged it. Exit 1.

That is the arc. Not "it worked" — *it did the work, and then declined to
claim more than it could show.*

## What it cost

2206 prompt tokens and about 5000 completion tokens for the drafting call,
plus the worker's turns. The board reports the counts its own records carry
and does not price them.

## Where this is thin

- §5's correction is shown from the verbs and their tests, not from one
  continuous captured session. The rest is captured output.
- The final page is the one six readers could not read. See the top.
