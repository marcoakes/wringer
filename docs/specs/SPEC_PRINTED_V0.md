# SPEC_PRINTED_V0 — every printed command is executed in CI, as printed

**Status: BINDING for every command the product prints** — the lines in
`commands.txt` and `mr.md`, the console after any verb, the drive's steps
and stops, the doctor's remedies, the board's help, the setup epilogues,
and every sentence that names a verb a person might type.

Ruled 2026-09-02 (0.7.5, P0.5). The registry and its guard live in
`tests/journey/test_printed_commands.py`.

## The body count

Runs 4 and 4B, 2026-09-01: two audit instructions failed AS PRINTED before
one was ever executed — first without a copy step (`no such file`), then
without the branch checkout ("could NOT be checked from here") — and run
4B's operator followed a printed command into a dead end. Each was fixed
one finding at a time (0.6.6, 0.6.7, 0.7.3). Building the harness found
two more the same day, both by running the line rather than reading it:

- the loop's missing-agent hint offered `npm bin -g`, a subcommand npm
  removed in 9.0 — exit 1 on npm 11.17.0. Dead as printed for the whole
  life of the message. Now `npm prefix -g`;
- the bench summary offered `wring judge <run>` for EVERY row, and the
  judge refuses a bundle whose gates did not pass — so the line for a
  contender that stopped on its budget exited 3 as printed. Now only rows
  whose loop converged.

## Ruling 1 — every printed command is executed in CI, as printed

Every command family the product prints has ONE row in the registry. The
row runs the real surface and captures what it printed, lifts the command
out with a regex, runs it through the real entry point — `cli.main` for
`wring`, the two `__main__.main`s for `wringer-drive` and `wringer-board`,
a subprocess for `git`, `npm` and `sh` — in the fixture the surface stood
in, and asserts the outcome the surface promised. Never a mock of the
entry point, never a parse in place of a run (the graph report's parser
check, `test_the_dry_run_report_names_a_command_that_exists`, is the
weaker form and is named as such).

A row may instead name the CI test that already executes the command end
to end; the registry checks that test exists. A printed command with
neither is a guard failure.

## Ruling 2 — a command CI may not run is registered human-only, with its reason

Some printed lines are a person's to run and nobody else's: `npm install
-g <agent>` and `uv tool install wringer` (a package manager over the
operator's machine), the two `security` Keychain commands (a credential in
a login keychain CI does not have), `POST a merge request` (an act on
somebody's forge account), and the commented `uv sync --frozen` example
in the config template. Each is registered with a reason that names what
it would touch and says CI never runs it; a test refuses a blank or vague
reason. Human-only is a disposition, not an exemption: the row still
pins the literal, so the line cannot change without the registry noticing.

## Ruling 3 — the guard walks the shipped strings, and a new command fails it

The guard walks every string literal in `src/wringer`, `src/wringer_board`
and `src/wringer_drive` — the 0.6.6 installed-pointer guard's walk,
docstrings exempt — and calls a literal command-shaped when a product verb
(`wring`, `wringer-drive`, `wringer-board`, `npm`, `security`, `uv`)
followed by a word, or `git` followed by a real subcommand, opens a line
or follows a newline, colon, backtick, quote or the word "with". Two
refinements were measured before the regex was written, against the 252
literals the naive form matched: `wring verify: <message>` is the verb
naming itself (110 sites, none a command), and `git repository` is English.

Every command-shaped span must be covered by exactly one row's pattern,
where a pattern must consume the whole argv-like prefix of the span: a
row for `wring verify` does not cover `wring verify --gate`, so a new flag
on an old verb is unregistered until somebody runs it. Vendor-neutral by
construction — no vendor's binary is a verb, and a worker COMMAND the
operator typed is not a printed command. Measured at 0.7.5: 202
command-shaped sites, 44 rows, every site covered by one row.

## Ruling 4 — placeholders are substituted only where the surface printed the value

`<id>` in `commands.txt`, `"..."` in the git-identity remedy, `<the id>`
in the pen's usage line, `<your document>` in the drive's stop, `<PRD>`
after a dry run: an executor substitutes a placeholder only where the
same surface printed the real value beside it (the dry run prints the
delivery directory above the file list) or where only the person holds it
(their email, their document). The row asserts the first kind was printed;
the second kind is named in the row. A placeholder the surface neither
prints nor names is a dead end, and the row that finds one fails.

## What this spec does not do

- It does not run a vendor's binary. The real-vendor canary stays a STOP
  for the blind run, never CI's (SPEC_WORKER_V0 §4).
- It does not make a printed command's outcome a promise about the WORK.
  A row asserts what the surface promised about the command — exit code,
  the file it said it would write, the sentence it said it would print.
- `wring spec <PRD> --send --witness` is executed against a fake endpoint
  that answers every call with a drafter reply; the lane runs and records,
  and the console says nothing about witnesses either way. Recorded here,
  not asserted, and owed a legibility ruling of its own.
- The guard does not read `docs/` or the setup scripts: the epilogues are
  executed by rows of their own (the 0.6.6 sandbox, then the drive from the
  copied project to a NAMED stop), and the pages are the province of
  `tests/test_docs.py`.
