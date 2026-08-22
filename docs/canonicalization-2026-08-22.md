# Command canonicalization — measured, and REFUSED

*The Codex teardown banked `command_canonicalization.rs` as a steal (§5.6):
parse argv, collapse wrapper differences, and use the result for approval
identity. This is the measurement that decided whether Wringer takes it. **It
does not.** Nothing shipped, and this page is why, so that a later window
rebuilding it has to answer this first.*

## What was being decided

`spec.same_command` compares a DRAFTED gate proposal against the gates already
in `.wringer.yaml`, to tell a genuine conflict from a proposal that was already
applied. It compares whitespace-normalised strings and nothing else, under a
recorded ruling: *"Whitespace only. Nothing cleverer should be attempted."*

The two ways to be wrong are not symmetric:

- **False NO** — says two identical commands differ. A duplicate gate gets
  installed. Friction.
- **False YES** — says two different commands are the same. The proposal is
  treated as already applied and is **not installed**, so the criterion stays
  bound to a check the person never approved while the plan they approved said
  otherwise. **That is consent damage**, and it is silent.

So the bar for collapsing any pair was set at proof, not plausibility.

## The method

Any canonicalizer written in Python is built on `shlex`. Gates run through
`subprocess(..., shell=True)` (`gates.py`), which on this platform is
`/bin/sh -c`. So the question is not "is `shlex` reasonable" but **"does
`shlex` agree with the shell that will actually run this"**.

One executable named `probe-argv` on PATH prints its own argv. Every candidate
string goes through `/bin/sh -c` and through `shlex.split`, and the results are
compared.

Machine: macOS, `/bin/sh` = GNU bash 3.2.57 in sh mode, arm64-apple-darwin25.

> **The probe's own first version was wrong, and it is recorded here rather
> than quietly fixed.** It substituted a two-word Python invocation into the
> shell lane and a one-word placeholder into the `shlex` lane, so the two lanes
> were answering questions about different strings. That made *quoting the
> program name* look like a decisive disagreement, and it is not one — `'x' -q`
> and `x -q` are the same to both. A first draft of this page and of
> `same_command`'s docstring carried that false finding for about ten minutes.
> It was caught by a guard asserting the platform behaviour the claim rested
> on, which failed. **The conclusion below survived the correction; the reason
> for it did not, and the reason is the part that matters.**

## The result

Fifteen pairs. Five agree, six disagree in the SAFE direction, and **four
disagree in the direction that does damage.**

| pair | `/bin/sh` | `shlex` | |
|---|---|---|---|
| `x -q` vs `x  -q` | same | same | agree |
| `x -q` vs `x "-q"` | same | same | agree |
| `x -q` vs `x '-q'` | same | same | agree |
| `x -q` vs `'x' -q` | same | same | agree |
| `x a\ b` vs `x "a b"` | same | same | agree |
| `x "*"` vs `x '*'` | same | same | agree |
| `x -q` vs `x -q;` | same | not same | safe |
| `x -q` vs `x -q $NOPE` | same | not same | safe |
| `x ~/f` vs `x $HOME/f` | same | not same | safe |
| `x 'a'` vs `x $'a'` | same | not same | safe |
| `x -q` vs `sh -c 'x -q'` | same | not same | safe |
| **`x "$HOME"` vs `x '$HOME'`** | **NOT same** | **same** | **UNSAFE** |
| **`x "\$HOME"` vs `x '\$HOME'`** | **NOT same** | **same** | **UNSAFE** |
| **`x "$(echo hi)"` vs `x '$(echo hi)'`** | **NOT same** | **same** | **UNSAFE** |
| **``x "`echo hi`"`` vs ``x '`echo hi`'``** | **NOT same** | **same** | **UNSAFE** |

**One cause under all four: `shlex` strips both quote characters identically,
and the shell does not.** Single quotes suppress expansion; double quotes do
not. Verbatim:

```
--- expansion inside double vs single quotes
    'probe-argv "$HOME"'       -> sh ['/Users/marc']   shlex ['probe-argv', '$HOME']
    "probe-argv '$HOME'"       -> sh ['$HOME']         shlex ['probe-argv', '$HOME']
    same under sh: False   same under shlex: True   *** DISAGREE ***
```

In config terms: `pytest --cov="$PKG"` and `pytest --cov='$PKG'` run different
checks and are the same string to any `shlex`-based canonicalizer. A gate
command carrying an environment variable is not exotic.

## The decision

**Nothing ships.** The recorded ruling stands, now with a measurement behind it
instead of a judgement, and `spec.same_command`'s docstring carries the
amendment in its own words rather than around it.

The five agreeing pairs are not worth taking on their own. Quoting a flag is
not something real configs do, and each sits one character away from a case
that is wrong — a canonicalizer built from special cases fails on the case
nobody enumerated.

**What would change this.** Not a better `shlex`. Canonicalization becomes
takeable when gate identity is compared on the argv the shell ACTUALLY
produced — recorded at execution time, records compared rather than strings.
That is a real design, it is not this slice, and it is OWED rather than
improvised.

## The guard

`tests/test_spec.py::test_canonicalization_is_REFUSED_on_a_measured_false_yes`
pins one of the four false-YES pairs, and re-takes the platform measurement it
rests on rather than trusting this page. A later window that rebuilds
canonicalization has to make that test pass with a real fix, not delete it.

Reproduce: `python3 scripts/canonicalization-probe.py`.
