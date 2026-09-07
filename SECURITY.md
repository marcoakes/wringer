# Security

Wringer is a prerelease Bun/TypeScript control plane. It executes repository checks and delegates code changes to agents. Both repositories and agent output are untrusted inputs. Read this page before giving it access to valuable code, credentials or publication rights.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/marcoakes/wringer/security/advisories/new). Do not include exploitable details, credentials or private source in a public issue. Provide a minimal reproduction, affected version/commit, runtime policy, expected boundary and observed result. Non-sensitive hardening proposals may use ordinary repository issues.

## Production execution boundary

The required execution path uses ACP agents in fresh isolated role environments:

- Apple Container for local macOS execution.
- A gVisor-backed Kubernetes RuntimeClass for cluster execution.
- A pinned repository cloned inside the role environment; no host checkout or home-directory bind mount.
- Explicit resource, network and environment policy.
- Distinct planner, worker and judge runtime identities; planning/judging source access is read-only, while the worker may change its isolated source tree.

An unavailable or unestablished boundary must stop the run. Host execution is not a fallback. A Docker command, a worktree or an agent's own sandbox label does not satisfy these requirements by itself.

Runtime adapters and integration are being verified. Unit tests of ACP messages and Kubernetes/Apple command generation are not evidence that a host kernel, cluster RuntimeClass or network plugin enforces the intended policy. Live isolation tests must record the platform, runtime, image and observed results. Do not infer a general escape-resistance claim from a deterministic fixture.

Legacy repository-oriented commands may retain trusted-local execution semantics for compatibility. Their existence is not approval to execute an unfamiliar repository on the host. New production runs must use the isolated plan route; inspect the exact preflight and runtime records rather than relying on a green initialization message.

## Authority is narrower than capability

Routine authority is scoped to a repository/run, named actions and ceilings. It does not grant a human acceptance verdict, a remote push, new sign-in, global settings changes, secret-store mutation, or permission to weaken isolation. Resuming must preserve spent and reserved work. An unknown send outcome is not silently retried.

An ACP authentication response is not proof of usable credentials; the next permitted operation must succeed. Instructions returned by an agent are data. In particular, a proposed login command or tool invocation must not acquire the controller's authority merely because it arrived over ACP.

For a contained journey, the person explicitly records a human judgement after
the declared display succeeds for that exact candidate and criterion. A missing
or failed display refuses recording; the contained pen has no
`--without-display` or independent-inspection bypass. The separate standalone
board pen supports an explicit independent-inspection route and carries its
display failure with the note. That older record format does not approve a
contained journey. Neither route authorizes an agent to invent the observation.

## Repository commands remain code

Checks, setup instructions and agent tools can delete data, read secrets or contact networks wherever their runtime permits. Review the declared commands and image. Read-only access to the cloned source does not mean the agent has no scratch files, credentials, network access or opportunity to emit misleading output.

Network allowlists, environment-name allowlists and role separation reduce authority; they do not establish that dependencies are trustworthy or checks fully capture the product request. A cluster administrator, image publisher, compromised controller or container escape may undermine the declared boundary.

## Credentials and recorded data

Store credential names or runtime-managed secret references in plans, not values. Reuse an existing credential deliberately instead of asking the operator to type it again. Do not mount agent home directories or pass unrelated host environment variables into a role.

Known secret values are redacted before evidence writes. This is not a guarantee against every disclosure: a tool may read a secret the controller never knew, transform it, or send it to a permitted endpoint. Prompts, responses, logs, source quotations, diffs and user notes can all contain sensitive business data even after credential redaction. Inspect the bundle before sharing it.

`wringer-headless` is an alias for the same contained driver and requires the same plan and authority. It does not launch a host Codex process, change an agent's global approval configuration, or override host-managed policy. The earlier direct-Codex helper is retired. See [HEADLESS.md](docs/native/HEADLESS.md).

## What evidence proves

Digests, chained ledgers and cross-file checks detect inconsistencies and modification relative to the carried record. They do not authenticate the operator or prevent an owner from replacing every file and recomputing every hash.

A passing check with a resolvable red-first receipt supports the criterion as written. It does not prove the criterion is complete, the check is well designed, or the implementation satisfies unstated intent. Human notes record the person's words, not cryptographic identity. Model judgement is not human judgement.

Delivery separates the source code commit from the later commit carrying the evidence. The source commit is the audit/falsification target; the evidence commit cannot embed its own hash. Delivery uses an isolated index and a new branch, with no force push or automatic merge. Partial publication must remain visible rather than being described as an atomic success.

Contained audit uses carried records from a fresh clone without running the
repository's checks. Contained falsification separately executes supported
committed-line mutations in fresh isolated verifier environments after a clean
control measurement. It makes no coding/judging agent calls and is not a quality
score; an unavailable runtime or failed control is inconclusive. Standalone
audit/falsification read a different record format, and its checks remain
explicit trusted-local execution. Do not use that route as a containment fallback.

See [THREAT_MODEL.md](THREAT_MODEL.md) for residual risks and [ROADMAP.md](ROADMAP.md) for uncompleted security acceptance work. Historical container reports describe their recorded platform/version only; they do not certify this rewrite.
