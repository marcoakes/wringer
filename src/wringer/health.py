"""`wring health` — the reader (SPEC_HEALTH_V0.md §3).

**A health tool that silently skips unreadable history is itself a narrowing
check** — the exact defect class this command exists to catch, one level up.
So this module's first product is not a verdict; it is a *coverage ledger*
that balances: every directory it saw is read, named as a skip with a reason,
or named as a duplicate. `discovered == read + skipped + duplicate` is pinned
by a test, because the alternative — a bundle dropped before classification —
looks exactly like a clean run.

Three decisions here are the spec's rulings rather than convenience:

- **Discovery sees a directory with a `manifest.json`, parseable or not**
  (ruling 12). Requiring a *known schema version* to call something a bundle
  made every unreadable bundle undiscoverable and therefore unskippable —
  "there is no quiet path" asserted by a predicate that built one. Seeing and
  classifying are separate steps, and only the second may fail.
- **Bench evidence is read, labelled, and decides nothing** (ruling 9).
  `wring bench` refuses to start unless the baseline is RED, so every bench
  guarantees a failed row for every required gate on a tree nobody changed —
  under the same `(id, command)` pairs as the repo's real gates, and in enough
  bundles to fill the window by itself. Counting it would make gates read
  `alive` on a staged repair exercise: a way to make zombies disappear, which
  is what the constants exist to prevent.
- **Loops are read for coverage, never resolved through `final_run`.** That
  field names only the last (converged, passing) verification and is recorded
  relative to a root the bundle does not name. The iteration verifies a loop
  wrote are ordinary bundles already sitting in the same root's
  `.wringer/runs/`, and they are found there directly — which removes the
  path relativity `bench._final_run_of` had to be fixed for rather than
  reproducing it.

Sorted at every boundary and no wall-clock anywhere: the report is
byte-deterministic over the same inputs, and directory iteration order is
OS-dependent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from wringer import evidence, fleet, loop, vacuity

# The committed fixture is named explicitly: `.wringer/` is gitignored, so in
# a fresh clone this is the ONLY bundle in the tree, and it predates vacuity
# and usage. It is the compatibility gate — it must READ, not skip.
EXAMPLE_DIRNAME = Path(".wringer.example")
BENCHES_DIRNAME = Path(".wringer") / "benches"

RUN_SCHEMA = evidence.SCHEMA_VERSION          # wringer.evidence.v1
LOOP_SCHEMA = loop.SCHEMA_VERSION             # wringer.loop.v1
BENCH_SCHEMA = "wringer.bench.v1"

_KINDS = {RUN_SCHEMA: "run", LOOP_SCHEMA: "loop", BENCH_SCHEMA: "bench"}

GATES_DIRNAME = "gates"
RESULT_FILENAME = "result.json"


@dataclass(frozen=True)
class Bundle:
    """One bundle that was read, and where it came from."""

    directory: Path
    receipt: str
    kind: str            # run | loop | bench
    run_id: str
    started_at: str
    # Position decides this, not a manifest field: anything under
    # `.wringer/worktrees/` or `.wringer/benches/` was written by a bench.
    bench_sourced: bool
    source: str          # "repo", or the --from root it was found under

    @property
    def qualifying(self) -> bool:
        """Whether this bundle's rows may decide a verdict (ruling 9)."""
        return self.kind == "run" and not self.bench_sourced


@dataclass(frozen=True)
class Skip:
    receipt: str
    reason: str


@dataclass(frozen=True)
class Duplicate:
    receipt: str
    already_read_as: str


@dataclass(frozen=True)
class Coverage:
    """The report's header, and the reason this module exists first."""

    roots: tuple[str, ...] = ()
    read: tuple[Bundle, ...] = ()
    skipped: tuple[Skip, ...] = ()
    duplicates: tuple[Duplicate, ...] = ()

    @property
    def discovered(self) -> int:
        return len(self.read) + len(self.skipped) + len(self.duplicates)

    def counts(self) -> dict[str, int]:
        kinds = {"run": 0, "loop": 0, "bench": 0}
        for bundle in self.read:
            kinds[bundle.kind] += 1
        return kinds


@dataclass(frozen=True)
class GateRun:
    """One `(id, command)` observation, with the receipt that evidences it."""

    gate_id: str
    command: str
    status: str
    timed_out: bool
    optional: bool
    duration_ms: int
    truncated: bool
    receipt: str
    started_at: str
    bench_sourced: bool
    # Joined from the same bundle's `vacuity.json` — see `_sensitivity`.
    sensitive: bool = False

    @property
    def genuine_failure(self) -> bool:
        """`status: failed` AND NOT a timeout (§3c).

        Both halves are required and the second is not decoration: the
        published gate-result schema has a two-value status whose own
        description reads "passed requires exit_code 0 AND timed_out false",
        so EVERY timeout already records `failed`. Testing `status` alone
        computes `alive` for a gate that has only ever died of slowness, which
        inverts ruling 7 — and that is exactly what the spec's first draft
        said to do.
        """
        return self.status == "failed" and not self.timed_out


@dataclass(frozen=True)
class Pair:
    """A gate's identity: `(id, command)`. An edited gate is a NEW pair.

    Editing is how checks most often narrow — the session that motivated this
    command watched a probe keep its name while its coverage shrank — so
    continuity across an edit is not inferred and not granted.
    """

    gate_id: str
    command: str
    runs: tuple[GateRun, ...] = field(default_factory=tuple)

    @property
    def key(self) -> tuple[str, str]:
        return (self.gate_id, self.command)


def _read_json(path: Path) -> object | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def _relative(path: Path, base: Path) -> str:
    try:
        return path.resolve().relative_to(base.resolve()).as_posix()
    except ValueError:
        return str(path)


def _sort_key(bundle: Bundle) -> tuple:
    """Newest-last ordering that does not trust the directory name.

    `started_at` is local ISO-8601 WITH OFFSET, so two bundles written on
    machines in different zones cannot be ordered by string comparison — the
    UTC lesson this repo already learned once. Parsed to an absolute instant
    where possible, with the run id as the deterministic tiebreak and as the
    fallback when a manifest's timestamp is unreadable.
    """
    try:
        stamp = datetime.fromisoformat(bundle.started_at).timestamp()
    except (TypeError, ValueError):
        stamp = float("-inf")
    return (stamp, bundle.run_id, bundle.receipt)


def search_roots(root: Path | None, extra: tuple[Path, ...] = ()) -> list[Path]:
    """Where discovery looks, stated so a reader can check it.

    NOT "every bundle reachable from the repo", which cannot be implemented
    and cannot be audited — a scope nobody can state is the narrowing defect
    this command hunts. The coverage header names these back.
    """
    roots: list[Path] = []
    if root is not None:
        roots += [
            root / evidence.RUNS_DIRNAME,
            root / loop.LOOPS_DIRNAME,
            root / BENCHES_DIRNAME,
            root / fleet.WORKTREES_DIRNAME,
            root / EXAMPLE_DIRNAME,
        ]
    roots += list(extra)
    return [path for path in roots if path.is_dir()]


def _bundle_dirs(top: Path) -> list[Path]:
    """Every directory under `top` holding a `manifest.json`, readable or not.

    The predicate is the FILE's existence, never its contents (ruling 12).
    """
    found = []
    if (top / evidence.MANIFEST_FILENAME).is_file():
        found.append(top)
    for path in sorted(top.rglob(evidence.MANIFEST_FILENAME)):
        if path.is_file() and path.parent != top:
            found.append(path.parent)
    return sorted(set(found), key=lambda p: p.as_posix())


def discover(
    root: Path | None, extra: tuple[Path, ...] = ()
) -> Coverage:
    """Read what is there, and NAME what is not readable.

    There is no quiet path: a bundle is read, or it is named as a skip, or it
    is named as a duplicate.
    """
    roots = search_roots(root, extra)
    extra_resolved = {path.resolve(): path for path in extra}

    read: list[Bundle] = []
    skipped: list[Skip] = []
    duplicates: list[Duplicate] = []
    by_run_id: dict[str, str] = {}

    for top in roots:
        for directory in _bundle_dirs(top):
            resolved = directory.resolve()
            # Which root this was found under decides the receipt's base, so
            # a --from bundle is never rendered as though it sat in the repo.
            base, source = root, "repo"
            for extra_root, original in extra_resolved.items():
                try:
                    resolved.relative_to(extra_root)
                except ValueError:
                    continue
                base, source = original, original.as_posix()
                break
            receipt = (
                _relative(directory, base) if base is not None else str(directory)
            )
            if source != "repo":
                receipt = f"{source}:{receipt}"

            raw = _read_json(directory / evidence.MANIFEST_FILENAME)
            if not isinstance(raw, dict):
                skipped.append(Skip(receipt, "manifest unreadable: not JSON"))
                continue
            version = raw.get("schema_version")
            kind = _KINDS.get(version if isinstance(version, str) else "")
            if kind is None:
                skipped.append(
                    Skip(receipt, f"schema {version!r} — not a format this reads")
                )
                continue

            run_id = str(
                raw.get("run_id") or raw.get("loop_id") or raw.get("bench_id") or ""
            )
            if not run_id:
                skipped.append(Skip(receipt, "manifest names no id"))
                continue
            if run_id in by_run_id:
                duplicates.append(Duplicate(receipt, by_run_id[run_id]))
                continue
            by_run_id[run_id] = receipt

            marker = fleet.WORKTREES_DIRNAME.as_posix()
            bench_sourced = (
                f"/{marker}/" in f"/{resolved.as_posix()}/"
                or f"/{BENCHES_DIRNAME.as_posix()}/" in f"/{resolved.as_posix()}/"
            )
            read.append(
                Bundle(
                    directory=directory,
                    receipt=receipt,
                    kind=kind,
                    run_id=run_id,
                    started_at=str(raw.get("started_at") or ""),
                    bench_sourced=bench_sourced,
                    source=source,
                )
            )

    return Coverage(
        roots=tuple(
            sorted(_relative(path, root) if root else str(path) for path in roots)
        ),
        read=tuple(sorted(read, key=_sort_key)),
        skipped=tuple(sorted(skipped, key=lambda s: s.receipt)),
        duplicates=tuple(sorted(duplicates, key=lambda d: d.receipt)),
    )


def _sensitivity(directory: Path) -> dict[str, bool]:
    """Which gate ids this bundle recorded a `sensitive: true` row for.

    Through `vacuity.read_verdict`, never by re-parsing the file. Note what
    comes back: rows carry `gate_id` and NO command, so the caller must join
    to the sibling `result.json` for the pair. Keying sensitivity on the id
    alone would let an edited gate inherit its predecessor's sensitivity and
    stay `alive` — the identity ruling defeated in the precise case it exists
    for.
    """
    result = vacuity.read_verdict(directory)
    if result is None:
        return {}
    return {row.gate_id: True for row in result.rows if row.sensitive}


def gate_runs(bundle: Bundle) -> list[GateRun]:
    """Every gate row this run bundle recorded, with sensitivity joined.

    A gate with no `result.json` never finished, and non-evidence is not
    evidence: those leave no row here at all.
    """
    if bundle.kind != "run":
        return []
    gates_dir = bundle.directory / GATES_DIRNAME
    if not gates_dir.is_dir():
        return []
    sensitive = _sensitivity(bundle.directory)

    rows = []
    for entry in sorted(gates_dir.iterdir(), key=lambda p: p.name):
        raw = _read_json(entry / RESULT_FILENAME)
        if not isinstance(raw, dict):
            continue
        gate_id = raw.get("gate_id")
        command = raw.get("command")
        if not isinstance(gate_id, str) or not isinstance(command, str):
            continue
        rows.append(
            GateRun(
                gate_id=gate_id,
                command=command,
                status=str(raw.get("status") or ""),
                timed_out=bool(raw.get("timed_out")),
                optional=bool(raw.get("optional")),
                duration_ms=int(raw.get("duration_ms") or 0),
                truncated=bool(raw.get("stdout_truncated"))
                or bool(raw.get("stderr_truncated")),
                receipt=bundle.receipt,
                started_at=bundle.started_at,
                bench_sourced=bundle.bench_sourced,
                # The join: this row's own command decides which pair the
                # sensitivity attaches to.
                sensitive=bool(sensitive.get(gate_id)),
            )
        )
    return rows


def history(coverage: Coverage) -> tuple[Pair, ...]:
    """Assemble `(id, command)` pairs, oldest run first within each pair.

    Bench-sourced rows are carried here — the report shows them, labelled —
    and are excluded from verdicts by `Bundle.qualifying`, not by being
    dropped on the floor. Evidence that is hidden cannot be audited.
    """
    pairs: dict[tuple[str, str], list[GateRun]] = {}
    for bundle in coverage.read:
        for row in gate_runs(bundle):
            pairs.setdefault((row.gate_id, row.command), []).append(row)
    return tuple(
        Pair(gate_id=gate_id, command=command, runs=tuple(runs))
        for (gate_id, command), runs in sorted(pairs.items())
    )


def declared_pairs(cfg) -> set[tuple[str, str]]:
    """The `(id, command)` pairs the config currently declares.

    Health never reads a command out of `.wringer.yaml` to RENDER it —
    scrubbing a raw config command would mean resolving declared secret names
    against the live environment, an environment read that would make the same
    bundles produce different bytes in different shells. Comparing is not
    rendering, and this is what makes `retired` computable.
    """
    if cfg is None:
        return set()
    return {(gate.id, gate.run) for gate in getattr(cfg, "gates", ())}


__all__ = [
    "Bundle",
    "Coverage",
    "Duplicate",
    "GateRun",
    "Pair",
    "Skip",
    "declared_pairs",
    "discover",
    "gate_runs",
    "history",
    "search_roots",
]
