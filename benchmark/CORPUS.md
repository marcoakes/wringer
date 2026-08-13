# The corpus selection rule

**Written 2026-08-13, before any task that costs money has been run.** That
ordering is the whole point of this file: *whoever picks the tasks can pick the
result*, so the rule goes down first and the excluded tasks are published beside
the kept ones. A corpus assembled after seeing the numbers is not a corpus, it is
the finding.

Nothing in here has been applied yet. The corpus is **empty**, and §5 says what
exists instead.

---

## 1. What a task must have to be in

All five, and a task missing any one of them is excluded with that reason
recorded:

1. **A held-out test set written by upstream, for this issue, after the fix.**
   The `FAIL_TO_PASS` shape. Without it the task cannot be scored and there is no
   independent signal at all.
2. **A red baseline.** The held-out tests must fail at the base commit. If they
   pass, there is nothing to repair and both arms score trivially.
3. **The repo's own suite must be runnable offline at the base commit**, and must
   pass there apart from the held-out set. A task whose *existing* tests are
   already broken measures the environment.
4. **A licence permitting this use**, recorded per task.
5. **A statement that names no test file.** The harness refuses a task whose
   statement mentions a held-out filename, but the rule exists so tasks are
   written that way rather than discovered to be void.

## 2. What excludes a task, even if §1 is satisfied

- **A docs-only or pure-refactor fix.** No `FAIL_TO_PASS` set exists, so it is
  undecidable — §1.1 by another route, listed separately because it is the most
  common reason a promising issue is unusable.
- **A task needing the network at test time.** The arms stop being comparable and
  the isolation story collapses.
- **A task whose fix is in the held-out test itself.** Then the signal and the
  work are the same artifact.
- **Anything a maintainer asked not to be used this way.**

## 3. The rule that decides difficulty, and it is the one that can void the whole run

> **The corpus must contain tasks where a good agent plausibly declares success
> wrongly.**

A corpus of easy issues makes both arms score identically and the
false-confidence cell — the one that decides the claim — is empty *by
construction*. So difficulty is a selection criterion and not an accident:

- **At least half the tasks must be ones where the repo's own declared gates do
  not fully cover the issue.** That is exactly the condition
  `demo-narrow-gates` demonstrates, and it is where Wringer can lose.
- A task is **not** excluded for being too hard. An agent that fails honestly
  produces a true refusal, which is a real data point.

## 4. Sampling honesty

- The rule above is fixed before selection and is **not** edited after any task
  runs. If it must change, the corpus is rebuilt and the old rows are published
  as a separate, earlier corpus.
- Every candidate examined is recorded — kept or excluded, with the reason —
  in a table appended to this file.
- Selection is done **before** any arm runs, and the task list is committed
  before the first paid run.
- 3–5 repositories, 10–20 tasks. Fewer repositories than that and the result is
  about one codebase's testing culture.

## 5. What exists today

**Nothing selected.** The corpus table below is empty, and the harness has been
proven only on tasks nobody selected:

| task | kind | costs | what it proves |
|---|---|---|---|
| `demo-narrow.yaml` | scripted | nothing | the harness, and a **Wringer loss** — precision is bounded by the repo's own gates |
| `demo-covering.yaml` | scripted | nothing | the harness, and the claim demonstrated |
| `smoke-real-agent.yaml` | **real agent, one repo we control** | **$0.135 measured** | that the agent path works end to end — **RUN 2026-08-13**, both arms `true_confidence`, see [docs/benchmark-first-run.md](../docs/benchmark-first-run.md). **Not a corpus task and not evidence about agents** — one draw on a planted bug |

`smoke-real-agent.yaml` is the first thing to run when the account has credit,
and it exists so that the $80–400 is not the first time a real model meets this
harness. It is deliberately **not** in the corpus table: the repo is ours, the
bug is planted, and one draw of one task measures nothing about anything.

**It has now run, and it demonstrated §3's rule by falling foul of it.** Both arms
landed in `true_confidence` — the real agent wrote the honest one-line fix with and
without supervision, so the task discriminates nothing and the cell that decides
the claim stayed empty. That is the correct outcome for an easy task and it is why
§3 is a selection criterion rather than a hope. Full record, including the three
defects the run found:
[docs/benchmark-first-run.md](../docs/benchmark-first-run.md).

Worth carrying into selection: the two most interesting cells this project has
produced still come from a worker *written* to be dishonest. Whether a real agent
ever lands in them is unmeasured, and a corpus of easy tasks will never find out.

## 6. Candidates examined

Empty. One row per candidate, kept or excluded, appended as selection happens.

| repo | issue | licence | kept? | reason |
|---|---|---|---|---|
| — | — | — | — | nothing examined yet |
