"""Signed provenance, CI-only — docs/specs/SPEC_SIGN_V0.md.

**Read this paragraph before the code.** A signature binds *the identity of the
runner, never the correctness of the work*. It says who produced a document. It
says nothing about whether the gates were meaningful, whether the criteria
matched the requirement, or whether the change is good — every hard question
this project exists to answer is upstream of the signature and untouched by it.
The risk of shipping this is not technical: it is that a green padlock reads to
a reader as a stronger claim than *"unaltered since written by a named party"*,
and this repository already has a rule against claims that read stronger than
they are.

**Why signing is possible at all now, having been ruled out on 2026-08-05.**
That ruling refused to put a key in CI secrets, because never touching a
credential is the product's most distinctive promise. Keyless signing holds no
long-lived key: it signs against a short-lived certificate bound to an ambient
OIDC identity, the same shape as this project's tokenless PyPI publish. The
premise changed; the conclusion did not have to.

**The decisive constraint is where the identity lives.** In CI it is ambient. On
a developer's machine there is none, and the keyless flow falls back to an
interactive browser login — which collides with two shipped positions at once,
because `wring audit` is offline by construction and `wring attest` opens no
socket. So signing is a CI-shaped feature in a mostly-local product, and
`signature_missing` must be the ORDINARY, untroubling case. It is:
`sign.assess` returns it for every local attestation ever written, and nothing
downstream treats it as a failure unless a repository explicitly asked.

**Wringer never signs anything itself.** It shells to a signer the user already
has, exactly as it shells to `git` — so the runtime dependency list is still
PyYAML alone, no key is ever handled, and the program still opens a socket in
exactly two places (`tests/test_network_surface.py`; this line named a grep
until 2026-08-15 and the grep counted itself). A subprocess
reaching a network is the `deliver.send` precedent
(SPEC_GET_V0 §7), not a new socket in this program. It is still a fifth way to
reach a network and every count in the documentation says so.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

# --- the three axes (SPEC_SIGN_V0 §4) ---------------------------------------
#
# Reported SEPARATELY and never collapsed into one boolean. A single `ok` would
# have to pick a side on the ordinary local case — an unsigned attestation whose
# bundles are all intact — and both answers are wrong: `false` makes the normal
# case look broken, `true` hides that nobody vouched for the document.

INTEGRITY_VALID = "integrity_valid"
INTEGRITY_INVALID = "integrity_invalid"

SIGNATURE_VALID = "signature_valid"
SIGNATURE_INVALID = "signature_invalid"
# The ORDINARY case for local work. Not a failure, not a warning, not a nudge.
SIGNATURE_MISSING = "signature_missing"
# **The fourth value, and it is an addition to the vocabulary the programme
# named.** A `.sig` is present and no verifier ran, so:
#
#   `valid`   would claim a check nobody performed;
#   `invalid` would call an honest signature bad;
#   `missing` would deny a file that is right there.
#
# All three are false statements, so the honest answer needed a word. Reachable
# two ways, both ordinary: no signer binary on this machine, and `wring audit`
# without `--verify-signature`, which stays offline by default.
SIGNATURE_UNVERIFIED = "signature_unverified"

# `trusted` requires a repository to have written down WHO it expects. Without
# that there is nothing to compare a verified identity against, so the answer is
# `unknown` — never `trusted`, which would make "signed by somebody" read as
# "signed by the right somebody" and is the padlock problem in one field.
IDENTITY_TRUSTED = "identity_trusted"
IDENTITY_UNTRUSTED = "identity_untrusted"
IDENTITY_UNKNOWN = "identity_unknown"

# The third collection, and it was missing while its two siblings existed.
# Not cosmetic: `SIGNATURE_STATES` and `IDENTITY_STATES` are what a reader —
# and a schema, and a test — consults to learn what an axis may hold, and the
# integrity axis had no such list at all. Its two values sat in no collection
# and no enum, so "what can this field be?" was answerable for two of the
# three axes and not for the one that decides whether a bundle was tampered
# with. `test_sign.py` now pins all three against the module's own constants,
# in both directions, so a fourth value added to any axis without joining its
# tuple reddens rather than ageing quietly.
INTEGRITY_STATES = (INTEGRITY_VALID, INTEGRITY_INVALID)

SIGNATURE_STATES = (
    SIGNATURE_VALID,
    SIGNATURE_INVALID,
    SIGNATURE_MISSING,
    SIGNATURE_UNVERIFIED,
)
IDENTITY_STATES = (IDENTITY_TRUSTED, IDENTITY_UNTRUSTED, IDENTITY_UNKNOWN)


# --- the signers ------------------------------------------------------------
#
# Every signing-tool vendor string in Wringer, behind one mapping, like
# `agents.py` for coding agents and `forge.py` for hosts. Neither tool is
# bundled, installed or recommended; a repository names the one it has.


@dataclass(frozen=True)
class Signer:
    id: str
    binary: str
    install: str


SIGNERS = {
    "cosign": Signer(
        id="cosign",
        binary="cosign",
        install="brew install cosign  (or see sigstore.dev)",
    ),
    "gh": Signer(
        id="gh",
        binary="gh",
        install="brew install gh  (GitHub CLI, needs the attestation extension)",
    ),
}
SIGNER_IDS = tuple(sorted(SIGNERS))
DEFAULT_SIGNER = "cosign"


# --- ambient identity -------------------------------------------------------
#
# The two variables GitHub Actions sets when a workflow is granted
# `id-token: write`. Named rather than sniffed: a keyless signature needs an
# OIDC token, this is the documented way to get one, and a check that guessed
# would refuse in CI or attempt an interactive login on a laptop.
_OIDC_URL = "ACTIONS_ID_TOKEN_REQUEST_URL"
_OIDC_TOKEN = "ACTIONS_ID_TOKEN_REQUEST_TOKEN"


def ambient_identity(env: dict[str, str] | None = None) -> str | None:
    """The CI identity provider available here, or None.

    None on every developer machine, which is the whole reason this is a
    CI-shaped feature. `env` is injectable so a test can describe a CI machine
    without being one — the alternative is a test that only passes in CI, which
    is a test nobody runs while writing the code.
    """
    environ = os.environ if env is None else env
    if environ.get(_OIDC_URL) and environ.get(_OIDC_TOKEN):
        return "github-actions-oidc"
    return None


def can_sign_here(
    signer_id: str = DEFAULT_SIGNER, env: dict[str, str] | None = None
) -> str | None:
    """Why this machine cannot produce a keyless signature, or None.

    Both halves are required and neither implies the other: a laptop with
    `cosign` installed still has no ambient identity, and a CI runner without
    `id-token: write` has an identity provider it cannot ask.
    """
    signer = SIGNERS.get(signer_id)
    if signer is None:  # pragma: no cover - config refuses it first
        return f"'{signer_id}' is not a signer Wringer knows ({', '.join(SIGNER_IDS)})"
    if shutil.which(signer.binary) is None:
        return (
            f"no {signer.binary} on PATH. Wringer never signs anything itself — "
            f"it shells to the signer you already have, so nothing here holds a "
            f"key. Install it: {signer.install}"
        )
    if ambient_identity(env) is None:
        return (
            "there is no ambient OIDC identity here, so a keyless signature "
            "would need an interactive browser login — which `wring attest` "
            "will not do, because it opens no socket of its own and an "
            "attestation must be producible without a human at a keyboard. "
            "Sign in CI, where the identity is ambient and no credential is "
            "stored (grant the job 'id-token: write')"
        )
    return None


# --- signing ----------------------------------------------------------------


class SignError(Exception):
    """A signature was asked for and could not be produced (exit code 2)."""


def sign_argv(signer_id: str, payload: Path, signature: Path) -> list[str]:
    """The command line that signs, as a list a reviewer can read.

    **No `--key` anywhere, in either dialect, and a test asserts it.** That
    absence is the whole reason this feature could be reopened after the 2026-08-05
    ruling: keyless means the certificate is minted from an ambient identity and
    discarded, so there is no long-lived secret for Wringer to touch, store, or
    leak into a bundle.
    """
    signer = SIGNERS[signer_id]
    if signer.id == "cosign":
        return [
            signer.binary,
            "sign-blob",
            "--yes",
            "--output-signature",
            str(signature),
            str(payload),
        ]
    return [
        signer.binary,
        "attestation",
        "sign",
        str(payload),
        "--output",
        str(signature),
    ]


def verify_argv(
    signer_id: str, payload: Path, signature: Path, identity: str | None
) -> list[str]:
    """The command line that verifies. Identity is passed when the repo declared
    one, so the tool itself checks the binding rather than Wringer comparing
    strings after the fact."""
    signer = SIGNERS[signer_id]
    if signer.id == "cosign":
        args = [
            signer.binary,
            "verify-blob",
            "--signature",
            str(signature),
        ]
        if identity is not None:
            args += ["--certificate-identity", identity]
        args.append(str(payload))
        return args
    args = [signer.binary, "attestation", "verify", str(payload)]
    if identity is not None:
        args += ["--signer-workflow", identity]
    return args


def sign(
    payload: Path,
    signature: Path,
    signer_id: str = DEFAULT_SIGNER,
    env: dict[str, str] | None = None,
    timeout: int = 120,
) -> str:
    """Produce `attestation.json.sig` beside the attestation it signs.

    The attestation's bytes are already on disk when this runs — the writer is
    `attest.build`, and this is a separate step by construction. That is the
    same rule every `--send` in this program follows: the exact bytes are
    written before anything can reach a network, so a signature is over a
    document a reader can hold.

    Returns the signer id that produced it. Raises `SignError` with the reason
    otherwise, and **writes no partial signature**: a `.sig` that is not a
    signature is worse than none, because `audit` would report it as
    `signature_invalid` and send a reader hunting for tampering.
    """
    refusal = can_sign_here(signer_id, env)
    if refusal is not None:
        raise SignError(refusal)
    try:
        done = subprocess.run(
            sign_argv(signer_id, payload, signature),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        signature.unlink(missing_ok=True)
        raise SignError(f"{signer_id} could not be run: {exc}") from exc
    if done.returncode != 0 or not signature.is_file():
        signature.unlink(missing_ok=True)
        tail = (done.stderr or done.stdout or "").strip().splitlines()
        detail = tail[-1] if tail else f"exit {done.returncode}"
        raise SignError(f"{signer_id} did not produce a signature: {detail}")
    return signer_id


# --- the three-axis report --------------------------------------------------


@dataclass(frozen=True)
class Assessment:
    """One attestation's signature and identity axes, and why.

    `integrity` is NOT here: it is `attest.audit`'s own finding over the
    bundles, and folding the two together is the collapse this whole vocabulary
    exists to prevent.
    """

    signature: str
    identity: str
    reason: str
    signer: str | None = None
    expected_identity: str | None = None

    @property
    def signed(self) -> bool:
        return self.signature == SIGNATURE_VALID


def assess(
    payload: Path,
    signature: Path,
    signer_id: str = DEFAULT_SIGNER,
    expect_identity: str | None = None,
    verify: bool = False,
    timeout: int = 120,
) -> Assessment:
    """Where this attestation stands on the two axes a signature can move.

    **`verify=False` is the default, and that is what keeps `wring audit`
    offline.** Checking a Sigstore signature means reaching a transparency log
    and a trust root, so it is an explicit extra step rather than something
    `audit` does behind a promise of being offline. Unasked, a present signature
    is `signature_unverified` — never `valid`, which would claim a check nobody
    ran.
    """
    if not signature.is_file():
        # The ordinary case for local work, said plainly and without hedging.
        return Assessment(
            signature=SIGNATURE_MISSING,
            identity=IDENTITY_UNKNOWN,
            reason=(
                "no signature beside this attestation. That is the ordinary "
                "case: keyless signing needs an ambient CI identity, most runs "
                "are local, and an unsigned attestation still proves its "
                "bundles are unaltered since they were written"
            ),
            expected_identity=expect_identity,
        )

    if not verify:
        return Assessment(
            signature=SIGNATURE_UNVERIFIED,
            identity=IDENTITY_UNKNOWN,
            reason=(
                "a signature is present and was not checked. `wring audit` is "
                "offline by default and verifying a keyless signature reaches "
                "a transparency log, so it is an explicit step: re-run with "
                "--verify-signature"
            ),
            signer=signer_id,
            expected_identity=expect_identity,
        )

    signer = SIGNERS.get(signer_id)
    if signer is None or shutil.which(signer.binary) is None:
        binary = signer.binary if signer else signer_id
        return Assessment(
            signature=SIGNATURE_UNVERIFIED,
            identity=IDENTITY_UNKNOWN,
            reason=(
                f"a signature is present and there is no {binary} here to "
                "check it with. Unverified is not invalid — nothing has been "
                "shown either way, and calling it invalid would send a reader "
                "hunting for tampering that may not exist"
            ),
            signer=signer_id,
            expected_identity=expect_identity,
        )

    try:
        done = subprocess.run(
            verify_argv(signer_id, payload, signature, expect_identity),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return Assessment(
            signature=SIGNATURE_UNVERIFIED,
            identity=IDENTITY_UNKNOWN,
            reason=(
                f"{signer_id} could not be run to check the signature ({exc}), "
                "so nothing has been shown either way"
            ),
            signer=signer_id,
            expected_identity=expect_identity,
        )

    if done.returncode != 0:
        tail = (done.stderr or done.stdout or "").strip().splitlines()
        detail = tail[-1] if tail else f"exit {done.returncode}"
        # **One rejection, two possible causes, and they are not the same
        # finding.** A verifier handed an identity rejects both a forged
        # signature and a genuine one from the wrong workload, and reporting
        # `signature_invalid` for the second would accuse a real signer of
        # forgery. So an identity was declared, the tool said no, and the honest
        # split is: the signature itself is unverified, the identity is
        # untrusted. Without a declared identity there is no such ambiguity and
        # the rejection is about the signature alone.
        if expect_identity is not None:
            return Assessment(
                signature=SIGNATURE_UNVERIFIED,
                identity=IDENTITY_UNTRUSTED,
                reason=(
                    f"{signer_id} rejected this signature for the declared "
                    f"identity '{expect_identity}': {detail}. That is either a "
                    "bad signature or a good one from a different workload, and "
                    "this rejection does not say which — re-run without an "
                    "expected identity to separate them"
                ),
                signer=signer_id,
                expected_identity=expect_identity,
            )
        return Assessment(
            signature=SIGNATURE_INVALID,
            identity=IDENTITY_UNKNOWN,
            reason=f"{signer_id} rejected this signature: {detail}",
            signer=signer_id,
            expected_identity=expect_identity,
        )

    if expect_identity is None:
        # Verified, and nobody said whose signature to expect. `trusted` here
        # would make "signed by somebody" read as "signed by the right
        # somebody", which is the padlock problem in one field.
        return Assessment(
            signature=SIGNATURE_VALID,
            identity=IDENTITY_UNKNOWN,
            reason=(
                f"{signer_id} accepted this signature. No expected identity is "
                "declared, so WHO signed it is unchecked — declare "
                "'provenance.expect_identity' to hold a signature to a "
                "particular workload"
            ),
            signer=signer_id,
        )
    return Assessment(
        signature=SIGNATURE_VALID,
        identity=IDENTITY_TRUSTED,
        reason=(
            f"{signer_id} accepted this signature and bound it to "
            f"'{expect_identity}'"
        ),
        signer=signer_id,
        expected_identity=expect_identity,
    )


# What a signature does NOT claim, travelling with the report rather than living
# in a spec nobody opened — the pattern `health.LIMITS`, `accept.LIMITS` and
# `backend.LIMITS` set. This is the one artifact in the program most likely to
# be over-read, because the word "signed" does a lot of work in a reader's head.
LIMITS = (
    "A signature binds the identity of the runner, never the correctness of "
    "the work. It says who produced this document — not that the gates were "
    "meaningful, that the criteria matched the requirement, or that the change "
    "is any good. Every hard question is upstream of it and untouched.",
    "signature_missing is the ORDINARY case. Keyless signing needs an ambient "
    "CI identity and most runs are local; an unsigned attestation still proves "
    "its bundles are unaltered since they were written.",
    "signature_unverified means nothing was shown either way — no verifier was "
    "available, or `wring audit` was run without --verify-signature. It is not "
    "invalid, and reading it as invalid sends someone hunting for tampering "
    "that may not exist.",
    "identity_unknown means nobody wrote down whose signature to expect. A "
    "valid signature from an unexpected workload is still a valid signature, "
    "which is why the two axes are reported separately.",
    "Verifying a keyless signature reaches a transparency log and a trust "
    "root. `wring audit` is offline by default and stays that way; "
    "--verify-signature is the step that is not offline, and it says so.",
    "The transparency log is public. Signing an attestation for a private "
    "repository publishes a digest and a signer identity to a log anyone can "
    "read.",
)
