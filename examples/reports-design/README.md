# Reports — a design-aware blind-test target

This is a deliberately unfinished **target repository**, not another harness.
Copy this directory **from the Wringer source checkout** into a fresh repository.
The compiled distribution carries inert reference docs, not a runnable copy of
this target. Wringer runs outside it. The worker
may change `src/` only; the supplied design system, data, checks and approved
design snapshot are protected inputs. The checks are expected to fail initially.

[profile.yaml](profile.yaml) is a compile-only operator starter, with deliberately
unprovisioned source/image/agent placeholders. Use the exact original PM request
when proposing work; the starter is not a substitute for their words or approval.

Give the PM [REQUEST.md](REQUEST.md) and an authorized Figma frame or owned design
reference. Use the operator protocol in
[DESIGN_BLIND_TEST.md](../../docs/DESIGN_BLIND_TEST.md). Do not run this repository
on the controller host as part of a production Wringer job.

The existing library is `ui/components.ts` and `ui/tokens.css`. The local report
data is `data/reports.json`; there is no account, customer data or paid API here.
The target's contained browser image must provide Bun and Playwright 1.63.0 at
`/opt/wringer-design/node_modules/playwright`, with its installed Chromium.

Source references: [app](src/app.ts), [components](ui/components.ts),
[tokens](ui/tokens.css), [reports](data/reports.json), [entry page](index.html),
[browser](checks/browser.ts), [checks](checks/acceptance.ts), [capture](checks/show.ts).

Inside the sandbox:

```sh
bun checks/acceptance.ts
bun checks/show.ts
```

The first command executes functional checks, not a screenshot similarity claim.
The second writes fixed-size real Chromium screenshots to `.evidence/`. Those
images show the result, not proof of its quality. The PM/designer still decides.

Use the capture declarations in [reviews.json](reviews.json), source-bound to the
`design-review` human requirement. For owned PNGs, use `desktop` and `mobile`
reference ids. For MCP imports, use the actual ids printed by `design inspect`
instead; the design guide explains that mapping. The inputs and output PNGs are carried in the
handover. No live preview is served under Wringer's privileged controller origin.

This starter does not claim an external Figma connection or a passed blind run.
