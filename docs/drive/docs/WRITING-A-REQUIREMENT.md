# Writing a requirement Wringer can do something with

**This is the highest-leverage page here.** A vague document produces a
confident specification for the wrong thing, and every check that follows will
prove that wrong thing perfectly.

The good news is that it is ordinary product writing. You are not learning a
format.

---

## The four rules

**1. Write prose.** Paragraphs, in your own voice, the way you would explain it
to a colleague who was about to build it. No bullet lists of acceptance
criteria, no tables, no YAML. The model turns your prose into criteria — that
is its job, and it does it better from prose than from your attempt at
criteria.

**2. Name no files, functions or modules.** If you write `update
report.py`, you have made an engineering decision you probably should not be
making, and you have narrowed the work to whatever you happened to know about.
Say what should be *true* afterwards, not where the code goes.

**3. Ask for one thing.** One requirement per document. Two unrelated asks
produce a specification that is confused about both, and you cannot approve
half a plan.

**4. Say what "done" looks like from a person's point of view.** Not "the
function returns a sorted list" — *"when I come back tomorrow, the games I
actually played are at the top"*. That sentence is what a criterion gets
written from.

---

## The template

```markdown
# <the problem, as a headline a colleague would recognise>

<What happens today, and why it is a problem. Be specific and concrete —
who complains, what it costs, what they do instead. Two or three sentences
of real detail beat a paragraph of "users want a better experience".>

<What you want instead. Describe the behaviour, not the implementation.
"When X happens, Y should be true." Cover the main case properly.>

<The edges you have already thought about, and the decisions you have
already made. This is where you pre-empt the questions — every one you
answer here is one you will not be asked later.>

<Anything that must NOT change or break. This is often the most valuable
paragraph and the one people forget.>
```

Four paragraphs is a good length. Both worked examples below are four
paragraphs.

---

## Two real ones

Neither is written for this page. Both were driven through a real model and
produced good specifications, so they are evidence.

### [`examples/pipeline/PRD.md`](../examples/pipeline/PRD.md)

Opens with the complaint, in concrete terms:

> When one step of a pipeline fails, everything that was waiting on it runs
> anyway. Support keeps forwarding us runs where a step fell over two minutes
> in and the run carried on for another twenty, producing a wall of errors that
> all trace back to the same thing.

Note what it does *not* say: no module names, no function names, no mention of
the graph structure it obviously implies. It produced ten acceptance criteria
and three tasks, and the run ended **DONE — AND PROVED**.

### [`examples/arcade/PRD.md`](../examples/arcade/PRD.md)

Same shape, and its third paragraph is the one to copy:

> A few things we've already decided, because we got them wrong on paper
> first. Playing something again should move it back to the front rather than
> listing it twice. Only the last handful should show — three feels right; a
> long list is just the grid again. And it has to survive closing the tab.

Three decisions, pre-empted, in a PM's voice. Each one is a question the model
would otherwise have asked.

Its last paragraph is rule 4 doing real work:

> The one thing I really don't want is for this to be able to break the
> cabinet. […] A shortcut that can take the arcade down is worse than no
> shortcut.

---

## What happens to your document

It goes to a model, which drafts a specification: acceptance criteria, tasks,
and a set of questions it could not answer from what you wrote. **You answer
those questions** — they are product questions and you are the only person who
can. Then you are shown the plan in plain language and asked whether it is what
you meant.

**Nothing is built until you say yes**, and there is no flag that answers that
for you.

---

## The one thing that will surprise you

Some of your requirements will come back saying **NOTHING CHECKS THIS YET**.

That is not a failure to understand you. It means the repository contains no
check that could decide whether that requirement was met, so it will be built
but not *proved*, and Wringer will say so rather than counting it as done.

You will get more of these than you expect. It is the honest state of most
codebases, and seeing which of your requirements land there is genuinely useful
information about the repository you are working with.

The fix is not in your document. It is a check that exists before the work
starts — see step 3 of [START-HERE](../START-HERE.md).
