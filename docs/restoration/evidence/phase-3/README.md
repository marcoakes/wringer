# Phase 3 evidence — serial graphs of contained loops

Deterministic engineering fixtures only. No model, container, fleet, human
decision or external publication was used. Local paths are replaced with
`[checkout]`, `[temporary]` or `[home]`.

| Record | What it shows |
| --- | --- |
| `measurements/` | The baseline before the new contract: legacy graph tests, the public refusal and source-binding probes |
| `initial/` | First runs that failed or were masked, kept as measured, including test-harness defects |
| [reversions.json](reversions.json) | Each guard removed alone in an isolated copy: red, then restored and green |
| [effects.json](effects.json) | What removing each guard changed, and the guards kept as defence in depth |
| `revert-*.log`, `restored-*.log` | The targeted transcripts behind every reversion |
| `local-validation.json` | Full local check, build and validation for the release candidate |
| `release.json` | Public release verification, added after publication |

The narrative is in [PHASE_3_MEASUREMENTS.md](../../PHASE_3_MEASUREMENTS.md).
