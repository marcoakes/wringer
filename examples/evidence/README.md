# Evidence another machine can read

An existing contained delivery already carries `manifest.json`, `digests.json`,
`summary.md`, a Git candidate bundle, the approved plan and portable observations.
Newer versions also carry loop/playbook evidence. Its exact inventory and meaning
are fixed by its version; export does not upgrade old evidence.

From a fresh clone of a delivered branch, use the delivery path recorded in its
handover instructions:

```sh
wring bundle export --bundle .wringer/deliveries/DELIVERY_ID --output /existing/parent/new-export
node /existing/parent/new-export/read-bundle.mjs /existing/parent/new-export
wring bundle inspect --bundle /existing/parent/new-export
```

Replace the ID and destination with real values. The destination must be new and
its parent must exist. Export first audits the source, copies only its portable
payload, then audits the copy. It never copies the private controller directory
or overwrites an earlier export. Interrupted exports remain available to inspect;
retry into a different new destination.

The resulting directory is self-contained:

```text
bundle.json          Versioned family/source identity and digest commitments
schema.json          The envelope's JSON Schema
summary.md           Human-readable carried summary
read-bundle.mjs      Independent reader using Node built-ins only
evidence/            Original contained delivery bytes and their sealed inventory
```

[The reader source](read-bundle.mjs) needs no Wringer installation, provider
account, external npm package or network. It checks inventory and file hashes,
binds the displayed source to the payload manifest and prints recorded loop
decisions when present. Its output explicitly says `semanticAudit: "not-run"`.
Integrity relative to an index does not authenticate that index's author.

`wring bundle inspect` additionally runs Wringer's existing semantic audit. It
validates the carried source/authority/check/judge lineage; it does not rerun
acceptance checks, measure runtime isolation or manufacture a human observation.
The unchanged underlying route is `wringer-drive audit --bundle PATH/evidence`.

The [envelope schema](../../schema/bundle-index-v1.schema.json) supports contained
delivery v1–v4 in this release. Standalone verification retains its existing
`wring audit --set` interface. Future graph and experiment exports need explicitly
versioned support; this reader does not guess unknown record families.
