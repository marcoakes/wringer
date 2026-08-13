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

**86 commits examined across five repositories; 25 passed mining;
5 were then dropped by an independent reader told to refute them;
13 are in the corpus.** §4 requires every candidate to be recorded
kept or excluded, with the reason, and this is that list rather than a summary
of it. The ones that were mined, survived refutation and were still not taken
are marked as such: they are held in reserve, and taking them later would be a
SECOND corpus published beside this one, never an extension of it.

| repo | commit | verdict | reason |
|---|---|---|---|
| marshmallow-code/marshmallow | `f07eadc87dfa` | **IN THE CORPUS** | `marshmallow-email-idn` — Fix validate.Email to accept IDNs (#2937) |
| marshmallow-code/marshmallow | `9f751e1cef94` | **IN THE CORPUS** | `marshmallow-data-key-in-schema-validator` — Fix handling data_key in ValidationErrors raised in schema validators (#2792) |
| marshmallow-code/marshmallow | `070dde08bad4` | **IN THE CORPUS** | `marshmallow-constant-required` — Fix Constant field with required=True raising ValueError (#2901) |
| marshmallow-code/marshmallow | `252090c7c707` | **dropped by the critic** | THE FIVE MECHANICAL RULES ALL HOLD — I reproduced every number (base 65374df0 pristine '1137 passed in 13.69s' clean tree; injected test red with "Val |
| marshmallow-code/marshmallow | `902f99c4151d` | survived, not selected | Fix URL validator rejecting a fragment after an empty path (#3016) — held in reserve; 13 of 20 survivors were taken |
| marshmallow-code/marshmallow | `94234acd1a98` | excluded while mining | Handle post_load methods that append to data (#2797). Technically valid on all five rules - measured: base '1224 passed in 1.30s', red 'FAILED tests/t |
| marshmallow-code/marshmallow | `024b5d09e9f0` | excluded while mining | Fix Enum field by-name lookup to only return actual members (#2902). Measured and valid: base '1138 passed in 0.88s', red '3 failed in 0.25s' (three p |
| marshmallow-code/marshmallow | `65374df0c31c` | excluded while mining | Fix OneOf.options() emitting phantom entries when labels outnumber choices (#2909). Measured and valid: base '1137 passed in 1.86s', red 'FAILED tests |
| marshmallow-code/marshmallow | `a45329dfde2f` | excluded while mining | Fix case sensitivity in validator (URL schemes). Measured and mechanically valid: base '1118 passed in 1.86s', red 'FAILED tests/test_validate.py::tes |
| marshmallow-code/marshmallow | `19ca8dce2d5b` | excluded while mining | Fix Constant field rejecting None values during load (#2894). Measured and valid: base '1131 passed in 1.95s', red 'FAILED tests/test_deserialization. |
| marshmallow-code/marshmallow | `2b84b56e9a80` | excluded while mining | (fix) missing constant with len validation (#2861). Measured and valid: base '1117 passed in 1.62s', red 'FAILED tests/test_deserialization.py::TestFi |
| marshmallow-code/marshmallow | `8dc078e2b863` | excluded while mining | fix issue #2891 (file:// URL case sensitivity). EXCLUDED under rule 3: upstream committed the tests FIRST, in the parent commit c62b9113 ('add tests f |
| marshmallow-code/marshmallow | `c62b9113dc0e` | excluded while mining | add tests for issue #2891. Tests-only commit, no source change, so no FAIL_TO_PASS task exists for it (it is the cause of 8dc078e2's red baseline). |
| marshmallow-code/marshmallow | `72ac4a04208f` | excluded while mining | Reject booleans in from_timestamp_ms, consistent with from_timestamp (#2904). Diff inspected, not measured: the source change is 2 added lines in src/ |
| marshmallow-code/marshmallow | `4acb783c7313` | excluded while mining | Fix Unreachable Warning (#2935). Diff inspected: touches CHANGELOG.rst, pyproject.toml and src/marshmallow/fields.py only - NO test file changed. Typi |
| marshmallow-code/marshmallow | `3bc191ab3c8c` | excluded while mining | Fix Field.error_messages type to allow dict and list values (#2907). Diff inspected: mostly src/marshmallow/types.py annotations plus a 5-line touch t |
| marshmallow-code/marshmallow | `c847ad47a3f1` | excluded while mining | Typing improvements to marshmallow.validate (#2940). Diff inspected: CHANGELOG.rst and src/marshmallow/validate.py only, no test file. Pure typing - n |
| marshmallow-code/marshmallow | `c1e727e16bed` | excluded while mining | Add support for IDNs to validate.URL (#2928). Diff inspected: a feature addition (new capability), not a bug fix, and it edits the same _regex_generat |
| pallets/click | `a1235aacb1be` | **IN THE CORPUS** | `click-zsh-completion-colons` — Fix Zsh completions with colons (#2846) |
| pallets/click | `7d05a59b9d46` | **IN THE CORPUS** | `click-parameter-source-during-convert` — Fix get_parameter_source() during type conversion and eager callbacks |
| pallets/click | `546f2851f414` | **dropped by the critic** | DROP. The red/green/baseline all reproduce (base ae46cfd, baseline 1364 passed; red = 4 nodes; green = 14 passed), but the task is broken in a way the |
| pallets/click | `1241abaed4e4` | **IN THE CORPUS** | `click-help-hint-shadowed-name` — Use non-shadowed help option name in error hint |
| pallets/click | `3a3e0350b6a2` | survived, not selected | Split string values from `default_map` for multi-value parameters — held in reserve; 13 of 20 survivors were taken |
| pallets/click | `762c97eef7c1` | excluded while mining | 'Fix double-bracketing of choices in synopsis'. VALID on all five criteria and fully measured - baseline at parent 8929d392781c8113bc569f388c15c47b94f |
| pallets/click | `0f71fe771cee` | excluded while mining | 'Fix dual-option arbitration to respect explicit defaults'. Mechanically it is the richest task I found - baseline at parent c943271a269e6941fcc51e350 |
| pallets/click | `32ae2acd3474` | excluded while mining | 'choice shell autocompletion to use normalize_choice()'. Fails criterion 1: the commit adds NO test. Its only test change edits an existing parametriz |
| pallets/click | `701b313160be` | excluded while mining | 'Fix completions for quoted/escaped parameters in Fish (#3013)'. Fails criterion 1 in spirit: `git diff` over tests/ shows zero added `def test_`; the |
| pallets/click | `1b0e19f50595` | excluded while mining | 'Don't include envvar in error hint when envvar not configured'. No new test function - three assertions appended inside the existing tests/test_optio |
| pallets/click | `3b16957cba71` | excluded while mining | 'Make `prompt`/`ParamType` typing work without runtime `typing_extensions`' - typing/packaging change, no behavioural FAIL_TO_PASS set. Screened from  |
| pallets/click | `051725fa7e0c` | excluded while mining | 'Add tests to deprecations. Better deprecate streams.' - primarily test additions plus a deprecation-shim change, not a bug fix. It also introduces te |
| pallets/click | `e3c0898975a7` | excluded while mining | 'add codespell pre-commit hook' - tooling/spelling chore across 11 files, no FAIL_TO_PASS set. Screened from `git show --stat`; not executed. |
| pallets/click | `745464765a3f` | excluded while mining | 'remove colorama' - dependency removal / refactor, not a bug fix. Screened from `git show --stat`; not executed. |
| pallets/click | `d15f3c23a177` | excluded while mining | 'fix: Skip flaky pager test on macOS with free-threaded Python 3.14t' - test-only change, no source fix to reproduce. Screened from `git show --stat`; |
| pallets/click | `7eb57cff7cd2` | excluded while mining | 'Fix pager test race by raising before yield' - test-harness race fix, environment-dependent and not a library bug with a held-out set. Screened from  |
| pypa/packaging | `e7f035135278` | survived, not selected | Fix post-release boundary intersections and unsatisfiable cases (#1257) — held in reserve; 13 of 20 survivors were taken |
| pypa/packaging | `b68980bcd1f6` | **IN THE CORPUS** | `packaging-arbitrary-equality-intersection` — Fix arbitrary equality intersection preservation in `SpecifierSet` (#951) |
| pypa/packaging | `25b1f44e0e9e` | **IN THE CORPUS** | `packaging-filter-exclusionary-bridges` — Fix pep440 edge case in `SpecifierSet.filter` (#942) |
| pypa/packaging | `07265129295b` | survived, not selected | fix: normalize nested extra marker values (#1246) — held in reserve; 13 of 20 survivors were taken |
| pypa/packaging | `5b583e309996` | **dropped by the critic** | VOID AS RECORDED. One of its three declared FAIL_TO_PASS tests cannot be passed by a semantically correct independent fix. tests/test_markers.py::Test |
| pypa/packaging | `b002be54d39b` | excluded while mining | fix(markers): only parse versions on certain keys (#939). MEASURED AND REJECTED on rule 3. The commit deletes/rewrites existing tests (3 removed test  |
| pypa/packaging | `189a76d54d64` | excluded while mining | fix(parser): require true end of input (#1345). FULLY MEASURED AND VALID: baseline '62341 passed, 1 skipped, 427 deselected in 193.45s (0:03:13)', red |
| pypa/packaging | `16f558722612` | excluded while mining | Fix > comparison for versions with dev+local segments (#1097). Examined diff only, not measured. Adds NO new test function — the coverage is extra pyt |
| pypa/packaging | `cf2cbe2aec28` | excluded while mining | Fix prerelease detection for `>` and `<` (#794). Examined diff only, not measured. No new test functions (parametrize rows only) and 2 existing test l |
| pypa/packaging | `a1f705642e50` | excluded while mining | fix: support nested parens in license expressions (#931). Examined diff only, not measured. No new test functions — coverage is parametrize rows in te |
| pypa/packaging | `9b972011a531` | excluded while mining | Fix canonicalizing specifiers on comparison (#1109). Examined diff only, NOT measured (time budget). Structurally viable: 0 modified test lines, 2 new |
| pypa/packaging | `210d878577f7` | excluded while mining | fix: only ASCII allowed in local version (#1102). Examined diff only, not measured. No new test functions (parametrize rows only), and it touches thre |
| pypa/packaging | `08bb047794f4` | excluded while mining | fix: DirectUrl auth stripping with @ in passwords (#1218). Examined diff only, not measured. Structurally clean (0 modified test lines, 1 new test fun |
| pypa/packaging | `c4fb81ff6eba` | excluded while mining | fix(ranges): require matching pre-release policy in difference (#1306). Examined diff only. 13 modified/deleted test lines — the commit rewrites exist |
| pypa/packaging | `d2fa92384821` | excluded while mining | fix(ranges): preserve autodetected prerelease policy when union collapses to full (#1295). Examined diff only, NOT measured (time budget). Structurall |
| pypa/packaging | `d8e08df11bfa` | excluded while mining | fix(requirements): make Requirement.__hash__ consistent with __eq__ (#1232). Examined diff only, not measured. No new test functions — coverage is par |
| pypa/packaging | `ba17fcea2367` | excluded while mining | fix(utils): is_normalized_name rejects collapsed double-hyphen names (a--b) (#1230). Examined diff only, not measured. No new test functions (parametr |
| pypa/packaging | `63af696867fd` | excluded while mining | fix: handle key parameter in SpecifierSet.filter for empty specifiers and prerelease is false (#1096). Examined diff only, not measured. One new test  |
| pypa/packaging | `26fa1d42ccd9` | excluded while mining | fix: reject invalid interpreter tags (#1351). Examined diff only, NOT measured (time budget). Structurally viable: 0 modified test lines, 2 new test f |
| pypa/packaging | `1c09ddf30b79` | excluded while mining | fix: normalize all extras, not just the first one (#1024). Examined diff only, not measured. 0 modified test lines and the tests/test_requirements.py  |
| pyparsing/pyparsing | `0a2d906a3e6b` | **IN THE CORPUS** | `pyparsing-located-leading-whitespace` — Fix Located capturing leading whitespace in its location (#621) |
| pyparsing/pyparsing | `9d789cbc7331` | **dropped by the critic** | DROP. Rules 1-5 all hold and I reproduced every number (baseline at base 2e98055c = '1591 passed, 3 warnings, 711 subtests passed in 17.53s'; RED = '6 |
| pyparsing/pyparsing | `f6ba79d74aae` | survived, not selected | Fixed bug in NotAny where expr parse action was not being run - see Issue #482 — held in reserve; 13 of 20 survivors were taken |
| pyparsing/pyparsing | `59b167db1ba3` | **IN THE CORPUS** | `pyparsing-quotedstring-whitespace-delims` — Preserve whitespace in QuotedString multi-char delimiters (fixes #492) |
| pyparsing/pyparsing | `4dace945ce8c` | **dropped by the critic** | DROP on difficulty. All five rules hold and I reproduced everything (baseline at base 3b3ca8d3 = '1877 passed, 27 skipped, 1705 subtests passed in 21. |
| pyparsing/pyparsing | `a6ae98ba59b9` | excluded while mining | Dict/as_dict returning [] instead of {} for an empty nested ParseResults. Fully measured and it PASSES all five rules — baseline '2043 passed, 27 skip |
| pyparsing/pyparsing | `51560caba558` | excluded while mining | RecursionError for bounded repetition with a large upper bound (#332). Red/green verified ('36 failed in 382.19s' at base, '36 passed in 0.40s' with t |
| pyparsing/pyparsing | `0fcc013745a4` | excluded while mining | IndexError raised in a parse action being masked by pyparsing's own handlers (#573). Red/green both verified ('6 failed in 16.26s' / '6 passed in 0.44 |
| pyparsing/pyparsing | `6f2fbcbd359f` | excluded while mining | 'Copy the occurrence lists when renumbering, not when copying'. The test diff adds ZERO new `def test_*` — it only edits existing assertions. No FAIL_ |
| pyparsing/pyparsing | `94842d07f1cb` | excluded while mining | 'Give ParseResults.copy() its own results-name bookkeeping' — adds one test (testParseResultsCopyResultsNamesAreIndependent) and would probably qualif |
| pyparsing/pyparsing | `b6719a63262a` | excluded while mining | 'Update CHANGES to include notes on new type annotations. Plus some black reformatting.' Refactor/docs, no reported defect and so no usable statement  |
| pyparsing/pyparsing | `581eaefee616` | excluded while mining | 'Update type annotations to use built-in types instead of imports from typing' — pure refactor across 9 files; the test diff adds no new `def test_*`  |
| pyparsing/pyparsing | `2d96abfff12f` | excluded while mining | 'Add AI instructions' — a feature plus a new markdown doc (pyparsing/ai/best_practices.md). Its two added tests (test_loads_markdown_file, test_fallba |
| python-attrs/attrs | `e048efcb3954` | **IN THE CORPUS** | `attrs-order-check-after-transformer` — Perform attr order checks after field transformer. (#1401) |
| python-attrs/attrs | `88e2896ca935` | **IN THE CORPUS** | `attrs-slots-cached-property-attributeerror` — Preserve AttributeError in slotted classes with cached_property (#1253) |
| python-attrs/attrs | `1921da6eac62` | **IN THE CORPUS** | `attrs-frozen-exception-mutable-attrs` — allow __suppress_context__ and __notes__ to be mutated on frozen exceptions (#1365) |
| python-attrs/attrs | `09161fc9181b` | survived, not selected | Fix crash when __pre_init__, kw_only, and defaults come together (#1319) — held in reserve; 13 of 20 survivors were taken |
| python-attrs/attrs | `fd7538f0e23a` | survived, not selected | validators.in_ now transforms certain unhashable options to tuples (#1320) — held in reserve; 13 of 20 survivors were taken |
| python-attrs/attrs | `af9c510912ce` | excluded while mining | FULLY VERIFIED AND VALID; dropped only for the 5-task cap, ranked last on discriminating power. 'Fix validators.disabled() to save/restore state on ne |
| python-attrs/attrs | `0bf0678a224d` | excluded while mining | Rule 3 — baseline not clean. 'Fix TypeError for asdict(<class with namedtuple>, retain_collection_types=True) (#1165)'. Semantically the STRONGEST can |
| python-attrs/attrs | `f53fc5440d7f` | excluded while mining | No red baseline in this environment. 'Stop evolve dunders from being modified (#1606)'. Baseline at f38b8a3f1625060aa4245930822c34c11c252f83 is green  |
| python-attrs/attrs | `97f8d175656b` | excluded while mining | No red baseline in this environment. 'Fix ClassVar forward reference detection (#1593)'. The added test tests/test_annotations.py::TestAnnotations::te |
| python-attrs/attrs | `3b0378dd66d3` | excluded while mining | Difficulty rule. 'Cope with field_transformer being a generator (#1417)'. Baseline at 19943b775d40c018e844f2cb1728442f58112a3b is green (`1332 passed, |
| python-attrs/attrs | `862696afb52f` | excluded while mining | Not a bug fix — a deliberate BREAKING feature ('Resolve field aliases before calling field_transformer (#1509)', news fragment filed as changelog.d/15 |
| python-attrs/attrs | `5aa76a4450c3` | excluded while mining | Screened by subject and --stat only, not measured. 'Add `ne` validator (#1571)' — a new feature, not a bug fix, so there is no defect to repair. |
| python-attrs/attrs | `0f758fe54a87` | excluded while mining | Screened by subject and --stat only, not measured. 'Expose converter as a decorator (#1541)' — new public API, not a bug fix. |
| python-attrs/attrs | `48b8611c2777` | excluded while mining | Screened by subject and --stat only, not measured. 'Add instance support to attrs.fields() (#1529)' — feature addition, not a bug fix. |
| python-attrs/attrs | `6851ab593cd2` | excluded while mining | Screened by subject and --stat only, not measured. 'Defer imports on the cold import path (#1600)' — performance refactor with no behavioural defect,  |
| python-attrs/attrs | `1315e42fe517` | excluded while mining | Screened by subject and --stat only, not measured. 'Improve performance of attr.astuple (#1469)' — pure optimisation. |
| python-attrs/attrs | `7369ad9f4b27` | excluded while mining | Screened by subject and --stat only, not measured. 'Improve performance of asdict in the common case (#1463)' — pure optimisation. |
| python-attrs/attrs | `62bdbf234f45` | excluded while mining | Screened by subject and --stat only, not measured. 'Implement __replace__ on 3.13 (#1383)' — new feature, and its tests are gated on Python 3.13+ so t |
| python-attrs/attrs | `c02d993f9dc8` | excluded while mining | Screened by subject and --stat only, not measured. 'Fix object index in API docs by splitting API docs in two (#1080)' — docs-only change. |
