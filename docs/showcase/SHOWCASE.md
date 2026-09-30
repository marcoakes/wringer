# Showcase

One command reproduces the showcase on a machine with Bun, Git and Node:

```sh
bun run build && bun scripts/showcase.ts
```

It runs four compiled public journeys and writes [showcase.json](showcase.json),
the record of the last run, with machine paths removed. Together the journeys
carry everything the qualification plan asks a showcase to carry:

| Required | Where it is shown |
| --- | --- |
| The graph | The parallel journey runs a version 2 graph: a fork, two private branches, a join, a review hold and a delivery |
| All candidate and integration evidence | The join's integration record and its fresh verification against every branch plan; the tournament's eligibility, validated challenges, replays and selection |
| A restart demonstration | In both graph journeys, a process killed after the first branch result is resumed; the finished branches are reconciled, not repeated |
| A source-bound review and delivery | A review decision bound to the exact revision and candidate, then an explicit Send of the exact evidence commit to a review branch |
| An offline audit | A fresh clone of the review branch runs the carried reader with Node alone; an edited export is refused |
| A future-improvement proposal with comparison results | The gate journey registers a stronger check with a prediction, evaluates it on held-out items against a frozen oracle, and prepares, sends and adopts it for future plans only; a weakened check that looks greener is refused |

The fourth journey sends one external A2A task from the public binary to a local
reference peer and verifies the returned patch before review and delivery.

## What the showcase does not show

Every journey uses a separately compiled fixture binary for role replies or the
verifier, a local bare origin and scripted decisions. It demonstrates the
mechanism: the records, refusals and audit trail. It does not demonstrate live
agent behaviour, real containment, a real A2A peer, independent human acceptance
or any comparative benefit. Commits, times and digests change between runs,
because each journey builds fresh repositories; the stages and outcomes are what
reproduce.

The evidence levels of each capability are in the
[capability ledger](../CAPABILITY_LEDGER.md). The comparison that could show a
benefit is [registered](../qualification/PILOT_REGISTRATION.md) and has not run.
