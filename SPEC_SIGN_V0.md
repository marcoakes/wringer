# SPEC_SIGN_V0 — signed provenance, CI-only

**Binding** for the `provenance:` section, `wring attest --sign`, the three axes
`wring audit` reports, and the delivery policy that refuses an unsignable
environment.

Status: **BUILT**, 2026-08-12. The logic is exercised end to end against a real
stub signer; §9 says what that leaves untested.

---

## 1. What a signature is for, and the sentence that must survive

> A signature binds **the identity of the runner, never the correctness of the
> work.**

It says who produced a document. It says nothing about whether the gates were
meaningful, whether the criteria matched the requirement, or whether the change
is good. **Every hard question this project exists to answer is upstream of the
signature and untouched by it.**

The risk of shipping this is not technical. It is that a green padlock reads to a
reader as a stronger claim than *"unaltered since written by a named party"*, and
this repository already has a rule against claims that read stronger than they
are. Every design decision below is downstream of that risk.

## 2. Why this was reopened, having been ruled out

**Marc ruled UNSIGNED on 2026-08-05**, and the reason was narrow and good:
signing would put a key in CI secrets, and never touching a credential is the
product's most distinctive promise. SPEC_PROVENANCE ruling 1 refused exactly
that.

Keyless signing holds no long-lived key. It signs against a short-lived
certificate minted from an ambient OIDC identity — the same shape as this
project's tokenless PyPI publish. **The premise changed; the conclusion did not
have to.**

What was already in place, by the same 2026-08-05 ruling that declined to sign:
`attest.py` reserved `attestation.json.sig` as a **sibling** file, so signing is
additive by construction and `wringer.attestation.v1` does not change. A test
asserts the schema version is still v1 after a signature is written.

## 3. The decisive constraint: where the identity lives

| where the attestation is made | can it be keyless-signed? |
|---|---|
| CI (GitHub Actions, ambient OIDC) | **yes**, with no stored credential |
| a developer's machine | **no** — the keyless flow falls back to an interactive browser login |
| an air-gapped or enterprise runner | only with that platform's own identity, a per-platform integration |

On a laptop there is no ambient identity, and an interactive login collides with
two shipped positions at once: `wring audit` is offline by construction, and
`wring attest` opens no socket. So **signing is a CI-shaped feature in a
mostly-local product**, and it follows that `signature_missing` must be the
ordinary, untroubling case. It is: `sign.assess` returns it for every local
attestation ever written, `wring audit` exits 0 on it, and the console marks it
`·` rather than `!` — a warning mark beside the normal outcome is how a tool
teaches people to ignore its marks.

Detection is the two variables GitHub Actions sets when a job is granted
`id-token: write`, named rather than sniffed. Both are required and neither
implies the other: a laptop with `cosign` installed still has no identity, and a
job without that permission has a provider it cannot ask.

## 4. The three axes, never collapsed

`wring audit` reports:

| axis | values |
|---|---|
| integrity | `integrity_valid` · `integrity_invalid` |
| signature | `signature_valid` · `signature_invalid` · `signature_missing` · `signature_unverified` |
| identity | `identity_trusted` · `identity_untrusted` · `identity_unknown` |

A single boolean would have to pick a side on the ordinary case — an unsigned
attestation whose bundles are all intact — and both answers are wrong: `false`
makes the normal case look broken, `true` hides that nobody vouched for the
document.

**`signature_unverified` is a fourth value the programme did not name, and it is
the one deliberate addition to the given vocabulary.** It means a `.sig` is
present and no verifier ran. The three given values cannot express that without
a false statement:

- `valid` claims a check nobody performed;
- `invalid` calls an honest signature bad, and sends a reader hunting for
  tampering that may not exist;
- `missing` denies a file that is right there.

It is reachable two ordinary ways: no verifier on this machine, and `wring audit`
without `--verify-signature`.

**`identity_trusted` requires a repository to have written down whose signature
to expect.** Without that there is nothing to compare against, so the answer is
`identity_unknown` — never `trusted`, which would let "signed by somebody" read
as "signed by the right somebody". That is the padlock problem in one field.

**One rejection, two causes, and they are not the same finding.** A verifier
handed an expected identity rejects both a forged signature and a genuine one
from the wrong workload. Reporting `signature_invalid` for the second would
accuse a real signer of forgery, so the honest split is `signature_unverified` +
`identity_untrusted`, with a reason that says the rejection does not distinguish
them and how to separate them.

**`ok`, the exit-code question, means: integrity holds AND nothing the caller
explicitly asked about came back bad.** Asking is what turns a signature into a
requirement. `signature_missing` never makes it false.

**Integrity is reported first and decides the exit.** A signature over a document
whose bundles do not re-verify is a signature over a broken claim, and letting a
padlock lead would walk a reader past the finding that matters.

## 5. The policy — `provenance:`

```yaml
provenance:
  require_signature: true
  signer: cosign                        # cosign | gh
  expect_identity: https://github.com/owner/repo/.github/workflows/ci.yml@refs/heads/main
```

Absent means unsigned, which every attestation written before this section
already was.

**`require_signature` is a DELIVERY policy**, and it reads: *changes leave this
repository only from an environment that can sign the record.* It is checked
where delivery happens rather than where attestation does, and the reason is the
order of operations — an attestation names the branch a delivery created, so it
is written **after** the push. A policy that could only refuse afterwards would
refuse nothing, because the change would already be on the remote.

So it is the sixth refusal in `deliver.plan`, and the only one about the machine
rather than the bundle. **No flag waves it through.** SPEC_VACUITY ruling 1
established that flags may tighten and never loosen; a `--allow-unsigned` would
be the counter-example. The escape is to deliver from CI, or to stop requiring
it.

**`expect_identity` is read HERE and never by `audit`** — see §6.

## 6. `wring audit` stays offline, and its promise is re-worded not broken

Verifying a keyless signature reaches a transparency log and a trust root. So:

- **`wring audit` is offline by default**, exactly as shipped. Integrity is
  checked by reading files. A present signature reports
  `signature_unverified`, and a test proves nothing is spawned by making
  `subprocess.run` raise.
- **`--verify-signature` is the step that is not offline**, and both the flag's
  help text and the reason string say so.

**`audit` reads no config, and that is why the signature parameters are
parameters.** Letting `provenance.expect_identity` leak in would mean two
auditors holding the same attestation got different answers depending on which
repository they happened to be standing in — and an audit whose result depends on
the auditor's filesystem is not an audit. `--expect-identity` is a flag; a repo
that wants its CI to check identity writes the flag into its workflow.

## 7. Wringer signs nothing itself

It shells to a signer the user already has — `cosign` or `gh` — exactly as it
shells to `git`. Consequences, all of them deliberate:

- **The runtime dependency list is still PyYAML alone.** No `sigstore` package.
- **No key is ever handled.** A test asserts no `--key`, `--private-key`,
  `--sk` or `COSIGN_PASSWORD` appears in either dialect's command line, in
  either direction. That absence is what let the 2026-08-05 ruling be revisited,
  so a `--key` creeping in would silently undo it.
- **`grep -rn build_opener src/` still has exactly two answers.** A subprocess
  reaching a network is the `deliver.send` precedent (SPEC_GET_V0 §7), where a
  `git push` in a subprocess is not a socket this program opens.
- **It is still a fifth way to reach a network**, and every count in the
  documentation now says five. The old "four commands SEND" phrasings are in
  `tests/test_docs.py`'s `_UNDERSTATEMENTS`, so the next window cannot restate
  them. The whole surface, so this paragraph does not become the next stale
  enumeration: **SEND** — `wring judge --send`, `wring spec --send`,
  `wring deliver --send`, `wring graph run --send` (or `wring graph resume
  --send`), which reaches one only through the same `deliver.send`, and
  `wring attest --sign`. **FETCH**, not behind a flag because fetching is their
  purpose — `wring get`, `wring issue`, and `wring start --clone`, which opens a
  socket under exactly one condition and then stops. Plus `wring audit
  --verify-signature`, which is a READ against a transparency log rather than
  either.
- **The signer table is one mapping**, like `agents.py` for coding agents and
  `forge.py` for hosts. Neither tool is bundled, installed or recommended.

The attestation's bytes are on disk before the signer runs — the same rule every
`--send` follows. And **a failed signing keeps the attestation**: it is a valid
unsigned attestation, which is the ordinary artifact this program produces, so
deleting it because a signature could not be added would throw away the thing
that was asked for over the thing that was not. A partial `.sig` is deleted,
because a `.sig` that is not a signature would report `signature_invalid` and
send a reader hunting for tampering.

Exit 0 from the signer is not enough: the file is the evidence. A tool that
exited 0 without writing one is a failure, or Wringer would record a signed
attestation with no signature.

## 8. Second-order costs, named once

- **The transparency log is public.** Signing an attestation for a private
  repository publishes a digest and a signer identity to a log anyone can read.
  That is usually acceptable and occasionally a disclosure incident; it is in
  `sign.LIMITS` so it travels with the report.
- **Verification wants a trust root**, which is why it is not offline and not
  the default.
- **`audit`'s unsigned limit still prints on success.** A passing audit must not
  read as a stronger claim than it is, and that was true before signatures
  existed.

## 9. What is exercised, and what is not

**Exercised end to end**, against a real stub signer — a program on PATH, found
by `shutil.which`, spawned by `subprocess.run`, that really writes a file and
really exits 0 or 1: ambient-identity detection, both halves of the signing
precondition, the sign path, the failure paths, all four signature states, all
three identity states, the forgery-accusation split, the offline default, the
console marks, `--json`, the delivery refusal, and every config refusal. The stub
is deliberately not a mocked `subprocess`, so everything between Wringer's
decision and the tool's exit code is real.

**Not exercised: Sigstore.** Neither `cosign` nor `gh` is on the machine this was
written on, so the two real command lines are argv-pinned and have never been run
against Fulcio or Rekor. What that leaves untested is the tool, not Wringer —
which is a better position than SPEC_EXEC_V0 §7's, where the whole boundary was
argv-only.

Specifically unverified: that `cosign sign-blob --yes --output-signature` and
`gh attestation sign --output` write what Wringer expects where it expects it,
and that the verify dialects accept the identity flags as spelled. A first real
CI run is what settles those, and it costs nothing but a push.

## 10. What this does NOT do

- **No attestation written before this exists becomes signable.** Signing
  happens at attest time; an old attestation can be re-attested, not
  retroactively signed.
- **`wring audit` cannot verify offline.** §6. A bundled trust root would be a
  vendored key set this project is not going to carry.
- **No signature over anything but the attestation.** Bundles are covered by
  `digests.json` and the ledger chains, unchanged. Signing every bundle would
  multiply transparency-log entries for no added claim.
- **`gh attestation`'s dialect is a guess in one respect**: it is spelled from
  its documented surface, not from a run. §9.
- **The identity axis checks a string a repository wrote down.** It does not
  know whether that workflow is trustworthy, only whether the signature is bound
  to it.
- **Nothing verifies a commit signature.** Unchanged: `attest` reports git's
  `%G?` verbatim and never re-verifies, because that needs the reader's own
  keyring and trust root.

## 11. DONE

- [x] Signing only in CI, keyless, via ambient OIDC, holding no long-lived key.
- [x] `attestation.json.sig` as a sibling; `wringer.attestation.v1` unchanged.
- [x] `wring audit` reports integrity, signature and identity **separately**.
- [x] `signature_missing` is the ordinary case, exits 0, and does not read as
      invalid.
- [x] `audit`'s offline promise re-worded rather than broken; `--verify-signature`
      is the explicit non-offline step, proven by a test that makes spawning fail.
- [x] `provenance.require_signature: true` refuses delivery with the reason
      recorded, and no flag bypasses it.
- [x] No `--key` in any command line, asserted for both signers in both
      directions.
- [x] The network surface says five senders everywhere, and the old counts are in
      the drift guard.
