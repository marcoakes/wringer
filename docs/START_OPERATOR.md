# Operator setup and retained work

Use [INSTALL](../INSTALL.md) for the product, not contributor installation steps.
State belongs in the private app directory outside source; source evidence stays
with the repository. Register one explicitly selected mode per workspace.

Verification runs the repository's declared checks on the host, with a finite
source/check-bound grant. Inspect the commands first. It requires no managed
worker key or image. Contained delegation requires a clean committed source,
explicit role models, immutable image, protected checks and a measured runtime.

```sh
wring runtime catalogue --json
wring runtime inspect --kind apple-container --json
wring runtime provision --kind apple-container --start-service --dry-run --json
```

The last command is a proposal, not service-start authority. Review its downloads,
space estimate, files and service action. Repeat the same ID/service selection
with `--apply --expected SHA --actor NAME` only when authorized. If already
running, omit `--start-service`. Then run the printed `runtime measure` procedure
using an owned reachable local control address. It runs contained no-model probes;
readiness, ACP negotiation and model acceptance remain separate observations.

For gVisor, first obtain an administrator-provisioned cluster/RuntimeClass and an
exact image digest. `runtime provision --kind gvisor-kubernetes --context CONTEXT
--runtime-class CLASS --image DIGEST_REF` previews the namespace/policies. Secret
options contain reference names (`ENV=NAME:KEY`), never values. No host fallback or
cluster service installation is offered. [Runtime guide](../runtime/README.md)
and [deployment](../deploy/README.md) retain lower-level requirements.

Use `setup --mode delegation --help` for the full explicit role/source/network
selection. The [feature example](../examples/adoption/contained-feature/README.md)
provides inert acceptance input and a complete proposal. A reviewed preparation
adds tests in a private child source commit, without changing the original repo.
Do not type hashes by hand or promote a fixture readiness result to live proof.

`job open` starts a local owner when absent. For a foreground owner you can stop
with Ctrl-C, use `job serve --workspace ID`. Client connection starts no owner and
no job. Close foreground owners before upgrade; dead ownership needs the exact
recovery preview. [Migration](MIGRATION.md) covers uncertain results, old controllers,
rollback, storage and diagnostic export. [Release channels](RELEASE_CHANNELS.md)
is for maintainers; its account/publication actions are separate decisions.
