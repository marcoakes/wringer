# FIELD REPORT — RUN 6 RE-RUN (spare Mac, 0.4.9), received 2026-08-27

*Dated note (Fable, 2026-08-27): pasted verbatim by Marc from email
(moakes@alpha-sense.com, 1:43 PM). The write-up is INCOMPLETE by its own
statement — it is waiting on Marc's answer to what
`claude-agent-acp --cli auth login` did on the spare Mac. Marc's covering
line in chat: "looks like we are going to have to run tests on this
machine as security setting stopping me from connecting the api to run
the key." Body below is verbatim.*

---

Where it stands
The build cannot run because the coding agent can't authenticate. Two routes, both now measured on your Mac today:

route result
your claude.ai org login (the only one your policy permits) session/new refused — "Unable to verify organization for the current authentication token… the token could not be validated"
your API key via env_passthrough session/new refused — "managed settings require a first-party login… A non-OAuth Anthropic credential cannot satisfy the org pin"
So your key is definitively not usable as the builder's credential here, and I've removed it from the config again — leaving it in makes things worse, because it also displaces your claude.ai login and takes precedence over it. Your key did its real job fine: it paid for reading your document and drafting the plan.

The blocker is your login, and the fix is yours. Which brings me to the thing I need: what actually happened when you tried claude-agent-acp --cli auth login? Did the browser open? An error? An SSO refusal? That's the route your employer mandates, and it failing is potentially the most important finding in this run — but I can't write it up from a guess.

Your four watch items
1. Logged-in shown before spending — ✅ FIXED. Quoted earlier, verbatim, before any money moved.

2. Never falsely says signed out — ✅ FIXED, and I proved it's the code not me. The config the drive wrote had zero env_passthrough entries, and 0.4.9's worker_env() now passes USER itself — omitting it rather than passing it empty when unset, which is a careful fix. I deliberately did not re-apply yesterday's workaround, so this was a real test.

One caveat for the write-up: when the build failed, the first thing it told me was "the most common cause is that the coding agent is not logged in." That's a hint, immediately qualified with "reaching this means the credential was accepted and then failed" — so it's honest. But it's the first sentence a non-engineer reads, and on your machine it points at the wrong cause. The real reason was in the worker log, one level down.

3. Example setup with no old clone — ⚠️ PARTLY FIXED. The contradiction is gone and there's now a clone command. But the path inside the clone is still wrong: it says ~/wringer-source/examples/pipeline; the examples are at ~/wringer-source/docs/drive/examples/pipeline. And this version is worse in one way — examples/ does exist at the root, just without your example in it, so you get a folder that looks right rather than a clean "no such directory". Same defect class, one step later. Your instinct in the sheet was exactly right.

4. Handover files disclose the unproved work — ✅ FIXED. Verified empirically on both files, not just in the code. mr.md now opens with:

There's exactly one renderer with two call sites — the MR body and the bundle summary — so they can't drift. And its docstring cites "Field report 2026-08-26, finding 3", your report from yesterday.

The judgement you asked for — would a cold reviewer understand it?
You said this is the most valuable thing in the run, so here it is properly. Partly. I'd know to be suspicious, but not enough to act.

What genuinely works: it sits above the green ticks, so you read the caveat before you're reassured. The sentence "Every gate passing means the change is mergeable. It does not mean the thing that was asked for was built" is the whole point in plain English. And it only appears when there's something to warn about, so it won't decay into boilerplate people skip.

Where I'd still be stuck, as someone who hadn't run it:

"Unevidenced" isn't a word I use. I'd infer it, but "6 of 8 requirements have no test proving them" would land faster.
It doesn't say which six. That's the big one. I'd know six things are unproven but not what, so I couldn't judge whether the gap is the core behaviour or a detail — and that's the entire decision I'm being asked to make. To find out I'd need the board, which the same file tells me "stays with the machine that ran it." I'm told there's a hole and told the map isn't coming.
"1 for a person to judge" doesn't say it was judged. You judged that criterion met, with a note. The MR doesn't show the verdict, the note, or who gave it. I'd assume it was still outstanding.
Nothing names the one proved criterion either. "1 evidenced" doesn't tell me which requirement is actually safe.
Net: the fix closes the honesty gap — a reviewer can no longer be misled into thinking green ticks mean the work was done. It doesn't yet close the usefulness gap. My suggestion for them is that the disclosure list the criteria by title with their state, or link a travelling copy of the board, so the reviewer can act on the warning rather than only receive it.

Tell me what the login did, and I'll finish the write-up — and if you can get the login working, the build itself is the only thing left to test.
