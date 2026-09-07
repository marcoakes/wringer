# Stop wasting work after an import fails

Our small data pipeline keeps processing branches after an earlier import has
failed. Downstream steps can then print empty outputs as if useful work happened.
People reading the daily report waste time investigating these downstream steps
instead of fixing the original import.

The runner must not attempt a step if any of its prerequisites failed or was
skipped. This applies through the entire dependency chain. Work on unrelated
branches must continue. Successful pipelines must keep their existing output and
ordering.

Every skipped step must name all of the original failed steps that blocked it,
once each and in a stable order. Use alphabetical step-id order when more than
one original failure applies. A failure on another branch must not be blamed
just because it happened first.

The summary must distinguish steps that failed from steps that were never
attempted. It must name the underlying failures beside each skipped step and
report how many steps were actually attempted. The run must finish with an
unsuccessful overall result if any step failed or was skipped, without crashing.

A person reading the two displayed reports can quickly tell which original
imports need fixing, without treating a skipped downstream step as a new failure.
