# @wringer/board

A native Bun reader and self-contained evidence board. It makes no network request,
executes no gate or worker, and writes no source record. The caller chooses where
to save the generated HTML or Markdown.

This reader supports standalone repository-verification records and their legacy
schemas. It does **not** read contained journey journals or deliveries. For new
agent work, use `wringer-drive status --state DIRECTORY` and the contained
show/review/delivery route in [QUICKSTART.md](../../QUICKSTART.md). There is no
contained HTML-board or certificate projection in this checkpoint.

The standalone public surface is `wringer-board render`/`serve`; its separate
`show`/`judge` pen executes explicitly trusted-local repository displays. That
pen is not an approval or recovery route for contained execution. See
`wringer-board --help` before choosing it.

```ts
import { loadBoard, renderHtml, renderMarkdown } from "@wringer/board";

const board = await loadBoard(repository);
await Bun.write("board.html", renderHtml(board));
await Bun.write("summary.md", renderMarkdown(board));
```

`loadBoard(repository, run)` optionally selects an explicit repository-relative run
path or run id. Without it, the newest manifest timestamp on disk wins, including
custom output names. A corrupt newest record is shown as corrupt; the reader does
not quietly choose an older successful run.

`BoardModel`, `deriveFacts`, `deriveRail`, `requirementLines` and
`toCertificateRequirements` are exported. Standalone delivery, summaries and the
HTML view consume those same facts and requirement wording. Missing measurements remain
`null`; the renderer never turns them into a zero or a successful outcome.

The six milestones are separate claims:

Built · Checks passing · Requirements proved · Human judgement complete · Ready to
deliver · Delivered.

Proof requires a resolved failure or sensitivity receipt for the exact gate and
command. The reader checks that successful gate results agree with the exit code,
rejects timeouts and unavailable commands as proof, and rejects receipt traversal
or escaping symlinks. Legacy isolated witness-store claims remain visible but are
not promoted to resolved proof when their supporting files are unavailable.

Run-local copies of `wringer.spec.yaml` and `wringer.sources.yaml` let the board
check source quotations against the intent frozen with that run. Older records
fall back to current source documents and say explicitly that the quotation is
unfrozen. Mismatched quotations and assessment counts are visible record issues.

The page includes light/dark themes, keyboard-operable requirement disclosures,
source and before/after drilldowns, requirement search and filters, a copyable next
command, separate usage lanes and the recorded journey. HTML has a restrictive
content policy, no external fonts or assets, and escaped record content.

```sh
bun test packages/board/test
```

The tests include a read-only check against the original Run 5B capture when it is
present on this machine. Its observed result is 3 checks passing, 1 requirement
proved, 8 unproved and 1 awaiting human judgement. Passing checks do not make that
run ready to deliver.
