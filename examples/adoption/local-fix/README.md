# Local bug fix: the missing first value

This no-model exercise uses Node24 and Git. It is a small meaningful verification
example, not a live coding-agent or human-acceptance claim. Copy the inert files
into a new scratch repository (keep your original checkout untouched):

```sh
mkdir /absolute/new-total-example
cd /absolute/new-total-example
cp /absolute/wringer/examples/adoption/local-fix/total.mjs.txt total.mjs
cp /absolute/wringer/examples/adoption/local-fix/checks.test.mjs.txt checks.test.mjs
cp /absolute/wringer/examples/adoption/local-fix/config.json.txt .wringer.yaml
wring reporter node-test > node-reporter.mjs
printf '.wringer/\n' > .gitignore
git init -b main
git -c user.name='Example operator' -c user.email='example@example.invalid' -c core.hooksPath=/dev/null -c commit.gpgsign=false add .
git -c user.name='Example operator' -c user.email='example@example.invalid' -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m 'Explicit scratch baseline'
wring verify --strict --json
```

Expected: exit1; the multi-value and singleton assertions fail. Keep that evidence
path. Change only `values.slice(1).reduce` to `values.reduce`, then rerun. Expected:
exit0, three registered assertions, sealed source-bound evidence. An empty test
file or plain TAP without registration evidence must not establish proof.

Now use [START_AGENT](../../../docs/START_AGENT.md) to register this verification
workspace, propose the original request “Include every value in the total,” open
the review page and approve a finite check grant. A check-only project makes no
human-criterion claim. Add an actual reviewed human criterion/show declaration if
you need product acceptance; [visual example](../visual-change/README.md) shows it.

Changing `checks.test.mjs` invalidates a job's check grant. Changing `total.mjs`
after verification makes its evidence stale. Use `wring explain --json` to inspect
the failing run and `wring audit --set EVIDENCE_DIRECTORY --json` for a sealed set.
Delivery needs an explicit destination and separate Send; there is no public
origin in this example. The automated measurement also changes source after a
pass and observes staleness. Sanitized sample evidence: [sample](sample.json).
