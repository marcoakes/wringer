# Figma connection repair — implementation contract

Date: 2026-09-09. This is a new REST API lane, not a retroactive pass of the
frozen official-MCP blind test.

## Outcome

In a design-ready workspace, a PM can paste desktop/mobile frame links into
their coding app, connect their Figma account on the private PM page, inspect
the actual references, permit retention, attach the exact snapshot, and review
a new source-bound proposal. Execution approval, design judgement and sending
the handover remain separate decisions.

The existing contained worker/judge loop remains the execution layer. Wringer
does not write product code, run a second model loop or give workers a live
design account. Its MCP interface carries prepared requests and safe status.

## Work packages and acceptance

1. `@wringer/figma-connect`: registered-app OAuth broker, PKCE/state/one-time
   claims, expiry, refresh and disconnect. App secret stays on the broker;
   operator tokens stay outside repositories. Missing configuration is visible.
2. `@wringer/design`: selected-node REST reads and version-pinned PNG export;
   bounded HTTPS, no redirects or CDN credential forwarding, strict PNG checks,
   exact byte receipts and a new `design-snapshot.v2` contract. V1 stays readable.
3. Application/MCP/PM surface: prepare is inert; connect/preview/retention/attach
   are operator actions. Frame and snapshot identities bind every decision.
4. Repository attachment: add only the permitted data artifact using bare Git
   plumbing. Keep original remote, preserve old profiles and approvals, pin a
   future-proposal-only overlay and transport bundle. Never push at attachment.
5. Execution/handover compatibility: the new snapshot follows the same contained
   read-only reference, actual-output display, human hold and portable audit path.
6. Evidence: adversarial unit/integration tests, real-browser engineering probes,
   full native validation, build, publication to main and observed CI. Fixtures
   must be labelled; no fixture counts as live Figma access or a PM blind pass.

## Deliberately bounded first release

One file, one or two frame/layer links, `file_content:read`, static PNGs. An
operator must provision contained rendering and matching capture dimensions in
the design-ready profile. A link is not permission to publish. Consent to
retain references is not approval to build or a judgement that the result is
right. Changing the reference requires a new proposal and approval.

## External release gates

A real Figma OAuth app, registered HTTPS callback, deployed broker and eligible
account are prerequisites for live sign-in. A real authorised frame link and
the owner's explicit permission are prerequisites for retaining private design
bytes. Public-app distribution may require Figma review. None is manufactured
by tests or bypassed by reusing another application's tokens. Live sign-in,
render-host compatibility, account access and an independent PM blind test must
be measured separately after those prerequisites exist.
