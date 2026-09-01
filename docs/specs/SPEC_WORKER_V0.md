# SPEC_WORKER_V0 — the worker contract

**Status: BINDING for the 0.6.0 worker contract** — the `exec:` worker form,
the brief-transport requirement, the run-path preflight refusals
(`worker_unbriefable`, `worker_auth_rejected`), the typed worker-auth state,
the `worker_read_only` stop, and the vendor-recipe capability stamp.

Authored 2026-08-31 from the run-3 review of record
(`~/Claude/WRINGER_RUN3_FINAL_REPORT_2026-08-31.md`, F4–F10), which measured
every clause here failing in the field before it was written. Nothing in
this spec is reasoned from a protocol; each ruling names the run that paid
for it.

## §1 The contract

A worker declaration is a contract with four legs, and every leg is either
validated before anything is spent or explicitly named unvalidatable:

1. **Prompt transport.** Wringer tells a worker what to build through
   exactly one channel per form: `{brief}` substitution (shell), the
   declared `brief:` transport (`exec:`), or the session prompt (`acp:`).
   A shell worker whose command carries no `{brief}` has NO channel — run 3
   measured the result as fifteen minutes of inherited-terminal silence per
   iteration (F5) — and is refused at preflight: `worker_unbriefable`,
   before the first gate or paid call. The `exec:` form cannot be parsed
   without a channel, so its refusal is a `ConfigError` at load.
2. **Write policy.** Not a schema key, by ruling: a `writes:` declaration
   Wringer cannot enforce would be a decorative claim. The tested flags ride
   the recipe's own argv (`--sandbox workspace-write` for codex), and the
   capability stamp (§4) is what proves an edit actually lands through that
   shape. A turn that ends cleanly, says something and writes nothing stops
   as `worker_read_only`, carrying the worker's own words (§5).
3. **Non-interactive termination.** Structural: a worker's stdin is
   `/dev/null`, never this process's own. A command that waits on a
   terminal reads EOF and terminates; before this, the F5 worker inherited
   the tty and sat on it — 0.08s of CPU in twelve clock minutes.
4. **Auth probe.** Derived from the roster (`agents.py`), never invented:
   ACP agents keep `Agent.auth_probe` and the handshake rung;
   shell and `exec:` workers get `agents.SHELL_VENDORS` — vendors whose
   login surface somebody has actually run. A vendor off the roster is
   `not_applicable`, which never refuses.

## §2 The three worker forms

```yaml
run:
  worker: 'codex exec --json --sandbox workspace-write "$(cat {brief})"'   # shell
  worker: { acp: { command: claude-agent-acp } }                           # acp
  worker:                                                                  # exec —
    exec:                                                                  # the documented
      argv: ["codex", "exec", "--json", "--sandbox", "workspace-write", "{brief}"]
      brief: argument                                                      # form since 0.6.0
```

The `exec:` form is the shell form's contract made declarative: an argv, no
shell, and the brief transport written down. `brief: argument` substitutes
the brief's TEXT into the `{brief}` element — the same bytes
`"$(cat {brief})"` hands a shell — and `brief: path` substitutes the
absolute path. There is no default transport and no `stdin` transport:
nothing has measured a worker reading its prompt from a pipe Wringer
writes, and the one stdin-shaped recipe ever published is F5.

Rulings:

- The shell-string form survives forever, `{brief}` required at preflight
  rather than at parse — existing configs must keep parsing everywhere
  (`wring verify` loads config too, and a verify-only repo with a broken
  worker string is not `verify`'s problem).
- `exec:` + `run.containment` is refused at parse: the pair is unmeasured,
  and containment's argv wrapping is defined over a shell string. The shell
  form is the contained one.
- The `worker.started` event for an `exec:` worker records the argv with
  the brief's PATH in the `{brief}` slot, never its text: the event is the
  run's record, and the brief's bytes are already in the bundle one
  directory over. `worker_kind` stays absent — the published event schema
  froze it as `const: "acp"`, and absence has always meant "not ACP".

## §3 The typed auth state

`worker_auth.read` answers for EVERY worker — verified (`logged_in`) /
rejected (`logged_out`) / `unknown` / `not_applicable` — and the run path
renders the state before anything is spent (`wring run`, `wring resume`,
the drive). A shell worker's `None` is gone; run 3 measured what it cost
(F10): every renderer returned early on it and silence read as a tick.

The shell lane composes exactly two facts and blends nothing:

| stored login (probe) | key env set | state | why |
|---|---|---|---|
| yes | no | `logged_in` | the vendor's own word; the ceiling still rides every sentence |
| yes | yes | `unknown` | **the displacement, named**: the key is what the turn spends against, and presence is not validity — measured on two vendors (ACP 2026-08-27, codex run 3 F7) |
| no | yes | `unknown` | the key is the only lane; only the turn can validate it |
| no | no | `logged_out` | the vendor's own definite no, with nothing else in sight — the one composition that refuses |

`worker_auth_rejected` is the refusal's name, one family with the ACP
lane's signed-out refusal, recorded per D0: a closed public roster
(`loop.RUN_REFUSAL_REASONS`), a constructor that requires the reason, a
session guard asserting constructed-equals-declared, and a taken-path test
through the command that owes it. Where a set key is part of the story the
message names the displacement instead of offering the key route again.

The codex probe is `codex login status` — measured on codex-cli 0.149.0:
exit 0 "Logged in using ChatGPT" / exit 1 "Not logged in", offline,
instant, and blind to env keys in both directions. `codex doctor` was
measured the same day and DISQUALIFIED: it reports auth satisfied on key
PRESENCE, and it opens sockets.

## §4 The capability stamp

Every shell recipe `docs/vendors.md` publishes is driven through a real
`wring run` in CI with a fake vendor binary standing in
(`tests/test_worker_contract.py`), and must show all three capabilities:
**brief received** (the fake banks its last argv and it must equal the
brief's text) · **repo editable** (the gate goes green on the fake's write)
· **terminates** (the loop converges, no timeout). The stamp measures
WRINGER'S side of the contract — measured mechanics, no vendor account.

**The real-vendor canary is a STOP.** Running the vendor's own binary as a
worker spends somebody's account; that is run 4's blind test, by hand, on a
clean machine — never CI's.

## §5 `worker_read_only`

A refinement of `no_progress`, chosen on facts the loop already owns: the
last turn exited 0, was not timed out, produced output, and left the tree
fingerprint byte-identical. The name states what the turn DID — it read
and it spoke — and claims nothing about why; the why is the worker's own
words, carried verbatim (`engine_words`, the stdout tail) in
`worker-diagnosis.json` (still `wringer.workerdiagnosis.v3`: every field
optional there, no schema spend) and quoted at the stop. A turn that
failed, timed out or stayed mute keeps `no_progress` — calling those
read-only would claim a shape the facts do not show.

## §6 What this spec does not do

- It does not validate that a recipe's write-policy flags work against the
  real vendor binary — run 4's canary, a STOP.
- It does not add a stdin brief transport, a `writes:` schema key, or a
  vendor-output parser (routing on a vendor's JSON would be text routing
  with extra steps — `diagnose.py`'s law binds here too).
- It does not contain `exec:` workers, probe validity of any key, or stop a
  run over `unknown`/`not_applicable` — Wringer's ignorance of a vendor
  never charges the operator.
- The shell turn-FAILED diagnosis (a `turn_failed` face for exit≠0 shell
  turns, e.g. run 3's 401 loop) is NOT built: the face enum in
  `wringer.workerdiagnosis.v3` is frozen and a v4 spend deserves its own
  slice. The 401-shaped ending keeps `no_progress` and its preflight now
  names the displacement before spend, which is where run 3's cost was.
