# Re-lead the README: the thesis to the front, the deferred runtime out

The launch direction decided 2026-08-09 (`WRINGER_NEXT_ACT_PLAN.md`, Move 3):
neutrality and the green-decays thesis are the argument every feature serves,
and they currently sit in paragraph four of the README while the intro
promises a runtime the same direction explicitly deferred.

## The job

1. **The lead blockquote carries the thesis and neutrality.** "In the agent
   era, code is cheap and green is suspect. The scarce resource is warranted
   trust in a passing check — and that trust decays." The trust-nothing stance
   and the eight-hour-burn link stay; the closing line is the one asset no
   vendor can copy: the party holding the receipts has no stake in what they
   say.
2. **The intro stops promising Temporal "tomorrow".** Deferred with a named
   trigger (first external user needing cross-machine durability) — a
   tripwire, not a phase. The intro says what is true today: loops and graphs
   run entirely on your machine, nothing to adopt first.
3. **The vitality demo is drawn in the README** (`docs/health.svg`), beside
   the claim it evidences — a gate dies under a neutering fix, twenty-five
   genuinely green runs later the table reads `zombie`.

## The gate that defines this job

`tests/test_docs.py::test_the_readme_leads_with_the_thesis_and_not_a_deferred_runtime`
is committed RED. It pins all three points by content and stays afterwards as
the re-lead's regression guard, so the thesis cannot drift below the fold
again without a test going red.

## Done means

`wring verify` green — the new guard and every pre-existing README guard
(promise wording, understatements, release-tied counts, network enumerations)
in the same run.
