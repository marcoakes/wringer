"""The `bench:` section (SPEC_BENCH_V0.md §3).

Two rules decide every check in this file, and both are refusals rather than
validation taste:

- **The only file that may put a command into Wringer's mouth is
  `.wringer.yaml`** (SPEC_GRAPH_V0 ruling 1, restated by SPEC_BENCH_V0 ruling
  1). Contenders are declared here; a flag may only *select* among them. So
  `agent:` takes an id from the shipped table and nothing else, and the
  command it expands to comes from `agents.py`, never from the config and
  never from an invocation.
- **Contenders may vary the worker and nothing else.** Identical conditions
  are what make rows comparable; a per-contender ceiling would be the
  flags-only-tighten rule broken inside a file.
"""

from __future__ import annotations

import pytest

from wringer import config

BASE = """\
version: 1
gates:
  - id: test
    run: "true"
"""


def parse(body: str) -> config.Config:
    import yaml

    return config.parse(yaml.safe_load(BASE + body), source=".wringer.yaml")


def refusal(body: str) -> str:
    with pytest.raises(config.ConfigError) as raised:
        parse(body)
    return str(raised.value)


TWO = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: scripted
      worker: "sh ./fix.sh"
    - id: other
      worker: "sh ./other.sh"
"""


# --- what a valid section produces -----------------------------------------


def test_two_shell_contenders_parse():
    cfg = parse(TWO)
    assert cfg.bench is not None
    assert cfg.bench.contender_wall_clock == 900
    assert [c.id for c in cfg.bench.contenders] == ["scripted", "other"]
    assert cfg.bench.contenders[0].worker == "sh ./fix.sh"


def test_a_repo_without_the_section_has_no_bench():
    """Its absence is what makes `wring bench` unreachable, the way every
    other optional section works."""
    assert parse("").bench is None


def test_an_agent_id_expands_through_the_shipped_table():
    """The id is sugar; the COMMAND comes from `agents.py` and nowhere else.
    A config that could name a command here would be a second file putting a
    command into Wringer's mouth."""
    from wringer import agents

    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: claude
      agent: claude-code
    - id: scripted
      worker: "sh ./fix.sh"
"""
    contender = parse(body).bench.contenders[0]
    assert isinstance(contender.worker, config.AcpWorker)
    expected = agents.worker(agents.find("claude-code"))
    assert contender.worker.command == expected.command
    assert contender.worker.args == expected.args
    assert contender.agent_id == "claude-code"


def test_an_agents_key_env_joins_the_declared_secret_names():
    """A bench across agents needs each one's credential by NAME, and
    `declared_secret_names` stays the single answer to what this config says
    holds one."""
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: claude
      agent: claude-code
    - id: gem
      agent: gemini
"""
    names = config.declared_secret_names(parse(body))
    assert "ANTHROPIC_API_KEY" in names
    assert "GEMINI_API_KEY" in names


def test_a_contenders_own_passthrough_joins_them_too():
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
      worker:
        acp:
          command: some-agent
          env_passthrough: [BENCH_ONE_CREDENTIAL]
    - id: two
      worker:
        acp:
          command: other-agent
          env_passthrough: [BENCH_TWO_CREDENTIAL]
"""
    names = config.declared_secret_names(parse(body))
    assert "BENCH_ONE_CREDENTIAL" in names
    assert "BENCH_TWO_CREDENTIAL" in names


def test_the_declared_names_are_deduplicated_and_stable():
    """Its docstring promises order is stable and duplicates dropped; adding
    a fourth source must not break that."""
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
      agent: claude-code
    - id: two
      agent: claude-code
"""
    names = config.declared_secret_names(parse(body))
    assert names.count("ANTHROPIC_API_KEY") == 1


# --- every refusal, each naming its fix ------------------------------------


def test_one_contender_is_refused_and_names_wring_run():
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: only
      worker: "sh ./fix.sh"
"""
    message = refusal(body)
    assert "wring run" in message, message


def test_no_contenders_at_all_is_refused():
    assert "contenders" in refusal(
        "bench:\n  contender_wall_clock: 900\n  contenders: []\n"
    )


def test_a_missing_wall_clock_is_refused():
    body = """\
bench:
  contenders:
    - id: one
      worker: "a"
    - id: two
      worker: "b"
"""
    message = refusal(body)
    assert "contender_wall_clock" in message


def test_both_agent_and_worker_is_refused():
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
      agent: claude-code
      worker: "sh ./fix.sh"
    - id: two
      worker: "b"
"""
    message = refusal(body)
    assert "agent" in message and "worker" in message


def test_neither_agent_nor_worker_is_refused():
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
    - id: two
      worker: "b"
"""
    assert "worker" in refusal(body)


def test_an_unknown_agent_id_is_refused_and_lists_the_known_ones():
    from wringer import agents

    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
      agent: not-a-real-agent
    - id: two
      worker: "b"
"""
    message = refusal(body)
    for known in agents.known():
        assert known in message, message


def test_duplicate_ids_are_refused():
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: same
      worker: "a"
    - id: same
      worker: "b"
"""
    assert "same" in refusal(body)


def test_a_non_slug_id_is_refused_because_it_names_a_directory():
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: "Not A Slug"
      worker: "a"
    - id: two
      worker: "b"
"""
    assert "slug" in refusal(body)


def test_unknown_keys_are_refused_at_both_levels():
    top = """\
bench:
  contender_wall_clock: 900
  parallel: true
  contenders:
    - id: one
      worker: "a"
    - id: two
      worker: "b"
"""
    assert "parallel" in refusal(top)

    inner = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
      worker: "a"
      max_iterations: 9
    - id: two
      worker: "b"
"""
    assert "max_iterations" in refusal(inner)


def test_a_per_contender_ceiling_is_refused_by_name():
    """The sharpest of the unknown-key refusals, because it is the one an
    author would most reasonably expect to work: identical conditions are the
    whole basis of comparability, and a per-contender budget would be the
    flags-only-tighten rule broken inside a file."""
    body = """\
bench:
  contender_wall_clock: 900
  contenders:
    - id: one
      worker: "a"
      wall_clock: 60
    - id: two
      worker: "b"
"""
    message = refusal(body)
    assert "wall_clock" in message
    assert "identical" in message or "same" in message, message


def test_there_is_no_bench_level_max_iterations():
    """Dropped by ruling: `run.max_iterations` (or its default) already binds
    every contender equally, and a bench-level one could only restate or
    loosen it — and `loop.run` treats the parameter as an OVERRIDE, so
    "tightens" would have been a word the machinery does not implement."""
    body = """\
bench:
  contender_wall_clock: 900
  max_iterations: 4
  contenders:
    - id: one
      worker: "a"
    - id: two
      worker: "b"
"""
    assert "max_iterations" in refusal(body)
