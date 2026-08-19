"""The M3 worker: apply the README re-lead, or fail saying which anchor moved.

This is the loop's worker for the self-shipped PR (m3/graph.yaml). It stands
in for a coding agent the same way `fix.sh` does in every committed demo, and
for the same reason stated there: the recording and the evidence need no
vendor binary, and the config records this command verbatim so the bundle is
honest about what ran. The prose it applies was authored in the planning
window; what the loop adds is not authorship but PROOF — the re-lead lands
only if every gate, including the failing guard that defines this job
(tests/test_docs.py::test_the_readme_leads_with_the_thesis_and_not_a_deferred_runtime)
and every pre-existing README guard, goes green.

Three exact-string replacements. A missing anchor is exit 1 with the anchor
named — a worker that "applies" a change to text that has drifted under it
would be editing a README it has not read.
"""

from __future__ import annotations

import sys
from pathlib import Path

README = Path("README.md")

OLD_LEAD = """\
> **Everyone else in this space is selling capability and asking for trust.
> Wringer is built on the opposite premise: trust nothing — including itself.**
> Not the worker's exit code, not the agent's summary, not even the tests the
> agent wrote — and soon, provably, not even its own ledgers. That stance came
> out of [a real eight-hour burn](docs/specs/SPEC_SUPERVISION_V0.md), it is welded into
> [eight invariants](docs/specs/SPEC_SUPERVISION_V0.md) a fleet already obeys, and it
> gets more valuable with every step frontier models take — because autonomy
> without receipts is exactly what everyone is about to be terrified of.
"""

NEW_LEAD = """\
> **In the agent era, code is cheap and green is suspect. The scarce resource
> is warranted trust in a passing check — and that trust decays.** Wringer is
> the evidence layer that keeps your green honest: it runs your repo's own
> gates, writes receipts a stranger can audit, and trusts nothing — including
> itself. Not the worker's exit code, not the agent's summary, not even the
> tests the agent wrote. That stance came out of
> [a real eight-hour burn](docs/specs/SPEC_SUPERVISION_V0.md) and is welded into
> [eight invariants](docs/specs/SPEC_SUPERVISION_V0.md) a fleet already obeys. And it is
> the one stance no vendor can copy, because Wringer is nobody's agent:
> **the party holding the receipts has no stake in what they say.**
"""

OLD_INTRO = (
    "It treats *loops* and *graphs of loops* as first-class, portable "
    "primitives, and runs the **same workflow definition** on your laptop "
    "today and on durable runtimes (Temporal first) tomorrow."
)

NEW_INTRO = (
    "It treats *loops* and *graphs of loops* as first-class, portable "
    "primitives, and runs them entirely on your machine — no runtime, no "
    "gateway, and no identity system to adopt first."
)

# The vitality demo, drawn where the claim is made. Anchored on the sentence
# that follows the health console excerpt in the H4 section.
OLD_HEALTH = "Nothing else tells you that. The coverage statement leads"

NEW_HEALTH = """\
<div align="center">

<img src="docs/health.svg" alt="wring health: a gate dies under a neutering fix, twenty-five green runs later the vitality table reads zombie" width="700">

*A real session, captured — the failure, the neutering "fix", twenty-five
genuinely executed green runs, and the verdict. Regenerate it with
`scripts/demo.sh`; the transcript is committed beside it at
[`docs/health.cast.json`](docs/health.cast.json).*

</div>

Nothing else tells you that. The coverage statement leads"""


def main() -> int:
    text = README.read_text(encoding="utf-8")
    for name, old, new in (
        ("lead", OLD_LEAD, NEW_LEAD),
        ("intro", OLD_INTRO, NEW_INTRO),
        ("health-demo", OLD_HEALTH, NEW_HEALTH),
    ):
        if new in text:
            # Already applied — a rerun converges instead of duplicating.
            continue
        if old not in text:
            print(f"apply_relead: anchor {name!r} not found; README has "
                  "drifted under this worker and it refuses to guess",
                  file=sys.stderr)
            return 1
        text = text.replace(old, new, 1)
    README.write_text(text, encoding="utf-8")
    print("re-lead applied")
    return 0


if __name__ == "__main__":
    sys.exit(main())
