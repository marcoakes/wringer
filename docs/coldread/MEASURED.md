# The board, measured four times

`PROTOCOL.md` exists so that "the board is readable" stops being a matter of
taste. It has now been run four times — same protocol, same six role prompts,
fresh readers each time, pages regenerated from the same real run.

**One of those four runs was an accident, and it turned out to be the most
useful.** It read the SAME page as the run before it, which makes it a
replication: it measures how much these numbers move when nothing changes.

## The numbers

| run | page | things a reader could not understand | words they had to guess |
|---|---|---|---|
| 1 — baseline | shipped board | **85** | 104 |
| 2 — after structural fixes | reading order, counts, promise, intent | **68** | 91 |
| *3 — replication* | *same page as run 2* | *73* | *96* |
| 4 — after explanatory fixes | + scope sentence, "passes today", judgements pointer | **82** | 94 |

## What the replication bought

Runs 2 and 3 read the same bytes. They differ by **5 confusing items and 5
jargon terms**, and their verdict splits differ by two readers (4 partly / 2
not finished, versus 2 partly / 3 not finished / 1 cannot tell).

So: **the noise band on six readers is roughly ±5 items and ±2 verdicts.**

That retires a claim made after run 2, which said the verdict split had
"shifted 3/3 to 4/2". It had not shifted; it had wobbled. The verdict column
cannot carry a two-reader difference at this sample size, and the earlier
write-up over-read it. The item counts are the sounder measure and the
qualitative reports are sounder still.

## The finding: structural fixes worked, explanatory prose did not

**Round one was structural** — put the verdict before the requirements
document, make the count line account for all ten requirements, scope the
promise to the rows it covers, render the intent instead of leaking raw
markdown. **85 → 68.** Outside the noise band. It worked, and the qualitative
change was clearer than the number: at baseline a reader said *"reading only
the count line, I'd think 8 of 10 were fine"*; afterwards every reader stated
the state correctly and unprompted.

**Round two was explanatory** — sentences added to resolve the contradiction
readers kept hitting, to say the check passes today, and to name the file a
human answer goes into. **68/73 → 82.** Also outside the band, in the wrong
direction.

The readers said why. On the sentence written specifically to resolve the
contradiction:

> *"The page pre-empts me on this — 'it may test more than this requirement
> does, but it only proves this one' — but that just tells me the bookkeeping
> is the problem, not the software. I cannot tell whether I have a half-built
> feature or a fully-built feature with a paperwork gap, and those need
> completely different responses from me."*

> *"the feature is probably built and working, and what is unfinished is the
> paperwork… but I cannot tell that from the page, I'm inferring it, and the
> page actively tells me not to."*

**The sentence acknowledged the problem instead of resolving it**, and left
the reader knowing there was a gap without being able to size it. That is
arguably worse than silence.

## What that means for the next attempt

The question a reader actually needs answered is not *"does this check count
for that requirement?"*. It is:

> **Is this a half-built feature, or a fully-built feature with unbound
> checks?**

Those need completely different responses from the person reading, and the
board holds enough to tell them apart — the gates sidecar carries proposed
bindings, and the check's own assertion names are right there on the page.

**That is a design change, not a wording change**, and the evidence here is
that reaching for a wording change first made things worse. It is not
attempted in this record; the next run has to earn its number.

## What is still unfixed

- The distinction above. This is the largest one.
- Ninety-odd words a reader has to guess at, essentially unmoved across all
  four runs. Structural fixes did not touch the vocabulary.

## The ceiling, unchanged

**These readers are models prompted as people, not people.** A lower bound on
the confusion, not a measurement of it. A human run is still owed, and the
replication above is a reason to want one: if six model readers wobble by two
verdicts on identical bytes, six humans will wobble at least that much.
