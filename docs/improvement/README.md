# Improving how agents work on your repository

Wringer can help find a better way of working for one kind of task in one repository,
and test it before anything changes. This is the whole route for an operator, from
an ordinary job to a tested playbook, in ten steps. Every step that may spend asks
for its own finite allowance and `--yes`. Nothing adopts itself: the last word
belongs to a registered comparison and to you.

Before you start you need a job that has run once, and a task family name for this
kind of work (here `reports`).

1. **Connect** the job's future improvements. This creates private storage; it
   grants nothing.

   ```sh
   wring experiment connect --job JOB --task-family reports
   ```

2. **Register a replicate set**: the job's approved plan, run k times (default 3).

   ```sh
   wring experiment replicate register --job JOB --task-family reports --replicate-set first --k 3
   ```

3. **Grant and collect** it. All attempts are reserved first, and every outcome is
   kept.

   ```sh
   wring experiment replicate grant --job JOB --replicate-set first --actor NAME --expires ISO_TIME --output grant.json
   wring experiment replicate collect --job JOB --replicate-set first --grant grant.json --yes
   ```

4. **Build the proposer's evidence**: what each attempt did, line by line, where the
   attempts disagreed, today's playbook and the lessons so far. Every held-out task
   of your registered comparisons is fenced out.

   ```sh
   wring experiment evidence --job JOB --replicate-set first --proposal p1
   ```

5. **Propose**: one separately granted session reads that evidence in its clone and
   writes a playbook tree, citing the moment behind every change, or `KEEP_BASE`.

   ```sh
   wring experiment prepare-proposal --job JOB --proposal p1 --input PROPOSAL_GRANT.json --output proposal-request.json
   wring experiment propose --job JOB --proposal p1 --request proposal-request.json --yes
   ```

6. **Review and commit** the proposal in a checkout of the repository.

   ```sh
   wring experiment export-proposal --job JOB --proposal p1 --into CHECKOUT
   git -C CHECKOUT add wringer/playbooks && git -C CHECKOUT commit -m "Proposed playbook, for comparison"
   ```

7. **Select it exactly**: the version 6 selection, and the paths the baseline arm
   must protect too.

   ```sh
   wring experiment select-tree --source CHECKOUT --manifest wringer/playbooks/ID/manifest.json
   ```

8. **Register the comparison** before any trial: both arms are version 6 plans at that
   commit, identical except the playbook, with held-out tasks the proposer never saw.

   ```sh
   wring experiment register --job JOB --experiment try-p1 --input COMPARISON.json
   ```

9. **Grant and collect** the comparison, under its own allowance.

   ```sh
   wring experiment grant --job JOB --experiment try-p1 --actor NAME --expires ISO_TIME --output grant.json
   wring experiment collect --job JOB --experiment try-p1 --grant grant.json --yes
   ```

10. **Evaluate**. A decided comparison with every trial recorded writes a lesson that
    the next proposal reads. Only an eligible result can be promoted, for future
    work only, and it can be undone.

    ```sh
    wring experiment evaluate --job JOB --experiment try-p1
    ```

The job page's *Optional · improve future work* card, and `wringer.inspect_improvements`
for a coding app, show the replicate sets and where they disagreed, each proposal
with the lines it cites, and the lessons so far. Reading them costs nothing and
decides nothing.

What is and is not established today: [capability ledger](../CAPABILITY_LEDGER.md).
Every mechanism on this page is fixture-tested; no live proposer has run and no
improvement is claimed. The registered live test is
[pilot amendment 1](../qualification/PILOT_AMENDMENT_1.md).

Details: [replicate sets](../native/REPLICATES.md) ·
[proposals and playbook trees](../native/PROPOSALS.md) ·
[comparisons](../native/EXPERIMENTS.md) · [loop trajectories](../native/LOOP_INSPECTION.md)
