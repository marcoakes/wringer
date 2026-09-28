# Reviewed acceptance preparation

New acceptance tests can be proposed as inert data, reviewed, and frozen into a
private Git snapshot. Preparation does not execute tests, install dependencies,
edit the user's checkout, push a branch, approve work, or call a model.

Create an input such as:

```json
{
  "schema_version": "wringer.acceptance-input.v1",
  "requirements": [
    { "id": "total", "title": "The total includes tax", "quote": "Include tax in the total" }
  ],
  "files": [
    {
      "path": "wringer-acceptance/total.test.mjs",
      "contents": "import {test} from 'node:test'; import {strictEqual} from 'node:assert'; import {total} from '../src/total.mjs'; test('includes tax', () => strictEqual(total(100, 0.2), 120));\n"
    }
  ],
  "checks": [
    {
      "id": "total-acceptance",
      "run": "node --test --test-reporter=./wringer-acceptance/node-reporter.mjs wringer-acceptance/total.test.mjs",
      "inputs": ["wringer-acceptance/total.test.mjs"],
      "requirements": ["total"],
      "adapter": "node-test"
    }
  ]
}
```

Inspect the actual complete file contents, requirement words, command and source:

```sh
wring setup --repo /absolute/project --prepare-acceptance /absolute/acceptance.json --dry-run --json
```

Apply the exact displayed identity with an explicitly recorded actor:

```sh
wring setup --repo /absolute/project --prepare-acceptance /absolute/acceptance.json --apply --expected DISPLAYED_IDENTITY --actor 'YOUR NAME'
```

Select the returned ID with `--acceptance ID` in contained `wring setup`, together
with explicit providers, models, provision, dependencies, network and local
source selections. The standard setup preview then shows the resulting frozen
profile. Work approval remains a later operator-page decision.

Only new files under `wringer-acceptance/` are supported. Existing files are never
replaced. New check IDs may supplement existing checks; an existing check ID must
have exactly the same definition. All prepared files and their parents remain
protected from worker writes. The original checkout must stay clean at the same
base commit. A changed baseline needs fresh acceptance preparation. This route
uses a local bundle, including for a repository with a remote destination.

Node, Vitest and Playwright stdout reports are translated using the shared
assertion rules. Node requires the displayed protected reporter because plain
TAP treats an empty file as a passing test. The measured Node 24.19.0 event stream
is retained in `evidence/m3/node-reporter-events.jsonl`; per-file summaries are
documented in the [Node test reporter API](https://nodejs.org/api/test.html).
Test registration does not establish the honesty or sufficiency of assertions.
The workflow still needs the protected failing baseline and matching successful
candidate. Playwright separately probes Chromium launch before product checks.
File-based reporters currently refuse because their freshness is not measured;
select a stdout reporter explicitly. No adapter silently reduces assertion
evidence to a successful command exit.

The adapter bundle is generated from `runtime/assertion-adapter.ts` and the shared
engine/record rules by `bun scripts/generate-assertion-adapter.ts`. Distribution
builds compare it to source before compiling. Runtime tests here are real local
scratch-runner measurements; they do not establish containment or model work.

Interrupted source preparation retains its lock, bundle and checkout for explicit
inspection. Automatic resumption of a partly created acceptance snapshot remains
part of lifecycle recovery work; no failed preparation is described as complete.
