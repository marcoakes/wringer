"""The pre-spend readiness card (P1.7, 0.8.6).

**Runs 4 and 4B, 2026-09-01.** The operator drove a build with a dead key
exported over a working stored login and learned it at the first worker turn
— after the drafting call had been paid for. Every fact needed to say so was
already on the machine. This card is that knowledge arriving in time.
"""

from __future__ import annotations

from test_drive_resume_verb import (  # noqa: F401
    converging_build,
    counting_engine_calls,
    drive,
    failing_build,
    prd,
)

from wringer_drive import run as run_module


def test_THE_CARD_IS_RENDERED_BEFORE_ANY_PAID_CALL(converging_build, tmp_path,
                                                   monkeypatch):
    """The property the whole item is: the card is on screen while the
    drafting endpoint's call count is still zero. Counted, never inferred."""
    launched = counting_engine_calls(monkeypatch)
    seen: list[str] = []
    real = run_module.Session.emit

    def watching(self, step):
        seen.append(step.id)
        if step.id == "readiness":
            # AT the moment the card is emitted, nothing may have been spent.
            assert not [argv for argv in launched if "spec" in argv], (
                "a drafting call was launched before the card that says what "
                "this run will spend"
            )
        return real(self, step)

    monkeypatch.setattr(run_module.Session, "emit", watching)
    drive(["run", str(prd(tmp_path)), "--repo", str(converging_build)],
          "The ones on screen.\nyes\n")

    assert "readiness" in seen, seen
    assert seen.index("readiness") < seen.index("plan"), seen


def test_THE_CARD_SAYS_WHAT_IT_WILL_SPEND_AND_PRICES_NOTHING(converging_build):
    card = run_module.readiness_step(converging_build)

    assert card.id == "readiness"
    text = card.text
    assert "Paid steps ahead:" in text
    assert "If a credential fails:" in text and "wringer-drive resume" in text
    assert "Wringer does not price these." in text
    # A claim ceiling, not a hedge: no currency, no estimate, no percentage.
    for forbidden in ("$", "£", "€", "%", "approximately", "roughly"):
        assert forbidden not in text, forbidden


def test_THE_CARD_QUOTES_DOCTORS_OWN_WORDS_FOR_A_CREDENTIAL(converging_build,
                                                            monkeypatch):
    """The credential lines are doctor's, verbatim — one surface owns that
    fact, and a second wording of it is how run 4B's operator met two
    different accounts of one credential."""
    from wringer import doctor

    said = "THE ENGINE'S OWN SENTENCE ABOUT A KEY"
    real = doctor.run_checks

    def patched(root):
        checks = list(real(root))
        return [
            c if c.name != "drafting key" else doctor.Check(
                name="drafting key", status=doctor.OK, detail=said
            )
            for c in checks
        ]

    monkeypatch.setattr(doctor, "run_checks", patched)
    assert said in run_module.readiness_step(converging_build).text


def test_A_SKIPPED_CHECK_IS_NOT_REPORTED_AS_A_PROBLEM(tmp_path, monkeypatch):
    """A machine where a check does not apply has answered nothing, and a
    card that printed the skip would read as a fault the operator must fix."""
    from wringer import doctor

    def only_skips(root):
        return [doctor.Check(name="worker auth", status=doctor.SKIP,
                             detail="not applicable here")]

    monkeypatch.setattr(doctor, "run_checks", only_skips)
    assert "not applicable here" not in run_module.readiness_step(tmp_path).text


def test_A_PROJECT_WITH_NOTHING_DECLARED_STILL_SAYS_WHAT_HAPPENS(tmp_path):
    """A fresh repository has no config at all; the card is still honest
    rather than empty — it says the answers are coming and what they cost."""
    text = run_module.readiness_step(tmp_path).text
    assert "you answer with" in text or "you name it at the interview" in text
    assert "Paid steps ahead:" in text


def test_THE_CARD_NAMES_ALL_THREE_CEILINGS_not_just_the_turn_count(
    converging_build,
):
    """**A card naming one of three understates what bounds the run — 0.9.4.**

    It said "up to N turn(s)" and stopped. `run.worker_timeout` and
    `run.wall_clock` are attributes on the same object the card already
    holds, and they are the two that actually stop a turn running away: a
    person told how many turns has not been told how long any one of them
    may take.

    `wall_clock` is optional and has no default (`config.py`: "the loop is
    already structurally bounded by iterations x worker_timeout"), so a repo
    that declares none is SAID to have declared none — never given a number
    Wringer invented.
    """
    from wringer import config

    text = run_module.readiness_step(converging_build).text
    settings = config.load(converging_build / config.CONFIG_FILENAME)

    assert "Ceilings:" in text, "the card names no ceilings at all"
    assert f"{settings.run.worker_timeout}s" in text, (
        "the per-turn timeout is not on the card, and it is the ceiling that "
        "stops one turn running away"
    )
    if settings.run.wall_clock:
        assert f"{settings.run.wall_clock}s" in text
    else:
        assert "no whole-build wall clock is declared" in text, (
            "an undeclared wall clock is passed over in silence, which reads "
            "as though one is in force"
        )
    # Still no price, and still no invented number.
    for forbidden in ("$", "£", "€", "%", "approximately", "roughly"):
        assert forbidden not in text, forbidden
