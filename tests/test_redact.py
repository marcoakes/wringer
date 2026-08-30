"""Which values count as secrets, and how thoroughly they are erased."""

from __future__ import annotations

from wringer import redact


def build(env: dict[str, str], evidence: dict | None = None) -> redact.Redactor:
    return redact.Redactor.from_config(evidence, environ=env)


def test_the_default_patterns_catch_the_usual_names():
    redactor = build(
        {
            "GITHUB_TOKEN": "tok-aaaaaa",
            "MY_SECRET_THING": "sec-bbbbbb",
            "AWS_ACCESS_KEY_ID": "key-cccccc",
            "PATH": "/usr/bin:/bin",
            "HOME": "/Users/someone",
        }
    )

    assert set(redactor.secrets) == {"tok-aaaaaa", "sec-bbbbbb", "key-cccccc"}


def test_matching_is_case_insensitive():
    redactor = build({"github_token": "tok-aaaaaa"})

    assert redactor.secrets == ("tok-aaaaaa",)


def test_config_patterns_are_added_not_substituted():
    """Losing token protection must never be one line of config away."""
    redactor = build(
        {"GITHUB_TOKEN": "tok-aaaaaa", "DATABASE_URL": "postgres://u:pw@host"},
        {"redact": {"env": ["*URL*"]}},
    )

    assert set(redactor.secrets) == {"tok-aaaaaa", "postgres://u:pw@host"}


def test_short_values_are_left_alone():
    """A two-character 'secret' would match half the log."""
    redactor = build({"A_TOKEN": "ab", "B_TOKEN": "longenough"})

    assert redactor.secrets == ("longenough",)


def test_every_occurrence_goes():
    redactor = build({"GITHUB_TOKEN": "tok-aaaaaa"})

    scrubbed = redactor.scrub("use tok-aaaaaa here and tok-aaaaaa there")

    assert "tok-aaaaaa" not in scrubbed
    assert scrubbed == f"use {redact.PLACEHOLDER} here and {redact.PLACEHOLDER} there"


def test_a_secret_containing_another_leaves_no_tail():
    """Longest first: replacing the short one first would leave the rest of
    the long one sitting in the log."""
    redactor = build({"A_TOKEN": "abc123", "B_TOKEN": "abc123def456"})

    scrubbed = redactor.scrub("value=abc123def456")

    assert "abc123def456" not in scrubbed
    assert "def456" not in scrubbed


def test_bytes_are_scrubbed_too():
    redactor = build({"GITHUB_TOKEN": "tok-aaaaaa"})

    assert redactor.scrub_bytes(b"before tok-aaaaaa after") == (
        b"before " + redact.PLACEHOLDER.encode() + b" after"
    )


def test_no_matching_variables_means_no_op():
    redactor = build({"PATH": "/usr/bin"})

    assert redactor.secrets == ()
    assert redactor.scrub("nothing to do") == "nothing to do"


# --- D8: the writer scrubs, and the encoding Wringer applies is undone -----


def test_a_secret_that_JSON_ENCODING_ESCAPES_is_still_matched():
    """**The redactor matches raw bytes; Wringer JSON-encodes first.**

    `acp.py` writes `json.dumps(update)` into a turn's updates, and
    `json.dumps` escapes `"`, backslash and every non-ASCII character. A
    secret containing any of them therefore never matched the pattern at all:
    the scrub ran, found nothing, and the credential went into the bundle
    intact. The encoding is one WRINGER applies, not one the gate chose, so
    it is ours to undo.
    """
    import json as json_module

    secret = 'sk-live-"quoted"-café-AAAAAAAA'
    redactor = redact.Redactor.from_config({}, {"MY_TOKEN": secret})

    encoded = json_module.dumps({"message": secret})
    assert secret not in encoded, "the premise: encoding changes the bytes"
    assert redactor.scrub(encoded) == '{"message": "[REDACTED]"}'
    # ...and the plain form still works.
    assert redactor.scrub(f"here: {secret}") == "here: [REDACTED]"


def test_the_bundle_writer_scrubs_whatever_it_is_handed(tmp_path):
    """One writer, and it cannot be forgotten.

    Redaction was a habit at each call site and three writers skipped it:
    `artifacts.collect` left artifact FILENAMES intact in a row claiming
    `redacted: true`, `acquire.record` took a redactor argument its body never
    referenced, and `checks.write` took none while `result.json` beside it
    scrubbed the same command string.
    """
    from wringer import evidence

    secret = "ghp_AAAAAAAAAAAAAAAAAAAA"
    redactor = redact.Redactor.from_config({}, {"GITHUB_TOKEN": secret})
    path = evidence.write_record(
        tmp_path / "record.json",
        {"name": f"report-{secret}.txt", "nested": [{"cmd": secret}]},
        redactor,
    )

    written = path.read_text(encoding="utf-8")
    assert secret not in written, written
    assert written.count("[REDACTED]") == 2, written

