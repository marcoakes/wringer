Wringer 1.0.0-alpha.30 lets several independent attempts at one task compete
and tries to falsify every one of them before anything is selected.

```sh
wringer-drive graph plan examples/graphs/tournament/graph.yaml
wringer-drive graph run GRAPH.yaml --authority AUTH.json --state DIR --source-bundle SOURCE.bundle
wringer-drive graph status --state DIR
```

A version 3 graph adds a `tournament`, which closes a fork of attempts instead of
merging them. Phase 6's measurement shows the problem it addresses. Across four
constructed tasks and every candidate order, taking the first attempt that
passed its own check shipped a defect in 16 of 24 orderings. A majority vote
shipped a defect every attempt shared. Requiring a unique survivor never shipped
a defect, but it never selected anything either, because correct alternatives tie.

An attempt is eligible only if its branch ended with a candidate that passed its
own checks. A branch that stops for good arrives disqualified; it no longer ends
the graph. One contained prosecutor session, whose plan may write only
`wringer/challenges.json`, sees every eligible attempt's change, labelled by tree
id rather than branch order. It proposes executable challenges that cite the
attempts' declared requirements.

A challenge counts only after it passes on every trusted control. These are
known-correct commits carried by the graph's root source bundle; a challenge that
fails one is dropped as spurious. The frozen set then runs on every eligible
attempt's exact tree in a contained verifier, so a shared defect is reproduced on
each attempt rather than voted on. Without a control, challenges are advisory
and disqualify nobody.

Selection is among survivors only. One survivor is selected. A tie is
`no-winner` or, when declared, the survivor with the smallest tree id, which is
arbitrary but the same in every branch order. No survivor is `no-winner`. The
selection is written before a final untouched evaluator, pinned in the plan,
assesses every attempt; the evaluator never changes it. A delivery of the
selected attempt carries the graph's export. A fresh clone's Node reader
recomputes the selection from the recorded runs and refuses a record that does
not match them.

New sibling records are `wringer.contained-graph-plan.v3`, `-event.v3`,
`-status.v3`, `-export.v3`, `wringer.contained-graph-tournament.v1` and
`-tournament-assessment.v1`. Version 1 and 2 graphs keep their records, and
published schemas keep their bytes. The phase has 40 isolated reversion checks,
each classified by what removing the guard changed. A compiled walkthrough drives
the public binary through a missing runtime, a crash after the attempts finished,
the prosecutor, a spurious challenge dropped on the control, a hard-coded attempt
disqualified, selection, Send, a fresh-clone Node audit and a refused edited
record. Its role replies come from a separately compiled fixture binary, and its
verifier really runs every check, challenge and evaluator gate on exported trees.
Live agents, real containment, how often real attempts share mistakes, and any
benefit of a tournament over one attempt remain unmeasured.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. The required release jobs verify
those archives and their installer/package routes before staging publication.
GitHub publication does not itself publish an npm package, Homebrew tap or MCP
registry listing. The documented cooperative-local operator boundary remains.

[Graphs, parallel branches and tournaments](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.30/docs/native/GRAPHS.md)
· [Capabilities and limits](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.30/docs/CAPABILITIES.md)
· [Previous release: gate and workflow proposals](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.29)

Temporal durability, A2A and comparative qualification remain subsequent phases
in the restoration plan.
