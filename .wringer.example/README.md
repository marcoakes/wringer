# `.wringer.example/` — the committed evidence

`.wringer/` is gitignored: real runs stay on the machine that produced them,
and nothing uploads, ever. This directory is the exception — the bundles a
stranger can read without running anything, and the answer the README gives
to *"how do I know?"*.

| bundle | what produced it |
|---|---|
| `runs/20260730-231645-a57c/` | `wring verify` on this repo, v0.1.0 — the original demo bundle, predating `digests.json` |
| `graphs/20260809-132737-f2f9/` | **M3**: `wring graph run m3/graph.yaml` — intent → human approval → loop → router → deliver, the whole spine on one run |
| `loops/20260809-132737-762c/` | the `build` node's repair loop: two iterations, converged |
| `runs/20260809-132737-4355/` | that loop's first verify — **red**, the guard the change had to satisfy |
| `runs/20260809-133147-2c91/` | that loop's second verify — green, and what the delivery stands on |
| `deliveries/20260809-134416-59b1/` | `wring deliver`: the branch, the commit message, the patch and the MR body |

## Read verbatim, and unedited

These were copied out of `.wringer/` byte for byte. Two consequences worth
knowing before you read them:

- **Every `digests.json` still verifies**, which is the point of copying
  rather than curating. `tests/test_no_secret_in_any_bundle.py` re-checks all
  of them through `attest.check_digests` — the shipped verifier, not a
  lookalike — on every run of the suite.
- **They name the paths of the machine that wrote them.** The M3 delivery
  manifest records an absolute `run_dir` under a developer's home directory,
  because that is what `wring deliver` wrote. Editing it would have made the
  bundle disagree with its own digests, which is a worse artifact than a
  local path: evidence that fails its own integrity check teaches the wrong
  lesson. (Every other cross-bundle reference here is repo-relative; that one
  is not, and the inconsistency is real.)

The M3 chain is the one place in this repository where the graph, the loop,
the verify runs and the delivery can be followed end to end as one piece of
work. It is a README edit — deliberately small, and it does not demonstrate a
factory. `docs/factory-dry-run.md` is the honest measurement of that.
