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



# --- 0.7.4: the tiers below the declared value ----------------------------
#
# Run 4B, 2026-09-01. Codex rejected a dead Platform key and its own `401`
# echoed `sk-proj-`, a run of `*` and the key's LAST FOUR characters into the
# worker log — 45 lines of one log carried that shape. The redactor owned
# none of those bytes: none of them was the declared value. Two tiers below
# the whole value now run on every write path: every MEASURED credential
# shape from `agents.py`, and every prefix or suffix of a declared value that
# is at least six characters long.


def fragments_only(secret: str) -> redact.Redactor:
    """A redactor with the value and NO shapes, so tier 3 is measured alone."""
    return redact.Redactor(secrets=(secret,))


def test_a_PREFIX_or_SUFFIX_of_six_or_more_characters_is_scrubbed():
    """A key wrapped across two lines is two fragments, neither the value."""
    secret = "sk-proj-Qm7Vx2Lp9Rt4Wn8Yb3Kc6Hd1Fg5Jz0iW0W"
    redactor = fragments_only(secret)

    split = f"line one {secret[:20]}\nline two {secret[20:]}\n"
    assert redactor.scrub(split) == (
        f"line one {redact.PLACEHOLDER}\nline two {redact.PLACEHOLDER}\n"
    )
    # Run 4B's echo, with the shape tier switched off: the eight-character
    # head is a fragment and goes; the four-character tail is a word and
    # stays. That remainder is what tier 2 exists for.
    echoed = f"Incorrect API key provided: {secret[:8]}****...{secret[-4:]}"
    assert redactor.scrub(echoed) == (
        f"Incorrect API key provided: {redact.PLACEHOLDER}****...{secret[-4:]}"
    )
    # Greedy: the longest matching head is ONE placeholder, never a
    # placeholder with the rest of the key hanging off it.
    assert redactor.scrub(f"head {secret[:-1]} tail") == (
        f"head {redact.PLACEHOLDER} tail"
    )
    assert redactor.scrub(f"tail {secret[1:]} head") == (
        f"tail {redact.PLACEHOLDER} head"
    )


def test_a_fragment_SHORTER_than_six_is_a_word_and_SURVIVES():
    """`sk-pr` is prose. The floor is the same six as the floor on a whole
    value, and it is one constant so the two cannot drift apart."""
    secret = "sk-proj-Qm7Vx2Lp9Rt4Wn8Yb3Kc6Hd1Fg5Jz0iW0W"
    text = f"head {secret[:5]} tail {secret[-5:]} bare sk- and {secret[:3]}"

    assert fragments_only(secret).scrub(text) == text
    # ...and with the shape tier on as well, since `sk-` is where the
    # vendor's shape begins.
    with_shapes = redact.Redactor.from_config({}, {"MY_API_KEY": secret})
    assert with_shapes.scrub(text) == text
    assert redact.FRAGMENT_MIN_LENGTH == redact.MIN_SECRET_LENGTH == 6


def test_a_NON_ASCII_EDGED_secret_does_not_scrub_every_escaped_letter():
    """**Bug review 0.7, 2026-09-02 (display-and-redaction).** D8 added the
    JSON-encoded form of every value as a second whole value, and 0.7.4's
    third tier then took six-character fragments of EVERY value in the set
    — including the encoded one. A secret that begins or ends with a
    non-ASCII character encodes that character as `\\u00e9`: six characters
    exactly, one letter. So declaring `éclair-secret-9` scrubbed every
    JSON-escaped `é` in every log — `"caf\\u00e9"` came back
    `"caf[REDACTED]"` — and the redactor destroyed the evidence it exists
    to protect. Measured on `Redactor.from_config`, the object every write
    path builds."""
    import json as json_module

    redactor = redact.Redactor.from_config({}, {"MY_TOKEN": "éclair-secret-9"})
    prose = json_module.dumps({"note": "café résumé", "raw": "café"})

    assert redactor.scrub(prose) == prose
    # The whole value, raw and encoded, still goes — D8 stands.
    assert redactor.scrub(json_module.dumps({"k": "éclair-secret-9"})) == (
        '{"k": "[REDACTED]"}'
    )
    assert redactor.scrub("raw éclair-secret-9 here") == "raw [REDACTED] here"
    # ...and the same at the tail end.
    redactor = redact.Redactor.from_config({}, {"MY_TOKEN": "secret-9-café"})
    assert redactor.scrub(prose) == prose


def test_a_value_TOO_SHORT_to_be_a_secret_yields_NO_fragment_rule():
    """Five characters is below the floor, so there is nothing to take a
    prefix of — scrubbing `abcd` because `abcde` was declared would be the
    two-character-secret defect in a new coat."""
    redactor = redact.Redactor(secrets=("abcde",))

    assert redactor.scrub("xx abcd yy bcde zz") == "xx abcd yy bcde zz"


def test_a_MEASURED_KEY_SHAPE_is_scrubbed_with_NOTHING_declared():
    """Tier 2 does not need the key to have been declared: the echo of
    somebody else's key, or a key a worker found in a file, is scrubbed on
    its shape alone. The shapes are `agents.py`'s rows and nothing else."""
    from wringer import agents

    redactor = build({"PATH": "/usr/bin"})
    assert redactor.secrets == ()
    assert [p.pattern for p in redactor.shapes] == list(agents.key_shapes())
    assert redactor.shapes, "the vendor table measured no shape at all"

    echoed = "401 Unauthorized: Incorrect API key provided: sk-proj-****...iW0W."
    assert redactor.scrub(echoed) == (
        f"401 Unauthorized: Incorrect API key provided: {redact.PLACEHOLDER}"
    )
    assert redactor.scrub("masked sk-…iW0W here") == (
        f"masked {redact.PLACEHOLDER} here"
    )
    assert redactor.scrub("whole sk-proj-NEVERDECLARED0000111122223333") == (
        f"whole {redact.PLACEHOLDER}"
    )
    # A bare `Redactor()` is the "nothing declared, nothing known" object
    # tests build on purpose, and it stays that way.
    assert redact.Redactor().shapes == ()


def test_ORDINARY_WORDS_survive_every_tier_BYTE_IDENTICAL():
    """The forgery control. A log with nothing to scrub must come back
    unchanged — through the text path AND the bytes path, which is where a
    worker's log actually travels. Words that brush against the shape
    (`task-`, `risk-`, `desk-`) are the ones a careless regex eats."""
    secret = "sk-proj-Qm7Vx2Lp9Rt4Wn8Yb3Kc6Hd1Fg5Jz0iW0W"
    redactor = redact.Redactor.from_config({}, {"MY_API_KEY": secret})
    text = (
        "task-1234 done; risk-based review; desk-99 asks-for sk- and sk-pr\n"
        "no key here, 401 Unauthorized, invalid_api_key\n"
    )
    raw = text.encode() + b"\xff\xfe not utf-8 \x00 either\n"

    assert redactor.scrub(text) == text
    assert redactor.scrub_bytes(raw) == raw


def test_BYTES_get_every_tier_the_text_path_has():
    """One implementation. `scrub_bytes` used to be its own loop over the
    values, so a tier added to `scrub` would have missed every worker log."""
    secret = "sk-proj-Qm7Vx2Lp9Rt4Wn8Yb3Kc6Hd1Fg5Jz0iW0W"
    redactor = redact.Redactor.from_config({}, {"MY_API_KEY": secret})
    raw = (
        b"\xff line one " + secret[:20].encode()
        + b"\nline two " + secret[20:].encode()
        + b"\nmasked sk-\xe2\x80\xa6iW0W and undeclared sk-proj-NEVERDECLARED0000\n"
    )

    scrubbed = redactor.scrub_bytes(raw)

    placeholder = redact.PLACEHOLDER.encode()
    assert scrubbed == (
        b"\xff line one " + placeholder + b"\nline two " + placeholder
        + b"\nmasked " + placeholder + b" and undeclared " + placeholder + b"\n"
    )


def test_the_RECORD_WRITER_gets_the_new_tiers_too(tmp_path):
    """`evidence.write_record` is the one writer behind `worker-diagnosis.json`,
    the manifests and the delivery record; it calls `scrub`, so it needs no
    change — this pins that it did not grow a copy of its own."""
    from wringer import evidence

    secret = "sk-proj-Qm7Vx2Lp9Rt4Wn8Yb3Kc6Hd1Fg5Jz0iW0W"
    redactor = redact.Redactor.from_config({}, {"MY_API_KEY": secret})
    path = evidence.write_record(
        tmp_path / "record.json",
        {
            "engine_words": f"said {secret[:3]}…{secret[-4:]}",
            "lines": [secret[:20], secret[20:]],
            "other": "sk-proj-NEVERDECLARED0000111122223333",
        },
        redactor,
    )

    written = path.read_text(encoding="utf-8")
    assert written.count(redact.PLACEHOLDER) == 4, written
    for start in range(len(secret) - 5):
        assert secret[start : start + 6] not in written, written
