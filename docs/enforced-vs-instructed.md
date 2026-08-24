# Enforced, not instructed

*The longer form of the sentence in the README's top fold. Written 2026-08-22,
after a teardown of OpenAI's Codex found Wringer's own thesis already written
down — as a prompt. **Extended 2026-08-24**, after a teardown of LangChain's
deepagents found the same thesis SHIPPED — as a judge.*

## The claim, in one line

Every agent harness now tells its model to verify its own work before declaring
victory. Wringer records the check **red before the work** and green after, and
refuses the handover when that transition is absent. An instruction is a hope.
A recorded transition is evidence.

## The distinction is a TRIPLE, and each leg was measured against a different tree

| | the competitor | Wringer | measured against |
|---|---|---|---|
| **enforced** vs instructed | completion is a prompt the model then grades itself against | a recorded transition the run cannot fake | `openai/codex` `343074d` |
| **executed** vs judged | the verdict is a model's opinion over read-only files | the verdict is a check that RAN | `langchain-ai/deepagents` `23b83ad` |
| **refusal** vs exit 0 | the verdict gates nothing; the process exits 0 either way | `wring deliver` stops, and no flag answers it | both |

Two harnesses, both arrived at "the model stopping is not the same as the work
being done", and neither of them can refuse. **The third row is the one a
competitor closes last, because closing it means being willing to say no to
your own user.**

## Why the distinction is not rhetorical

`openai/codex` at `343074d` ships
`prompts/templates/goals/continuation.md`, whose "Completion audit" section
reads, in part:

> Before deciding that the goal is achieved, treat completion as unproven and
> verify it against the actual current state […] The audit must prove
> completion, not merely fail to find obvious remaining work.

That is a good paragraph. It is also **instructions to a model that then grades
itself**: in that harness, "done" is the model calling
`update_goal(status="complete")`, with nothing in the tree checking that any
command ran or that any check changed state. Goals are bounded by token budget,
not by evidence. 112 crates, and none named for verification, evidence,
acceptance, or attestation of work.

So the problem is real enough that the most-watched harness on earth writes a
paragraph about it, and prompting is what it has. **The gap is not awareness.
It is enforcement.**

## The second leg: EXECUTED, not judged

*Scouted 2026-08-23 against `github.com/langchain-ai/deepagents` at `23b83ad`.*

LangChain went further than a prompt and shipped the shape: a goal, acceptance
criteria, and a grader. `update_goal(status="complete")` does not complete
anything — it STAGES a completion note, *"recorded if the accepted rubric is
satisfied"* (`goal_tools.py:314`) — and a separate grader sub-agent commits or
bounces it with per-criterion gap text (`middleware/rubric.py`). That is
worker-proposes / gate-disposes, in public, in about eighty lines.

**It stops one layer short, and the layer is execution.** The grader is an LLM
with READ-ONLY tools — `ls`, `read_file`, `glob`, `grep`, path-validated and
budget-capped. It can confirm that a file SAYS something. It cannot run a
check. There is no red-first, no baseline, no transition, nowhere in the tree.

The difference is not a preference. A grader reading a diff can be persuaded by
a convincing-looking change; a check that was RED and is now GREEN cannot,
because the run happened and the bundle says so.

## The third leg: a REFUSAL, not exit 0

Both harnesses share this one. deepagents' headless `--rubric` loop **exits 0
whether the rubric was satisfied or not**, and their GitHub Action's only
output is `exit_code` — so a CI consumer cannot tell judged-done from gave-up.
Codex's `cloud-tasks` lifecycle is `Pending → Ready → Applied`, where Ready
means a diff exists and Applied means a human applied it, with no verification
between.

`wring deliver` refuses, by name, with the reason in the message and no flag
that answers it. **A verdict that changes no exit code is a comment.**

### One thing this page must not do

deepagents' `RubricMiddleware` is marked `@beta` and is actively moving, and
their own grader prompt already anticipates tools that "run tests". Giving that
grader execution and gating the exit code is a SMALL step for them. When they
take it, the second and third rows above stop being true of them, and **this
page gets edited the same day, by measurement, not defended.** The moat that
survives that step is red-first plus a tamper-evident record plus a refusal —
three things, not one — and saying so now is cheaper than discovering it in an
argument.

### What was measured, in the other direction

The day this page was extended, `wring verify` was installed as a Stop
hook inside `dcode` — LangChain's own harness — and **blocked its agent from
finishing on an unproven change**, then let it finish when the check passed.
Same agent, same prompt, one variable. That capture is
[docs/supervise-their-harness.md](supervise-their-harness.md), and it is the
narrowest possible statement of this page's claim: the difference between
instructed and enforced is one exit code, and it can be demonstrated inside
somebody else's loop.

## What "enforced" means here, concretely

Three mechanisms, none of which is a prompt:

1. **Red before the work, recorded.** A criterion is `evidenced` only when the
   bound gate passes NOW **and** the record shows the same gate failing on a
   run that pre-dates the change. A gate that has only ever been green has
   never told satisfied from unsatisfied, and Wringer says so by name rather
   than counting it.
2. **A refusal, not a warning.** `wring deliver` stops when the transition is
   missing. There is no flag that answers it and no config key that turns it
   off — the interlock only tightens.
3. **A record a stranger can re-check offline.** `digests.json` is sealed over
   every bundle, every ledger event carries the previous line's hash, and
   `wring audit` names the changed file and the broken link. It is
   tamper-**evident**, not tamper-proof: an edit is DETECTED, not prevented
   (see [SECURITY.md](../SECURITY.md)).

The words that appear nowhere in a competitor's tree are **red-BEFORE**. That
is the load-bearing one, and it is the one a prompt cannot supply, because it
is a fact about a run that already happened.

## What this page does NOT claim

- Not that instructing a model is worthless. It raises the floor, and
  continuation.md is a better prompt than most.
- Not that Wringer's checks are good checks. A gate passing says the gate
  passed; it does not say the criterion is met in every case the criterion
  could describe. That limit ships inside every acceptance record.
- Not that a recorded transition proves the fix is the RIGHT fix. A witness
  proves the stated criterion could fail and was made to pass. It certifies no
  agreement with an unstated intended fix, and nothing on any Wringer surface
  may say otherwise.
- Not that any of this constrains the agent. Wringer does not sandbox your
  worker; it runs with the access you have.

## The other half of the sentence

Enforcement is only adoptable if it costs nothing to try, which is why the top
fold pairs it with the structural fact: **any coding agent you can start from a
terminal, any model behind an OpenAI-compatible endpoint.** Nobody has to
switch tools to find out whether their greens are honest.
[docs/vendors.md](vendors.md) is the measured receipt for that half, per vendor,
per lane.

**And one more thing the second teardown changed.** deepagents' wedge is ALSO
model-agnosticism — *"similar to Claude Code, powered by any LLM"* — with
Claude-Code-compatible hooks, env names and `SKILL.md`. They are courting the
same no-lock-in buyer. **So "works with anything" no longer differentiates
against them, and this page must not lean on it.** What differentiates is the
table at the top, and the receipt for the other half is
[docs/vendors.md](vendors.md) — where their own agent is now a
`MEASURED-WORKING` row, because a claim about neutrality that excludes a
competitor's agent is not a claim about neutrality.

Provenance: `~/Claude/WRINGER_CODEX_DOSSIER_2026-08-22.md`, scouted against
`github.com/openai/codex` at `343074d` on 2026-08-22, and
`~/Claude/WRINGER_DEEPAGENTS_DOSSIER_2026-08-23.md`, scouted against
`github.com/langchain-ai/deepagents` at `23b83ad` on 2026-08-23. The dossiers
decide nothing; this page states a positioning claim and names its limits.
