"""The `stability:` block on a gate — SPEC_STABILITY_V0.md §2.

Strict like every other config section: a typo must not silently change what
"verified" means. Two of these are rulings rather than validation —
`require_consistent` defaulting to TRUE, and the refusal where it meets
`proves:` — and each has its own test saying why.
"""

from __future__ import annotations

import pytest

from wringer import config


def gate(**extra) -> config.Gate:
    """One gate, through the real loader, with whatever keys a test adds."""
    raw = {"version": 1, "gates": [{"id": "tests", "run": "pytest", **extra}]}
    return config.parse(raw).gates[0]


def test_a_gate_with_no_stability_key_declares_no_policy():
    """Absence is not `attempts: 1`. It is the whole pre-stability contract:
    one attempt, no attempts directory, no stability record anywhere."""
    assert gate().stability is None


def test_attempts_is_read_and_require_consistent_defaults_to_true():
    """**The default is the whole safety story.**

    `attempts: 3` on its own must not mean "retry until green" — that is the
    defect this feature exists to catch, and a key whose absence installed it
    would be a trap rather than a feature.
    """
    declared = gate(stability={"attempts": 3}).stability
    assert declared == config.Stability(attempts=3, require_consistent=True)


def test_require_consistent_can_be_turned_off_explicitly():
    declared = gate(
        stability={"attempts": 2, "require_consistent": False}
    ).stability
    assert declared == config.Stability(attempts=2, require_consistent=False)


def test_stability_must_declare_attempts():
    """No default. A number Wringer picked is a number nobody agreed to
    spend, and attempts multiply the gate's wall clock."""
    with pytest.raises(config.ConfigError) as caught:
        gate(stability={"require_consistent": True})
    assert "must declare 'attempts'" in str(caught.value)


@pytest.mark.parametrize("value", [0, -1, "3", True, 1.5])
def test_attempts_must_be_a_positive_integer(value):
    with pytest.raises(config.ConfigError) as caught:
        gate(stability={"attempts": value})
    assert "'stability.attempts'" in str(caught.value)


def test_attempts_are_capped():
    with pytest.raises(config.ConfigError) as caught:
        gate(stability={"attempts": config.MAX_STABILITY_ATTEMPTS + 1})
    assert f"at most {config.MAX_STABILITY_ATTEMPTS}" in str(caught.value)


def test_an_unknown_stability_key_is_an_error():
    with pytest.raises(config.ConfigError) as caught:
        gate(stability={"attempts": 2, "retries": 4})
    assert "unknown stability keys: retries" in str(caught.value)


def test_stability_must_be_a_mapping():
    with pytest.raises(config.ConfigError) as caught:
        gate(stability=3)
    assert "'stability' must be a mapping" in str(caught.value)


def test_require_consistent_must_be_a_boolean():
    with pytest.raises(config.ConfigError) as caught:
        gate(stability={"attempts": 2, "require_consistent": "sometimes"})
    assert "'stability.require_consistent' must be a boolean" in str(caught.value)


def test_a_bound_gate_may_not_tolerate_a_mixture():
    """The refusal that closes the acceptance hole, where the two keys meet.

    A tolerated flaky gate reads `passed` while its own record says the result
    was a coin flip, and `proves:` would turn that coin flip into acceptance
    evidence. Worse, it satisfies the HARD half of `evidenced` for free:
    SPEC_ACCEPT_V0 §3 wants a gate that has demonstrably failed, and a
    nondeterministic gate manufactures that receipt without ever telling
    satisfied from unsatisfied.
    """
    with pytest.raises(config.ConfigError) as caught:
        gate(
            proves="c1",
            stability={"attempts": 3, "require_consistent": False},
        )
    message = str(caught.value)
    assert "may not also set 'require_consistent: false'" in message
    assert "manufacture" in message


def test_a_bound_gate_may_still_declare_attempts():
    """Only the tolerance is refused, never the measurement. A gate that
    evidences a criterion is the LAST one whose flakiness should go
    unmeasured."""
    bound = gate(proves="c1", stability={"attempts": 3})
    assert bound.proves == "c1"
    assert bound.stability == config.Stability(attempts=3, require_consistent=True)


def test_a_drafted_spec_may_not_propose_a_stability_block():
    """`parse_gate` is shared with `wring spec`, and `spec.schema.json` is
    frozen with `additionalProperties: false` — so a drafted gate carrying
    `stability:` would render a `wringer.spec.yaml` that fails its own
    published schema. Same key-set boundary `proves:` sits behind."""
    with pytest.raises(config.ConfigError) as caught:
        config.parse_gate(
            {"id": "tests", "run": "pytest", "stability": {"attempts": 3}},
            0,
            "reply",
        )
    assert "unknown keys: stability" in str(caught.value)
