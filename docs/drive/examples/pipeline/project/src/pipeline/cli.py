"""`python -m pipeline <pipeline.json>` — run a pipeline and print the summary."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pipeline.graph import Graph, GraphError
from pipeline.report import render
from pipeline.runner import run, succeeded


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline")
    parser.add_argument("pipeline", help="a JSON file describing the jobs")
    args = parser.parse_args(argv)

    try:
        data = json.loads(Path(args.pipeline).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"pipeline: cannot read {args.pipeline}: {exc}", file=sys.stderr)
        return 2

    try:
        graph = Graph.from_data(data)
    except GraphError as exc:
        print(f"pipeline: {exc}", file=sys.stderr)
        return 2

    results = run(graph)
    print(render(results))
    return 0 if succeeded(results) else 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
