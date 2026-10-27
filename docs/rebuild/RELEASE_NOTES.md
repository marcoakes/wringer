Wringer 1.0.0-alpha.38 completes the improvement loop: a finished comparison leaves a
record of what it established, the next proposal reads it, and the job page shows the
whole research trail.

```sh
wring experiment evaluate --job JOB_ID --experiment ID
wring experiment evidence --job JOB_ID --replicate-set ID --proposal ID
wring job improvements --job JOB_ID
```

**Lessons.** When a registered comparison is decided with every planned trial
recorded, `evaluate` records a lesson. It holds the prediction, the held-out counts,
and the exact playbook difference the trials used, file by file. An inconclusive
comparison records nothing. The next proposer reads lessons under `LESSONS/`, without
the per-task findings that would name held-out tasks. No model writes a lesson, and a
fixture comparison can refute but never qualify.

**The job's research view.** The job page and `wringer.inspect_improvements` show:

- replicate sets and where their attempts disagreed;
- each proposal, with its status and the trajectory lines it cites;
- how many comparisons qualified or were refuted.

None of it can collect, propose or adopt.

**Proposals from a job.** The proposal commands accept `--job JOB_ID --proposal ID`.
Evidence built this way fences every held-out task of the job's comparisons, by
identity and source tree. It refuses replicates that ran a held-out source.

**A registered live test.** [Pilot amendment 1](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.38/docs/qualification/PILOT_AMENDMENT_1.md)
registers "no playbook versus a proposer-written playbook" on the pilot's seven repair
tasks. It uses the pilot's endpoint, minimum effect, regression limits and
fixed-sample rule. It is registered, not run.

Tested with real Git fixture comparisons and a Chromium rehearsal of the job page.
11 guards were each removed alone; every one turned its test red on the first run.

Not measured: a live comparison, a live lesson, or any benefit from a proposed
playbook. Nothing here claims an improvement.

Native macOS arm64 and Linux x64 archives retain checksums, inventories, signed
provenance and exact-artifact claim reports. GitHub publication does not itself
publish an npm package, Homebrew tap or MCP registry listing. The documented
cooperative-local operator boundary remains.

[The improvement route in ten steps](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.38/docs/improvement/README.md)
· [Proposals](https://github.com/marcoakes/wringer/blob/v1.0.0-alpha.38/docs/native/PROPOSALS.md)
· [Previous release: propose from evidence](https://github.com/marcoakes/wringer/releases/tag/v1.0.0-alpha.37)
