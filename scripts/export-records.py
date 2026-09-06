#!/usr/bin/env python3
"""Every record on disk, matched to the schema it declares, as a corpus.

**The port's contract, and its instrument (2026-09-06).** Wringer is being
ported surface by surface behind its frozen records: the board and the
drive read `.wringer/` and almost nothing else, so the records ARE the
seam. A second implementation is only safe if it reads exactly what this
one writes, and the only way to know that is to run both over the same
bytes.

So this walks a tree for records, matches each to a schema by the
`schema_version` the record itself declares — never by filename, which
guesses — validates it here with `jsonschema`, and writes a manifest the
TypeScript readers re-validate. Two languages, one corpus, one schema.

A file that declares no version is COUNTED and named in the manifest's
`skipped`, never dropped in silence: nine of the sixty-three schemas
describe event lines and sub-objects that carry no version of their own,
and a corpus that quietly omitted them would look complete.

    scripts/export-records.py [root ...] --output corpus.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def schemas_by_version(directory: Path) -> tuple[dict[str, Path], list[str]]:
    """`{declared version: schema file}`, and the schemas that declare none."""
    known: dict[str, Path] = {}
    versionless: list[str] = []
    for path in sorted(directory.glob("*.schema.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise SystemExit(f"{path}: unreadable schema: {exc}") from exc
        declared = (payload.get("properties") or {}).get("schema_version") or {}
        const = declared.get("const")
        if isinstance(const, str):
            if const in known:
                raise SystemExit(
                    f"two schemas declare {const}: {known[const].name} and "
                    f"{path.name} — a record could not be matched to one"
                )
            known[const] = path
            continue
        for one in declared.get("enum") or []:
            if isinstance(one, str):
                known.setdefault(one, path)
        if not const and not declared.get("enum"):
            versionless.append(path.name)
    return known, versionless


def _version_of(payload: object) -> str | None:
    if isinstance(payload, dict):
        found = payload.get("schema_version")
        return found if isinstance(found, str) else None
    return None


def records_under(root: Path, known: dict[str, Path]) -> tuple[list[dict], list[dict]]:
    """Every record under `root`, matched or named as unmatched."""
    matched: list[dict] = []
    skipped: list[dict] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in (".json", ".jsonl"):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            skipped.append({"path": str(path), "why": "unreadable"})
            continue
        shown = str(path.relative_to(REPO)) if REPO in path.parents else str(path)
        if path.suffix == ".jsonl":
            for number, line in enumerate(text.splitlines(), start=1):
                if not line.strip():
                    continue
                try:
                    payload = json.loads(line)
                except ValueError:
                    skipped.append(
                        {"path": shown, "line": number, "why": "not JSON"}
                    )
                    continue
                version = _version_of(payload)
                if version is None or version not in known:
                    skipped.append(
                        {
                            "path": shown,
                            "line": number,
                            "why": "declares no version this schema set knows"
                            if version is None
                            else f"declares {version}, which no schema claims",
                        }
                    )
                    continue
                matched.append(
                    {
                        "path": shown,
                        "line": number,
                        "schema": known[version].name,
                        "version": version,
                    }
                )
            continue
        try:
            payload = json.loads(text)
        except ValueError:
            skipped.append({"path": shown, "why": "not JSON"})
            continue
        version = _version_of(payload)
        if version is None or version not in known:
            skipped.append(
                {
                    "path": shown,
                    "why": "declares no version this schema set knows"
                    if version is None
                    else f"declares {version}, which no schema claims",
                }
            )
            continue
        matched.append(
            {"path": shown, "schema": known[version].name, "version": version}
        )
    return matched, skipped


def _one(record: dict, root: Path) -> object:
    named = Path(record["path"])
    path = named if named.is_absolute() else root / named
    text = path.read_text(encoding="utf-8")
    if "line" in record:
        return json.loads(text.splitlines()[record["line"] - 1])
    return json.loads(text)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("roots", nargs="*", default=[], help="trees to walk")
    parser.add_argument("--schemas", default=str(REPO / "schema"))
    parser.add_argument("--output", default=str(REPO / "ts" / "corpus.json"))
    parser.add_argument(
        "--validate", action="store_true",
        help="validate every matched record here before writing the manifest",
    )
    args = parser.parse_args(argv)

    known, versionless = schemas_by_version(Path(args.schemas))
    roots = [Path(one).resolve() for one in (args.roots or [REPO / ".wringer"])]

    matched: list[dict] = []
    skipped: list[dict] = []
    for root in roots:
        if not root.exists():
            print(f"export-records: {root} does not exist", file=sys.stderr)
            continue
        one, other = records_under(root, known)
        matched += one
        skipped += other

    mismatched: list[dict] = []
    if args.validate:
        import jsonschema

        cached: dict[str, dict] = {}
        for record in matched:
            schema = cached.setdefault(
                record["schema"],
                json.loads(
                    (Path(args.schemas) / record["schema"]).read_text(encoding="utf-8")
                ),
            )
            try:
                # Formats are checked here too — see `ts/packages/records/
                # src/read.ts`. Two validators that disagree about what a
                # record IS make every later differential meaningless.
                jsonschema.validate(
                    _one(record, REPO), schema,
                    format_checker=jsonschema.FormatChecker(),
                )
            except jsonschema.ValidationError as exc:
                where = f"{record['path']}"
                if "line" in record:
                    where += f":{record['line']}"
                # **Collected, not raised on the first.** One version naming
                # two shapes is a finding about the whole set, and stopping
                # at the first instance hides how many there are.
                mismatched.append(
                    {
                        "path": record["path"],
                        "line": record.get("line"),
                        "schema": record["schema"],
                        "version": record["version"],
                        "why": exc.message,
                    }
                )

    manifest = {
        "schema_count": len(known),
        "versionless_schemas": versionless,
        "roots": [str(one) for one in roots],
        "records": [
            record
            for record in matched
            if not any(
                bad["path"] == record["path"]
                and bad.get("line") == record.get("line")
                for bad in mismatched
            )
        ],
        "skipped": skipped,
        # **A record that declares a version it does not satisfy.** Not a
        # corpus entry — a finding, kept where the corpus can be read beside
        # it, because a reader in any language that trusts the declared
        # version will read this one wrongly.
        "mismatched": mismatched,
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    versions = {record["version"] for record in matched}
    print(
        f"export-records: {len(matched)} record(s) across {len(versions)} of "
        f"{len(known)} known versions; {len(skipped)} skipped; "
        f"{len(versionless)} schema(s) declare no version → {output}"
    )
    if mismatched:
        print(
            f"export-records: {len(mismatched)} record(s) declare a version "
            "they do not satisfy — a version that names two shapes cannot be "
            "matched to one schema by any reader:",
            file=sys.stderr,
        )
        for bad in mismatched[:10]:
            where = bad["path"] + (f":{bad['line']}" if bad.get("line") else "")
            print(f"  {where} declares {bad['version']}: {bad['why']}", file=sys.stderr)
        if len(mismatched) > 10:
            print(f"  ... and {len(mismatched) - 10} more", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
