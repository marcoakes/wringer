# Pipeline runs keep wasting everyone's time after something breaks

When one step of a pipeline fails, everything that was waiting on it runs
anyway. Support keeps forwarding us runs where a step fell over two minutes in
and the run carried on for another twenty, producing a wall of errors that all
trace back to the same thing. Somebody then has to sit down and work out by
hand which failures were real and which were just knock-on from the first one.
Two teams have told us they now ignore the summary entirely and go straight to
the logs, which rather defeats the point of having a summary.

What we want is for a run to stop pouring effort into work that cannot possibly
succeed. If a step fails, anything waiting on it — directly, or further down the
chain — should not be attempted at all. Steps that were not waiting on it should
carry on exactly as they do now; people rely on getting the rest of the results.

The summary is the other half of this. It should say plainly which steps were
not attempted, and for each one it should name the failure that caused it, so
that a person reading it can tell at a glance which single thing to go and fix.
When there is more than one failure in a run, each skipped step should point at
the one it was actually waiting on rather than at whichever failure happened
first.

The run itself should still finish tidily rather than fall over, and it should
still be obvious overall that the run did not succeed.
