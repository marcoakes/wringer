# Pilot qualification — registration

Registered 30 September 2026, before any pilot task has run. This page and
[pilot-registration.json](pilot-registration.json) fix the design. The JSON
carries a digest of its own content, and a test refuses it if any field changes
without a new registration. Nothing here is a result.

## Purpose

The pilot estimates task-level variance and shows whether Wringer's orchestration
helps on real work. It is a pilot, not a powered benchmark and not a
state-of-the-art test. Its result will design a second, untouched comparison.

## Arms and comparisons

| Comparison | Arm A | Arm B | Tasks it applies to |
| --- | --- | --- | --- |
| Primary | Wringer contained loop with its checks, judge and repair | The same builder and model used directly on the same task | All 20 |
| Single loop versus graph | One loop | A serial or parallel graph | Serial-dependency and parallel-integration tasks |
| Single candidate versus tournament | One attempt | A three-attempt tournament with a prosecutor | Adversarial-candidate tasks |
| Baseline versus adopted gate | The task family's current gates | A gate set qualified and adopted through `wring experiment gate` | Repair tasks in that family |

Both arms of every comparison get the same builder, model, task text, repository
commit, checks and total resource ceiling. Actual usage is reported. The
evaluator never changes between arms. No improvement is credited to a feature
whose comparison did not run.

## Tasks

Twenty bounded tasks across three repositories, one of them a user-facing
application:

| Task class | Count |
| --- | --- |
| Ordinary repairs | 7 |
| Serial dependencies | 4 |
| Parallel integration | 3 |
| Interruptions and recovery | 2 |
| Human review decisions | 2 |
| Adversarial candidates | 2 |

The exact tasks are frozen before the first run: repository, commit, task text,
checks and the hidden acceptance evaluator for each. Freezing them is a new
registration, which cites this one's digest. Each task runs twice per arm.
Repetitions are averaged within the task; the task is the unit.

## Endpoints and rules

- **Primary endpoint:** the number of tasks whose delivery an independent
  reviewer accepts, review-ready, within the declared budget, out of 20.
  Model non-convergence and honest stops count as failures and stay in the
  denominator.
- **Minimum useful effect:** four more accepted tasks in arm A than in arm B.
- **Regression limits:** no false acceptance in the adversarial tasks; median
  active human minutes per task no more than 20% above arm B; every published
  delivery passes its portable audit.
- **Uncertainty:** the paired task-level difference with an exact two-sided sign
  test and a 95% bootstrap interval over tasks. A pilot of 20 can support only a
  narrow result.
- **Stopping:** fixed sample. No task is added, removed or re-run after results
  are seen, except to repair a documented harness fault, which is reported.
- **Reported always:** every attempt and its outcome, requirement failures,
  active human minutes, intervention counts, wall time, role calls, measured
  billing where available (unknown stays unknown), recovery outcomes and
  fresh-clone audit results.

## Independent observations

Acceptance and usability judgements come from people who did not build Wringer
and did not see the arm labels. Scripted browser clicks and an assistant's review
never count as independent observations.

## Status

Registered, not run. Running it needs live model access, three repositories with
real tasks and independent reviewers; none is available to this restoration.
