"""Signed provenance, CI-only — SPEC_SIGN_V0.md.

**What is real here and what is argv-only.** Unlike the container backend, the
LOGIC in this slice is exercised end to end: a stub signer — a real shell script
that really writes a file and really exits 0 or 1 — drives the whole three-axis
pipeline, the policy refusal and the console. Only the cosign/gh command lines
themselves are argv-pinned, because neither tool is on the machine this was
written on.

The stub is deliberately not a mock of `subprocess`: it is a program on PATH,
found by `shutil.which`, spawned for real. What that leaves untested is Sigstore,
not Wringer.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path

import pytest

from wringer import attest, cli, config, deliver, sign

CI_ENV = {
    "ACTIONS_ID_TOKEN_REQUEST_URL": "https://example.invalid/token",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "opaque",
}


def stub_signer(directory: Path, name: str, *, body: str) -> None:
    """A real program on PATH, not a mocked subprocess.

    Found by `shutil.which` and spawned by `subprocess.run` exactly as cosign
    would be, so everything between Wringer's decision and the tool's exit code
    is genuinely exercised.
    """
    path = directory / name
    path.write_text(f"#!/bin/sh\n{body}\n", encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def on_path(monkeypatch, directory: Path) -> None:
    monkeypatch.setenv("PATH", f"{directory}{os.pathsep}{os.environ['PATH']}")


# --- ambient identity, which is the whole shape of the feature --------------


def test_a_developer_machine_has_no_ambient_identity():
    """The constraint that makes this CI-shaped, asserted rather than assumed.

    Keyless signing needs an OIDC token. In CI it is ambient; on a laptop the
    flow falls back to an interactive browser login, which collides with `wring
    attest` opening no socket and with an attestation having to be producible
    without a human at a keyboard.
    """
    assert sign.ambient_identity(env={}) is None
    assert sign.ambient_identity(env=CI_ENV) == "github-actions-oidc"


def test_half_an_identity_is_no_identity():
    """Both variables or neither. A job without `id-token: write` has an
    identity provider it cannot ask, which is not the same as having one."""
    for partial in (
        {"ACTIONS_ID_TOKEN_REQUEST_URL": "https://example.invalid/token"},
        {"ACTIONS_ID_TOKEN_REQUEST_TOKEN": "opaque"},
    ):
        assert sign.ambient_identity(env=partial) is None


def test_a_signer_on_path_is_still_not_enough_without_an_identity(
    tmp_path: Path, monkeypatch
):
    stub_signer(tmp_path, "cosign", body="exit 0")
    on_path(monkeypatch, tmp_path)

    refusal = sign.can_sign_here("cosign", env={})

    assert refusal is not None
    assert "no ambient OIDC identity" in refusal
    assert "id-token: write" in refusal


def test_an_identity_is_still_not_enough_without_a_signer(monkeypatch):
    monkeypatch.setattr(sign.shutil, "which", lambda _name: None)

    refusal = sign.can_sign_here("cosign", env=CI_ENV)

    assert refusal is not None
    assert "never signs anything itself" in refusal


def test_both_together_can_sign(tmp_path: Path, monkeypatch):
    stub_signer(tmp_path, "cosign", body="exit 0")
    on_path(monkeypatch, tmp_path)

    assert sign.can_sign_here("cosign", env=CI_ENV) is None


# --- the command lines -----------------------------------------------------


@pytest.mark.parametrize("signer_id", sorted(sign.SIGNERS))
def test_no_signing_command_line_carries_a_key(signer_id: str, tmp_path: Path):
    """**The assertion the whole feature rests on.**

    Signing was ruled out on 2026-08-05 because it would put a key in CI
    secrets, and never touching a credential is this product's most distinctive
    promise. Keyless is what changed the premise, so a `--key` appearing in
    either dialect would silently undo the ruling that let this be built.
    """
    for built in (
        sign.sign_argv(signer_id, tmp_path / "a.json", tmp_path / "a.json.sig"),
        sign.verify_argv(
            signer_id, tmp_path / "a.json", tmp_path / "a.json.sig", None
        ),
    ):
        joined = " ".join(built)
        for forbidden in ("--key", "--private-key", "COSIGN_PASSWORD", "--sk"):
            assert forbidden not in joined, f"{signer_id}: {forbidden}"


def test_the_signature_is_written_beside_the_attestation(tmp_path: Path):
    built = sign.sign_argv("cosign", tmp_path / "a.json", tmp_path / "a.json.sig")

    assert str(tmp_path / "a.json.sig") in built
    assert built[0] == "cosign"


def test_an_expected_identity_is_passed_to_the_verifier_not_compared_after(
    tmp_path: Path,
):
    """The tool checks the binding. Wringer comparing a string it read out of a
    certificate afterwards would be a second, worse implementation of X.509."""
    with_identity = sign.verify_argv(
        "cosign", tmp_path / "a.json", tmp_path / "a.sig", "https://wf/main"
    )
    without = sign.verify_argv(
        "cosign", tmp_path / "a.json", tmp_path / "a.sig", None
    )

    assert "https://wf/main" in with_identity
    assert "--certificate-identity" in with_identity
    assert "--certificate-identity" not in without


def test_the_two_signer_tables_agree():
    """`config` refuses signers and `sign` builds command lines for them. A
    signer the parser accepts and the builder cannot spell would crash at the
    moment somebody asked for a signature."""
    assert set(config._KNOWN_SIGNERS) == set(sign.SIGNER_IDS)


# --- signing, through a real stub ------------------------------------------


def test_signing_produces_a_sibling_and_nothing_else(tmp_path: Path, monkeypatch):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body='echo "SIGNATURE" > "$4"')
    on_path(monkeypatch, bin_dir)
    payload = tmp_path / "attestation.json"
    payload.write_text("{}", encoding="utf-8")
    signature = tmp_path / "attestation.json.sig"

    used = sign.sign(payload, signature, "cosign", env=CI_ENV)

    assert used == "cosign"
    assert signature.read_text(encoding="utf-8").strip() == "SIGNATURE"
    # the attestation itself is untouched: `wringer.attestation.v1` does not
    # change, which is what makes signing purely additive
    assert payload.read_text(encoding="utf-8") == "{}"


def test_a_failed_signer_leaves_no_partial_signature(tmp_path: Path, monkeypatch):
    """A `.sig` that is not a signature is worse than none: `audit` would report
    it `signature_invalid` and send a reader hunting for tampering."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body='echo "half" > "$4"; exit 1')
    on_path(monkeypatch, bin_dir)
    payload = tmp_path / "attestation.json"
    payload.write_text("{}", encoding="utf-8")
    signature = tmp_path / "attestation.json.sig"

    with pytest.raises(sign.SignError):
        sign.sign(payload, signature, "cosign", env=CI_ENV)

    assert not signature.exists()


def test_a_signer_that_exits_zero_without_writing_is_a_failure(
    tmp_path: Path, monkeypatch
):
    """Exit 0 is the tool's opinion; the file is the evidence. Trusting the
    exit code alone would record a signed attestation with no signature."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body="exit 0")
    on_path(monkeypatch, bin_dir)
    payload = tmp_path / "attestation.json"
    payload.write_text("{}", encoding="utf-8")

    with pytest.raises(sign.SignError) as caught:
        sign.sign(payload, tmp_path / "a.sig", "cosign", env=CI_ENV)
    assert "did not produce a signature" in str(caught.value)


# --- the three axes --------------------------------------------------------


def assess(tmp_path: Path, **kw) -> sign.Assessment:
    payload = tmp_path / "attestation.json"
    payload.write_text("{}", encoding="utf-8")
    return sign.assess(payload, tmp_path / "attestation.json.sig", **kw)


def test_no_signature_is_missing_and_missing_is_ordinary(tmp_path: Path):
    """**The requirement that matters most.** `signature_missing` is the
    ordinary case for local work and must not read as invalid — a command that
    failed on it would teach everybody to stop running it."""
    assessed = assess(tmp_path)

    assert assessed.signature == sign.SIGNATURE_MISSING
    assert assessed.identity == sign.IDENTITY_UNKNOWN
    assert "ordinary case" in assessed.reason
    # and the reason says what an unsigned attestation still proves, rather than
    # only what it does not
    assert "unaltered since they were written" in assessed.reason


def test_a_present_signature_is_unverified_until_somebody_asks(tmp_path: Path):
    """The fourth status, and the reason it had to exist.

    A `.sig` is present and no verifier ran. `valid` would claim a check nobody
    performed, `invalid` would call an honest signature bad, `missing` would deny
    a file that is right there — all three are false statements, so the honest
    answer needed a word.
    """
    (tmp_path / "attestation.json.sig").write_text("sig", encoding="utf-8")

    assessed = assess(tmp_path)

    assert assessed.signature == sign.SIGNATURE_UNVERIFIED
    assert "offline by default" in assessed.reason


def test_a_present_signature_with_no_verifier_is_unverified_not_invalid(
    tmp_path: Path, monkeypatch
):
    (tmp_path / "attestation.json.sig").write_text("sig", encoding="utf-8")
    monkeypatch.setattr(sign.shutil, "which", lambda _name: None)

    assessed = assess(tmp_path, verify=True)

    assert assessed.signature == sign.SIGNATURE_UNVERIFIED
    assert "Unverified is not invalid" in assessed.reason


def test_a_verifier_that_accepts_gives_valid_and_unknown_identity(
    tmp_path: Path, monkeypatch
):
    """Verified, and nobody said whose signature to expect. `trusted` here would
    make "signed by somebody" read as "signed by the right somebody", which is
    the padlock problem in one field."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body="exit 0")
    on_path(monkeypatch, bin_dir)
    (tmp_path / "attestation.json.sig").write_text("sig", encoding="utf-8")

    assessed = assess(tmp_path, verify=True)

    assert assessed.signature == sign.SIGNATURE_VALID
    assert assessed.identity == sign.IDENTITY_UNKNOWN
    assert "WHO signed it is unchecked" in assessed.reason


def test_a_verifier_that_accepts_a_declared_identity_gives_trusted(
    tmp_path: Path, monkeypatch
):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body="exit 0")
    on_path(monkeypatch, bin_dir)
    (tmp_path / "attestation.json.sig").write_text("sig", encoding="utf-8")

    assessed = assess(tmp_path, verify=True, expect_identity="https://wf/main")

    assert assessed.signature == sign.SIGNATURE_VALID
    assert assessed.identity == sign.IDENTITY_TRUSTED


def test_a_rejected_signature_with_no_declared_identity_is_invalid(
    tmp_path: Path, monkeypatch
):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body='echo "bad signature" >&2; exit 1')
    on_path(monkeypatch, bin_dir)
    (tmp_path / "attestation.json.sig").write_text("sig", encoding="utf-8")

    assessed = assess(tmp_path, verify=True)

    assert assessed.signature == sign.SIGNATURE_INVALID
    assert assessed.identity == sign.IDENTITY_UNKNOWN
    assert "bad signature" in assessed.reason


def test_a_rejection_against_a_declared_identity_does_not_accuse_forgery(
    tmp_path: Path, monkeypatch
):
    """**One rejection, two possible causes, and they are not the same finding.**

    A verifier handed an identity rejects both a forged signature and a genuine
    one from the wrong workload. Reporting `signature_invalid` for the second
    would accuse a real signer of forgery, so the honest split is: the signature
    is unverified, the identity is untrusted.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body='echo "identity mismatch" >&2; exit 1')
    on_path(monkeypatch, bin_dir)
    (tmp_path / "attestation.json.sig").write_text("sig", encoding="utf-8")

    assessed = assess(tmp_path, verify=True, expect_identity="https://wf/main")

    assert assessed.signature == sign.SIGNATURE_UNVERIFIED
    assert assessed.identity == sign.IDENTITY_UNTRUSTED
    assert "does not say which" in assessed.reason


def test_every_state_the_module_declares_is_reachable():
    """A status no code can produce is a promise nobody keeps."""
    assert set(sign.SIGNATURE_STATES) == {
        sign.SIGNATURE_VALID,
        sign.SIGNATURE_INVALID,
        sign.SIGNATURE_MISSING,
        sign.SIGNATURE_UNVERIFIED,
    }
    assert len(sign.IDENTITY_STATES) == 3


def test_the_limits_refuse_the_reading_a_padlock_invites():
    """Pinned by CONTENT. This is the artifact most likely to be over-read,
    because the word "signed" does a lot of work in a reader's head."""
    joined = " ".join(sign.LIMITS)

    assert "identity of the runner, never the correctness of the work" in joined
    assert "ORDINARY case" in joined
    assert "not invalid" in joined
    assert "transparency log is public" in joined
    assert "offline by default" in joined


# --- audit, end to end -----------------------------------------------------


def attested(repo: Path, monkeypatch, capsys) -> Path:
    """A real attestation over a real verified run."""
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n", encoding="utf-8"
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    assert cli.main(["attest"]) == cli.EXIT_OK
    capsys.readouterr()
    found = sorted((repo / attest.ATTESTATIONS_DIRNAME).iterdir())
    return found[-1] / attest.ATTESTATION_FILENAME


def test_an_unsigned_attestation_passes_audit_on_all_three_axes(
    repo, monkeypatch, capsys
):
    """The ordinary case, end to end. Integrity holds, the signature is missing,
    and the command exits 0 — because for local work that is not a finding."""
    path = attested(repo, monkeypatch, capsys)

    assert cli.main(["audit", str(path), "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)

    assert emitted["integrity"] == sign.INTEGRITY_VALID
    assert emitted["signature"] == sign.SIGNATURE_MISSING
    assert emitted["identity"] == sign.IDENTITY_UNKNOWN
    assert emitted["ok"] is True
    assert emitted["problem"] is None


def test_the_console_prints_the_axes_separately_and_marks_missing_softly(
    repo, monkeypatch, capsys
):
    """A `!` beside the ordinary outcome is how a tool teaches people to ignore
    its marks, so `signature_missing` gets a `·`."""
    path = attested(repo, monkeypatch, capsys)

    cli.main(["audit", str(path)])
    out = capsys.readouterr().out

    assert "✓ attestation.json verifies" in out
    assert f"· {sign.SIGNATURE_MISSING}" in out
    assert f"· {sign.IDENTITY_UNKNOWN}" in out
    assert "✗" not in out


def test_a_broken_bundle_still_fails_on_integrity_with_a_signature_present(
    repo, monkeypatch, capsys
):
    """**Integrity is reported first and decides the exit, and that ordering is
    the point.** A signature over a document whose bundles do not re-verify is a
    signature over a broken claim; letting a padlock lead would walk a reader
    past the finding that matters."""
    path = attested(repo, monkeypatch, capsys)
    path.with_name(attest.SIGNATURE_FILENAME).write_text("sig", encoding="utf-8")
    # tamper with a bundle the attestation names
    payload = json.loads(path.read_text(encoding="utf-8"))
    named = repo / payload["bundles"][0]["path"]
    (named / "summary.md").write_text("edited by hand\n", encoding="utf-8")

    assert cli.main(["audit", str(path), "--json"]) == cli.EXIT_GATE_FAILED
    emitted = json.loads(capsys.readouterr().out)

    assert emitted["integrity"] == sign.INTEGRITY_INVALID
    assert emitted["ok"] is False


def test_audit_stays_offline_unless_the_flag_is_typed(repo, monkeypatch, capsys):
    """The shipped promise, kept literally rather than re-worded into
    meaninglessness: a signature is reported present and unchecked, and nothing
    is spawned."""
    path = attested(repo, monkeypatch, capsys)
    path.with_name(attest.SIGNATURE_FILENAME).write_text("sig", encoding="utf-8")

    def refuse(*_a, **_kw):  # pragma: no cover - must never be reached
        raise AssertionError("audit spawned a verifier without --verify-signature")

    monkeypatch.setattr(sign.subprocess, "run", refuse)

    assert cli.main(["audit", str(path), "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)

    assert emitted["signature"] == sign.SIGNATURE_UNVERIFIED
    assert emitted["ok"] is True


def test_an_untrusted_identity_fails_the_audit_when_one_was_declared(
    repo, monkeypatch, capsys, tmp_path
):
    """Asking is what makes it a requirement. Nobody asked in the test above,
    and the same attestation passed."""
    path = attested(repo, monkeypatch, capsys)
    path.with_name(attest.SIGNATURE_FILENAME).write_text("sig", encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body="exit 1")
    on_path(monkeypatch, bin_dir)

    code = cli.main([
        "audit", str(path), "--json",
        "--verify-signature", "--expect-identity", "https://wf/main",
    ])
    emitted = json.loads(capsys.readouterr().out)

    assert code == cli.EXIT_GATE_FAILED
    assert emitted["identity"] == sign.IDENTITY_UNTRUSTED
    assert emitted["ok"] is False


def test_audit_reads_no_config_so_two_auditors_agree(repo, monkeypatch, capsys):
    """`provenance.expect_identity` is a DELIVERY policy and is deliberately
    not read here. An audit whose result depends on which repository the auditor
    happens to be standing in is not an audit."""
    path = attested(repo, monkeypatch, capsys)
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n"
        "provenance:\n  expect_identity: https://somebody-elses/workflow\n",
        encoding="utf-8",
    )

    assert cli.main(["audit", str(path), "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)

    assert emitted["identity"] == sign.IDENTITY_UNKNOWN


# --- attest --sign ---------------------------------------------------------


def test_attest_sign_on_a_laptop_refuses_and_keeps_the_attestation(
    repo, monkeypatch, capsys
):
    """**The attestation stays.** It is a valid unsigned attestation, which is
    the ordinary artifact this program produces; deleting it because a signature
    could not be added would throw away the thing that was asked for over the
    thing that was not."""
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n", encoding="utf-8"
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["attest", "--sign"]) == cli.EXIT_CONFIG
    printed = capsys.readouterr()

    written = sorted((repo / attest.ATTESTATIONS_DIRNAME).iterdir())
    assert len(written) == 1
    assert (written[0] / attest.ATTESTATION_FILENAME).is_file()
    assert not (written[0] / attest.SIGNATURE_FILENAME).exists()
    assert "signature_missing" in printed.err
    assert "the ordinary case, not a failure" in printed.err


def test_attest_sign_in_ci_writes_the_sibling(repo, monkeypatch, capsys, tmp_path):
    """The CI path, driven by a real stub program rather than a mocked call."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body='echo "SIGNATURE" > "$4"')
    on_path(monkeypatch, bin_dir)
    for name, value in CI_ENV.items():
        monkeypatch.setenv(name, value)
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n", encoding="utf-8"
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["attest", "--sign", "--json"]) == cli.EXIT_OK
    emitted = json.loads(capsys.readouterr().out)

    assert emitted["signed_by"] == "cosign"
    written = sorted((repo / attest.ATTESTATIONS_DIRNAME).iterdir())[-1]
    assert (written / attest.SIGNATURE_FILENAME).is_file()
    # and the attestation's own schema version has not moved: signing is
    # additive by construction, which is why `.sig` was reserved as a sibling
    # back when the 2026-08-05 ruling declined to sign at all
    payload = json.loads(
        (written / attest.ATTESTATION_FILENAME).read_text(encoding="utf-8")
    )
    assert payload["schema_version"] == "wringer.attestation.v1"


# --- the delivery policy ---------------------------------------------------


def test_require_signature_refuses_delivery_from_an_unsignable_environment(
    tmp_path: Path,
):
    """A statement about the ENVIRONMENT, checked before the push.

    An attestation names the branch a delivery created, so it is written AFTER
    the push — a policy that could only refuse afterwards would refuse nothing,
    because the change would already be on the remote.
    """
    cfg = config.parse(
        {
            "version": 1,
            "gates": [{"id": "u", "run": "true"}],
            "provenance": {"require_signature": True},
        }
    )

    with pytest.raises(deliver.Refused) as caught:
        deliver._check_can_sign(cfg)
    message = str(caught.value)
    assert "only from an environment that can sign the record" in message
    assert "no flag to wave it through" in message


def test_a_repo_that_never_asked_delivers_exactly_as_before():
    for raw in (
        {"version": 1, "gates": [{"id": "u", "run": "true"}]},
        {
            "version": 1,
            "gates": [{"id": "u", "run": "true"}],
            "provenance": {"require_signature": False},
        },
    ):
        assert deliver._check_can_sign(config.parse(raw)) is None


def test_require_signature_passes_in_a_signable_environment(
    tmp_path: Path, monkeypatch
):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body="exit 0")
    on_path(monkeypatch, bin_dir)
    for name, value in CI_ENV.items():
        monkeypatch.setenv(name, value)
    cfg = config.parse(
        {
            "version": 1,
            "gates": [{"id": "u", "run": "true"}],
            "provenance": {"require_signature": True},
        }
    )

    assert deliver._check_can_sign(cfg) is None


# --- the config surface ----------------------------------------------------


def test_provenance_defaults_to_unsigned():
    cfg = config.parse({"version": 1, "gates": [{"id": "u", "run": "true"}]})
    assert cfg.provenance is None


def test_an_unknown_signer_is_refused_with_the_reason():
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "provenance": {"signer": "openssl"},
            }
        )
    assert "names a program rather than a scheme" in str(caught.value)


def test_an_unknown_provenance_key_is_an_error():
    with pytest.raises(config.ConfigError) as caught:
        config.parse(
            {
                "version": 1,
                "gates": [{"id": "u", "run": "true"}],
                "provenance": {"key_path": "/etc/secret.pem"},
            }
        )
    assert "unknown keys under 'provenance': key_path" in str(caught.value)


def test_a_successful_signing_says_so_and_qualifies_the_unsigned_limit(
    repo, monkeypatch, capsys, tmp_path
):
    """**The limit stays and a second line qualifies it.**

    `wring audit` refuses an attestation whose own `limits` array has had the
    unsigned sentence removed, so that sentence cannot be conditional on
    anything. But printing "not who produced them" beside a signature that names
    exactly who produced them is a false statement, so the half that changed is
    said out loud rather than the whole sentence being suppressed.

    Without this the console said nothing at all about a signature it had just
    written — `--sign` succeeded silently, which was found by reading the real
    output rather than the tests.
    """
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub_signer(bin_dir, "cosign", body='echo "SIGNATURE" > "$4"')
    on_path(monkeypatch, bin_dir)
    for name, value in CI_ENV.items():
        monkeypatch.setenv(name, value)
    (repo / ".wringer.yaml").write_text(
        "version: 1\ngates:\n  - id: unit\n    run: 'true'\n", encoding="utf-8"
    )
    monkeypatch.chdir(repo)
    assert cli.main(["verify"]) == cli.EXIT_OK
    capsys.readouterr()

    assert cli.main(["attest", "--sign"]) == cli.EXIT_OK
    out = capsys.readouterr().out

    assert attest.UNSIGNED_LIMIT in out
    assert "signed by cosign" in out
    assert "not that the work is any good" in out

    path = sorted((repo / attest.ATTESTATIONS_DIRNAME).iterdir())[-1]
    assert cli.main(["audit", str(path / attest.ATTESTATION_FILENAME),
                     "--verify-signature"]) == cli.EXIT_OK
    audited = capsys.readouterr().out

    assert f"✓ {sign.SIGNATURE_VALID}" in audited
    assert attest.UNSIGNED_LIMIT in audited
    assert "does say who produced it" in audited
