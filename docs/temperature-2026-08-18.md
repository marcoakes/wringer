# `wring spec --send` could not reach a current model — measured, fixed, measured

*2026-08-18. Every number and every quoted string below came from a command
run on this machine on that date. Nothing here is recalled.*

## What was wrong

`spec.build_request` always sent `"temperature": 0`. Every current-generation
Anthropic model rejects it outright — **HTTP 400, before a token is drafted**.
So a product manager who named the model their team actually uses got an error
instead of a specification, at the first step of the surface this programme
spent a month building.

It was found on 2026-08-17 while driving `wringer-drive` end to end, and the
capture that measured the PM path used `claude-sonnet-4-6` precisely because
it was the model that still worked.

## The reproduction, before the change

A scratch repository, one PRD, `judge.model: claude-opus-5`:

```
$ wring spec PRD.md --send --json
wring spec: the endpoint could not be used: HTTP Error 400: Bad Request.
The request is on disk at .wringer/specs/20260817-202716-2f69/request.json.
exit=2
```

That recorded request carried:

```
keys: ['max_tokens', 'messages', 'model', 'temperature']
temperature: 0 | model: claude-opus-5 | max_tokens: 8000
```

**The endpoint's own words**, obtained by replaying that exact recorded body:

```
HTTP 400
{"error": {"code": "invalid_request_error",
           "message": "`temperature` is deprecated for this model.",
           "type": "invalid_request_error", "param": null}}
```

Replaying the artifact rather than paraphrasing the error is deliberate: the
`request.json` written before any socket opens is the provenance record, and
it is the thing that can be checked later.

## The change

The `temperature` key is removed from `spec.build_request`. **No configuration
knob replaces it.**

`temperature: 0` never bought determinism here. The drafter's correctness
mechanism is parse-or-refuse — `spec.parse_response` puts every field the
model proposes through the same parser the file itself will face, so the
caller gets a spec that loads or an exception, never a half-formed document.
A `judge.temperature` key would be surface nobody asked for; if a real need
arrives it can arrive with a use case and get its own slice.

**`wring judge` is a different request and is untouched.** It still sends
`temperature: 0`, `schema/judge-request.schema.json` still requires it with
`"const": 0`, and that schema is frozen in `schema/frozen.json`. A judge that
is not deterministic is not a gate.

### What this does to evidence bytes

The body is written to `.wringer/specs/<id>/request.json` as provenance, so
this edit changes what new records contain. Three things were checked before
it was made:

- **Nothing reads `temperature` back out.** A grep over `src/` finds the key
  written in two places and read in none.
- **No schema governs this body.** `spec.schema.json` governs
  `wringer.spec.yaml`; `judge-request.schema.json` governs `wring judge`'s
  request, and the test that validates it loads that file from the verdicts
  directory, not from a spec directory.
- **Old records stay readable.** A `request.json` written on 2026-08-11
  (`.wringer/specs/20260811-111842-1762/`) loads and reports
  `temperature: 0`, `model: claude-opus-5`, `max_tokens: 16000` — which is
  also the earliest evidence in this repository that somebody pointed this
  command at a model it could not reach.

## The proof, both directions, live

Both runs were real sends to `https://api.anthropic.com/v1/chat/completions`.

| | model | before | after |
|---|---|---|---|
| the model that 400'd | `claude-opus-5` | HTTP 400, exit 2, nothing drafted | **exit 0** |
| the regression check | `claude-sonnet-4-6` | drafted (it accepts the old body) | **exit 0** |

`claude-opus-5`, after:

```
{"mode": "live", "spec": "wringer.spec.yaml", "approved": false,
 "criteria": 5, "gates": 0, "tasks": 3, "open_questions": 10,
 "spec_dir": ".wringer/specs/20260817-202822-8b77"}
exit=0
```

`claude-sonnet-4-6`, after — the model that already worked, checked because a
fix that trades one model class for another is not a fix:

```
{"mode": "live", "spec": "wringer.spec.yaml", "approved": false,
 "criteria": 6, "gates": 1, "tasks": 2, "open_questions": 11,
 "spec_dir": ".wringer/specs/20260817-202913-4a2c"}
exit=0
```

and the body that travelled on that run:

```
keys: ['max_tokens', 'messages', 'model'] | model: claude-sonnet-4-6
temperature present: False
```

**`approved: false` in both.** The interlock is untouched by this: a draft is
a draft, and a person flips that key.

### Spend, itemised

Read from the recorded `response.json` of each run, not estimated:

| call | model | prompt | completion | total |
|---|---|---|---|---|
| the 400 reproduction | `claude-opus-5` | — | — | **0** (rejected before drafting) |
| the replay that captured the error text | `claude-opus-5` | — | — | **0** (same rejection) |
| the after proof | `claude-opus-5` | 989 | 2677 | 3666 |
| the regression check | `claude-sonnet-4-6` | 733 | 1431 | 2164 |

Four calls, **5,830 tokens billed in total**, well under a dollar. **No corpus
row was run**: that is a pre-registered instrument and it is Marc's alone.

## What this does NOT fix, named rather than left to be discovered

`judge.max_output_tokens` still defaults to **1024**, which truncates the
draft for any real PRD — `wring spec` then refuses the whole reply and writes
nothing. Both scratch repositories above declared `8000`, as `wringer-drive`'s
generated config does, which is why they drafted at all. That default is a
shared constant the judge uses too, and one risky engine edit per window is
the rule; the refusal message already names the fix. It is deferred, and it
is the next thing a PM will hit.

> **DONE 2026-08-19, the next window.** The default is now **8000** — the
> value both scratch repositories above declared, which is why this paragraph
> could name it before it existed. The paragraph is kept as written: it is the
> record of a thing being deferred on purpose, and the deferral is the reason
> the fix has this shape rather than a new configuration knob.
