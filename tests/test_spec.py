"""`wring spec` — prose in, a spec file a human approves (SPEC_INTENT_V0.md).

No test here opens a socket. Drafting reuses `judge.send`, the one function
in Wringer that does, so faking that one function is enough to exercise the
whole command — which is also the point of routing it through the judge's
transport rather than adding a second one.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from conftest import flat

from wringer import cli, spec

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


@pytest.mark.parametrize(
    "path",
    [".git/refs/heads/main", ".git/config", "tasks.jsonl",
     "wringer.rubric.yaml", "wringer.spec.yaml", ".wringer.yaml"],
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
    drafted = spec.parse_response(real_reply(), PRD)

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

    payload = json.loads(real_reply()["choices"][0]["message"]["content"])
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
    payload = json.loads(real_reply()["choices"][0]["message"]["content"])
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
