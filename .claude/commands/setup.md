---
description: Preview the current Wringer workspace setup and scoped Claude Code connection
---

Use the canonical installed `wring setup --repo PATH --client claude-code
--dry-run --json` journey. Preserve the user's explicitly selected verification
or delegation mode. Read the measured preview and apply only the setup the user
selected. Setup grants no execution, acceptance or Send authority.

Use `wring connect --workspace ID --client claude-code --scope project` to preview
the named MCP entry and reusable workflow skill, then apply that exact preview
with `--apply --expected DIGEST`. Open the operator page with `wring job open`.
The shared workflow is in `integrations/wringer/SKILL.md` and installs as the
`wringer` skill. Follow its retained-job and human-decision boundaries.

Do not execute the historical SETUP.md as a competing onboarding script. Do not
retrieve keys, read login directories, alter global client permissions, invent
personal verdicts, or activate a privileged runtime without its actual allowance.
