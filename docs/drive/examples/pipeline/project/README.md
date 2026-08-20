# pipeline

A tiny pipeline runner. A pipeline is a JSON file mapping a job name to what it
runs and what it waits for:

```json
{
  "build": {"command": "make build"},
  "test":  {"needs": ["build"], "command": "make test"},
  "docs":  {"command": "make docs"}
}
```

```
python -m pipeline pipeline.json
```

Jobs run in dependency order. The summary has one line per job and a verdict.

## How we work

`tests/` is the suite that must stay green — `pytest -q` runs exactly that.

`acceptance/` holds executable specs: checks written from a requirement
*before* it is built. They are red until the feature lands, which is why they
are not in the default run. Run one with
`pytest -q acceptance/<file>.py`.
