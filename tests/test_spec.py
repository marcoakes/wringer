"""`wring spec` — prose in, a spec file a human approves (docs/specs/SPEC_INTENT_V0.md).

No test here opens a socket. Drafting reuses `judge.send`, the one function
in Wringer that does, so faking that one function is enough to exercise the
whole command — which is also the point of routing it through the judge's
transport rather than adding a second one.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest
import yaml
from core_helpers import flat

from wringer import cli, config, spec

PRD = """\
# CSV export

Our reports page needs a CSV export. People keep asking for it because they
want to pivot the numbers in a spreadsheet.

It should cover the same rows the page is showing, respecting whatever filter
is applied.
"""

CONFIG = """\
version: 1
gates:
  - id: check
    run: "true"
judge:
  endpoint: http://127.0.0.1:11434/v1/chat/completions
  model: cheap-model
  rubric: wringer.rubric.yaml
"""

DRAFT = {
    "title": "Add CSV export to the reports page",
    "open_questions": [
        {
            "id": "date-format",
            "question": "Which date format should the export use?",
            "required": True,
        },
        {
            "id": "row-cap",
            "question": "Is there a maximum row count?",
            "required": False,
        },
    ],
    "criteria": [
        {
            "id": "export-button-exists",
            "title": "A CSV export button appears on the reports page",
            "guidance": "A test asserts the button renders.",
            "required": True,
            "human": False,
        },
        {
            "id": "respects-filters",
            "title": "The export contains exactly the filtered rows",
            "required": True,
            "human": False,
        },
        {
            "id": "reads-well",
            "title": "The column headings read the way a finance team expects",
            "required": True,
            "human": True,
        },
    ],
    "gates": [{"id": "test", "run": "pytest -q"}],
    "tasks": [
        {
            "id": "csv-export",
            "brief": "briefs/csv-export.md",
            "dir": ".",
            "objective": "Add the export endpoint and the button that calls it.",
        }
    ],
}


def reply(payload: object) -> dict:
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return {"choices": [{"message": {"content": body}}]}


def setup_repo(repo: Path, prd: str = PRD, config_text: str = CONFIG) -> None:
    (repo / "PRD.md").write_text(prd, encoding="utf-8")
    (repo / ".wringer.yaml").write_text(config_text, encoding="utf-8")


def fake_transport(monkeypatch, reply=None, fail=None):
    """Stand in for the one function in Wringer that opens a socket."""
    from wringer import judge

    sent = {}

    def fake_send(request, endpoint, timeout, api_key):
        sent.update(
            request=request, endpoint=endpoint, timeout=timeout, api_key=api_key
        )
        if fail is not None:
            raise judge.TransportFailed(fail)
        return reply

    monkeypatch.setattr(judge, "send", fake_send)
    return sent


def only_draft(repo: Path) -> Path:
    found = sorted((repo / spec.SPECS_DIRNAME).iterdir())
    assert len(found) == 1, found
    return found[0]


def drafted(repo: Path) -> dict:
    return yaml.safe_load((repo / spec.SPEC_FILENAME).read_text(encoding="utf-8"))


# --- the dry run: the default, and it drafts nothing ---------------------


def test_a_dry_run_writes_the_request_and_drafts_nothing(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_OK

    out = capsys.readouterr().out
    assert "nothing was sent" in out
    directory = only_draft(repo)
    assert (directory / spec.REQUEST_FILENAME).is_file()
    assert not (directory / spec.RESPONSE_FILENAME).exists()
    # a dry run drafts nothing: there is no spec file to approve by accident
    assert not (repo / spec.SPEC_FILENAME).exists()


def test_a_dry_run_needs_no_api_key(repo, monkeypatch, capsys):
    """The credential is for the socket, and a dry run does not open one."""
    setup_repo(repo, config_text=CONFIG.rstrip() + "\n  api_key_env: DRAFT_KEY\n")
    monkeypatch.delenv("DRAFT_KEY", raising=False)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_OK

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    assert "DRAFT_KEY" in capsys.readouterr().err


def test_print_request_writes_the_body_and_stops(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    body = json.loads(capsys.readouterr().out)
    assert body["model"] == "cheap-model"
    # **No `temperature`, and this assertion is the point rather than a
    # leftover.** It read `body["temperature"] == 0` until 2026-08-18, which
    # pinned a key every current-generation Anthropic model rejects with HTTP
    # 400 before drafting a token. `wring judge`'s request still carries it
    # and its frozen schema still requires it; this one must not.
    assert "temperature" not in body, (
        "`spec.build_request` is sending `temperature` again. Opus 5, Opus "
        "4.8, Opus 4.7, Sonnet 5 and Fable 5 all answer `temperature` is "
        "deprecated for this model, HTTP 400 — a PM naming their own model "
        "gets an error instead of a spec"
    )
    # the PRD really is what travels
    assert "pivot the numbers in a spreadsheet" in body["messages"][1]["content"]
    # an inspection leaves nothing behind
    assert not (repo / spec.SPECS_DIRNAME).exists()


def test_the_request_asks_for_the_key_the_sidecar_is_written_from(
    repo, monkeypatch, capsys
):
    """The drafter can only answer what it was asked.

    Measured on a real model, 2026-08-11 (docs/first-contact.md): the reply
    came back schema-valid on the first try and carried NO `gate_bindings`,
    so no sidecar was written and `gate_diff` was empty. That was not the
    model failing. `parse_bindings` and `render_gatespec` were shipped and
    tested — every test around this one drives them — while the prompt asked
    for `gates: [{id, run}]` and never once named the key the sidecar is
    written from. A whole binding channel, complete and unreachable, because
    the request omitted a word.

    So this test pins the ASK rather than the parse: the machinery below it
    was never broken.
    """
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    asked = json.loads(capsys.readouterr().out)["messages"][1]["content"]
    assert "gate_bindings" in asked
    assert "proves" in asked
    # And the reason a binding exists at all: a command that is green the day
    # it is written has not been shown to tell satisfied from unsatisfied.
    assert "FAILS today" in asked


def test_a_repo_without_a_judge_section_cannot_reach_a_network(
    repo, write_config, monkeypatch, capsys
):
    (repo / "PRD.md").write_text(PRD, encoding="utf-8")
    write_config(repo, 'version: 1\ngates:\n  - id: check\n    run: "true"\n')
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_CONFIG

    assert "no 'judge:' section" in capsys.readouterr().err


# --- --send, against the fake transport ----------------------------------


def test_send_drafts_a_valid_spec_from_a_real_prd(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    sent = fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert sent["endpoint"].endswith("/v1/chat/completions")
    document = drafted(repo)
    assert document["schema_version"] == spec.SCHEMA_VERSION
    assert document["title"] == DRAFT["title"]
    assert len(document["criteria"]) == 3
    assert len(document["tasks"]) == 1
    # and it loads back through the real parser
    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert loaded.title == DRAFT["title"]
    assert [q.id for q in loaded.unanswered] == ["date-format"]
    # both halves of the exchange are on disk
    assert (only_draft(repo) / spec.REQUEST_FILENAME).is_file()
    assert (only_draft(repo) / spec.RESPONSE_FILENAME).is_file()


def test_a_drafted_spec_always_arrives_unapproved(repo, monkeypatch, capsys):
    """The interlock. No reply may set it, however hard it tries."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    insistent = dict(DRAFT, approved=True)
    fake_transport(monkeypatch, reply=reply(insistent))

    # a reply carrying a key the request never asked for is refused outright
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    assert "did not ask for" in capsys.readouterr().err
    assert not (repo / spec.SPEC_FILENAME).exists()

    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    assert drafted(repo)["approved"] is False
    assert spec.load(repo / spec.SPEC_FILENAME).approved is False


def test_the_intent_is_the_humans_words_not_the_models(repo, monkeypatch, capsys):
    """A model paraphrasing the PRD inside the artifact the human approves is
    the confident-wrong-answer in miniature."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(
        monkeypatch,
        reply=reply(dict(DRAFT, intent="They want a button. Probably red.")),
    )

    # the paraphrase is refused as an unrequested key...
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    # ...and what does get written is quoted from the file
    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()
    assert "pivot the numbers in a spreadsheet" in drafted(repo)["intent"]
    assert "Probably red" not in (repo / spec.SPEC_FILENAME).read_text("utf-8")


@pytest.mark.parametrize(
    "body, expected",
    [
        (reply("not json at all"), "not the JSON object"),
        (reply("[1, 2, 3]"), "not an object"),
        ({"choices": []}, "no message content"),
        ({}, "no message content"),
        (reply(dict(DRAFT, criteria=[])), "non-empty list"),
        (reply(dict(DRAFT, tasks=[])), "non-empty list"),
        (reply(dict(DRAFT, gates=[{"id": "../etc", "run": "x"}])), "letter or digit"),
        (
            reply(dict(DRAFT, tasks=[dict(DRAFT["tasks"][0], brief="../../out.md")])),
            "escape the repository",
        ),
        (
            reply(dict(DRAFT, tasks=[dict(DRAFT["tasks"][0], brief="/etc/passwd")])),
            "relative to the repository",
        ),
        (
            reply(dict(DRAFT, criteria=[dict(c, required=False)
                                        for c in DRAFT["criteria"]])),
            "at least one criterion must be required",
        ),
    ],
)
def test_a_malformed_reply_is_refused_and_writes_no_spec(
    repo, monkeypatch, capsys, body, expected
):
    """Never a half-written spec file: a half-written one gets approved."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=body)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert expected in capsys.readouterr().err
    assert not (repo / spec.SPEC_FILENAME).exists()


def test_an_unreachable_endpoint_writes_no_spec(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, fail="connection refused")

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert "connection refused" in capsys.readouterr().err
    assert not (repo / spec.SPEC_FILENAME).exists()
    # ...but the request that would have been sent is still auditable
    assert (only_draft(repo) / spec.REQUEST_FILENAME).is_file()


def test_an_existing_spec_is_never_overwritten(repo, monkeypatch, capsys):
    """It may already carry an approval and a page of answers."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    approved = (repo / spec.SPEC_FILENAME).read_text("utf-8").replace(
        "approved: false", "approved: true"
    )
    (repo / spec.SPEC_FILENAME).write_text(approved, encoding="utf-8")

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert "refusing to overwrite" in capsys.readouterr().err
    assert "approved: true" in (repo / spec.SPEC_FILENAME).read_text("utf-8")


def test_the_api_key_reaches_the_transport_but_no_artifact(
    repo, monkeypatch, capsys
):
    secret = "sk-draftdraft98765"
    setup_repo(repo, config_text=CONFIG.rstrip() + "\n  api_key_env: DRAFT_KEY\n")
    monkeypatch.setenv("DRAFT_KEY", secret)
    monkeypatch.chdir(repo)
    sent = fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    assert sent["api_key"] == secret
    for name in (spec.REQUEST_FILENAME, spec.RESPONSE_FILENAME,
                 spec.SUMMARY_FILENAME):
        assert secret not in (only_draft(repo) / name).read_text(encoding="utf-8")


def test_json_output_is_one_object(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send", "--json"]) == cli.EXIT_OK

    payload = json.loads(capsys.readouterr().out)
    assert payload == {
        "mode": "live",
        "spec": spec.SPEC_FILENAME,
        "approved": False,
        "criteria": 3,
        "gates": 1,
        "tasks": 1,
        "open_questions": 2,
        "spec_dir": payload["spec_dir"],
    }
    assert payload["spec_dir"].startswith(".wringer/specs/")


# --- the PRD itself ------------------------------------------------------


def test_a_prd_outside_the_repo_is_refused(repo, tmp_path_factory, monkeypatch,
                                           capsys):
    outside = tmp_path_factory.mktemp("elsewhere") / "secrets.md"
    outside.write_text("nothing to see", encoding="utf-8")
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", str(outside)]) == cli.EXIT_CONFIG

    assert "outside the repository" in capsys.readouterr().err


def test_an_oversized_prd_is_refused(repo, monkeypatch, capsys):
    setup_repo(repo, prd="x" * (spec.MAX_PRD_BYTES + 1))
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_CONFIG

    assert "these bytes travel" in flat(capsys.readouterr().err)


def test_an_empty_prd_is_refused(repo, monkeypatch, capsys):
    setup_repo(repo, prd="   \n\n")
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_CONFIG

    assert "nothing to draft from" in capsys.readouterr().err


def test_a_missing_prd_is_refused(repo, monkeypatch, capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "nope.md"]) == cli.EXIT_CONFIG

    assert "no PRD at" in capsys.readouterr().err


# --- the rendered file ---------------------------------------------------


def test_the_rendered_file_survives_awkward_prose(repo, monkeypatch, capsys):
    """A paragraph objective, a colon in a title, an indented PRD line: all of
    them are YAML hazards, and all of them must still load."""
    awkward = dict(
        DRAFT,
        title="Export: rows, filtered",
        criteria=[
            dict(DRAFT["criteria"][0], title="It exports: everything shown"),
            DRAFT["criteria"][2],
        ],
        tasks=[
            dict(
                DRAFT["tasks"][0],
                objective="First, add the endpoint.\n\nThen wire up the button.",
            )
        ],
    )
    setup_repo(repo, prd="    indented first line\n\nnormal: line\n\ttab\n")
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(awkward))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert loaded.title == "Export: rows, filtered"
    assert loaded.tasks[0].objective.endswith("Then wire up the button.")
    assert "indented first line" in loaded.intent


def test_the_file_says_out_loud_that_it_is_the_interlock(repo, monkeypatch,
                                                         capsys):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    text = (repo / spec.SPEC_FILENAME).read_text(encoding="utf-8")
    assert "approved: false" in text
    assert "no --yes" in text
    # the human's next move is written down beside the switch
    assert "refuses while this is false" in text


# --- the module's own edges ----------------------------------------------


def test_a_long_prd_is_quoted_and_says_so():
    quoted = spec.quote_intent("y" * (spec.MAX_INTENT_CHARS + 500))
    assert quoted.startswith("y" * 100)
    assert "read the file itself for the rest" in quoted


def test_control_characters_never_reach_the_spec_file():
    assert "\x00" not in spec.quote_intent("before\x00after")
    assert spec.quote_intent("keep\ttabs\nand newlines") == "keep\ttabs\nand newlines"


def test_a_spec_without_approved_is_not_approved_by_omission():
    document = dict(
        schema_version=spec.SCHEMA_VERSION,
        title="t",
        intent="i",
        criteria=DRAFT["criteria"],
        tasks=DRAFT["tasks"],
    )
    with pytest.raises(spec.SpecError, match="approved by omission"):
        spec.parse(document, "test")


def test_a_failed_live_draft_never_calls_itself_a_dry_run(repo, monkeypatch,
                                                          capsys):
    """The summary is an evidence artifact. A live run that produced nothing
    is not a dry run, and saying so would be the one unforgivable thing."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply("not json at all"))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    written = (only_draft(repo) / spec.SUMMARY_FILENAME).read_text("utf-8")
    assert "mode: **live**" in written
    assert "dry run" not in written
    assert "no spec file was written" in written


def test_an_unreachable_endpoint_summary_says_the_socket_was_opened(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, fail="connection refused")

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    written = (only_draft(repo) / spec.SUMMARY_FILENAME).read_text("utf-8")
    assert "dry run" not in written


# --- what an adversarial review found (2026-08-01) -----------------------
#
# Each of these reproduced against the first cut of this slice. They are the
# cases where the code was confidently wrong, which is the failure mode the
# whole slice is about, so they get named tests rather than a tidy-up.


def test_the_wire_never_carries_what_the_request_file_redacts(
    repo, monkeypatch, capsys
):
    """THE audit test. Scrubbing only the artifact would leave request.json
    saying [REDACTED] beside a socket that carried the real value — a record
    that denies what happened, which is worse than no record."""
    secret = "sk-live-AAAABBBBCCCC1234"
    setup_repo(
        repo,
        prd=f"Use the staging key {secret} when testing the export.",
        config_text=CONFIG.rstrip() + "\n  api_key_env: DRAFT_KEY\n",
    )
    monkeypatch.setenv("DRAFT_KEY", secret)
    monkeypatch.chdir(repo)
    sent = fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    on_wire = json.dumps(sent["request"])
    on_disk = (only_draft(repo) / spec.REQUEST_FILENAME).read_text("utf-8")
    # the artifact and the socket agree, because both came from one scrubbed
    # string — and neither carries the credential
    assert secret not in on_wire
    assert secret not in on_disk
    assert "[REDACTED]" in on_wire and "[REDACTED]" in on_disk
    # nor does the spec file the human is about to commit
    assert secret not in (repo / spec.SPEC_FILENAME).read_text("utf-8")


def test_print_request_is_scrubbed_too(repo, monkeypatch, capsys):
    secret = "sk-live-DDDDEEEEFFFF5678"
    setup_repo(
        repo,
        prd=f"The key is {secret}.",
        config_text=CONFIG.rstrip() + "\n  api_key_env: DRAFT_KEY\n",
    )
    monkeypatch.setenv("DRAFT_KEY", secret)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    assert secret not in capsys.readouterr().out


def test_a_reply_that_answers_its_own_question_is_refused(
    repo, monkeypatch, capsys
):
    """The second interlock. An `answer` the drafter wrote is the assumption
    it was told to ask about, wearing a human's clothes — `wring plan` would
    wave it through and the brief would call it a decision someone made."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    presumptuous = dict(
        DRAFT,
        open_questions=[
            dict(DRAFT["open_questions"][0], answer="I'll assume ISO-8601."),
            DRAFT["open_questions"][1],
        ],
    )
    fake_transport(monkeypatch, reply=reply(presumptuous))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "answered its own open question" in err
    assert "date-format" in err
    assert not (repo / spec.SPEC_FILENAME).exists()


#: The `.git` paths are the OTHER rule in `check_writable` and stay literal —
#: there is no list in `src/` to derive them from, and two of them is the
#: point. The reserved paths are DERIVED (2026-08-24, Fable's hand-kept-list
#: audit): they were four typed-out names beside a `spec.RESERVED_WRITE_PATHS`
#: that is itself derived, so a fifth would have been exercised by nothing.
@pytest.mark.parametrize(
    "path",
    [".git/refs/heads/main", ".git/config", *spec.RESERVED_WRITE_PATHS],
)
def test_a_write_path_that_would_destroy_something_is_refused(repo, path):
    with pytest.raises(spec.SpecError):
        spec.check_writable(repo, path, "brief")


def test_a_control_character_in_a_path_is_refused_not_crashed(repo):
    """A NUL reaches the OS layer and raises ValueError out of stat(). A
    refusal is the answer; a traceback is not."""
    with pytest.raises(spec.SpecError, match="control character"):
        spec.check_writable(repo, "briefs/a\x00.md", "brief")


def test_every_scalar_the_file_can_hold_reads_back_exactly(repo):
    """`_scalar` used to `.strip()` the emitter's document marker, which also
    ate leading and trailing Unicode whitespace from the value — so a title
    ending in a non-breaking space was quietly written down as a different
    title. And only '\\n' forced quoting, though YAML breaks lines on
    U+2028, U+2029 and U+0085 too."""
    awkward = [
        "title\xa0", "\xa0lead", "tail　", "a b", "c d",
        "e\x85f", "cr\rhere", "multi\nline", "a: b", "yes", "null", "123",
        "  padded  ", "#hash", "- dash", 'q"and\'both', "back\\slash",
        "emoji \U0001f3af", "",
    ]
    for value in awkward:
        rendered = spec._scalar(value)
        assert "\n" not in rendered, f"{value!r} rendered across lines"
        assert yaml.safe_load(f"k: {rendered}")["k"] == value, value


def test_the_dry_run_key_check_opens_no_socket(repo, monkeypatch, capsys):
    """The --send half must be refused BEFORE the transport, not by the
    transport happening to fail. Any call here is the bug."""
    setup_repo(repo, config_text=CONFIG.rstrip() + "\n  api_key_env: DRAFT_KEY\n")
    monkeypatch.delenv("DRAFT_KEY", raising=False)
    monkeypatch.chdir(repo)

    from wringer import judge

    def forbidden(*args, **kwargs):
        raise AssertionError("a socket was opened without the declared key")

    monkeypatch.setattr(judge, "send", forbidden)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_OK
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    assert "DRAFT_KEY" in capsys.readouterr().err


def test_the_drafter_is_shown_the_gates_the_repo_already_declares(
    repo, monkeypatch, capsys
):
    """A drafter shown nothing invents. Law 5 is why proposals are a diff a
    human applies; this is how to need that safety net less often."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    body = json.loads(capsys.readouterr().out)["messages"][1]["content"]
    assert "already declares" in body
    assert "check: true" in body


def test_criteria_too_large_to_be_a_rubric_are_refused_at_draft_time(
    repo, monkeypatch, capsys
):
    """Not left for `wring plan`: a spec that reads fine, gets approved, and
    only then turns out to be unplannable spends the reading for nothing."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    bloated = dict(DRAFT, criteria=[
        {"id": f"c{n}", "title": "T", "guidance": "g" * 2000,
         "required": True, "human": False}
        for n in range(20)
    ])
    fake_transport(monkeypatch, reply=reply(bloated))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert "these bytes travel" in flat(capsys.readouterr().err)
    assert not (repo / spec.SPEC_FILENAME).exists()


@pytest.mark.parametrize(
    "over, expected",
    [
        ({"tasks": [{"id": f"t{n}", "brief": f"briefs/{n}.md", "dir": ".",
                     "objective": "o"} for n in range(spec.MAX_TASKS + 1)]},
         "over the limit"),
        ({"open_questions": [{"id": f"q{n}", "question": "?", "required": False}
                             for n in range(spec.MAX_OPEN_QUESTIONS + 1)]},
         "over the limit"),
    ],
)
def test_the_model_controlled_ceilings_hold(repo, monkeypatch, capsys, over,
                                            expected):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(dict(DRAFT, **over)))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert expected in capsys.readouterr().err
    assert not (repo / spec.SPEC_FILENAME).exists()


@pytest.mark.parametrize(
    "duplicated",
    [
        {"tasks": [dict(DRAFT["tasks"][0]),
                   dict(DRAFT["tasks"][0], brief="briefs/other.md")]},
        {"open_questions": [DRAFT["open_questions"][0],
                            dict(DRAFT["open_questions"][0], question="again?")]},
        {"gates": [{"id": "test", "run": "a"}, {"id": "test", "run": "b"}]},
    ],
)
def test_duplicate_ids_are_refused(repo, monkeypatch, capsys, duplicated):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(dict(DRAFT, **duplicated)))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert "duplicate" in capsys.readouterr().err
    assert not (repo / spec.SPEC_FILENAME).exists()


def test_an_oversized_spec_file_is_refused_on_load(repo):
    (repo / spec.SPEC_FILENAME).write_text(
        "# " + "x" * (spec.MAX_SPEC_BYTES + 1), encoding="utf-8"
    )
    with pytest.raises(spec.SpecError, match="over the"):
        spec.load(repo / spec.SPEC_FILENAME)


@pytest.mark.parametrize("escape", ["../elsewhere", "/etc", "~/somewhere"])
def test_a_task_dir_that_leaves_the_repo_is_refused(repo, escape):
    with pytest.raises(spec.SpecError):
        spec.parse(
            {
                "schema_version": spec.SCHEMA_VERSION,
                "approved": True,
                "title": "t",
                "intent": "i",
                "criteria": DRAFT["criteria"],
                "tasks": [dict(DRAFT["tasks"][0], dir=escape)],
            },
            "test",
        )


def test_a_prd_carrying_the_agents_credential_is_scrubbed(
    repo, write_config, monkeypatch, capsys
):
    """`wring spec` scrubs the PRD on the way IN, so `request.json` and the
    wire carry the same text. It built that redactor from `judge.api_key_env`
    alone, so a credential named in `run.worker.acp.env_passthrough` — the one
    an agent is handed, and the one `wring start` writes — went through
    untouched.

    A PRD is a document a human pasted things into. That is exactly where a
    key ends up by accident.
    """
    secret = "notarealcredential-in-a-prd-4c81f0a6"
    monkeypatch.setenv("WRINGER_AGENT_CREDENTIAL", secret)
    write_config(
        repo,
        'version: 1\ngates:\n  - id: t\n    run: "true"\n'
        "run:\n  worker:\n    acp:\n      command: some-agent\n"
        "      env_passthrough: [WRINGER_AGENT_CREDENTIAL]\n"
        "judge:\n"
        "  endpoint: http://127.0.0.1:11434/v1/chat/completions\n"
        "  model: a-model\n"
        "  rubric: rubric.yaml\n",
    )
    (repo / "PRD.md").write_text(
        f"# Build it\n\nUse the key {secret} when you call the API.\n",
        encoding="utf-8",
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_OK
    capsys.readouterr()

    hits = [
        path.relative_to(repo).as_posix()
        for path in (repo / ".wringer").rglob("*")
        if path.is_file()
        and secret in path.read_text(encoding="utf-8", errors="replace")
    ]
    assert hits == [], f"the credential reached {hits}"


# --- the gate sidecar (G1, SPEC_GATEGEN_V0) ------------------------------
#
# A criterion for a feature that does not exist has no gate, and until now a
# human wrote every one by hand (docs/factory-dry-run.md §3: `wring plan`
# proposed ZERO gates). The drafter now proposes them into
# `wringer.gates.yaml` — a sidecar, because `wringer.spec.v1` is frozen and
# has no `proves` channel — and that file has no authority at all until a
# person applies the diff `wring plan` prints.

BINDINGS = [
    {
        "id": "acc-export-button",
        "run": "pytest -q acceptance/test_button.py",
        "proves": "export-button-exists",
    },
    {
        "id": "acc-filters",
        "run": "pytest -q acceptance/test_filters.py",
        "timeout": 300,
        "proves": "respects-filters",
    },
]


def draft_with(bindings) -> dict:
    return {**DRAFT, "gate_bindings": bindings}


def sidecar(repo: Path) -> dict:
    return yaml.safe_load(
        (repo / spec.GATESPEC_FILENAME).read_text(encoding="utf-8")
    )


def test_the_drafter_proposes_a_gate_for_every_machine_criterion(
    repo, monkeypatch, capsys
):
    """One per criterion a machine can decide, and none for the one only a
    person can — a command claiming to evidence taste is a category error the
    config loader already refuses."""
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply(draft_with(BINDINGS)))
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    written = sidecar(repo)
    assert written["schema_version"] == spec.GATESPEC_SCHEMA_VERSION
    assert [g["id"] for g in written["gates"]] == [
        "acc-export-button", "acc-filters"
    ]
    assert [g["proves"] for g in written["gates"]] == [
        "export-button-exists", "respects-filters"
    ]
    # the human criterion is bound by nothing
    assert "reads-well" not in yaml.safe_dump(written)
    capsys.readouterr()


def test_A_GATE_INSTALLED_BY_AN_EARLIER_RUN_IS_NOT_A_CONFLICT(repo):
    """**Field report 2026-08-21 finding 10 — re-running was not a safe act.**

    The first run installed `recently-played-acceptance` into `.wringer.yaml`
    and left its proposal in `wringer.gates.yaml`, which is exactly what a
    successful run leaves behind. The second run then compared the gate to
    ITSELF, called it a pre-existing conflict, and refused:

        'recently-played-acceptance' runs `node --test …`, which is already
        what 'recently-played-acceptance' runs … it passes today, so it
        cannot be made to fail by the work. The binding was dropped and the
        criterion is left unbound

    Three things wrong, all verified by the evaluator: the same id on both
    sides of the sentence; "it passes today" asserted about a command that
    exits 1, which Wringer itself had reported as "None of them passes today"
    one run earlier; and "left unbound" contradicted by `.wringer.yaml`, which
    still carried its `proves:` line.

    Then it STOPPED THE BUILD, and recovery meant moving the already-applied
    proposal aside by hand. A product manager is dead there.
    """
    installed = config.Gate(
        id="acc-export-button",
        run="pytest -q acceptance/test_button.py",
        proves="export-button-exists",
    )
    criteria = [
        spec.Criterion(id="export-button-exists", title="There is a button"),
    ]
    kept, notes, already = spec.parse_bindings(
        [dict(BINDINGS[0])], criteria, "the sidecar", (installed,)
    )

    assert notes == (), (
        f"an already-installed gate was reported as a conflict: {notes}. This "
        "is the previous run's success, still where the previous run left it"
    )
    assert kept == (), "it is already on disk; there is nothing to install"
    assert len(already) == 1
    assert "already installed" in already[0]
    # The three false claims, each named so none can come back quietly.
    said = " ".join(already)
    assert "passes today" not in said, (
        "a gate result is being asserted that nothing measured"
    )
    assert "left unbound" not in said, (
        "the criterion is bound on disk; saying otherwise contradicts the file"
    )


def test_the_same_command_under_a_DIFFERENT_id_is_still_a_real_conflict(repo):
    """The other direction, and the reason the pair exists.

    The fix above must not turn every duplicate into a shrug. A DIFFERENT gate
    running the identical command is the case the check was built for — it was
    measured on 2026-08-17, when a drafter proposed `pytest -q` as a binding
    for a criterion the repository's own `test` gate already ran, green before
    and after the work.
    """
    installed = config.Gate(id="test", run="pytest -q acceptance/test_button.py")
    criteria = [
        spec.Criterion(id="export-button-exists", title="There is a button"),
    ]
    kept, notes, already = spec.parse_bindings(
        [dict(BINDINGS[0])], criteria, "the sidecar", (installed,)
    )

    assert already == (), "a genuine conflict was waved through as already applied"
    assert len(notes) == 1 and kept == ()
    assert "'test' runs" in notes[0]
    # **The claim ceiling.** The old sentence ended "it passes today, so it
    # cannot be made to fail by the work" — a statement about a gate result
    # nothing had run, and false on the measured case. The ARGUMENT survives
    # in the drafting request's prose, where it always lived.
    assert "passes today" not in notes[0], (
        "the note asserts a gate result nobody measured"
    )
    # Nothing else declares `proves: export-button-exists` here, so saying so
    # is true — and it is DERIVED from the declared gates rather than assumed.
    assert "nothing else in the project's settings proves" in notes[0]


def test_NO_NOTE_EVER_NAMES_THE_SAME_GATE_ON_BOTH_SIDES(repo):
    """**Field report 2026-08-25, finding 2 — the half 2026-08-21 left alive.**

    Finding 10 killed the tautology for the case where id, command AND
    binding all matched. Measured at HEAD a field report later, the same
    sentence still came out whenever the installed gate's `proves:` differed
    from the proposal's:

        'acceptance-skip-downstream' runs `pytest -q …`, which is already what
        'acceptance-skip-downstream' runs

    The commonest way in is not exotic — somebody hand-wrote the check first,
    so the gate on disk carries no binding at all — and `parse_gatespec`
    RAISES on the first note, so the build stops on a sentence nobody can act
    on. That is a product manager stuck, twice, on the same sentence.

    **Derived over every arm, not spot-checked.** The property is that no
    note may name one id on both sides of its own sentence, whatever the
    reason for the note. A guard written as three examples would pass again
    the next time an arm is added.
    """
    cmd = "pytest -q acceptance/test_button.py"
    criteria = [
        spec.Criterion(id="export-button-exists", title="There is a button"),
        spec.Criterion(id="something-else", title="Something else"),
    ]
    same_id = "acc-export-button"
    arms = {
        "installed with no binding at all": config.Gate(id=same_id, run=cmd),
        "installed proving another criterion": config.Gate(
            id=same_id, run=cmd, proves="something-else"
        ),
        "installed proving the same criterion": config.Gate(
            id=same_id, run=cmd, proves="export-button-exists"
        ),
    }
    for label, installed in arms.items():
        _kept, notes, already = spec.parse_bindings(
            [dict(BINDINGS[0])], criteria, "the sidecar", (installed,)
        )
        for said in (*notes, *already):
            assert said.count(f"'{same_id}'") < 2, (
                f"{label}: the gate is compared to ITSELF — {said}"
            )
        # And whatever it says, it never asserts a result nothing ran.
        assert "passes today" not in " ".join((*notes, *already)), label

    # The two arms that DROP the binding say what to do about it, because a
    # refusal that stops the build and names no next step is where the field
    # report's operator was left.
    _kept, notes, _already = spec.parse_bindings(
        [dict(BINDINGS[0])], criteria, "the sidecar",
        (config.Gate(id=same_id, run=cmd),),
    )
    assert "add `proves: export-button-exists`" in notes[0], notes


def test_the_unbound_half_of_the_note_is_not_claimed_when_the_config_binds_it(
    repo,
):
    """The half of finding 10 that was false on disk.

    A conflicting proposal is dropped — but whether that leaves the criterion
    unbound depends on the rest of `.wringer.yaml`, which this function can
    read. When something already proves it, claiming otherwise is the same
    class of false sentence as "it passes today".
    """
    installed = (
        config.Gate(id="test", run="pytest -q acceptance/test_button.py"),
        config.Gate(id="other", run="pytest -q other.py",
                    proves="export-button-exists"),
    )
    criteria = [
        spec.Criterion(id="export-button-exists", title="There is a button"),
    ]
    _kept, notes, _already = spec.parse_bindings(
        [dict(BINDINGS[0])], criteria, "the sidecar", installed
    )
    assert len(notes) == 1
    assert "nothing else in the project's settings proves" not in notes[0], (
        "the note claims the criterion is unbound while a declared gate proves it"
    )


def test_OVERRULING_AN_ASSUMPTION_MARKS_THE_CRITERIA_IT_SHAPED_STALE():
    """**Field report 2026-08-21 finding 4 — the deepest one in the report.**

    The evaluator overruled the assumption `limit-of-three` with *"make it
    five, three feels tight now"*. `wringer-board revise` did everything it
    claims: the answer was recorded, the approval was withdrawn, `wring plan`
    refused. And the criterion that assumption had SHAPED was left untouched
    in both `wringer.spec.yaml` and `wringer.rubric.yaml`:

        - id: capped-at-three
          title: At most three games are ever shown

    So the repository recorded "make it five" as the person's answer AND "at
    most three" as the thing the work would be judged against. Nothing warned.

    *"The plan's own disclaimer — that a green check against a wrongly-worded
    requirement proves the wrong thing perfectly — describes this exactly,
    except here Wringer created the inconsistency itself, and a PM has no way
    to notice it."*
    """
    drafted = spec.Spec(
        approved=False,
        title="Arcade",
        intent="Players pick up where they left off.",
        questions=(
            # The promoted assumption: its id is now an ANSWERED question
            # whose text is the question the assumption displaced.
            spec.Question(
                id="limit-of-three",
                question="How many recent games should be shown?",
                required=True,
                answer="make it five, three feels tight now",
            ),
        ),
        criteria=(
            spec.Criterion(id="capped-at-three", title="At most three games are shown"),
            spec.Criterion(id="unrelated", title="The heading reads as mine"),
        ),
        gates=(),
        tasks=(spec.Task(id="build", brief="briefs/b.md", objective="Build it."),),
        path="wringer.spec.yaml",
    )
    assumptions = (
        spec.Assumption(
            id="limit-of-three",
            decision="The cap is exactly three entries.",
            why="Three fits the shelf without scrolling.",
            instead_of_asking="How many recent games should be shown?",
            criteria=("capped-at-three",),
        ),
    )

    stale, guesses = spec.stale_criteria(drafted, assumptions)

    assert [row.criterion for row in stale] == ["capped-at-three"], (
        "the criterion derived from an overruled decision was not flagged — "
        "it stands in the spec as the thing the work is judged against"
    )
    assert stale[0].stated is True, "a stated back-reference is not a guess"
    assert stale[0].answer == "make it five, three feels tight now"
    assert stale[0].decision == "The cap is exactly three entries."
    assert guesses == (), "a stated back-reference must not also produce a guess"
    # And it does not sweep up criteria the decision never touched.
    assert "unrelated" not in [row.criterion for row in stale]


def test_an_assumption_still_standing_marks_NOTHING_stale():
    """The other direction. An assumption nobody overruled is the ordinary
    case — it is a decision the person accepted by approving the plan, and
    every criterion it shaped is correctly worded. A detector that fired here
    would refuse every plan in the world."""
    drafted = spec.Spec(
        approved=False,
        title="Arcade",
        intent="Players pick up where they left off.",
        questions=(),
        criteria=(spec.Criterion(id="capped-at-three", title="At most three"),),
        gates=(),
        tasks=(spec.Task(id="build", brief="briefs/b.md", objective="Build it."),),
        path="wringer.spec.yaml",
    )
    assumptions = (
        spec.Assumption(
            id="limit-of-three",
            decision="The cap is exactly three entries.",
            why="Three fits the shelf.",
            instead_of_asking="How many recent games should be shown?",
            criteria=("capped-at-three",),
        ),
    )
    stale, guesses = spec.stale_criteria(drafted, assumptions)
    assert stale == () and guesses == ()


def test_an_overruled_assumption_with_NO_back_reference_says_it_cannot_list_them():
    """**The honest fallback, and it is a LOWER BOUND with no known ceiling.**

    An older sidecar carries no `criteria`, and a drafter may simply not emit
    them. The temptation is to guess by matching words between the decision
    and a criterion's title. This repository has already learned what that
    costs: the buried-decision detector was corrected once and the correction
    was ALSO wrong, so it is now ruled a lower bound with no true-negative
    case in the corpus.

    So no list is invented. The note says a decision was overruled, that the
    draft did not record what it shaped, and — explicitly — that silence here
    is not evidence that nothing is affected.
    """
    drafted = spec.Spec(
        approved=False,
        title="Arcade",
        intent="Players pick up where they left off.",
        questions=(
            spec.Question(
                id="limit-of-three",
                question="How many recent games should be shown?",
                required=True,
                answer="make it five",
            ),
        ),
        criteria=(spec.Criterion(id="capped-at-three", title="At most three"),),
        gates=(),
        tasks=(spec.Task(id="build", brief="briefs/b.md", objective="Build it."),),
        path="wringer.spec.yaml",
    )
    assumptions = (
        spec.Assumption(
            id="limit-of-three",
            decision="The cap is exactly three entries.",
            why="Three fits the shelf.",
            instead_of_asking="How many recent games should be shown?",
        ),
    )
    stale, guesses = spec.stale_criteria(drafted, assumptions)

    assert stale == (), "a guess must never reach the channel that REFUSES"
    assert len(guesses) == 1
    assert "not evidence that none of them do" in guesses[0], (
        "the note does not say that its silence proves nothing — which is the "
        "one thing a lower-bound detector must always say"
    )


# The question a real product manager was asked, on a real run, as the thing
# blocking their build. Copied verbatim from docs/field-report-2026-08-21.md
# finding 5 — a fixture written here would be a fixture written on the same
# side of the seam as its reader.
THE_UNANSWERABLE_QUESTION = (
    "Which of the listed criteria does `acceptance/test_skip_downstream.py` "
    "(with `acceptance/chain.json`) actually assert, so the remaining "
    "criteria can be given checks of their own?"
)


def test_A_BLOCKING_QUESTION_NAMING_A_TRACKED_FILE_IS_REFUSED_AT_PARSE(repo):
    """**Field report 2026-08-21 finding 5.**

    Answering that question means reading a 145-line pytest file and mapping
    ten test functions onto nine acceptance criteria. It is a question for an
    engineer, asked of a product manager, as the thing blocking their build —
    contradicting the product's stated audience on the one screen where the
    audience matters.

    The drafter was not guessing: the request HANDS it the tracked file list,
    so rule 6 is satisfiable, and the request already says "never ask what you
    can look up". Prompts are not guards — this repository has measured that
    twice — so this is the guard.

    A refused draft is a sub-cent re-roll. A blocking question that requires
    reading pytest source is the product failing at the thing it is for.
    """
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": "which-asserts", "question": THE_UNANSWERABLE_QUESTION,
         "required": True}
    ]
    tracked = ("acceptance/test_skip_downstream.py", "acceptance/chain.json")

    with pytest.raises(spec.SpecError, match="only somebody who can read"):
        spec.parse_response(reply(payload), PRD, (), tracked)


def test_the_parser_REFUSES_and_never_rewrites_or_demotes_the_question():
    """Standing law, and both halves matter.

    Rewriting would be this package deciding what the drafter meant to ask.
    Demoting to optional would leave a question nobody can answer sitting in
    the spec looking harmless. The whole reply is refused and re-drafted.
    """
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": "which-asserts", "question": THE_UNANSWERABLE_QUESTION,
         "required": True}
    ]
    try:
        spec.parse_response(
            reply(payload), PRD, (), ("acceptance/test_skip_downstream.py",)
        )
    except spec.SpecError as exc:
        assert "Nothing was written" in str(exc)
    else:  # pragma: no cover - the assertion above is the point
        raise AssertionError("the unanswerable question was accepted")


def test_an_OPTIONAL_question_naming_a_file_blocks_nothing_and_is_kept():
    """Only a REQUIRED question is refused. An optional one blocks no build,
    and refusing a paid draft over it would cost more than it saves."""
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": "which-asserts", "question": THE_UNANSWERABLE_QUESTION,
         "required": False}
    ]
    drafted = spec.parse_response(
        reply(payload), PRD, (), ("acceptance/test_skip_downstream.py",)
    )
    assert [q.id for q in drafted.spec.questions] == ["which-asserts"]


def test_a_question_a_PERSON_can_answer_is_untouched():
    """The other direction, and it is most of the world. A guard that fired on
    ordinary questions would refuse every draft this product makes."""
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": "date-format",
         "question": "Which date format should the export use?",
         "required": True}
    ]
    drafted = spec.parse_response(
        reply(payload), PRD, (), ("acceptance/test_skip_downstream.py", "src/app.py")
    )
    assert [q.id for q in drafted.spec.questions] == ["date-format"]


def test_a_bare_word_that_happens_to_be_a_tracked_path_does_not_condemn():
    """`LICENSE` and `Makefile` are tracked files AND ordinary English words.

    Matching on a bare name with no extension would refuse a draft for asking
    "should this be under a permissive licence?" — a guard that sometimes lies,
    which SPEC_GATEGEN ruling 4 already refused by name.
    """
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": "licence",
         "question": "Should the export note be covered by the same LICENSE?",
         "required": True}
    ]
    drafted = spec.parse_response(reply(payload), PRD, (), ("LICENSE", "Makefile"))
    assert [q.id for q in drafted.spec.questions] == ["licence"]


def test_with_NO_file_listing_the_check_does_not_pretend_to_have_run():
    """An offline draft with no listing gets no protection here, and that is
    an UNCHECKED condition rather than a clean bill. Stated because the
    difference between "checked and fine" and "not checked" is the whole
    subject of this repository."""
    assert spec.unanswerable_questions(
        [spec.Question(id="q", question=THE_UNANSWERABLE_QUESTION, required=True)],
        (),
    ) == ()


def test_A_PROMOTED_ASSUMPTION_SURVIVES_THE_COLLISION_RULE():
    """**Found by EXECUTING the field report's scenario, not by reading it.**

    The collision rule drops any assumption whose id is also an open
    question's, so that two readers cannot join an unrelated decision to an
    unrelated answer. Correct for a COINCIDENCE — and a promotion is not one.

    `wringer-board revise` turns an assumption into an answered open question
    and deliberately leaves the sidecar row in place, so after any override
    the id is legitimately in BOTH files. The drop therefore deleted exactly
    the rows the stale-criteria check exists to read, silently, and the whole
    of S4a did nothing at all. `wring plan` was driven against the real
    scenario, exited 0, and that is how this was found — no amount of reading
    the diff would have shown it.

    Told apart by the WORDS, not the id: the same join `revise` and the plan
    already use.
    """
    displaced = "How many recent games should be shown?"
    promoted = spec.Question(
        id="limit-of-three", question=displaced, required=True, answer="make it five"
    )
    entry = {
        "id": "limit-of-three",
        "decision": "The cap is exactly three entries.",
        "why": "Three fits the shelf.",
        "instead_of_asking": displaced,
        "criteria": ["capped-at-three"],
    }

    kept, _notes = spec.parse_assumptions(
        [entry], "the sidecar", (promoted,),
        (spec.Criterion(id="capped-at-three", title="At most three"),),
    )
    assert len(kept) == 1, (
        "the assumption a person overruled was dropped, so nothing downstream "
        "can tell that the criteria it shaped are now stale"
    )
    assert kept[0].criteria == ("capped-at-three",)

    # And the coincidence still drops — the rule it was protecting is intact.
    coincidence = spec.Question(
        id="limit-of-three",
        question="Something else entirely?",
        required=False,
        answer="yes",
    )
    kept, notes = spec.parse_assumptions(
        [entry], "the sidecar", (coincidence,), ()
    )
    assert kept == (), (
        "a genuine id collision was accepted — two readers would then join a "
        "decision to an unrelated answer"
    )
    assert any("is also an open question's id" in note for note in notes)


def test_a_criteria_back_reference_naming_nothing_is_dropped_with_a_note():
    """Content pointing at nothing — the gate sidecar's rule for a `proves`
    naming no criterion, applied here. The rest of the assumption is still
    consent-bearing and is kept; a dangling reference cannot be, because it
    would make `wring plan` refuse over a criterion nobody can review."""
    kept, notes = spec.parse_assumptions(
        [
            {
                "id": "limit-of-three",
                "decision": "The cap is three.",
                "why": "It fits.",
                "instead_of_asking": "How many?",
                "criteria": ["capped-at-three", "no-such-criterion"],
            }
        ],
        "the drafted assumptions",
        (),
        (spec.Criterion(id="capped-at-three", title="At most three"),),
    )
    assert len(kept) == 1
    assert kept[0].criteria == ("capped-at-three",)
    assert any("no-such-criterion" in note for note in notes)


def test_a_binding_on_a_human_criterion_is_refused_and_nothing_is_written(
    repo, monkeypatch, capsys
):
    """`config.parse_gate` and the binding rules already refuse this. The
    drafter gets no exemption for proposing it."""
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply(draft_with([
            {"id": "acc-taste", "run": "true", "proves": "reads-well"}
        ])),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "reads-well" in err
    assert "human" in err
    assert not (repo / spec.GATESPEC_FILENAME).exists()
    assert not (repo / spec.SPEC_FILENAME).exists()


def test_a_binding_to_a_criterion_the_reply_never_declared_is_refused(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply(draft_with([
            {"id": "acc-ghost", "run": "true", "proves": "no-such-criterion"}
        ])),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "no-such-criterion" in err
    assert not (repo / spec.GATESPEC_FILENAME).exists()


def test_two_gates_for_one_criterion_is_refused(repo, monkeypatch, capsys):
    """One criterion, one gate (SPEC_ACCEPT): a second is a second claim to
    keep honest and the artifact has one slot."""
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply(draft_with(BINDINGS + [
            {"id": "acc-again", "run": "true", "proves": "export-button-exists"}
        ])),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "export-button-exists" in err
    assert not (repo / spec.GATESPEC_FILENAME).exists()


def test_a_proposed_gate_goes_through_the_configs_own_parser(
    repo, monkeypatch, capsys
):
    """Wringer cannot propose a gate its own loader would reject — the same
    rule the spec's `gates:` block has always had."""
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply(draft_with([
            {"id": "../escape", "run": "true", "proves": "export-button-exists"}
        ])),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "id" in err
    assert not (repo / spec.GATESPEC_FILENAME).exists()


def test_a_binding_without_a_proves_is_refused(repo, monkeypatch, capsys):
    """The sidecar is the binding channel and nothing else. A gate with no
    criterion belongs in the spec's own `gates:` block, where it already
    goes."""
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply(draft_with([{"id": "acc-loose", "run": "true"}])),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = flat(capsys.readouterr().err)
    assert "proves" in err
    assert not (repo / spec.GATESPEC_FILENAME).exists()


def test_a_reply_with_no_bindings_writes_no_sidecar(repo, monkeypatch, capsys):
    """Absence is absence: an empty sidecar would be a claim that no
    criterion can be evidenced, which is a different statement."""
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert (repo / spec.SPEC_FILENAME).is_file()
    assert not (repo / spec.GATESPEC_FILENAME).exists()
    capsys.readouterr()


def test_offline_the_next_steps_name_the_hand_written_sidecar(
    repo, monkeypatch, capsys
):
    """No endpoint, no draft — and the dry run has to say how a person gets a
    sidecar anyway, or the no-LLM path is second class."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md"]) == cli.EXIT_OK

    out = flat(capsys.readouterr().out)
    assert spec.GATESPEC_FILENAME in out
    assert "by hand" in out


# --- the drafter may not propose a check that cannot discriminate -----------
#
# **The reply below is not written here.** It is the one `claude-sonnet-4-6`
# really returned on 2026-08-17, kept byte for byte at
# `tests/replies/2026-08-17-pm-mode-drafter-reply.json`, and it is the reason
# this rule exists: for the criterion "no regression on the report page" it
# proposed `run: pytest -q` — byte for byte the repository's existing `test`
# gate. That gate was green before, during and after. No agent, however good,
# could have made it red, so the criterion came back `unevidenced` and the
# handover was refused. The request already forbids this in prose ("**A
# binding that already passes is worth nothing**") and the model did it
# anyway, which is the whole lesson: prompts are not guards.

REAL_REPLY = Path(__file__).parent / "replies" / "2026-08-17-pm-mode-drafter-reply.json"


def real_reply() -> dict:
    return json.loads(REAL_REPLY.read_text(encoding="utf-8"))


def within_question_cap(payload: dict) -> dict:
    """The captured payload with its required questions trimmed to the cap.

    **The CAPTURES ARE NOT EDITED, and that is the whole point of this
    helper.** Both archived replies predate `MAX_REQUIRED_QUESTIONS` and are
    over it — the 2026-08-17 one asks 5 required questions, the 2026-08-18 one
    asks 10 — so feeding either straight through `parse_response` now hits the
    cap instead of the rule each test is actually watching.

    A capture is evidence. This programme corrects one by dated note and never
    by rewriting it, so the trimming happens HERE, in memory, on a copy: keep
    the first `MAX_REQUIRED_QUESTIONS` required questions, keep every optional
    one, leave every other byte of the reply exactly as the model sent it.

    The two tests that assert what the fixtures CONTAIN do not use this — they
    read the raw files, which is what makes them evidence.
    """
    trimmed = json.loads(json.dumps(payload))       # deep copy, no aliasing
    kept, required_seen = [], 0
    for question in trimmed.get("open_questions") or []:
        if question.get("required", True):
            required_seen += 1
            if required_seen > spec.MAX_REQUIRED_QUESTIONS:
                continue
        kept.append(question)
    trimmed["open_questions"] = kept
    return trimmed


def test_the_captured_reply_is_the_one_that_shipped_the_defect():
    """The fixture is evidence, so its content is asserted rather than assumed.

    A fixture that quietly stopped containing the duplicate would leave the
    test below green while checking nothing — the guard-that-cannot-fail this
    programme keeps finding.
    """
    drafted = json.loads(real_reply()["choices"][0]["message"]["content"])
    binding = drafted["gate_bindings"][0]
    declared = drafted["gates"][0]
    assert binding["run"] == declared["run"] == "pytest -q"
    assert binding["id"] != declared["id"]


def test_a_binding_that_repeats_a_gate_in_the_same_reply_is_refused():
    """Half of the rule: the reply's own `gates:` block."""
    drafted = spec.parse_response(reply(within_question_cap(
        json.loads(real_reply()["choices"][0]["message"]["content"])
    )), PRD)

    assert drafted.gates == (), (
        "the binding duplicating `test` was accepted; a check that already "
        "runs cannot be the thing that proves a new criterion"
    )
    assert drafted.notes, "the binding was dropped without saying why"
    said = " ".join(drafted.notes)
    assert "bind-no-regression" in said and "test" in said
    assert "pytest -q" in said


def test_a_binding_that_repeats_a_gate_the_REPO_declares_is_refused():
    """The other half: `.wringer.yaml`, which the reply cannot see itself."""
    from wringer import config

    payload = within_question_cap(
        json.loads(real_reply()["choices"][0]["message"]["content"])
    )
    payload["gates"] = []                       # nothing to clash with in-reply
    declared = (config.Gate(id="suite", run="pytest  -q"),)   # whitespace differs

    drafted = spec.parse_response(reply(payload), PRD, declared=declared)

    assert drafted.gates == ()
    said = " ".join(drafted.notes)
    assert "suite" in said and "bind-no-regression" in said


def test_a_binding_with_a_command_of_its_own_is_kept():
    """The rule refuses duplicates and nothing else.

    Watched in the other direction on purpose: a check that refused every
    binding would pass all three assertions above while destroying the only
    channel a criterion has.
    """
    payload = within_question_cap(
        json.loads(real_reply()["choices"][0]["message"]["content"])
    )
    payload["gate_bindings"][0]["run"] = "pytest -q acceptance/test_regression.py"

    drafted = spec.parse_response(reply(payload), PRD)

    assert [g.id for g in drafted.gates] == ["bind-no-regression"]
    assert drafted.notes == ()


def test_a_HAND_WRITTEN_sidecar_duplicating_a_gate_is_an_ERROR_not_a_note():
    """A person who wrote it deserves the error, not a silent drop.

    The drafted path drops the binding and says so, because the alternative is
    throwing away a whole spec over one bad entry. A sidecar is somebody's
    deliberate file, and quietly ignoring a line they wrote is worse than
    refusing it.
    """
    from wringer import config

    sidecar = {
        "schema_version": spec.GATESPEC_SCHEMA_VERSION,
        "gates": [{"id": "bind-x", "run": "pytest -q", "proves": "c1"}],
    }
    criteria = (spec.Criterion(id="c1", title="t", guidance="g", required=True),)

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_gatespec(
            sidecar, spec.GATESPEC_FILENAME, criteria,
            declared=(config.Gate(id="test", run="pytest -q"),),
        )
    assert "bind-x" in str(caught.value) and "test" in str(caught.value)


# --- R3 (2026-08-18): a drafted reply's decorative key drops with a note -----
#
# **The reply below is not written here either.** It is the one a real drafting
# run returned on 2026-08-18, kept byte for byte at
# `tests/replies/2026-08-18-arcade-run2-drafter-reply.json`. Every one of its
# four tasks carried `objective_note` — an unknown key whose value, in all
# four cases, was an EMPTY STRING — and the whole paid-for draft was refused
# over it: `tasks[0]: unknown keys: objective_note`. One drafting run in four
# died that way that day. Strictness is right for the interlock keys; a
# decorative key on a task is a different thing, and R3 rules the asymmetry:
# a MODEL's proposal survives with its losses named in `Draft.notes`; a
# PERSON's file keeps the strict error, because silently dropping a typo is
# vanishing their content.

UNKNOWN_KEY_REPLY = (
    Path(__file__).parent / "replies" / "2026-08-18-arcade-run2-drafter-reply.json"
)


def unknown_key_reply() -> dict:
    return json.loads(UNKNOWN_KEY_REPLY.read_text(encoding="utf-8"))


def test_the_captured_reply_really_carries_the_decorative_keys():
    """The fixture is evidence, so its content is asserted rather than
    assumed — a fixture that quietly stopped carrying `objective_note` would
    leave the tests below green while checking nothing."""
    drafted = json.loads(unknown_key_reply()["choices"][0]["message"]["content"])
    assert drafted["tasks"], "the fixture lost its tasks"
    for task in drafted["tasks"]:
        assert "objective_note" in task, (
            "the fixture no longer carries the key the ruling is about"
        )


def test_a_drafted_replys_unknown_key_is_dropped_with_a_note_not_the_draft():
    """**Red on the real defect: this reply was refused whole.**

    The draft survives, the key is gone, and the notes name the key, where it
    sat, and what it carried — nothing is silently lost, and nothing of value
    is thrown away either.
    """
    drafted = spec.parse_response(reply(within_question_cap(
        json.loads(unknown_key_reply()["choices"][0]["message"]["content"])
    )), PRD)

    assert len(drafted.spec.tasks) == 4, "the draft did not survive"
    assert drafted.spec.approved is False
    said = " ".join(drafted.notes)
    assert "objective_note" in said, "the dropped key is never named"
    assert "tasks[0]" in said, "the notes never say where it sat"
    assert "recent-plays-store" in said, (
        "the notes never name the task it was dropped from"
    )
    # All four tasks carried it; all four drops are named, none silently.
    assert said.count("objective_note") == 4
    # What it carried — an empty string, said rather than elided.
    assert "nothing" in said.lower() or "''" in said


def test_a_reply_carrying_approved_on_a_task_is_refused_whole():
    """**The interlock does not become droppable by moving down a level.**

    Top-level `approved` refuses the reply; `approved` smuggled onto a task,
    question or criterion is the same attempt and gets the same answer —
    never a drop-note.
    """
    payload = within_question_cap(
        json.loads(real_reply()["choices"][0]["message"]["content"])
    )
    payload["tasks"][0]["approved"] = True

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)
    said = str(caught.value)
    assert "approved" in said
    assert "interlock" in said, (
        "the refusal does not say what was being worked"
    )
    assert "nothing was written" in said.lower()


def test_a_hand_written_spec_with_an_unknown_task_key_keeps_the_strict_error():
    """The other half of the asymmetry, pinned so a tidy-up cannot flatten it:
    `parse` — the loader every on-disk `wringer.spec.yaml` faces — still
    refuses the same key the drafted path drops. A person's typo silently
    dropped is a person's content vanished."""
    payload = within_question_cap(
        json.loads(unknown_key_reply()["choices"][0]["message"]["content"])
    )
    on_disk = {
        "schema_version": spec.SCHEMA_VERSION,
        "approved": False,
        "title": payload["title"],
        "intent": "quoted",
        "open_questions": [],
        "criteria": payload["criteria"],
        "gates": [],
        "tasks": payload["tasks"],          # objective_note still aboard
    }
    with pytest.raises(spec.SpecError) as caught:
        spec.parse(on_disk, "wringer.spec.yaml")
    assert "unknown keys" in str(caught.value)
    assert "objective_note" in str(caught.value)


# --- the drafter cannot name a file it has never been shown ------------------
#
# **Measured on 2026-08-19, driving a real PRD through `wringer-drive`.** The
# request tells the drafter (rule 6) that *"every file it names must already be
# in the repository"* and gives it no way to know what is in the repository. On
# that run `claude-opus-5` complied honestly and proposed ZERO bindings, saying
# so in an open question of its own: *"Which existing modules, classes and test
# files implement pipeline execution and the summary, so acceptance checks can
# be bound to checks that already exist in the repository?"* Every one of the
# nine machine criteria came back `unbound`, the loop ran no worker turns, and
# nothing was proved.
#
# The rule was not the problem. The rule was unsatisfiable.


def test_the_request_shows_the_drafter_what_the_repository_contains():
    request = spec.render_request(
        PRD, "m", 8000,
        files=("src/report.py", "tests/test_report.py",
               "acceptance/test_export.py"),
    )
    user = request["messages"][1]["content"]
    assert "acceptance/test_export.py" in user
    assert "src/report.py" in user


def test_with_no_listing_the_request_claims_no_knowledge_of_the_tree():
    """Absence is absence. An empty heading would tell the drafter the
    repository contains nothing, which is a much stronger claim than silence
    and would make rule 6 refuse every binding there is."""
    user = spec.render_request(PRD, "m", 8000)["messages"][1]["content"]
    assert "repository contains" not in user.lower()


def test_the_listing_is_capped_and_says_when_it_was_cut():
    """A cap that truncates silently is a listing that lies by omission: the
    drafter would read it as exhaustive and rule 6 would forbid the file it
    needed."""
    many = tuple(f"src/module_{n:04d}.py" for n in range(spec.MAX_LISTED_FILES * 2))
    user = spec.render_request(PRD, "m", 8000, files=many)["messages"][1]["content"]
    assert user.count("src/module_") == spec.MAX_LISTED_FILES
    assert "not the whole" in user.lower() or "truncat" in user.lower()


def test_the_listing_is_the_repositorys_own_tracked_files(tmp_path):
    """Read from git, never from a walk that would offer the drafter a path
    inside `.venv` or `node_modules` — a binding naming one of those would be
    a check nobody else can run."""
    import subprocess

    repo = tmp_path / "r"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "app.py").write_text("x = 1\n", encoding="utf-8")
    (repo / "untracked.py").write_text("y = 2\n", encoding="utf-8")
    for argv in (["init", "-q"], ["add", "src/app.py"],
                 ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "c"]):
        subprocess.run(["git", *argv], cwd=repo, check=True,
                       capture_output=True, text=True)

    listed = spec.repository_files(repo)

    assert "src/app.py" in listed
    assert "untracked.py" not in listed


def test_a_repository_git_cannot_read_lists_nothing_rather_than_guessing(tmp_path):
    """The failure path, because a guard that explodes where its fact is
    missing teaches people to delete it. No git, no listing, no crash — and
    the drafter is back to proposing nothing, which is the honest old
    behaviour rather than a new one."""
    assert spec.repository_files(tmp_path) == ()


# --- a couple of easy questions, and that is all ----------------------------
#
# **Measured across the four real runs this programme has driven: 9, 9, 12 and
# 10 questions, every one `required: true` and therefore blocking.** A product
# manager who wants one feature was asked a dozen things before anything
# happened. Of forty real questions, ten were LOOKUPS — *"is
# `acceptance/recently-played.test.js` already executed by `npm test`?"* — which
# is asking a person to read a file the tool has in front of it.
#
# The cause was a rule we wrote on purpose: "Never guess. Anything you had to
# assume becomes an entry in `open_questions`." Correct about correctness, and
# it maximises question count by construction.


def test_the_request_caps_the_questions_and_says_who_is_reading():
    user = spec.render_request(PRD, "m", 8000)["messages"][1]["content"]

    assert "AT MOST THREE QUESTIONS" in user
    assert "product manager" in user
    # The cap is repeated where the model actually writes the field, because a
    # rule stated once at the top of a long prompt is a rule that gets lost.
    fmt = user[user.index("## Reply format"):]
    assert "AT MOST 3" in fmt


def test_the_request_forbids_asking_what_it_could_look_up():
    """The ten lookups. The tool has the repository; asking a human to read it
    is a defect whoever the human is."""
    user = spec.render_request(PRD, "m", 8000)["messages"][1]["content"]

    assert "Never ask what you can look up" in user
    assert "Never ask about testing machinery" in user


def test_the_request_tells_it_to_DECIDE_and_show_the_decision():
    """The other half, and the half that makes the cap honest.

    A cap alone would just lose the information. The instruction is to decide
    the obvious thing and write it into the criterion, so the person approves a
    visible assumption instead of answering trivia about it.
    """
    user = spec.render_request(PRD, "m", 8000)["messages"][1]["content"]

    assert "DECIDE" in user
    assert "visible assumption" in user


def test_no_rule_still_routes_a_gap_into_a_QUESTION():
    """**Rule 6 did, and it was the one that manufactured the volume.**

    It ended "propose no binding for it and say so in `open_questions`" — so
    every criterion the drafter could not bind became another blocking question
    aimed at the person least able to answer it. Three of the four real runs
    asked one, and they were the worst questions in the whole census.
    """
    user = spec.render_request(PRD, "m", 8000, files=("src/a.py",))[
        "messages"][1]["content"]
    rules = user[user.index("Rules, in order"):user.index("## Reply format")]

    asks = [line for line in rules.splitlines()
            if "open_questions" in line and "AT MOST" not in line]
    assert not asks, (
        "a rule still sends a gap to `open_questions`, which is how nine to "
        f"twelve blocking questions got asked: {asks}"
    )


# --- SPEC_PMPLAN_V0 P1: the cap, the channel, and the lower bound -----------
#
# Grounded on four replies captured on 2026-08-19 from ONE unchanged PRD
# (`docs/variance-2026-08-19.md`). `prompt_tokens` is 2206 on all four, so the
# differences between them are sampling variance rather than four different
# questions — which is what makes them evidence about what a product manager
# is actually consenting to.

VARIANCE_REPLIES = tuple(
    Path(__file__).parent / "replies" / f"2026-08-19-arcade-run{n}-drafter-reply.json"
    for n in (1, 2, 3, 4)
)


def variance_reply(n: int) -> dict:
    return json.loads(VARIANCE_REPLIES[n - 1].read_text(encoding="utf-8"))


def drafted_of(payload: dict) -> dict:
    return json.loads(payload["choices"][0]["message"]["content"])


def test_the_four_captures_are_the_ones_the_ruling_is_about():
    """The fixtures are evidence, so their content is asserted, not assumed."""
    seen = []
    for n in (1, 2, 3, 4):
        drafted = drafted_of(variance_reply(n))
        buried = [
            c["id"] for c in drafted["criteria"]
            if any(m in str(c.get("guidance", "")).lower()
                   for m in spec._BURIED_DECISION_MARKERS)
        ]
        seen.append(len(buried))
    # 4, 4, 3, 3 — every run, not three of four. An earlier version of this
    # programme published "ten across three runs, run 2 is a clean control".
    assert seen == [4, 4, 3, 3], seen


def test_run_2_is_found_only_because_a_SECOND_phrasing_was_learned():
    """**Red on the real defect.** Run 2 labels its four decisions
    `Decision to approve:`. The marker list said only `decision taken`, which
    finds runs 1, 3 and 4 and reports run 2 — four buried decisions — as
    entirely clean. That claim was published before a review caught it."""
    from wringer.rubric import Criterion

    criteria = tuple(
        Criterion(id=c["id"], title=c["title"], guidance=c.get("guidance", ""),
                  required=True)
        for c in drafted_of(variance_reply(2))["criteria"]
    )
    notes = spec.buried_decision_notes(criteria)

    named = [n for n in notes if "criterion" in n]
    assert len(named) == 4, notes
    assert any("recent-section-above-grid" in n for n in named), named


def test_the_buried_decision_note_claims_a_LOWER_BOUND_and_never_a_total():
    """The claim ceiling, in the output rather than only in a comment. This
    check has been wrong twice and has no true-negative case in the corpus, so
    a reader must never take its silence — or its count — as complete."""
    from wringer.rubric import Criterion

    criteria = (
        Criterion(id="c1", title="t",
                  guidance="Decision taken without asking: per-browser only.",
                  required=True),
    )
    said = " ".join(spec.buried_decision_notes(criteria)).lower()

    assert "at least" in said
    assert "silence is not evidence" in said


def test_a_reply_asking_FOUR_required_questions_is_refused_at_parse():
    """The cap, and the reason it is a guard: the rule has been in the
    request's prose the whole time."""
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": f"q{n}", "question": f"Question {n}?", "required": True}
        for n in range(4)
    ]

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    said = str(caught.value)
    assert "4" in said and "3" in said
    assert "nothing was written" in said.lower()


def test_three_required_questions_and_any_number_of_optional_ones_are_fine():
    """Watched in the other direction: a cap that refused everything would
    pass the test above while destroying the channel it bounds."""
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": f"q{n}", "question": f"Question {n}?", "required": True}
        for n in range(3)
    ] + [
        {"id": f"o{n}", "question": f"Optional {n}?", "required": False}
        for n in range(6)
    ]

    drafted = spec.parse_response(reply(payload), PRD)

    assert sum(1 for q in drafted.spec.questions if q.required) == 3
    assert len(drafted.spec.questions) == 9


def test_the_interlock_refusals_still_fire_BEFORE_the_cap():
    """Ordering, pinned. A reply that both works the interlock and asks nine
    questions gets the interlock refusal — the more serious of the two — and
    its message is the one that was written for that attempt."""
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": f"q{n}", "question": f"Q{n}?", "required": True} for n in range(9)
    ]
    payload["tasks"][0]["approved"] = True

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    assert "interlock" in str(caught.value)


def test_the_cap_does_not_steal_the_question_parsers_own_errors():
    """The reason the cap sits AFTER `parse`. A non-boolean `required` is a
    shape `_parse_questions` has a precise message for; counting raw dicts
    before it would answer with a question-quota error instead — or crash."""
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": "q1", "question": "Q?", "required": "yes please"},
    ]

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    assert "'required' must be a boolean" in str(caught.value)


def test_assumptions_land_in_the_draft_with_the_question_each_displaced():
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [
        {
            "id": "memory-scope",
            "decision": "The list is remembered per browser only.",
            "why": "The requirements describe no accounts.",
            "instead_of_asking": "Should the list follow a person to another device?",
        }
    ]

    drafted = spec.parse_response(reply(payload), PRD)

    assert [a.id for a in drafted.assumptions] == ["memory-scope"]
    assert drafted.assumptions[0].instead_of_asking.startswith("Should the list")


def test_approved_smuggled_onto_an_ASSUMPTION_is_refused_whole():
    """**The interlock does not become droppable by adding a section.**
    `assumptions` is a fourth id-keyed container; a section the drop-walk did
    not cover would be a new place to hide the one key that may never arrive
    from a model."""
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [{
        "id": "a1", "decision": "d", "why": "w", "instead_of_asking": "q?",
        "approved": True,
    }]

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    said = str(caught.value)
    assert "approved" in said and "interlock" in said


def test_an_unusable_assumption_drops_with_a_note_and_the_draft_survives():
    """The R3 asymmetry, applied to the new section: a model's proposal
    survives with its losses named. Refusing a paid draft over one malformed
    row is the `objective_note` mistake."""
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [
        {"id": "good", "decision": "d", "why": "w", "instead_of_asking": "q?"},
        {"id": "no-question", "decision": "d", "why": "w"},
    ]

    drafted = spec.parse_response(reply(payload), PRD)

    assert [a.id for a in drafted.assumptions] == ["good"]
    said = " ".join(drafted.notes)
    assert "instead_of_asking" in said


def test_an_assumption_that_is_ALSO_a_required_open_question_is_refused():
    """The one collision that is a real contradiction: the draft says it
    decided this AND that it still needs to ask. A person must never be shown
    that pair."""
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [{
        "id": "date-format", "decision": "ISO 8601.", "why": "Unambiguous.",
        "instead_of_asking": "Which date format?",
    }]

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    assert "date-format" in str(caught.value)


def test_an_assumption_colliding_with_ANY_question_id_is_dropped_with_a_note():
    """**Accepting this silently was a real defect, reproduced end to end.**
    An assumption sharing an id with an optional or already-answered question
    was kept — and both readers of the sidecar then joined assumption to
    question BY ID, so the plan claimed the person had answered something they
    had never been asked, and `revise` overwrote their real answer.

    The drafter is already given the total rule in the request ("an
    `assumptions` id must not be the id of a question you are also asking").
    This is that rule as a guard, because prompts are not guards.

    It DROPS rather than refusing: a required-and-unanswered collision is the
    contradiction worth refusing a paid draft over, and this is not that."""
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [{
        "id": "row-cap", "decision": "No cap.", "why": "Nothing said one.",
        "instead_of_asking": "Is there a maximum row count?",
    }]

    drafted = spec.parse_response(reply(payload), PRD)

    assert drafted.assumptions == ()
    said = " ".join(drafted.notes)
    assert "row-cap" in said and "an id is not a question" in said


def test_the_decisions_sidecar_round_trips_and_declares_what_it_cannot_do():
    assumptions = (
        spec.Assumption(id="memory-scope", decision="Per browser only.",
                        why="No accounts: it cannot follow a person.",
                        instead_of_asking="Follow a person to another device?"),
    )
    text = spec.render_decisions(assumptions)

    assert "NO AUTHORITY OVER WHAT IS BUILT" in text
    assert "no gate here runs" in text
    back, notes = spec.parse_decisions(yaml.safe_load(text), "sidecar")
    assert back == assumptions and notes == ()


def test_a_hand_written_decisions_file_is_told_apart_from_a_generated_one(
    tmp_path,
):
    """The protection its sibling has carried since GATEGEN. Without it,
    `wring spec --send` silently replaces a person's own decisions."""
    generated = tmp_path / "generated.yaml"
    generated.write_text(spec.render_decisions(()), encoding="utf-8")
    by_hand = tmp_path / "hand.yaml"
    by_hand.write_text(
        f"schema_version: {spec.DECISIONS_SCHEMA_VERSION}\nassumptions: []\n",
        encoding="utf-8",
    )

    assert spec.decisions_is_generated(generated)
    assert not spec.decisions_is_generated(by_hand)


def test_spec_send_writes_the_decisions_sidecar_and_says_what_it_is(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [{
        "id": "memory-scope", "decision": "Per browser only.",
        "why": "The requirements describe no accounts.",
        "instead_of_asking": "Should it follow a person to another device?",
    }]
    fake_transport(monkeypatch, reply=reply(payload))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    written = (repo / spec.DECISIONS_FILENAME).read_text(encoding="utf-8")
    assert "memory-scope" in written
    assert "Should it follow a person" in written
    err = capsys.readouterr().err
    assert "rather than asked" in err
    assert "Approving the plan approves them" in err


def test_a_reply_with_no_assumptions_writes_NO_sidecar(repo, monkeypatch):
    """Absence is absence. An empty `assumptions:` list would ASSERT that
    nothing was decided for the reader — a much stronger claim than having
    nothing to say, and precisely the claim nobody could previously make."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert not (repo / spec.DECISIONS_FILENAME).exists()


def test_a_HAND_WRITTEN_decisions_file_is_never_clobbered_by_a_draft(
    repo, monkeypatch, capsys
):
    """The protection its sibling has carried since GATEGEN. Without it an
    ordinary `wring spec --send` silently replaces a person's own decisions
    with a model's — and this file is the record of what they consented to."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    mine = (
        f"schema_version: {spec.DECISIONS_SCHEMA_VERSION}\n"
        "assumptions:\n"
        "  - id: mine\n"
        "    decision: I decided this myself.\n"
        "    why: Because I am the one who knows.\n"
        "    instead_of_asking: Would anyone have asked me?\n"
    )
    (repo / spec.DECISIONS_FILENAME).write_text(mine, encoding="utf-8")
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [{
        "id": "theirs", "decision": "A model decided this.",
        "why": "It was not asked.", "instead_of_asking": "Anything?",
    }]
    fake_transport(monkeypatch, reply=reply(payload))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert (repo / spec.DECISIONS_FILENAME).read_text(encoding="utf-8") == mine
    assert "written by hand, so it was left alone" in capsys.readouterr().err


def test_the_request_ASKS_for_assumptions_and_says_where_they_do_not_go(
    repo, monkeypatch, capsys
):
    """The transport lesson, again: a channel the request never names is a
    channel that stays empty. `gate_bindings` shipped complete and unreachable
    for exactly this reason."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    asked = json.loads(capsys.readouterr().out)["messages"][1]["content"]
    assert "assumptions" in asked
    assert "instead_of_asking" in asked
    # And the misfiling this whole channel exists to stop, named in the ask.
    assert "NOT in a criterion's guidance" in asked


# --- SPEC_PMPLAN_V0 P2: the second register ---------------------------------


def test_a_tasks_outcome_is_lifted_off_the_reply_and_the_task_is_untouched():
    """Ruling 6's mechanism, and both halves matter. `outcome` is lifted
    BEFORE the drop-walk (which would eat it with a note), and `_TASK_KEYS`
    does not gain it — that set is what the on-disk loader accepts, and
    `spec.schema.json`'s task items are frozen and closed, so adding it there
    would make `parse` accept a key the published schema refuses."""
    payload = json.loads(json.dumps(DRAFT))
    payload["tasks"][0]["outcome"] = "You can download the rows you are looking at."

    drafted = spec.parse_response(reply(payload), PRD)

    assert drafted.outcomes == {
        "csv-export": "You can download the rows you are looking at."
    }
    # nothing was dropped, and the task the engineer works from is unchanged
    assert not [n for n in drafted.notes if "outcome" in n]
    assert drafted.spec.tasks[0].objective.startswith("Add the export endpoint")


def test_outcome_never_joins_TASK_KEYS_or_the_frozen_schema_would_disagree():
    """Pinned as a property, not a hope: a later tidy-up that 'simplifies' the
    lift by adding the key to `_TASK_KEYS` breaks the on-disk contract."""
    assert "outcome" not in spec._TASK_KEYS
    schema = json.loads(
        (Path(__file__).parent.parent / "schema" / "spec.schema.json")
        .read_text(encoding="utf-8")
    )
    task = schema["properties"]["tasks"]["items"]
    assert task["additionalProperties"] is False
    assert "outcome" not in task["properties"]


def test_a_missing_outcome_is_a_note_only_once_the_channel_IS_used():
    """The scoping rule from review C16. A reply that carries outcomes for
    some tasks and not others gets a note; a reply from before the channel
    existed gets silence, because that drafter was never asked."""
    payload = json.loads(json.dumps(DRAFT))
    payload["tasks"].append({
        "id": "second", "brief": "briefs/second.md", "dir": ".",
        "objective": "Something else.",
    })
    payload["tasks"][0]["outcome"] = "You can export."

    drafted = spec.parse_response(reply(payload), PRD)

    said = " ".join(drafted.notes)
    assert "'second' has no plain-language outcome" in said

    # ...and with the channel unused, nothing is said at all.
    bare = json.loads(json.dumps(DRAFT))
    bare["tasks"].append({
        "id": "second", "brief": "briefs/second.md", "dir": ".",
        "objective": "Something else.",
    })
    assert spec.parse_response(reply(bare), PRD).notes == ()


def test_the_archived_capture_still_produces_NO_notes_at_all():
    """**The exact test review C16 said this would redden.** It asserts
    `notes == ()` totally, and that totality is the watch: the duplicate-
    binding rule must refuse duplicates AND NOTHING ELSE. Loosening it to
    ignore outcome notes was refused; the note is scoped instead."""
    payload = within_question_cap(
        json.loads(real_reply()["choices"][0]["message"]["content"])
    )
    payload["gate_bindings"][0]["run"] = "pytest -q acceptance/test_regression.py"

    drafted = spec.parse_response(reply(payload), PRD)

    assert drafted.notes == (), drafted.notes


def test_an_outcome_naming_a_task_the_spec_lacks_is_refused_whole():
    """Content pointing at nothing — the rule the gate sidecar already applies
    to a `proves` naming no criterion."""
    tasks = (spec.Task(id="real", brief="briefs/real.md", objective="o"),)

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_outcomes(
            [{"task": "ghost", "outcome": "Something."}], tasks, "sidecar"
        )

    said = str(caught.value)
    assert "ghost" in said and "real" in said


def test_the_sidecar_carries_both_registers_and_the_request_asks_for_both():
    text = spec.render_decisions((), {"csv-export": "You can export the rows."})
    assert "outcomes:" in text
    assert "You can export the rows." in text

    asked = spec.render_request(PRD, "m", 100)["messages"][1]["content"]
    assert '"outcome"' in asked
    assert "what the person who asked for this will be able to DO" in asked


# --- SPEC_PMPLAN_V0 P3: `--redraft`, and an id is not a question ------------


def redraft_setup(repo, monkeypatch, first_answer="After thirty seconds."):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    first = json.loads(json.dumps(DRAFT))
    first["open_questions"] = [{
        "id": "what-counts", "required": True,
        "question": "Does it count the moment they open it, or only after "
                    "they have played for a while (and if so, how long)?",
    }]
    fake_transport(monkeypatch, reply=reply(first))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    text = (repo / spec.SPEC_FILENAME).read_text(encoding="utf-8")
    (repo / spec.SPEC_FILENAME).write_text(
        text.replace("answer: ''", f"answer: {first_answer}", 1), encoding="utf-8"
    )
    return first


def test_drafting_over_an_existing_spec_points_at_redraft_not_at_deletion(
    repo, monkeypatch, capsys
):
    """**The refusal was right and its advice was the defect.** It read "Move
    or delete it if you want a fresh draft" — which is exactly how a person
    loses every answer they have given."""
    redraft_setup(repo, monkeypatch)
    fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    err = capsys.readouterr().err
    assert "--redraft" in err
    assert "KEEPS every answer" in err
    assert "Move or delete it" not in err


def test_a_redraft_keeps_an_answer_when_the_question_is_UNCHANGED(
    repo, monkeypatch
):
    first = redraft_setup(repo, monkeypatch)
    again = json.loads(json.dumps(first))
    fake_transport(monkeypatch, reply=reply(again))

    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert {q.id: q.answer for q in loaded.questions}["what-counts"] == (
        "After thirty seconds."
    )


def test_a_REWORDED_question_never_inherits_the_previous_answer(
    repo, monkeypatch, capsys
):
    """**The sharpest finding of the review, and this repository's own
    captures prove it.** The id `what-counts-as-played` carries four
    materially different questions across four rolls of one unchanged PRD.
    Someone who answered "after thirty seconds" to a question about DURATION
    would have it filed as their answer to a question about PRESSING START —
    a consent nobody gave, forged by the feature meant to protect answers."""
    first = redraft_setup(repo, monkeypatch)
    reworded = json.loads(json.dumps(first))
    reworded["open_questions"][0]["question"] = (
        "Does it count the moment they open it, or only after they actually "
        "start a round (e.g. press start)?"
    )
    fake_transport(monkeypatch, reply=reply(reworded))

    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    loaded = spec.load(repo / spec.SPEC_FILENAME)
    by_id = {q.id: q for q in loaded.questions}
    # The re-worded question is left for the person to answer...
    assert by_id["what-counts"].answer == ""
    assert "press start" in by_id["what-counts"].question
    # ...and their answer is still here, under the words they answered.
    kept = [q for q in loaded.questions if q.answer == "After thirty seconds."]
    assert len(kept) == 1
    assert "for a while" in kept[0].question
    assert "an id is not a question" in capsys.readouterr().err


def test_a_question_dropped_by_the_new_draft_keeps_its_answer(
    repo, monkeypatch, capsys
):
    redraft_setup(repo, monkeypatch)
    without = json.loads(json.dumps(DRAFT))
    without["open_questions"] = []
    fake_transport(monkeypatch, reply=reply(without))

    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert [q.answer for q in loaded.questions] == ["After thirty seconds."]
    assert "carried forward" in capsys.readouterr().err


def test_a_redraft_keeps_the_documents_it_replaces(repo, monkeypatch):
    """Recovery, not consent: what is being replaced is kept beside the
    request that replaced it."""
    redraft_setup(repo, monkeypatch)
    fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    # **Not `sorted(...)[-1]`, and the first version of this test was flaky
    # for exactly that reason.** A bundle directory is `<timestamp>-<random>`
    # with SECOND granularity, so two drafting runs inside one second sort by
    # the random suffix — an arbitrary order. It passed on this laptop and
    # failed in the fresh clone the gate builds. Find the file instead.
    kept = [
        path / f"previous-{spec.SPEC_FILENAME}"
        for path in (repo / spec.SPECS_DIRNAME).iterdir()
        if (path / f"previous-{spec.SPEC_FILENAME}").is_file()
    ]
    assert len(kept) == 1, kept
    assert "After thirty seconds." in kept[0].read_text(encoding="utf-8")


def test_a_full_spec_drops_the_oldest_carried_answer_LOUDLY_and_never_wedges(
    repo, monkeypatch, capsys
):
    """**The second permanent wedge, and the fix is not a refusal.**

    Carried answers accumulate across redrafts. Once the merged total passed
    `MAX_OPEN_QUESTIONS` the re-parse refused, nothing was written — and
    because nothing was written the on-disk state never advanced, so every
    LATER redraft produced the identical refusal forever. Same shape as the
    id-length wedge: a repository that can never be drafted in again.

    So the oldest carried answer is dropped with a sentence naming it AND
    quoting it, and the draft proceeds. Losing one old answer visibly is bad;
    losing the ability to draft at all is worse."""
    redraft_setup(repo, monkeypatch)
    crowded = json.loads(json.dumps(DRAFT))
    crowded["open_questions"] = [
        {"id": f"q{n}", "question": f"Q{n}?", "required": False}
        for n in range(spec.MAX_OPEN_QUESTIONS)
    ]
    fake_transport(monkeypatch, reply=reply(crowded))

    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    err = capsys.readouterr().err
    assert "could NOT be carried forward" in err
    # The answer itself is quoted, so it is recoverable from the console alone.
    assert "After thirty seconds." in err
    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert len(loaded.questions) <= spec.MAX_OPEN_QUESTIONS


def test_redraft_without_an_existing_spec_says_to_drop_the_flag(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_CONFIG
    assert "Drop the flag" in capsys.readouterr().err


# --- Found by the adversarial review of this build, 2026-08-19 --------------


def test_redraft_can_be_run_many_times_without_wedging_the_repository(
    repo, monkeypatch
):
    """**A permanent wedge, reproduced by the review.** The carried id grew by
    `-as-answered` (12 chars) on every redraft that re-worded a question, and
    `_slug` caps an id at 64 — so a realistic question id made the merged
    document unparseable on the second or third redraft. The re-parse then
    refused, nothing was written, and because nothing was written every LATER
    redraft produced the byte-identical refusal forever. The only escape was
    deleting the spec: exactly the answer-losing move the refusal steers
    people away from.

    Wording variance is the norm here, not the exception — four rolls of one
    PRD produced four wordings of one id."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    long_id = "should-the-recent-list-follow-you-across-browsers"   # 48 chars
    payload = json.loads(json.dumps(DRAFT))
    payload["open_questions"] = [
        {"id": long_id, "question": "Wording zero?", "required": True}
    ]
    fake_transport(monkeypatch, reply=reply(payload))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    for round_number in range(1, 6):
        text = (repo / spec.SPEC_FILENAME).read_text(encoding="utf-8")
        (repo / spec.SPEC_FILENAME).write_text(
            text.replace("answer: ''", f"answer: Answer {round_number}.", 1),
            encoding="utf-8",
        )
        payload["open_questions"][0]["question"] = f"Wording {round_number}?"
        fake_transport(monkeypatch, reply=reply(payload))

        assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK, (
            f"redraft {round_number} refused — the repository is wedged"
        )
        loaded = spec.load(repo / spec.SPEC_FILENAME)
        for question in loaded.questions:
            assert len(question.id) <= 64, question.id


def test_a_redraft_that_decides_nothing_removes_the_stale_sidecar(
    repo, monkeypatch, capsys
):
    """**Reproduced by the review.** A generated sidecar outliving the spec it
    describes is rendered by the board as LIVE CONSENT — in the sharpest case
    a stale outcome becomes the plan's lead line and contradicts the objective
    printed underneath it, silently, with a zero exit code."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    first = json.loads(json.dumps(DRAFT))
    first["assumptions"] = [{
        "id": "storage", "decision": "It follows you to any browser.",
        "why": "Nothing said otherwise.", "instead_of_asking": "Which browsers?",
    }]
    fake_transport(monkeypatch, reply=reply(first))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    assert (repo / spec.DECISIONS_FILENAME).is_file()

    fake_transport(monkeypatch, reply=reply(DRAFT))       # decides nothing
    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    assert not (repo / spec.DECISIONS_FILENAME).exists(), (
        "the previous draft's decisions survived the spec they described"
    )
    assert "removed rather than left describing" in capsys.readouterr().err


def test_a_HAND_WRITTEN_sidecar_survives_a_redraft_that_decides_nothing(
    repo, monkeypatch
):
    """The other direction: only a GENERATED sidecar is removed. A person's
    own file is theirs."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    mine = f"schema_version: {spec.DECISIONS_SCHEMA_VERSION}\nassumptions: []\n"
    (repo / spec.DECISIONS_FILENAME).write_text(mine, encoding="utf-8")

    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    assert (repo / spec.DECISIONS_FILENAME).read_text(encoding="utf-8") == mine


def test_no_empty_assumptions_block_is_ever_written(repo, monkeypatch, capsys):
    """**The code comment claimed this and the code did not do it.** The
    sidecar is written for outcomes alone, and it emitted an empty
    `assumptions:` under the sentence "Approving the plan approves these" —
    asserting something about zero things. The guard that was supposed to
    cover this could not reach the branch: its fixture had no outcomes."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    payload = json.loads(json.dumps(DRAFT))
    payload["tasks"][0]["outcome"] = "You can export the rows you see."
    fake_transport(monkeypatch, reply=reply(payload))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    written = (repo / spec.DECISIONS_FILENAME).read_text(encoding="utf-8")
    assert "assumptions:" not in written, written
    assert "outcomes:" in written
    # ...and it does not announce zero decisions as though that were news.
    assert "0 decision(s)" not in capsys.readouterr().err


def test_an_id_yaml_would_read_as_a_boolean_still_round_trips(repo):
    """**The same class as the `approved: False` corruption fixed this
    morning.** `_slug` accepts `on`, `no`, `yes`, `off`, `true`, `123`; written
    bare, PyYAML reads them back as bools and ints, and `parse_assumptions`
    then DROPS the row — a consent record vanishing between the write and the
    read."""
    for identifier in ("on", "no", "yes", "off", "true", "123"):
        assumptions = (
            spec.Assumption(id=identifier, decision="d", why="w",
                            instead_of_asking="q?"),
        )
        text = spec.render_decisions(assumptions)
        back, notes = spec.parse_decisions(yaml.safe_load(text), "sidecar")
        assert [a.id for a in back] == [identifier], (identifier, notes)


def test_an_unusable_outcome_is_NAMED_rather_than_silently_dropped(repo):
    """`lift_outcomes` runs before the drop-walk and removes the key, so the
    drop-walk can never report it — which made this the one place in the
    parser where a model's content disappeared without a word. Worse, a
    sibling task's valid outcome then made the missing-outcome note say this
    task 'has no plain-language outcome' about a reply that carried one."""
    payload = json.loads(json.dumps(DRAFT))
    payload["tasks"][0]["outcome"] = {"not": "a sentence"}
    payload["tasks"].append({
        "id": "second", "brief": "briefs/second.md", "dir": ".",
        "objective": "Something.", "outcome": "You can do the second thing.",
    })

    drafted = spec.parse_response(reply(payload), PRD)

    said = " ".join(drafted.notes)
    assert "unusable 'outcome'" in said, drafted.notes
    assert "csv-export" in said


def test_more_assumptions_than_a_person_can_read_is_refused():
    """Every other id-keyed container the reply carries has a ceiling and this
    one had none. Approving a plan approves every assumption on it, so a list
    nobody can read is not consent."""
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [
        {"id": f"a{n}", "decision": "d", "why": "w", "instead_of_asking": "q?"}
        for n in range(spec.MAX_ASSUMPTIONS + 1)
    ]

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    assert "not consent" in str(caught.value)


def test_the_redraft_backup_goes_through_the_REDACTOR(repo, monkeypatch):
    """**These documents carry answers a person TYPED**, which is the likeliest
    place in this whole surface for a credential to appear — and the bundle
    they are copied into is evidence that travels. Every other write into a
    bundle is scrubbed; this one was a raw `read_text`."""
    setup_repo(
        repo,
        config_text=CONFIG.rstrip()
        + "\nevidence:\n  redact:\n    env:\n      - '*SECRET*'\n",
    )
    monkeypatch.chdir(repo)
    monkeypatch.setenv("MY_SECRET_TOKEN", "hunter2")
    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    text = (repo / spec.SPEC_FILENAME).read_text(encoding="utf-8")
    (repo / spec.SPEC_FILENAME).write_text(
        text.replace("answer: ''", "answer: the password is hunter2", 1),
        encoding="utf-8",
    )

    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    kept = [
        path for path in (repo / spec.SPECS_DIRNAME).rglob(
            f"previous-{spec.SPEC_FILENAME}"
        )
    ]
    assert len(kept) == 1, kept
    body = kept[0].read_text(encoding="utf-8")
    assert "hunter2" not in body, body


def test_the_engine_can_LOAD_every_spec_it_can_RENDER():
    """**It could not, and that is as bad as it sounds.**

    `render()` wrote every id bare — `- id: no` — and `_slug` accepts `no`,
    `yes`, `on`, `off`, `true`, `false`, `null`, `123`. PyYAML resolves all of
    them as bools, ints or None, so the loader refused a file this module had
    just written, with a message blaming the id for not being a string.

    Fourteen of twenty slug-legal ids reproduced it. Bare digits are included,
    so a drafter numbering its assumptions 1, 2, 3 triggers it.

    The sidecar renderer was fixed for exactly this class earlier the same day
    and the spec renderer was left alone — the comment there even names the
    class. This is that fix, finished."""
    for identifier in ("no", "yes", "on", "off", "true", "false", "null",
                       "123", "1_000", "ordinary-id"):
        rendered = spec.render(spec.Spec(
            approved=False, title="T", intent="i",
            questions=(spec.Question(id=identifier, question="Q?", required=True),),
            criteria=(spec.Criterion(id=identifier, title="t", guidance="g",
                                     required=True),),
            gates=(),
            tasks=(spec.Task(id=identifier, brief="b.md", objective="o", dir="."),),
            path=spec.SPEC_FILENAME,
        ))
        loaded = spec.parse(yaml.safe_load(rendered), "round trip")
        assert loaded.questions[0].id == identifier, (identifier, rendered)
        assert loaded.criteria[0].id == identifier
        assert loaded.tasks[0].id == identifier


def test_an_assumption_may_not_displace_a_HUMAN_JUDGED_criterion():
    """**Field report 2026-08-22 finding 9, reconstructed.**

    Run 4 of that day drafted the same PRD as run 3 with the same model and
    moved the heading wording into `DECIDED WITHOUT ASKING YOU`. Run 3 had
    ASKED. The criterion that wording shapes is the one the board prints to
    the reader as *"No check can decide this one — it needs a person to look
    and say."* So the single decision the document itself says no check may
    make is the one the drafter took, and a person approving that plan would
    have shipped wording they never chose.

    The shape is reconstructed rather than the words: an assumption naming a
    criterion the SAME reply marked `human: true`. `reads-well` is this
    fixture's human criterion, and the assumption below shapes it exactly the
    way the heading assumption shaped the heading.

    **A refusal, not a note**, which is the opposite of everything else in
    this parser. `human: true` is the spec's own statement that nothing but a
    person settles this; an assumption over it is the consent surface
    answering on the person's behalf in the one place it has no standing.
    Salvaging the row would leave the criterion in the plan with the decision
    already taken, which is the defect.
    """
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [
        {
            "id": "heading-wording",
            "decision": 'The heading reads "Recently played".',
            "why": "It matches the wording used elsewhere in the product.",
            "instead_of_asking": "What should the heading say?",
            "criteria": ["reads-well"],
        }
    ]

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_response(reply(payload), PRD)

    said = str(caught.value)
    assert "reads-well" in said, "the refusal does not name the criterion"
    assert "human" in said
    # **Re-derived 2026-08-22, after a real drafting call hit this.** The
    # sentence used to be "Ask the question instead", and this guard pinned
    # it as "what to do instead". It is not: the reader of this message is the
    # person who just paid for the call, and they cannot make a model ask
    # anything. What turns a wall into a route is a move the READER can make.
    assert "Draft again" in said and "in the document yourself" in said, (
        "the refusal names no move the person reading it can actually take. "
        "It is addressed to the drafter, and the drafter is not who reads it"
    )


def test_the_SIDECAR_reader_is_not_told_that_nothing_was_written():
    """**The same refusal, one layer up, reaching a different person.**

    `parse_assumptions` is shared: the drafted reply goes through it, and so
    does `wringer.decisions.yaml` on every load. So a repository written
    before this rule existed — one whose sidecar already holds an assumption
    with a `criteria` back-reference — hit the drafter's message on a file
    sitting on its own disk. It was told to ask a question, with nothing to
    ask it of, and told that nothing was written, about a file that exists.

    That is this repository's own trap shape: a refusal whose only named way
    out belongs to somebody who is not in the room.
    """
    criteria = [SimpleNamespace(id="reads-well", human=True)]
    sidecar = {
        "schema_version": spec.DECISIONS_SCHEMA_VERSION,
        "assumptions": [
            {
                "id": "heading-wording",
                "decision": 'The heading reads "Recently played".',
                "why": "It matches the wording used elsewhere.",
                "instead_of_asking": "What should the heading say?",
                "criteria": ["reads-well"],
            }
        ],
    }

    with pytest.raises(spec.SpecError) as caught:
        spec.parse_decisions(sidecar, spec.DECISIONS_FILENAME, (), criteria)

    said = str(caught.value)
    assert "Nothing was written" not in said, (
        "the sidecar reader is told nothing was written about a file that is "
        "already on their disk"
    )
    assert spec.DECISIONS_FILENAME in said, (
        "the refusal does not name the file the person would have to edit"
    )
    assert "revise" in said, (
        "the refusal offers no way to turn the decision back into the "
        "question it displaced"
    )


def test_an_assumption_over_a_NON_human_criterion_is_untouched():
    """The other half — the rule is narrow or it is a blockade.

    Deciding something that shapes a machine-checkable criterion is exactly
    what the assumptions channel is FOR: it is a decision taken visibly, with
    the question it displaced carried beside it so the person is one action
    from asking it after all. Only the `human: true` case is different, and a
    guard that could not tell them apart would have killed the channel.
    """
    payload = json.loads(json.dumps(DRAFT))
    payload["assumptions"] = [
        {
            "id": "memory-scope",
            "decision": "The list is remembered per browser only.",
            "why": "The requirements describe no accounts.",
            "instead_of_asking": "Should the list follow a person to another device?",
            "criteria": ["respects-filters"],
        }
    ]

    drafted = spec.parse_response(reply(payload), PRD)

    assert [a.id for a in drafted.assumptions] == ["memory-scope"]
    assert drafted.assumptions[0].criteria == ("respects-filters",)


def test_a_hedge_against_an_ANSWERED_question_is_found():
    """**Field report 2026-08-22 finding 10.**

    The tester answered "what counts as played". The plan carried the answer
    forward hedged against its own absence:

        using whichever moment the product has confirmed counts as 'played'
        in the open question (if unanswered, record on launch from the cabinet)

    A builder reading that has two instructions and no way to tell which is
    live, and the person who answered is never told their answer is being
    second-guessed.
    """
    found = spec.conditionals_on_answered_questions(
        spec.Spec(
            approved=True,
            title="t",
            intent="i",
            questions=(),
            criteria=(),
            gates=(),
            tasks=(
                spec.Task(
                    id="build",
                    brief="briefs/build.md",
                    objective=(
                        "Record whichever moment the product has confirmed "
                        "counts as 'played' in the open question (if "
                        "unanswered, record on launch from the cabinet)."
                    ),
                ),
            ),
            path="wringer.spec.yaml",
        )
    )

    assert len(found) == 1, f"expected one hedge, got {found}"
    where, sentence = found[0]
    assert where == "task 'build' objective"
    assert "if unanswered" in sentence.lower(), (
        "the refusal would not be able to quote the document back"
    )


def test_prose_that_merely_MENTIONS_uncertainty_is_not_a_hedge():
    """The narrowness half. This is a stale-fallback detector, not a parser of
    English — a pattern reaching for the second would fire on any spec that
    discussed open questions at all, and specs are supposed to do that."""
    assert spec.conditionals_on_answered_questions(
        spec.Spec(
            approved=True,
            title="t",
            intent=(
                "Some questions here were left unanswered on purpose and the "
                "team decided that was fine."
            ),
            questions=(),
            criteria=(),
            gates=(),
            tasks=(
                spec.Task(
                    id="build",
                    brief="briefs/build.md",
                    objective="Export the filtered rows as CSV.",
                ),
            ),
            path="wringer.spec.yaml",
        )
    ) == ()


def _hedges(text: str) -> tuple[tuple[str, str], ...]:
    """One objective through the real detector."""
    return spec.conditionals_on_answered_questions(
        spec.Spec(
            approved=True,
            title="t",
            intent="i",
            questions=(),
            criteria=(),
            gates=(),
            tasks=(spec.Task(id="build", brief="briefs/build.md",
                             objective=text),),
            path="wringer.spec.yaml",
        )
    )


def test_the_SECOND_field_runs_phrasing_is_a_hedge_too():
    """**Field report 2026-08-25, finding 6 — and the detector walked past it.**

    2026-08-22's drafter wrote `(if unanswered, …)` and this detector was
    built from that phrase. 2026-08-25's drafter wrote *"once … is answered"*
    over a spec with answers to all seven questions, and the plan a product
    manager was asked to approve carried stale deferrals with nothing said.
    Measured at HEAD before the fix: zero hits on that phrasing.

    Both phrasings are here now because both were produced by a real drafter.
    Nothing in this list is invented — a pattern reasoned out from how
    deferral *could* be written is the thing the detector's own comment
    forbids.
    """
    for text in (
        "Write the summary format once the summary question is answered.",
        "Defer grouping until 'how should this be grouped' is answered.",
        "Hold this back until the two open questions have been answered.",
        # 2026-08-22's, which must not regress while the new arm is added.
        "Use the default (if unanswered, name each step).",
        "If unanswered, keep the current order.",
    ):
        assert _hedges(text), f"walked past a stale deferral: {text!r}"


def test_ordinary_prose_about_answering_is_still_not_a_hedge():
    """The narrowness half of the widening, and the reason it is `once` and
    `until` rather than every word that can introduce a sequence.

    A spec is *supposed* to talk about its questions. A detector that fired on
    "the question was answered" would refuse every spec whose drafter wrote a
    sentence about the interview — and a refusal nobody can satisfy teaches
    people to stop reading refusals.
    """
    for text in (
        "The question was answered during the interview, so build it that way.",
        "Every question is answered in the spec above.",
        "Once the pipeline runs, the summary is written to stdout.",
        "The runner answers each request until the queue is empty.",
        "This is answered by the acceptance check, which is already committed.",
    ):
        assert _hedges(text) == (), f"fired on ordinary prose: {text!r}"


def test_canonicalization_is_REFUSED_on_a_measured_false_yes():
    """**The seam, pinned — S4.2, 2026-08-22.**

    Codex's `command_canonicalization.rs` was banked as a steal, and the bar
    for taking it was proof rather than plausibility. Any Python canonicalizer
    is built on `shlex`; gates run through `subprocess(shell=True)` —
    `/bin/sh -c`. Fifteen pairs were run through both and the argv compared.
    Four disagree in the direction that does damage, and they share one cause:
    **`shlex` strips both quote characters identically and the shell does
    not.** Single quotes suppress expansion; double quotes do not. So

        pytest --cov="$PKG"      and      pytest --cov='$PKG'

    are one string to `shlex` and two different checks to the shell. A
    canonicalizer trusting `shlex` would call those gates twins, treat the
    drafted one as already installed, and leave a criterion bound to a check
    the person never approved — silent consent damage, from a config a real
    repository could carry.

    So `same_command` stays whitespace-only, and this test is the toll a later
    window has to pay: **make it pass with a real fix, do not delete it.**

    The platform claim is RE-TAKEN here rather than trusted. The first version
    of this guard pinned a different pair, on a measurement that turned out to
    be an artefact of a broken probe — and it was this style of assertion that
    caught it. Full capture: `docs/canonicalization-2026-08-22.md`.
    """
    import subprocess

    from wringer import spec as spec_module

    expanded = 'pytest --cov="$WRINGER_PROBE_PKG"'
    literal = "pytest --cov='$WRINGER_PROBE_PKG'"
    assert not spec_module.same_command(expanded, literal), (
        "same_command now calls these two the same command. The measurement "
        "says the shell does not: double quotes expand and single quotes do "
        "not, so these run different checks. If canonicalization has genuinely "
        "been made safe, argue it in docs/canonicalization-2026-08-22.md and "
        "measure it against a real shell — do not assert it here"
    )

    # The property the refusal rests on, measured on THIS machine rather than
    # quoted from a document.
    env = {"WRINGER_PROBE_PKG": "wringer", "PATH": "/usr/bin:/bin"}
    got = [
        subprocess.run(
            f"printf %s {form}", shell=True, capture_output=True, text=True, env=env
        ).stdout
        for form in ('"$WRINGER_PROBE_PKG"', "'$WRINGER_PROBE_PKG'")
    ]
    assert got == ["wringer", "$WRINGER_PROBE_PKG"], (
        "on this platform the shell does NOT distinguish the two quote "
        f"classes the way the refusal assumes: {got}. Re-take the measurement "
        "in scripts/canonicalization-probe.py before concluding anything here"
    )


# --- the drafter proposes a DISPLAY per human criterion (P0.3, 2026-09-02) --


def test_the_request_asks_for_a_display_per_HUMAN_criterion(repo, monkeypatch, capsys):
    """The `gate_bindings` lesson, applied before it repeats: a channel the
    request never names is a channel the drafter never fills."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    asked = json.loads(capsys.readouterr().out)["messages"][1]["content"]
    # Two separate facts, asserted separately — the key's NAME appears three
    # times in the request, so `"show_proposals" in asked` survived deleting
    # the instruction that tells the drafter to fill it (red-watch RW16,
    # 2026-09-02, stayed green on the first pass).
    assert "propose a `show_proposals` entry" in asked, "the instruction"
    assert '"show_proposals": {"<human criterion id from above>"' in asked, (
        "the reply format"
    )
    assert "guess dressed as a recipe" in asked, "the ceiling the plan named"


def test_the_drafter_proposes_a_DISPLAY_for_the_human_criterion(
    repo, monkeypatch, capsys
):
    """The proposal lands in the sidecar under `show:`, as the newest schema
    version, and reads back as the exact command through the sidecar's own
    parser."""
    command = 'PYTHONPATH=src python3 -m report "a b.json" || [ $? -eq 1 ]'
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply(
            {**draft_with(BINDINGS), "show_proposals": {"reads-well": command}}
        ),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    written = sidecar(repo)
    assert written["schema_version"] == "wringer.gatespec.v2"
    assert written["show"] == {"reads-well": command}
    assert [g["id"] for g in written["gates"]] == ["acc-export-button", "acc-filters"]
    loaded = spec.load(repo / spec.SPEC_FILENAME)
    back = spec.load_sidecar(repo, loaded.criteria)
    assert back.show == {"reads-well": command}
    capsys.readouterr()


def test_a_DISPLAY_ONLY_reply_still_writes_the_sidecar(repo, monkeypatch, capsys):
    """No binding proposed, one display proposed: the sidecar exists for it.
    Before P0.3 a sidecar was written only when a gate was."""
    setup_repo(repo)
    fake_transport(
        monkeypatch, reply=reply({**DRAFT, "show_proposals": {"reads-well": "true"}})
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    written = sidecar(repo)
    assert "gates" not in written
    assert written["show"] == {"reads-well": "true"}
    capsys.readouterr()


def test_a_display_proposed_for_a_MACHINE_criterion_is_dropped_with_a_note(
    repo, monkeypatch, capsys
):
    """The drafted path drops and says so — one bad display is not a reason
    to throw away a spec; the typed-sidecar path refuses (tests/test_plan.py)."""
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply({
            **draft_with(BINDINGS),
            "show_proposals": {"export-button-exists": "true", "reads-well": "true"},
        }),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    err = flat(capsys.readouterr().err)
    assert "export-button-exists" in err and "machine decides" in err
    assert sidecar(repo)["show"] == {"reads-well": "true"}


def test_a_display_proposed_for_an_UNKNOWN_criterion_is_dropped_with_a_note(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply({**draft_with(BINDINGS), "show_proposals": {"reads-wel": "true"}}),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert "reads-wel" in flat(capsys.readouterr().err)
    assert "show" not in sidecar(repo)


def test_a_display_that_is_not_a_command_is_refused_whole(repo, monkeypatch, capsys):
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply({**draft_with(BINDINGS), "show_proposals": {"reads-well": ""}}),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    assert not (repo / spec.SPEC_FILENAME).is_file(), "a half-refused reply was written"
    capsys.readouterr()


# --- the drafter offers CHOICES per open question (0.8.4, P1.11) ------------
#
# Runs 4 and 4B, 2026-09-01: a drafter's question in front of a product
# manager with nothing beside it but a blank line. The reply MAY now offer two
# to four ways to answer each open question; they land in their own sidecar
# (`wringer.spec.v1` is frozen and its question items are closed), and what the
# interview records is always a choice's TEXT — never its number.

CHOICES = {
    "date-format": [
        {
            "text": "ISO dates, like 2026-09-03",
            "consequence": "Spreadsheets sort them correctly without any setup.",
            "example": "2026-09-03",
        },
        {
            "text": "The format the reports page already shows",
            "consequence": "The export matches the screen but sorts as text.",
            "example": "3 Sep 2026",
        },
    ]
}


def choices_file(repo: Path) -> dict:
    return yaml.safe_load(
        (repo / spec.CHOICES_FILENAME).read_text(encoding="utf-8")
    )


def test_the_request_asks_for_CHOICES_per_open_question(repo, monkeypatch, capsys):
    """The `gate_bindings` and `show_proposals` lesson a third time: a channel
    the request never names is a channel the drafter never fills. Two facts,
    asserted separately — the key's NAME alone survives deleting the rule."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--print-request"]) == cli.EXIT_OK

    asked = json.loads(capsys.readouterr().out)["messages"][1]["content"]
    assert "you MAY propose `choices`" in asked, "the instruction"
    assert '"choices": {"<open question id from above>"' in asked, "the reply format"
    assert "a list that hides the real answer is worse than a blank line" in asked, (
        "the ceiling"
    )
    assert f"at most {spec.MAX_CHOICES_PER_QUESTION} per question" in asked


def test_the_drafter_offers_CHOICES_and_they_land_in_their_OWN_file(
    repo, monkeypatch, capsys
):
    """The sidecar, not the spec: `wringer.spec.v1` is frozen, so the drafted
    spec carries no `choices` key anywhere, and the offers read back through
    the engine's own loader as the exact words the drafter wrote."""
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply({**DRAFT, "choices": CHOICES}))
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    written = choices_file(repo)
    assert written["schema_version"] == "wringer.choices.v1"
    assert written["choices"] == CHOICES
    assert "choices" not in drafted(repo), "the frozen spec grew a key"
    assert "choices" not in yaml.dump(drafted(repo)["open_questions"])
    loaded = spec.load(repo / spec.SPEC_FILENAME)
    back = spec.load_choices(repo, loaded.questions)
    assert back == {
        "date-format": tuple(spec.Choice(**c) for c in CHOICES["date-format"])
    }
    assert spec.choices_is_generated(repo / spec.CHOICES_FILENAME)
    out = capsys.readouterr().out
    assert spec.CHOICES_FILENAME in out and "pick one, or write your own" in out


def test_a_reply_offering_NO_choices_writes_no_choices_file(repo, monkeypatch, capsys):
    """The forgery control: absence is absence. No file, and the console says
    nothing about one."""
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert not (repo / spec.CHOICES_FILENAME).exists()
    assert spec.CHOICES_FILENAME not in capsys.readouterr().out
    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert spec.load_choices(repo, loaded.questions) == {}


def test_choices_for_an_UNKNOWN_question_are_dropped_with_a_note(
    repo, monkeypatch, capsys
):
    """One stray key is not a reason to throw away a spec — the drafted path
    drops and says so; a typed file naming a question nobody asked is
    refused (`parse_choices_document` is strict)."""
    setup_repo(repo)
    fake_transport(
        monkeypatch,
        reply=reply({
            **DRAFT,
            "choices": {**CHOICES, "date-formt": CHOICES["date-format"]},
        }),
    )
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK

    assert "date-formt" in flat(capsys.readouterr().err)
    assert set(choices_file(repo)["choices"]) == {"date-format"}

    loaded = spec.load(repo / spec.SPEC_FILENAME)
    with pytest.raises(spec.SpecError, match="date-formt"):
        spec.parse_choices_document(
            {"schema_version": "wringer.choices.v1",
             "choices": {"date-formt": CHOICES["date-format"]}},
            spec.CHOICES_FILENAME, loaded.questions,
        )


@pytest.mark.parametrize(
    "bad, why",
    [
        (
            [{"text": "2", "consequence": "Two.", "example": "2"},
             {"text": "Three", "consequence": "Three.", "example": "3"}],
            "bare number",
        ),
        (
            [{"text": "ISO", "consequence": "a", "example": "b"}],
            "one is a default wearing a list",
        ),
        (
            [{"text": f"Option {n}", "consequence": "a", "example": "b"}
             for n in "abcde"],
            "more than",
        ),
        (
            [{"text": "Same", "consequence": "a", "example": "b"},
             {"text": "Same", "consequence": "c", "example": "d"}],
            "repeats an earlier option",
        ),
        (
            [{"text": "ISO", "consequence": "", "example": "b"},
             {"text": "Screen", "consequence": "a", "example": "b"}],
            "non-empty string",
        ),
    ],
)
def test_a_malformed_choice_list_is_REFUSED_WHOLE(repo, monkeypatch, capsys, bad, why):
    """A `text` that is a bare number could not be told from a selection; one
    option is a default; five is a form; two with the same words record the
    same answer for different consequences. Each refused by name, and no
    half-refused spec is written."""
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply({**DRAFT, "choices": {"date-format": bad}}))
    monkeypatch.chdir(repo)

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG

    assert why in flat(capsys.readouterr().err)
    assert not (repo / spec.SPEC_FILENAME).is_file(), "a half-refused reply was written"
    assert not (repo / spec.CHOICES_FILENAME).exists()


def test_a_redraft_offering_nothing_REMOVES_the_generated_choices_file(
    repo, monkeypatch, capsys
):
    """The decisions precedent: a generated sidecar may never outlive the
    questions it offers answers to."""
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply({**DRAFT, "choices": CHOICES}))
    monkeypatch.chdir(repo)
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    assert (repo / spec.CHOICES_FILENAME).is_file()

    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    assert not (repo / spec.CHOICES_FILENAME).exists()
    assert "was removed" in flat(capsys.readouterr().err)


def test_a_HAND_WRITTEN_choices_file_is_left_alone_by_a_redraft(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    monkeypatch.chdir(repo)
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    mine = (
        "schema_version: wringer.choices.v1\n"
        "choices:\n"
        "  date-format:\n"
        "    - text: Mine\n      consequence: My words.\n      example: mine\n"
        "    - text: Also mine\n      consequence: My words.\n      example: mine\n"
    )
    (repo / spec.CHOICES_FILENAME).write_text(mine, encoding="utf-8")

    fake_transport(monkeypatch, reply=reply({**DRAFT, "choices": CHOICES}))
    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK

    assert (repo / spec.CHOICES_FILENAME).read_text(encoding="utf-8") == mine
    assert "written by hand" in flat(capsys.readouterr().err)


# --- run 5, 2026-09-05: the two P0s from the first blind attempt at 0.9.4 ---


def _cut_off(payload: dict, at: int = 8000) -> dict:
    """A reply the endpoint stopped for length, the way run 5's arrived: the
    JSON ends inside a string, `finish_reason` says why, and `usage` says
    where. Shaped on `.wringer/specs/20260905-075039-bf48/response.json`."""
    body = json.dumps(payload)
    return {
        "choices": [
            {"message": {"content": body[: len(body) // 2]}, "finish_reason": "length"}
        ],
        "usage": {
            "prompt_tokens": 2915,
            "completion_tokens": at,
            "total_tokens": 2915 + at,
        },
    }


def test_RUN_5_a_reply_CUT_OFF_at_the_ceiling_is_refused_by_name_and_ends_in_a_command(
    repo, monkeypatch, capsys
):
    """**The blind phase ended here.** The reply stopped at exactly 8,000
    completion tokens with `finish_reason: length`, mid-string, and the stop
    said only "not the JSON object the request asked for". True and useless:
    the operator ran the documented resume, which spent the same again to be
    cut off in the same place, because nothing had said the reply was CUT
    OFF rather than malformed or what to change.

    Every stop carries a next move that is a command. This one names the
    vendor's own reason, the count it stopped at, the setting to raise, and
    the command to run — and the exchange's own record carries the same
    words, so it can be read back after the terminal is gone.
    """
    from wringer import diagnose

    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=_cut_off(DRAFT))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    said = capsys.readouterr().err

    assert "CUT OFF at 8,000 tokens" in said, said
    assert "not malformed, it is unfinished" in said
    assert "judge.max_output_tokens" in said
    assert said.rstrip().endswith(
        f"{diagnose.RESUME_COMMAND}. The reply is on disk at "
        f".wringer/specs/{only_draft(repo).name}/{spec.RESPONSE_FILENAME}."
    ) or diagnose.RESUME_COMMAND in said
    assert "not the JSON object" not in said, (
        "the generic parse refusal spoke instead of the truncation one"
    )
    assert not (repo / spec.SPEC_FILENAME).exists()

    summary = (only_draft(repo) / spec.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert "Why: the reply was CUT OFF at 8,000 tokens" in summary
    assert "The error is on the console" not in summary, (
        "the record still points at the one place a stop cannot be read back "
        "from"
    )


def test_RUN_5_explain_READS_A_DRAFTING_EXCHANGE_and_says_why_it_ended(
    repo, monkeypatch, capsys
):
    """`wring explain` pointed at the stop that ended the blind phase said
    "no runs — run 'wring verify' first". A drafting exchange is told apart
    by its own files, never by its path, like the journey and loop branches
    beside it, and the summary it reads carries the cause since 0.9.5."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=_cut_off(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    assert cli.main(["explain", str(only_draft(repo))]) == cli.EXIT_OK
    out = capsys.readouterr().out
    assert "Nothing was drafted" in out
    assert "CUT OFF at 8,000 tokens" in out
    assert "run 'wring verify' first" not in out


def _assumption_deciding(criterion_id: str) -> dict:
    return {
        "id": "a-readability",
        "decision": "Headings use the finance team's usual abbreviations.",
        "why": "It is what the existing reports do.",
        "instead_of_asking": "Which heading style should the export use?",
        "criteria": [criterion_id],
    }


def _second_draft(*, drop_human: bool) -> dict:
    payload = json.loads(json.dumps(DRAFT))
    if drop_human:
        payload["criteria"] = [c for c in payload["criteria"] if not c["human"]]
        payload["tasks"] = [
            {**t, "criteria": [c for c in t.get("criteria", []) if c != "reads-well"]}
            if "criteria" in t else t
            for t in payload["tasks"]
        ]
    return payload


def test_RUN_5_a_REDRAFT_may_not_drop_a_human_criterion_the_previous_draft_declared(
    repo, monkeypatch, capsys
):
    """**The drafter routed around a refusal by deleting the criterion it was
    refused on.** Draft 3 declared "at a glance" as `human: true`; an
    assumption decided it, and `parse_assumptions` refused, correctly. Draft
    4, same document, same request, had no `human` criterion at all — and
    passed every check. The one judgement the document reserved for a person
    had become no requirement whatsoever.

    Driven through the real verb twice, so the previous draft is a real
    exchange on disk and not a fixture written by the same hand as the
    reader. The obligation set is the drafter's own previous words; nothing
    here reads the PRD for requirements.
    """
    setup_repo(repo)
    monkeypatch.chdir(repo)

    first = json.loads(json.dumps(DRAFT))
    first["assumptions"] = [_assumption_deciding("reads-well")]
    fake_transport(monkeypatch, reply=reply(first))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    refused = capsys.readouterr().err
    assert "marked 'human: true'" in refused, "the premise: the first draft was refused"
    assert not (repo / spec.SPEC_FILENAME).exists()

    fake_transport(monkeypatch, reply=reply(_second_draft(drop_human=True)))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    said = capsys.readouterr().err

    assert "judged that 1 requirement(s) needed a person" in said, said
    assert "The column headings read the way a finance team expects" in said, (
        "the refusal does not name the judgement that went missing"
    )
    assert "this draft judges that 0 do" in said
    assert "may not decide that fewer things need a person" in said
    assert not (repo / spec.SPEC_FILENAME).exists(), (
        "a plan with the human judgement deleted was written out"
    )


def test_RUN_5_a_redraft_that_KEEPS_the_human_criterion_is_accepted(
    repo, monkeypatch, capsys
):
    """The control: the same second draft with the judgement still in it is
    the redraft the first refusal was asking for, and it goes through."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    first = json.loads(json.dumps(DRAFT))
    first["assumptions"] = [_assumption_deciding("reads-well")]
    fake_transport(monkeypatch, reply=reply(first))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    fake_transport(monkeypatch, reply=reply(_second_draft(drop_human=False)))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK, (
        capsys.readouterr().err
    )
    assert (repo / spec.SPEC_FILENAME).exists()


def test_RUN_5_a_CHANGED_document_is_not_bound_by_the_previous_draft(
    repo, monkeypatch, capsys
):
    """A person who edits the PRD so it no longer asks for a judgement is not
    held to a draft of the old text. "The same request" is checked on the
    user message — document and file listing — never assumed."""
    setup_repo(repo)
    monkeypatch.chdir(repo)

    first = json.loads(json.dumps(DRAFT))
    first["assumptions"] = [_assumption_deciding("reads-well")]
    fake_transport(monkeypatch, reply=reply(first))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    (repo / "PRD.md").write_text(
        PRD + "\nThe headings are whatever the database calls the columns.\n",
        encoding="utf-8",
    )
    fake_transport(monkeypatch, reply=reply(_second_draft(drop_human=True)))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK, (
        capsys.readouterr().err
    )
    assert (repo / spec.SPEC_FILENAME).exists()


def test_RUN_5_the_obligation_set_is_the_drafters_own_words_never_the_PRD(
    repo, tmp_path
):
    """`previous_human_criteria` reads records and refuses nothing: no
    exchanges, an unreadable reply, a reply with no criteria — each
    contributes nothing, and the PRD is never opened."""
    request = spec.render_request(PRD, "m", 16000)
    specs = repo / spec.SPECS_DIRNAME
    assert spec.previous_human_criteria(specs, request) == ()

    specs.mkdir(parents=True)
    broken = specs / "20260905-000000-aaaa"
    broken.mkdir()
    (broken / spec.REQUEST_FILENAME).write_text(json.dumps(request), encoding="utf-8")
    (broken / spec.RESPONSE_FILENAME).write_text("not json", encoding="utf-8")
    assert spec.previous_human_criteria(specs, request) == ()

    other = specs / "20260905-000001-bbbb"
    other.mkdir()
    (other / spec.REQUEST_FILENAME).write_text(
        json.dumps(spec.render_request(PRD + "\nchanged\n", "m", 16000)),
        encoding="utf-8",
    )
    (other / spec.RESPONSE_FILENAME).write_text(
        json.dumps(reply(DRAFT)), encoding="utf-8"
    )
    assert spec.previous_human_criteria(specs, request) == (), (
        "a previous exchange for a DIFFERENT request bound this one"
    )


# --- 0.9.6, SOTA item 4: the no-progress spending guard ---------------------


def _exchanges(repo: Path) -> list[Path]:
    return sorted((repo / spec.SPECS_DIRNAME).iterdir())


def test_ITEM_4_an_identical_request_whose_reply_was_cut_off_is_NOT_SENT_AGAIN(
    repo, monkeypatch, capsys
):
    """**Run 5's second paid call, refused before the socket opens.** The
    documented resume sent the same request with the same ceiling and paid
    the same again to be cut off in the same place. The guard compares the
    scrubbed request that is on disk; the same bytes with a `length` reply
    behind them is a repeat of a known failure, and it costs nothing to say
    so."""
    from wringer import diagnose

    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=_cut_off(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()
    first = _exchanges(repo)[-1].name

    sent = fake_transport(monkeypatch, reply=_cut_off(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    said = capsys.readouterr().err

    assert not sent, "the request was sent again — the guard spent the money"
    assert "refusing to spend" in said
    assert first in said, "the refusal does not name the exchange it repeats"
    assert "Nothing has changed" in said
    assert diagnose.RESUME_COMMAND in said
    assert not (repo / spec.SPEC_FILENAME).exists()

    # The refused exchange is the one WITHOUT a reply — told apart by
    # content, because two exchanges in one second sort by a random suffix.
    refused = next(
        e for e in _exchanges(repo) if not (e / spec.RESPONSE_FILENAME).exists()
    )
    summary = (refused / spec.SUMMARY_FILENAME).read_text(encoding="utf-8")
    assert "Why: this exact request" in summary
    assert first in summary


def test_ITEM_4_a_RAISED_CEILING_is_a_changed_request_and_is_sent(
    repo, monkeypatch, capsys
):
    """The control, and the whole point of comparing bytes rather than
    documents: raising `max_output_tokens` changes the request, which is
    exactly the change that makes a retry worth paying for."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=_cut_off(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()

    (repo / ".wringer.yaml").write_text(
        CONFIG + "  max_output_tokens: 32000\n", encoding="utf-8"
    )
    sent = fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK, (
        capsys.readouterr().err
    )
    assert sent, "a changed request was refused as a repeat"
    assert sent["request"]["max_tokens"] == 32000
    assert (repo / spec.SPEC_FILENAME).exists()


def test_ITEM_4_the_guards_OWN_refusal_does_not_hide_the_cut_off_it_refused_over(
    repo, monkeypatch, capsys
):
    """A refused-before-send exchange has a request and no reply. Walking
    newest-first and stopping at it would find no `length` and let the third
    attempt spend. An exchange with no reply is skipped, so the cut-off
    behind it still decides."""
    import os

    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=_cut_off(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()
    # **Told apart by CONTENT, never by name order.** Two exchanges in one
    # second sort by a random suffix, so "the first is the cut-off one" was
    # a coin flip — the very defect the guard's walk had, one level up in
    # its own test. The cut-off exchange is the one with a reply on disk.
    both = _exchanges(repo)
    assert len(both) == 2
    cut_off = next(e for e in both if (e / spec.RESPONSE_FILENAME).exists())
    refused = next(e for e in both if e != cut_off)
    assert not (refused / spec.RESPONSE_FILENAME).exists(), "the premise"

    # **The order is STAMPED, because two exchanges in one second are
    # otherwise ordered by a random suffix — and this watch was vacuous
    # until it was.** The refused exchange must be the newer one, so the
    # walk meets it first and the no-reply skip is what this exercises.
    os.utime(cut_off, (1_000_000, 1_000_000))
    os.utime(refused, (2_000_000, 2_000_000))

    sent = fake_transport(monkeypatch, reply=_cut_off(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_CONFIG
    capsys.readouterr()
    assert not sent, "the guard's own refusal hid the cut-off behind it"
    assert len(_exchanges(repo)) == 3


# --- 0.9.7, SOTA item 1 slice 1: where each requirement came from -----------


def _with_source(criterion_id: str, sentence: str) -> dict:
    payload = json.loads(json.dumps(DRAFT))
    for criterion in payload["criteria"]:
        if criterion["id"] == criterion_id:
            criterion["source"] = sentence
    return payload


# A sentence of PRD, VERBATIM — and it spans a line break in the document,
# so a byte-exact match would miss it and only whitespace-normalisation finds
# it. That is the one normalisation the check allows.
QUOTED = (
    "It should cover the same rows the page is showing, respecting whatever "
    "filter is applied."
)


def test_ITEM_1_a_source_that_IS_in_the_document_is_written_beside_the_requirement(
    repo, monkeypatch, capsys
):
    """The drafter quotes; the engine checks the quote is there; the sidecar
    carries it. The plan and the certificate can then say where a
    requirement came from in the person's own words."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(_with_source("respects-filters", QUOTED)))

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    sidecar = repo / spec.SOURCES_FILENAME
    assert sidecar.is_file(), "a verified quote was not written"
    assert spec.sources_is_generated(sidecar)
    loaded = spec.load(repo / spec.SPEC_FILENAME)
    assert spec.load_sources(repo, loaded.criteria) == {"respects-filters": QUOTED}
    # The spec itself is untouched by the key: the frozen schema never sees it.
    assert "source" not in (repo / spec.SPEC_FILENAME).read_text(encoding="utf-8")


def test_ITEM_1_a_source_NOT_in_the_document_is_a_NOTE_and_is_never_written(
    repo, monkeypatch, capsys
):
    """**Never a refusal, measured**: drafters quote 3 requirements in 39, so
    refusing here refuses nearly every paid draft. And never written: a
    paraphrase beside the requirement would tell the person their document
    says something it does not."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    paraphrase = "It should cover the same rows the page shows."
    fake_transport(
        monkeypatch, reply=reply(_with_source("respects-filters", paraphrase))
    )

    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    said = capsys.readouterr()
    console = said.out + said.err

    assert (repo / spec.SPEC_FILENAME).exists(), "the draft was refused over a quote"
    assert not (repo / spec.SOURCES_FILENAME).exists(), (
        "a sentence that is not in the document was written as its source"
    )
    assert "respects-filters" in console and "is not in the document" in console, (
        "the unquoted requirement was not named on the console"
    )


def test_ITEM_1_whitespace_is_normalised_and_nothing_else_is(repo, monkeypatch, capsys):
    """A line break inside the sentence is the document's wrapping, not a
    different sentence; one changed word IS a different sentence."""
    setup_repo(repo)
    monkeypatch.chdir(repo)
    wrapped = QUOTED.replace("respecting", "\n   respecting")
    fake_transport(monkeypatch, reply=reply(_with_source("respects-filters", wrapped)))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()
    assert (repo / spec.SOURCES_FILENAME).is_file()

    (repo / spec.SPEC_FILENAME).unlink()
    (repo / spec.SOURCES_FILENAME).unlink()
    one_word_off = QUOTED.replace("filter", "filters")
    fake_transport(
        monkeypatch, reply=reply(_with_source("respects-filters", one_word_off))
    )
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()
    assert not (repo / spec.SOURCES_FILENAME).exists(), (
        "a near-quote was accepted as a quote"
    )


def test_ITEM_1_a_HAND_WRITTEN_sources_file_is_left_alone_by_a_redraft(
    repo, monkeypatch, capsys
):
    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(DRAFT))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()
    own = repo / spec.SOURCES_FILENAME
    own.write_text(
        f"schema_version: {spec.SOURCES_SCHEMA_VERSION}\n"
        "sources:\n"
        f"  export-button-exists: {QUOTED!r}\n",
        encoding="utf-8",
    )
    before = own.read_text(encoding="utf-8")

    fake_transport(monkeypatch, reply=reply(_with_source("respects-filters", QUOTED)))
    assert cli.main(["spec", "PRD.md", "--send", "--redraft"]) == cli.EXIT_OK
    said = capsys.readouterr().err
    assert own.read_text(encoding="utf-8") == before, "a person's file was replaced"
    assert "written by hand" in said


def test_ITEM_1_the_PLAN_shows_the_quote_and_SAYS_when_there_is_none(
    repo, monkeypatch, capsys
):
    """The surface a person approves from: where a requirement came from, in
    their own words, and an honest sentence where nothing was quoted."""
    from wringer_board import interview

    setup_repo(repo)
    monkeypatch.chdir(repo)
    fake_transport(monkeypatch, reply=reply(_with_source("respects-filters", QUOTED)))
    assert cli.main(["spec", "PRD.md", "--send"]) == cli.EXIT_OK
    capsys.readouterr()

    text = interview.plan(repo)
    assert f'From your document: "{QUOTED}"' in text
    assert text.count("(no sentence of your document was quoted for this)") == 2, (
        "the two unquoted requirements are not said to be unquoted"
    )
