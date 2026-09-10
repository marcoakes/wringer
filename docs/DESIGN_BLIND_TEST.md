# Design + PM blind test — frozen candidate required

Status: protocol prepared; **not run and not passed**. Freeze the candidate commit
and compiled binary before starting. Do not improve code or docs during the blind
phase. Use a new target repo/controller and keep previous failed runs unchanged.

## Operator preparation (not the PM test)

Record the candidate commit, Wringer/Bun/runtime versions, selected coding app,
worker/judge, provisioned browser image's inspected digest, machine condition,
existing credential state and exact entry page. Never record secret values.
State whether cooperative-local was deliberately selected and its limits.

Use [the Reports starter](../examples/reports-design/README.md) in a fresh repo
with repo-local Git identity and its own new local bare `origin.git`. No global
Git config or forge account is required. Keep the source, approval controller
and audit clone separate. The PM does not need to prepare any of this plumbing.

Choose **one source lane before starting** and never switch it silently:

1. Live Figma: the designer owns an eligible accessible file/node containing the
   desktop/mobile reference. Use only the product's documented read recipe.
   Capture access failure verbatim. An owned export after that stop is salvage,
   not a passed Figma test.
2. Owned-reference: the designer supplies their own desktop/mobile PNGs and
   component rules. Record honestly that no live Figma integration is measured.

Obtain permission to retain the exact design bytes in the repo/delivery. Follow
[the design entry page](native/DESIGN.md) to import, inspect, commit and bind the
design to a matching bounded profile. Record every page touched and all stops.
For Figma use the actual returned asset ids, never assumed `desktop`/`mobile` ids.
Keep the new operator profile in an existing operator-owned private folder (0700)
outside every Git working tree and pass its absolute output path to `design bind`.
The permitted snapshot belongs in the target repo; the operator profile does not.
With no forge account, prepare that bound profile against the local checkout with
`prepare --local` (see the [assistant entry page](../ASSISTANT_START.md)), keep
its bundle and record beside it, and pass it to `setup` and `init`. The local
lane is a route, proven end to end by the `local-design-rehearsal` validation
stage with scripted roles and decisions; a PM pass on it is still to be observed.
The assistant lane proposes from the profile and runs no planner turn; planning
lives in `wringer-drive`'s intake and is guarded by the scripted-planner test.

The designer should keep the expected result out of worker-writable files. Give
the worker the approved design snapshot and the existing component library,
not a finished implementation. Prove the supplied functional checks fail on the
unfinished starter. Provision the runtime and keys once; do not re-add keys.

## Give the participant only this

The installed product's [assistant entry page](../ASSISTANT_START.md), the target
repo handle, the prepared design-aware workspace, and
[the original Reports request](../examples/reports-design/REQUEST.md).

Ask a non-engineering PM or designer who did not implement the feature to operate
it through their usual coding app. Their task:

> Build this Reports workspace using the approved design and existing components.
> Show me the result. I will ask for one correction, judge the design, and decide
> whether to send it. I want a handover that another reviewer can audit.

Do not coach them through UI controls. The builder assistant may use only the
product's pages and offered routes. It may not make the participant's aesthetic
decision or publication decision. If it reaches a stop, capture the stop whole.

## Observe this complete story

- Can the participant tell what design, requirements and limits they approve?
- Do checks fail before work and pass after a contained worker's change?
- Can the independent judge see the same pinned design without shared sessions?
- Does one page show reference versus actual desktop/mobile output, with no
  terminal/file/token hunt required from the PM?
- Does review remain blocked if showing or an image load fails?
- Can the participant request a meaningful visual correction in their own words?
  Does it keep the earlier record and invalidate stale Yes/display evidence?
- Can they say Yes to the changed result and separately Send to the named branch?
- Do the certificate, board, summary and MR agree about the actual candidate,
  checks and authored note? Unknown costs must remain unknown.
- From a fresh clone of the new origin's delivered branch, does the exact audit
  command in `mr.md` resolve all carried claims, including the design and PNGs?

Negative probes belong to a separate labelled adversarial appendix, not the
participant's happy path: change an image, remove a reference, substitute a design
digest, replay an old display, revoke page access, or request a design write.
The original delivery is kept untouched; perform mutations only in new audit
copies. Report whether each refused and why. Never turn a missing runtime into
a passed visual test or an unavailable provider cost into zero.

## Stop rule and report

The blind verdict ends at the first undocumented repair. Capture the complete
command/page/output and explain where the public trail failed. Continuing is
allowed only as explicitly labelled salvage with every repair logged verbatim.
A participant choosing an offered route is not hand repair.

Record approval-to-review time, correction-to-review time, total wall clock,
human steps and hesitations, exact page URLs without private tokens, role turn
counts, per-lane measured or unknown costs, screenshots, notes, receipts and
the fresh-clone audit transcript. Separate engineering fixture evidence, actual
containment, actual Figma access and real human observations in the final verdict.

Passing means the participant completed the story uncoached, using the frozen
product. A successful scripted browser rehearsal is not this result.
