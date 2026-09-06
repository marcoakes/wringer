# `ts/` — the port's contract

Wringer is being ported surface by surface behind its frozen records. This
directory is **phase 0** of `~/Claude/WRINGER_BUN_PORT_PLAN_2026-09-06.md`:
the records contract, and nothing else. No engine behaviour is ported here.

## Why the records are the seam

Measured on 0.9.10, before any of this was written:

- The **board** makes exactly four calls into the engine
  (`spec.Criterion`, `accept.criterion_digest`, `spec.render`,
  `fleet.run_at`) and reads everything else from `.wringer/`.
- The **drive** reaches the engine as `wring <verb> --json` for every paid
  step.
- Every record has a frozen schema under `schema/`, with a sha256 in
  `schema/frozen.json`.

So a TypeScript surface needs one thing from the Python to be safe: to read
what it writes, under the same schemas, with the same refusals.

## What is here

```
scripts/generate-types.ts        types for all 63 schemas, generated, checked in
packages/records/src/generated.ts   ← the generated file (do not edit)
packages/records/src/read.ts     the readers, which fail closed and say why
packages/records/test/           the contract, proved over real records
corpus.json                      built by ../scripts/export-records.py
```

## Running it

```bash
cd ts
bun install
bun run corpus     # walk .wringer/, match every record to the schema it declares
bun run check      # types are current + the contract suite
```

`bun run corpus` shells to the repo's own venv and validates in Python
first, so the suite is a **differential**: two languages, one corpus, one
schema. It exits non-zero when a record declares a version it does not
satisfy.

## What the contract does NOT cover yet

Nine of the 63 schemas describe event lines and sub-objects that carry no
`schema_version` of their own — `evidence-event`, `graph-event`,
`loop-event`, `gate-result`, `judge-request` and their v2 siblings. They are
matched by the file they live in rather than by declaration, and that is not
built. `contract.test.ts` names them so the gap is visible rather than
silent.
