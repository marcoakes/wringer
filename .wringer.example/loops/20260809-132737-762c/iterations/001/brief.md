# Fix this

`wring verify` failed. This is the structured result an agent would
get from `wring verify --json`:

```json
{
  "status": "failed",
  "failed_gate": "test",
  "rerun": "wring verify --gate test",
  "evidence_dir": ".wringer/runs/20260809-132737-4355"
}
```

## Failing gate: `test`

- command: `pytest -q`
- exit code: 1

### stdout

```
[... 14 earlier lines, see the bundle ...]
........................................................................ [ 99%]
.                                                                        [100%]
=================================== FAILURES ===================================
_______ test_the_readme_leads_with_the_thesis_and_not_a_deferred_runtime _______

    def test_the_readme_leads_with_the_thesis_and_not_a_deferred_runtime():
        """M3's job definition, and afterwards the re-lead's regression guard.
    
        The next act's direction (2026-08-09) re-aims the launch: the green-decays
        thesis and neutrality move to the FRONT of the README, because they are
        the argument everything else serves — and a thesis in paragraph four is a
        thesis nobody reads. Three claims, each of which was false when this test
        was written:
    
        1. The lead carries the thesis: green is suspect, and trust in a passing
           check decays.
        2. The lead carries neutrality: the party holding the receipts has no
           stake in what they say.
        3. The intro no longer promises a durable runtime "tomorrow" — Temporal
           was deferred with a named trigger, not a phase, and a README that
           promises it is a roadmap wearing a landing page.
    
        Plus the vitality demo, drawn where the claim is made rather than only in
        docs/: a reader should SEE a gate die under green runs from the README.
        """
        require_checkout("README.md")
        text = (repo_root() / "README.md").read_text(encoding="utf-8")
        lead = "\n".join(text.splitlines()[:45])
    
>       assert "green is suspect" in lead, (
            "the README's lead does not carry the thesis — 'code is cheap and "
            "green is suspect' is the sentence the whole next act is built on"
        )
E       AssertionError: the README's lead does not carry the thesis — 'code is cheap and green is suspect' is the sentence the whole next act is built on
E       assert 'green is suspect' in '<div align="center">\n\n# 🗜️ Wringer\n\n**The vendor-neutral AI-DLC harness — a control plane for AI-driven developme.../demo.sh`; the recorded transcript is committed beside it at\n[`docs/demo.cast.json`](docs/demo.cast.json).*\n\n</div>'

tests/test_docs.py:1516: AssertionError
=========================== short test summary info ============================
FAILED tests/test_docs.py::test_the_readme_leads_with_the_thesis_and_not_a_deferred_runtime
1 failed, 1078 passed, 2 skipped in 206.68s (0:03:26)
```

## What to do

Fix the failure above, then re-check with:

```
wring verify --gate test
```

The whole evidence bundle — diff, status, every gate's logs — is at `.wringer/runs/20260809-132737-4355`.
Do not edit anything under `.wringer/`: that is the evidence, not the code.
