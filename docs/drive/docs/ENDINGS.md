# The four ways a run ends, and what to do about each

Every run finishes in one of four states. Three of them are refusals, and that
is not a fault — **a refusal is the product working.** Anything can show you a
green tick. The point of this one is that it will not show you a green tick it
cannot back up.

Here is how to tell which one you are in.

---

## 1. "Nothing was built" — the repository was never eligible

> Nothing was built. This project has no tests or checks that could prove the
> work was done, and inventing one would prove nothing. Ask an engineer to add
> a test command.

**What happened.** Wringer looked for commands this project already declares —
a `test` script, a lint command, a Makefile target — and found none. It stopped
before calling a model, so this cost you nothing.

**Why it will not just guess one.** A check Wringer invented would be a check
nobody agreed to, passing or failing for reasons nobody chose. A green tick from
a made-up check is worse than no tick.

**What to do.** This one is not yours to fix. An engineer adds a test command,
and then the repository is a candidate. You can find this out in advance, before
writing anything, with `wring doctor` — see step 3 of
[START-HERE](../START-HERE.md).

---

## 2. "NOTHING CHECKS THIS YET" — built, and honestly unproved

You will see this on the plan, *before* you approve anything:

```
  Steps waiting directly on a failed step are not executed
    must — NOTHING CHECKS THIS YET. It will be reported as unevidenced
    and it will not be claimed as done
```

**What happened.** The requirement is clear and the agent can work on it, but
nothing in the repository can decide whether it was actually met. So the work
happens and the claim does not.

**Expect several of these.** On one real run, nine of ten requirements landed
here. That is the normal state of a codebase, not a bad day.

**What to do.** Two honest options and one wrong one.

- **Accept it.** The work still gets done; you just do not get a proof. Say yes
  knowing which parts are unproved — the plan tells you before you commit.
- **Get a check written first.** Somebody writes a check for that requirement
  *before* the work starts, so it is failing when the run begins. Then it can be
  proved. This is what both examples here do.
- **The wrong one:** having the agent write the check as part of the same work.
  That check passes because it was written to pass, not because the work is
  right. Wringer treats a check that arrived with the work as proving nothing,
  and it is correct to.

---

## 3. "This needs you" — held for a human judgement

> summary-readable-at-a-glance — HUMAN
> nobody has answered this — a person decides it, and records the decision

**What happened.** Some requirements cannot be checked by anything — taste,
tone, whether a summary actually reads well. Those are marked as yours from the
start, and the handover waits for your answer.

**Why nothing answers it for you.** No part of this product will write your
judgement, and there is no flag that skips it. A tool that quietly decided
"looks fine to me" on your behalf would be worth nothing.

**What to do.** Look at the work and decide. **Right now that means an engineer
recording your answer in a file**, which is a rough edge we know about — there is
no PM-facing way to answer a judgement yet.

---

## 4. "DONE — AND PROVED" — and what "red first" means

> **DONE — AND PROVED** — A step whose dependency failed is never executed
> **It was red first.** *This check has been recorded failing — the run that
> failed it is in this repository's evidence.*

**What happened.** A check that decides this requirement passed — and the same
check is on the record having **failed**, before any of the work, in a run kept
in the repository.

**Why that second half is the whole product.** A check that has never failed
might be testing nothing at all. Most green ticks in most codebases have never
been seen to fail, so nobody knows whether they can. This one has, so its
passing means something changed.

**What to do.** Nothing. This is the state you were after, and the evidence sits
in the repository for anyone who wants to check your work.

---

## One more thing you should not trust

**None of this says the change was the one you had in mind.**

A proof shows that a stated requirement could fail and was made to pass. If the
requirement was worded loosely, a green check against it proves the loose thing
perfectly. Wringer checks a check's *consequences*, never its wisdom — that is
your job, and it is why you are shown the plan before anything is built.

Related: on one real run the agent edited a file that the acceptance check
itself reads. The change happened to be harmless, the record named the file, and
the requirement still came back proved. That gap is known, written down, and not
yet fixed.
