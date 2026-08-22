"""`docs/vendors.md` — the matrix, and the guard that keeps it honest.

**The charter this file enforces:** Wringer is vendor-agnostic or it is
nothing. A page listing vendors is the easiest page in the repository to
inflate — one word changed from BLOCKED to WORKING and a reader is being told
something nobody measured. So the page is DERIVED-GUARDED: every claim on it
is checked against something outside the page.

Three properties, each of which was a real way to lie:

1. **A status must be one of four**, because "supported" and "coming soon"
   are the words a roster inflates through.
2. **A `MEASURED-WORKING` row must link a capture that EXISTS**, so a working
   claim cannot outlive the file that backed it.
3. **The order is alphabetical**, so no vendor can be quietly promoted to the
   top of the page — and the key table, the endpoint table and `wring
   doctor`'s own key-name list are all held to the SAME vendor set, so a
   vendor cannot be half-added.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
VENDORS_MD = ROOT / "docs" / "vendors.md"

#: Closed on purpose. A fifth status is a change to what this page promises,
#: which is a decision, not an edit.
STATUSES = {
    "MEASURED-WORKING",
    "BLOCKED-ON-CREDENTIAL",
    "BLOCKED-ON-AUTH-ROUTE",
    "NO-AGENT-CLI",
}

LANES = {"brain", "worker"}


def body() -> str:
    return VENDORS_MD.read_text(encoding="utf-8")


def _rows(heading: str) -> list[list[str]]:
    """The cells of the markdown table under `heading`, header row dropped."""
    text = body()
    start = text.index(heading)
    end = len(text)
    for later in re.finditer(r"^## ", text[start + len(heading):], re.M):
        end = start + len(heading) + later.start()
        break
    out = []
    for line in text[start:end].splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells):
            continue
        out.append(cells)
    return out[1:]


def matrix() -> list[tuple[str, str, str, str, str]]:
    rows = _rows("## The matrix")
    assert rows, "docs/vendors.md has no matrix at all"
    return [(r[0], r[1], r[2], r[3], r[4]) for r in rows]


def test_the_matrix_uses_the_FOUR_statuses_and_no_others():
    for vendor, lane, status, _measured, _capture in matrix():
        assert lane in LANES, f"{vendor}: {lane!r} is not a lane this page has"
        assert status in STATUSES, (
            f"{vendor}/{lane} claims {status!r}, which is not one of the four "
            f"statuses this page is allowed to say: {sorted(STATUSES)}"
        )


def test_a_MEASURED_WORKING_row_LINKS_A_CAPTURE_THAT_EXISTS():
    """**The property the whole page rests on.**

    A working claim with no capture behind it is exactly the thing this
    repository exists to refuse, aimed at its own front matter. The guard
    reads the table AND the filesystem: a row may say a vendor works only if
    the file it points at is really there.
    """
    for vendor, lane, status, _measured, capture in matrix():
        link = re.search(r"\(([^)]+)\)", capture)
        if status == "MEASURED-WORKING":
            assert link, (
                f"{vendor}/{lane} claims MEASURED-WORKING and links no capture"
            )
            target = (VENDORS_MD.parent / link.group(1)).resolve()
            assert target.is_file(), (
                f"{vendor}/{lane} claims MEASURED-WORKING and its capture "
                f"{link.group(1)} does not exist in this repository"
            )
        elif link:
            target = (VENDORS_MD.parent / link.group(1)).resolve()
            assert target.is_file(), (
                f"{vendor}/{lane} links {link.group(1)}, which is not here"
            )


def test_NO_VENDOR_IS_LISTED_ABOVE_ANY_OTHER():
    """Alphabetical, and the lanes ordered within a vendor.

    The front page of a vendor-neutral tool is precisely where a favourite
    would show up first, and "we just wrote them in the order we added them"
    is how that happens without anybody deciding it.
    """
    seen = [v for v, _lane, _s, _m, _c in matrix()]
    assert seen == sorted(seen), (
        f"the matrix is not alphabetical by vendor: {seen}"
    )
    for vendor in dict.fromkeys(seen):
        lanes = [lane for v, lane, _s, _m, _c in matrix() if v == vendor]
        assert lanes == sorted(lanes), f"{vendor}'s lanes are out of order: {lanes}"


def test_EVERY_VENDOR_HAS_BOTH_LANES_AND_ONE_ROW_EACH():
    """A vendor with only the flattering lane filled in is a half-truth."""
    pairs = [(v, lane) for v, lane, _s, _m, _c in matrix()]
    assert len(pairs) == len(set(pairs)), f"a vendor/lane appears twice: {pairs}"
    for vendor in dict.fromkeys(v for v, _ in pairs):
        missing = LANES - {lane for v, lane in pairs if v == vendor}
        assert not missing, f"{vendor} has no row for: {sorted(missing)}"


def _vendors_in(heading: str) -> list[str]:
    return [r[0] for r in _rows(heading)]


def test_THE_KEY_TABLE_AND_THE_ENDPOINT_TABLE_COVER_THE_SAME_VENDORS():
    """One convention per vendor, and no vendor half-added.

    A person choosing a vendor from the matrix and finding no Keychain
    convention beside it has been sent to a dead end — which is the failure
    the vendor-free key surfaces exist to prevent.
    """
    listed = sorted(dict.fromkeys(v for v, _lane, _s, _m, _c in matrix()))
    keys = sorted(dict.fromkeys(_vendors_in("## Your key, whichever vendor")))
    ends = sorted(dict.fromkeys(_vendors_in("## The endpoints and models")))
    assert keys == listed, (
        f"the key table and the matrix name different vendors: {keys} vs {listed}"
    )
    assert ends == listed, (
        f"the endpoint table and the matrix name different vendors: "
        f"{ends} vs {listed}"
    )


def test_EVERY_VENDORS_KEYCHAIN_SERVICE_FOLLOWS_THE_ONE_CONVENTION():
    """`-s <something>-api-key`, so the page teaches one habit, not five."""
    for row in _rows("## Your key, whichever vendor"):
        vendor, service = row[0], row[1]
        assert re.fullmatch(r"`[a-z0-9]+-api-key`", service), (
            f"{vendor}'s Keychain service {service} does not follow the "
            "documented `-s <vendor>-api-key` convention"
        )


def test_DOCTOR_LOOKS_FOR_THE_KEY_NAMES_THIS_PAGE_TELLS_PEOPLE_TO_USE():
    """**Derived, not duplicated.**

    `wring doctor` falls back to a list of well-known variable names when a
    repository declares none. That list was two names long and vendor-locked
    while this page told people about five vendors, so a person who followed
    the page got "no LLM API key set" with the key correctly set. The page is
    the source; doctor's list is checked against it.
    """
    from wringer import doctor

    named = set()
    for row in _rows("## Your key, whichever vendor"):
        for cell in row[2:]:
            named.update(re.findall(r"`([A-Z][A-Z0-9_]{3,})`", cell))
    # The brain lane's variable is whatever the config names; the WORKER
    # lane's belongs to the agent, and those are the ones doctor can guess.
    assert named, "the key table names no environment variables at all"
    missing = named - set(doctor.WELL_KNOWN_KEY_ENVS)
    assert not missing, (
        "docs/vendors.md tells people to set these variables and `wring "
        f"doctor` does not look for them: {sorted(missing)}"
    )


def test_THE_PAGE_NAMES_THE_SHELL_WORKERS_REAL_CREDENTIAL_MECHANIC():
    """`env_passthrough` is ACP-only (`config.py:180`); a shell worker
    inherits the launch environment (`gates.py:191`). A page telling people
    to declare a passthrough their worker form does not have sends them to a
    knob that silently does nothing."""
    text = " ".join(body().split())
    assert "env_passthrough" in text, "the ACP credential act is never named"
    assert "inherits the environment" in text, (
        "the page never says how a SHELL worker gets its key, which is the "
        "form codex and kimi's headless mode both use"
    )
    assert "gates.py:191" in text, "the claim about inheritance cites nothing"


@pytest.mark.parametrize(
    "forbidden", ["coming soon", "supported", "partner", "certified"]
)
def test_no_TABLE_CELL_makes_a_claim_this_page_cannot_back(forbidden: str):
    """Checked in the CELLS, not the prose.

    The prose has to be able to say *"there is no 'coming soon' here"*
    without tripping its own guard — a first version of this test failed on
    exactly that sentence, which is a guard measuring the wrong thing. What
    matters is that no ROW quietly upgrades itself past the four statuses.
    """
    for heading in (
        "## The matrix",
        "## Your key, whichever vendor",
        "## The endpoints and models",
        "## The worker commands",
    ):
        for row in _rows(heading):
            for cell in row:
                assert forbidden not in cell.lower(), (
                    f"{heading}: a cell claims {forbidden!r} — this page may "
                    f"only say what somebody ran: {row}"
                )
