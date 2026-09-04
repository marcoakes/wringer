"""The proof gap as a decision (P1.9, 0.8.7).

**Runs 4 and 4B, 2026-09-01.** The operator delivered with five of seven
requirements unproved. The board said so, the certificate said so, the merge
request said so — and none of them ASKED. A warning read on the way past is
not a decision.
"""

from __future__ import annotations

from test_drive_open_board import (  # noqa: F401
    TO_THE_PEN,
    converge_the_handover,
    drive,
    prd,
    project,
)

from wringer_drive import run as run_module


def _ids(steps) -> list[str]:
    return [step.id for step in steps]


def test_THE_GAP_IS_ASKED_BEFORE_THE_HANDOVER_YES(project, tmp_path, monkeypatch):
    """Asked against the board that was just rendered, and BEFORE the second
    yes — after it, the decision would be about work already sent."""
    converge_the_handover(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)],
        TO_THE_PEN + "deliver\nyes\n",
        monkeypatch,
    )
    ids = _ids(steps)
    assert "proof-gap" in ids, ids
    # Against the board that was just rendered, and before the handover's own
    # confirm — after it, the decision would be about work already sent.
    assert ids.index("board") < ids.index("proof-gap"), ids
    # The handover's own confirm is asked through `_confirm`, which does not
    # emit a step, so what proves the decision came FIRST is that answering
    # `deliver` let the run finish: the gap is asked, then the work is sent.
    assert ids[-1] == "done", ids
    assert code == 0


def test_STRENGTHEN_SENDS_NOTHING_AND_RESUMES_AT_THE_CHECKS(project, tmp_path, monkeypatch):
    """The person chose evidence over speed: nothing is sent, everything
    built is kept, and the record points `resume` at the checks rather than
    back at the handover."""
    converge_the_handover(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)],
        TO_THE_PEN + "strengthen\n",
        monkeypatch,
    )
    assert code == 0, "choosing evidence is not a failure"
    assert _ids(steps)[-1] == "stopped:strengthen-first", _ids(steps)
    assert "deliver" not in _ids(steps), "it asked for the handover anyway"
    assert "wringer-drive resume" in steps[-1].text
    assert run_module.read_resume(project).get("phase") == "gates"


def test_AN_EMPTY_ANSWER_IS_NOT_A_CHOICE(project, tmp_path, monkeypatch):
    """Offers never fall back. An unanswered question stops, and says how to
    come back to it."""
    converge_the_handover(monkeypatch)
    code, steps = drive(
        ["run", str(prd(tmp_path)), "--repo", str(project)],
        TO_THE_PEN + "\n",
        monkeypatch,
    )
    assert code == 2
    assert _ids(steps)[-1] == "stopped:proof-gap-unanswered", _ids(steps)
    assert "wringer-drive resume" in steps[-1].text


def test_NOTHING_UNPROVED_MEANS_NO_QUESTION(tmp_path, monkeypatch):
    """A run with everything settled must meet no extra question — a
    decision asked when there is nothing to decide is a step people learn to
    dismiss."""
    from wringer import accept, evidence

    repo = tmp_path / "repo"
    (repo / evidence.RUNS_DIRNAME / "20260904-000000-aaaa").mkdir(parents=True)

    monkeypatch.setattr(
        accept, "read", lambda run_dir: {"counts": {accept.UNEVIDENCED: 0}}
    )
    assert run_module.proof_gap_step(repo) is None

    monkeypatch.setattr(
        accept, "read",
        lambda run_dir: {
            "counts": {accept.UNEVIDENCED: 2},
            "criteria": [
                {"state": accept.UNEVIDENCED, "title": "The first one"},
                {"state": accept.UNEVIDENCED, "title": "The second one"},
            ],
        },
    )
    step = run_module.proof_gap_step(repo)
    assert step is not None
    assert "The first one" in step.text and "The second one" in step.text
    assert step.detail["unproved"] == 2


def test_THE_OFFER_IS_THE_PLANNERS_OWN_AND_ITS_ABSENCE_IS_SAID(tmp_path,
                                                               monkeypatch):
    """A check this package invented would be the drive deciding what
    evidence is worth. When the planner proposes none, the card says so
    rather than inventing one."""
    from wringer import accept, evidence

    repo = tmp_path / "repo"
    (repo / evidence.RUNS_DIRNAME / "20260904-000000-aaaa").mkdir(parents=True)
    monkeypatch.setattr(
        accept, "read",
        lambda run_dir: {
            "counts": {accept.UNEVIDENCED: 1},
            "criteria": [{"state": accept.UNEVIDENCED, "title": "A thing"}],
        },
    )

    monkeypatch.setattr(run_module, "gate_proposal",
                        lambda repo: {"gates_proposed": ["acc-a-thing"]})
    said = run_module.proof_gap_step(repo)
    assert "acc-a-thing" in said.text
    assert said.detail["gates_proposed"] == ["acc-a-thing"]

    monkeypatch.setattr(run_module, "gate_proposal", lambda repo: {})
    silent = run_module.proof_gap_step(repo)
    assert "proposes no new check" in silent.text
    assert silent.detail["gates_proposed"] == []
