# wring verify — 20260809-132737-4355

- repo: **wringer** @ `630b968` (branch `main`, dirty)
- started: 2026-08-09T14:27:37+01:00
- result: **failed** — required gate `test` failed
- files: 2 changed, 3 untracked ([diff.patch](diff.patch), [status.txt](status.txt))

| gate | status | duration | logs |
|---|---|---|---|
| lint | passed | 0.1s | [stdout](gates/001_lint/stdout.log) · [stderr](gates/001_lint/stderr.log) |
| test | failed | 206.9s | [stdout](gates/002_test/stdout.log) · [stderr](gates/002_test/stderr.log) |

Rerun the failing gate:

```
wring verify --gate test
```
