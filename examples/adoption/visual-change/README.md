# Optional visual change: review the actual range page

This verification example needs Node24 and a browser you control. Copy
[page.html.txt](page.html.txt) to `page.html`, [show.mjs.txt](show.mjs.txt) to
`show.mjs`, [config.json.txt](config.json.txt) to `.wringer.yaml` and
[spec.json.txt](spec.json.txt) to `wringer.spec.yaml` in a new scratch repository.
Create its initial commit explicitly. The spec is labelled unapproved: review it
and change `approved` to true only as your actual decision, then propose a finite
verification job using [START_AGENT](../../../docs/START_AGENT.md).

The check validates the sample content; it does not establish visual quality.
The declared show command reports exact HTML, while you independently open the
local `page.html` in a browser to inspect the actual layout at desktop and mobile
sizes. The Wringer page does not embed executable repository HTML in its operator
origin. Keep its textual display beside your visual observation.

Ask your coding assistant for a specific visual change (for example, a larger
review button) before approval. Review the changed file at 1360px and 390px,
request a correction once, rerun the granted checks/display, and record your own
acceptance. Send remains a separate exact destination decision. No public remote
is configured by this example.

Expected unsuccessful paths: remove `show.mjs` or replace its command with a
failure; acceptance stays disabled. Change the source after a display; that display
cannot accept the new candidate. A missing visual observation must never be called
a visual pass. For pinned reference PNGs and contained captures use the existing
[design workflow](../../reports-design/README.md); it needs separately provisioned
browser/runtime assets. [Sanitized example evidence](sample.json) is labelled
synthetic, not a person's review or a live design run.
