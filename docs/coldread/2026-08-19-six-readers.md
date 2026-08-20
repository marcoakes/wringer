# Six strangers read the board (2026-08-19)

`README.md` has carried this sentence: *"no stranger has read a board it
produced, so it is named here rather than linked and no claim is made about
how usable a product manager finds it."*

**Six have now. The board did not survive it.** This file is the record.

## What was run

Six readers, each given ONE file — `docs/coldread/board-2026-08-19.html`, a
real page from a real run — and nothing else. No documentation, no context,
no explanation of the tool, and an instruction not to go looking for any.
Each was asked, in their own voice: what is this page telling you, is the work
finished, what would you do next, and what could you not understand.

**The honest ceiling on this evidence: these are MODELS PROMPTED AS PEOPLE,
not people.** They cannot be tired, they do not have a stake in the answer,
and they read more carefully than a person skimming before a meeting. So this
is a lower bound on the confusion a real reader would have, not a measurement
of it. `docs/coldread/PROTOCOL.md` is the sheet for running it with humans,
and that is still owed.

## The verdict

| question | answer |
|---|---|
| Is the work finished? | **nobody said yes** — 3 "partly", 3 "not finished" |
| Confidence in their own reading | low to medium |

Six readers, one page, and not one of them could tell whether the thing was
done.

## The finding that matters most

The page prints **eight named failing checks**:

```
✖ the cabinet remembers a game it launched
✖ the most recently played comes first
✖ at most three are shown, and they are the three most recent
✖ it survives closing the page — the same store gives the same answer
...
```

and, on the same screen, **eight requirement cards saying "Nothing checks this
yet, so nobody can prove it either way"** — whose wording matches those checks
almost word for word.

The product manager reader:

> *"Those two statements cannot both be true. Either the checks exist and this
> page hasn't been told which requirement they belong to, or the checks don't
> cover what their names say. That is not a small formatting nit — it's the
> difference between 'we verified 1 of 10' and 'we verified 9 of 10', and I
> can't tell which from the page."*

**Both statements are in fact true.** Those eight assertions are the
acceptance check's own sub-tests, captured red before the work; the eight
criteria are unbound because that check was never *installed* against them. So
the page is accurate and arranged so that a careful reader concludes it is
lying to them — which is the exact failure this surface exists to prevent, on
the surface built to prevent it.

## What else they could not read

Every reader hit the same small set:

- **"DONE — AND PROVED" sits directly above `pass 0 / fail 8`.** The only
  evidence on the page is a total-failure log. The passing run is never shown.
  *"My eye says total failure; the label says proved."*
- **The green promise box reads as a guarantee about the whole page** and is
  true of one row in ten.
- **The count line — "1 done and proved · 1 holding up the handover" —
  silently omits the other eight.** *"Reading only the count line, I'd think 8
  of 10 were fine."*
- **"Which check should decide this requirement?" is asked eight times** of a
  reader who has no list of checks, no idea what one is, and nowhere to write
  an answer. It is the most-repeated question on the page and none of it is
  actionable.
- **The most important sentence is inside a collapsed box**: *"Nothing here
  catches a change that satisfies the criterion and is still wrong."* It
  contradicts the tone of the green banner above it.
- **Raw internals leak into a page written for a non-engineer**:
  `demonstrated_able_to_fail`, `null`, `wringer.acceptance.v3`, "the two
  trees", "the pin", "tamper-evident", `run.containment`.
- **A rendering bug**: the intent paragraph shows a literal `# ` and literal
  `*asterisks*` — the PRD's markdown is not being rendered.
- **No date, no author, no link to the thing being described.** *"I was handed
  a status report with no way to check anything on it."*

## The jargon they had to guess at


`NEEDS YOU (as a formal state)`, `NEEDS YOU — a state meaning a person must act, though the two flavours of it (no check bound vs. human-only judgement) are shown identically.`, `NEEDS YOU — a state, but it means two different things on this page (see confusing).`, `Refused (as a formal state, distinct from NEEDS YOU)`, `Wringer`, `Wringer / wring`, `Wringer — appears once, in "Wringer's own words". I take it to be the tool that produced this page. Never introduced.`, `Wringer — the name appears once, near the bottom, in "Wringer's own words". Never introduced. I assume it's the tool that made the page but nothing says so.`, `acceptance record`, `acceptance record / wringer.acceptance.v3`, `binding / "the bound gate"`, `binding / 'the gate-to-criterion binding is a human's declaration' — no idea. Someone linked a test to a requirement, maybe?`, `binding / bound — connecting a check to a requirement, I'm guessing from context`, `bound / binding — attaching a check to a requirement, declared by a human.`, `bound gate`, `cabinet — this one I could work out, it's their word for the arcade page, and the brief uses it naturally enough that it lands`, `cancel`, `cause`, `cause / reason — described as machine-handle vs prose. Neither appears on any card.`, `cause vs reason`, `check`, `check — I think it means an automated test, but the page also uses it in a way that might mean something narrower, like a specific named test case someone has to pick`, `coverage`, `coverage narrowing`, `criterion (vs 'requirement' — used as if interchangeable, never reconciled)`, `criterion / criteria`, `criterion / criteria — I think this just means 'requirement', but then why does the page use both words?`, `criterion — I guessed this is the same thing as "requirement", but then why two words? If they are different I have no idea how.`, `criterion — I think this means what the cards call a requirement, but then two words exist for one thing`, `criterion — appears to be their word for a single requirement/row on this board.`, `delivery`, `demonstrated_able_to_fail`, `demonstrated_able_to_fail (and its false / null meanings)`, `demonstrated_able_to_fail / cause — field names from some machine-readable record I have not been shown.`, `demonstrated_able_to_fail — a field name, with a whole paragraph about true/false/null. I never see this field anywhere on the page, so I can't connect the explanation to anything.`, `demonstrated_able_to_fail, cause, null, false — raw code-looking terms in a paragraph aimed at me.`, `evidenced`, `evidenced / unevidenced — appears to be the page's word for 'proved', but it's used as a technical term with its own definition.`, `evidenced — a state stronger than passing: passed AND previously seen failing.`, `evidenced — apparently the good state, but it isn't the word used on any card (the cards say 'DONE — AND PROVED')`


That is the vocabulary of the tool, on the page whose entire purpose is to be
readable by someone who has never been taught it.

## What each reader would do next


**pm** — *partly* (confidence: low)

> 1. Ask the person who handed me this the one question that decides
> everything: the failure printout on this page lists eight checks with
> names that are almost word-for-word eight of my requirements — "at most
> three are shown", "it survives closing the page", "a game that is no
> longer in the cabinet is quietly dropped", "rubbish in the store does not
> take the cabinet down". Yet those same eight requirements each say
> "Nothing checks this yet, so nobody can prove it either way." Those two
> statements cannot both be true. Either the checks exist and this page
> hasn't been told which requirement they belong to, or the checks don't
> cover what their names say. That is not a small formatting nit — it's the
> difference between "we verified 1 of 10" and "we verified 9 of 10", and I
> can't tell which from the page.

**founder** — *not finished* (confidence: medium)

> Go back to whoever handed me this with five questions, and not pay the
> next invoice until I have answers:

**designer** — *partly* (confidence: medium)

> Two things, in order.

**newdev** — *not finished* (confidence: high)

> 1. Find whoever produced this and ask the one question the page cannot
> answer: does the feature actually work? Everything here is about checks,
> nothing about behaviour.

**manager** — *partly* (confidence: medium)

> First, answer the one question only a person can answer — go and look at
> the heading on the actual page and say yes or no. It is blocking the
> handover and it costs a minute; the fact that it has sat unanswered tells
> me nobody has been driving this. Second, chase the contradiction: get the
> repo, the commit, and both runs — the failing one shown here and the
> passing one claimed at the top — because right now the only evidence on
> this page is of total failure and I will not report "done" on that. Third,
> take the eight tests printed here and bind them to the eight requirements
> that say nothing checks them; if that binding is a human declaration, as
> the small print says, then it is exactly the sort of thing the departing
> person did not finish, and it converts most of this board from unknown to
> answered without writing any new code. Fourth, I want the two requirements
> that have no matching test at all — "the full set of games still appears
> underneath, unchanged" and "a first-time visitor sees no empty shortcut
> section" — written as checks, since the whole stated fear in the brief was
> that this shortcut could take the arcade down. Fifth, I want someone to
> sit with me for twenty minutes and explain the vocabulary — gate, witness,
> pin, containment, loop — because I am being asked to make a shipping
> decision on a page whose disclaimers I cannot fully read. And I'd file the
> "#" in the intro and the truncated test output as small bugs in whatever
> generates this page.

**skeptic** — *not finished* (confidence: high)

> First I would resolve the contradiction at the centre of the page: get
> whoever produced it to show me the passing run for the one DONE
> requirement, or take the DONE badge off. Right now the only evidence
> displayed is a total failure under a green label, and that single fact
> undermines everything else the page is trying to establish.


## What this does NOT say

It does not say the board is wrong. Every sentence on it that these readers
challenged turned out to be true. It says the page can be read carefully by a
motivated reader and leave them unable to answer the one question it exists to
answer.

It does not say what a human would do. See the ceiling above.

And it does not fix anything: this file is the measurement. The fixes are
separate, and each one should be able to point at a line in here.

---

*Commit note: `56aa6eb` carries this record AND, unrelated to it, this
package's first release workflow plus its `__version__`. That was a
`git add -A` sweeping up staged work, and the message describes only half of
what landed. Recorded here rather than rewritten, because the history is
already pushed and a dated note is how this programme corrects a record.*
