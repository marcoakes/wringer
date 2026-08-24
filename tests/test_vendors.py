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

**Extended 2026-08-23, when a worker arrived that the matrix's own shape could
not carry.** `dcode` is LangChain's agent and LangChain ships no model, so the
vendor×lane matrix has no honest cell for it: a brain row would have to invent
a fifth status for a lane that vendor does not have. It gets a second table,
and the second table is guarded harder than the first — because a roster row
about somebody else's binary is the easiest row on this page to grow past its
capture. Every claim in it is checked against the capture file it links.
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


AGENT_TABLE = "## The agents whose vendor is not a model vendor"


def agent_rows() -> list[dict[str, str]]:
    """The second table, as dicts, because it has seven columns and a reader
    counting commas is how a guard ends up asserting about the wrong cell."""
    rows = _rows(AGENT_TABLE)
    assert rows, "docs/vendors.md has no agent table at all"
    columns = ("agent", "ships", "lane", "status", "measured", "credential", "capture")
    for row in rows:
        assert len(row) == len(columns), (
            f"an agent row has {len(row)} cells, not {len(columns)}: {row}"
        )
    return [dict(zip(columns, row, strict=True)) for row in rows]


def _capture_of(row: dict[str, str]) -> Path:
    link = re.search(r"\(([^)]+)\)", row["capture"])
    assert link, f"{row['agent']} links no capture at all"
    return (VENDORS_MD.parent / link.group(1)).resolve()


def test_the_AGENT_TABLE_uses_the_SAME_FOUR_STATUSES_as_the_matrix():
    """**Derived from the matrix's own closed set, never a second copy.**

    A second table with its own vocabulary is how "supported" gets back onto
    this page through a side door: nobody edits the matrix, they just write a
    fresh word in the new table. The set is the same object.
    """
    for row in agent_rows():
        assert row["lane"] in LANES, f"{row['agent']}: {row['lane']!r} is not a lane"
        assert row["status"] in STATUSES, (
            f"{row['agent']} claims {row['status']!r}, which is not one of the "
            f"four statuses this page is allowed to say: {sorted(STATUSES)}"
        )


def test_a_MEASURED_WORKING_agent_LINKS_A_CAPTURE_THAT_EXISTS():
    for row in agent_rows():
        target = _capture_of(row)
        assert target.is_file(), (
            f"{row['agent']} links {row['capture']}, which is not in this "
            "repository"
        )


def test_NO_AGENT_IS_LISTED_ABOVE_ANY_OTHER():
    """**Vacuous today and said so on purpose**: one row is in order however
    it is written, so this guard cannot fail until a second agent arrives —
    which is exactly the edit it is here to meet. Red-watched 2026-08-23 by
    adding a second row out of order."""
    seen = [row["agent"] for row in agent_rows()]
    assert seen == sorted(seen), f"the agent table is not alphabetical: {seen}"


def test_AN_AGENT_ROW_MAY_NAME_ONLY_A_CREDENTIAL_ITS_CAPTURE_DECLARED():
    """**The one way this row grows past its receipt, closed by derivation.**

    `dcode`'s own startup refusal names three vendors' variables and only one
    of them was ever run. The tempting edit is to list all three — the binary
    accepts them, after all — and the row would then claim two routes nobody
    measured.

    **The first version of this guard was VACUOUS and the red-watch caught
    it.** It asked whether the variable appeared anywhere in the capture, and
    all three appear there — inside the quoted refusal that names what the
    agent WOULD have taken. Adding `OPENAI_API_KEY` to the row left the whole
    file green. So the derivation moved to the only line in a capture that
    records a credential actually crossing the boundary: the
    `env_passthrough` the measured run declared. A variable that never rode a
    real run cannot be in the row, and adding one means taking the
    measurement first.
    """
    for row in agent_rows():
        capture = _capture_of(row).read_text(encoding="utf-8")
        declared = set()
        for line in capture.splitlines():
            if "env_passthrough" in line:
                declared.update(re.findall(r"[A-Z][A-Z0-9_]{3,}", line))
        assert declared, (
            f"{_capture_of(row).name} shows no `env_passthrough` at all, so "
            f"nothing in it backs {row['agent']}'s credential cell"
        )
        named = re.findall(r"`([A-Z][A-Z0-9_]{3,})`", row["credential"])
        assert named, f"{row['agent']}'s credential cell names no variable"
        for variable in named:
            assert variable in declared, (
                f"{row['agent']}'s row names {variable}; the run captured in "
                f"{_capture_of(row).name} declared {sorted(declared)} and "
                "nothing else. The binary accepting a variable is not the "
                "same fact as somebody having run it"
            )


def test_AN_AGENT_ROWS_CAVEATS_ARE_THE_CAPTURES_CAVEATS():
    """**Derived from the capture, because the flattering edit is a deletion.**

    Nothing in a table cell can carry "it auto-approves its own tool calls" or
    "it was twice as slow" — those live in the prose beneath, and prose is
    what gets tidied. If the capture raised a caveat, the page repeats it.
    """
    for row in agent_rows():
        capture = _capture_of(row).read_text(encoding="utf-8").lower()
        page = body().lower()
        for caveat in ("auto-approve", "unmeasured"):
            if caveat in capture:
                assert caveat in page, (
                    f"{_capture_of(row).name} raises {caveat!r} about "
                    f"{row['agent']} and docs/vendors.md does not repeat it"
                )


def test_EVERY_AGENTS_CREDENTIAL_IS_ONE_WRING_DOCTOR_LOOKS_FOR():
    """The same derivation the key table gets: a page that tells somebody to
    set a variable `wring doctor` has never heard of sends them to a green
    they cannot get."""
    from wringer import doctor

    for row in agent_rows():
        for variable in re.findall(r"`([A-Z][A-Z0-9_]{3,})`", row["credential"]):
            assert variable in doctor.WELL_KNOWN_KEY_ENVS, (
                f"the agent table tells people to set {variable} and `wring "
                "doctor` does not look for it"
            )


def test_EVERY_LISTED_AGENT_HAS_A_WORKER_COMMAND_A_PERSON_CAN_COPY():
    """A roster row naming a binary with no `run.worker` beside it is a name,
    not a route. The two tables are held together in the one direction that
    matters: listed means copyable."""
    commands = " ".join(
        " ".join(row) for row in _rows("## The worker commands")
    )
    for row in agent_rows():
        assert row["agent"] in commands, (
            f"{row['agent']} is in the roster and the worker-commands table "
            "never says what to write in .wringer.yaml for it"
        )


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
        AGENT_TABLE,
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
