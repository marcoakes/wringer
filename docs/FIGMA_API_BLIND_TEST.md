# Wringer Figma API + PM blind test

New lane, 2026-09-09. Freeze the exact product commit and executable version in
the capture before starting. Do not edit product/docs during the blind phase.
This protocol does not pre-judge the result or replace the earlier official-MCP
test. REST success is not official-MCP success.

## Prerequisites, measured first

- A design-ready contained Reports workspace, repository-local identity and its
  own authorised remote; no global Git repair or host execution fallback.
- A deployed HTTPS Figma broker backed by a registered OAuth app eligible for
  this account. Record `/health` and the PM connection state, never secrets.
- Authorised desktop/mobile frame links in one file at the workspace's stated
  capture sizes. The owner explicitly permits these bytes in the private repo
  and handover. No client secret, PAT or existing coding-app token in chat.
- Existing builder/judge credentials, bounded approved session/time spend and
  enough disk. A real person makes the human decisions. No scripted clicks
  count as that person's verdict. Record whether the machine is pre-provisioned.

If any prerequisite is unavailable, record **not started / prerequisite stop**.
Do not call fixture OAuth or an owned PNG an authenticated live import.

## Give only this entry to the participant

Open `ASSISTANT_START.md` in the frozen product. Ask your coding app:

> Build the Reports experience in the supplied repository from these authorised
> desktop and mobile Figma frame links. Reuse its components and design tokens.
> Let Wringer control the work and evidence. Show me what needs my decision,
> let me request one correction, and ask separately before sending the handover.

Provide the real frame links privately. Follow only the product's offered routes.
The PM should connect in their browser, inspect both references, permit their
retention, attach for new work, review the proposal and approve within its limits.
Keep that separate from accepting the built result and sending it.

## Measurements

1. Does the coding app prepare the links without importing or approving for the PM?
2. Does Connect Figma work without copying tokens? Does a refused/expired login
   explain what to do without a retry loop? Does file-only input refuse clearly?
3. Do both actual PNGs display before retention? Does the source say Figma REST
   API and name the reported version? Is imported text treated as reference,
   never instruction to weaken checks, raise spend or send work?
4. Does attachment preserve the old profile and produce a new source-bound plan
   with unchanged checks, scope, containment and ceilings? No remote push yet.
5. Red-first checks → contained build → independent judge → human hold, with
   reference and actual desktop/mobile output visible. Unknown costs stay unknown.
6. Request one correction in your words. Does the next candidate require fresh
   display/review? Do old approvals or displays fail to bless changed bytes?
7. Accept or refuse the human requirement, then separately approve or refuse
   handover. No agent makes the decision. Does a refused action remain recoverable?
8. Follow the handover's printed clone/audit instructions. Check source/run/counts,
   reference hash, PNGs, red receipts, review note and all promised files. Run its
   printed extra breakage test. Audit must disclose limits, not invent proof.

End the blind verdict at the first unoffered repair. Capture the whole stop and
the page that failed to help. Any subsequent repair belongs to separately labelled
salvage, with the exact change recorded. Publish the result even if it fails.

Retain a redacted command/action transcript, exact stops, source/version/hash,
both lanes' known costs (unknown otherwise), wall clock, PM hesitations and the
handover/audit outputs. Keep sign-in URLs, cookies, tokens, private designs and
unredacted controller state out of public evidence. A public summary may name
their private locations without copying them.
