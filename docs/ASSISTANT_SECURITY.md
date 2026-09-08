# Assistant entry point: security scope

Status: cooperative-local engineering preview. Protected delegation and a
trusted human-presence mechanism are **not established**. This addendum extends
the [threat model](../THREAT_MODEL.md), not the controller's authority.

## Three different boundaries

| Boundary | What it controls | What it does not establish |
| --- | --- | --- |
| MCP contract | The operations, handles and bounded facts exposed through the assistant connection | A restriction on the assistant's independent shell, filesystem or browser access |
| Controller and job authority | Exact approved plan, ceilings, current source, recorded effects and eligible actions | Protection from a same-user program that can alter the controller's files or call operator routes |
| Contained agent runtime | The worker/judge execution environment under the declared Apple Container or gVisor policy | Protected access for the outer coding app; an ACP transcript alone also does not prove runtime containment |

MCP carries requests into the control plane. ACP carries work to the separately
contained runtime. Neither protocol authenticates a human or provides an OS
security boundary by itself.

## Cooperative-local is a named limitation

The operator explicitly selects cooperative-local mode. The assistant uses a
restricted connection, while operator approval and human-review surfaces remain
separate. The MCP tools do not include granting authority, increasing budgets,
recording human verdicts, publishing, arbitrary shell execution or retrieving
credentials. Inert proposals and read-only queries do not authorize agent work.

Those restrictions apply to the MCP interface. An assistant with the same OS
access may read local connection records, reach operator routes, edit grants,
launch another controller or automate the browser. Private file permissions,
opaque handles and separate bearer tokens are worthwhile interface controls;
they are **not a defense against that same-user adversary**. A name and checkbox
record an asserted decision, not authenticated human presence.

Protected mode therefore refuses until a measured deployment can enforce its
boundary. There is no silent fallback, promise to bypass macOS/client approval,
or claim that a cooperative-local demonstration satisfies this security gate.

## Data, requests and evidence

- Bind proposals to the registered workspace and exact immutable plan profile.
  Treat repository contents, requirements and receipt text as untrusted data.
- Use opaque job/operation handles, idempotency and current revision/candidate
  checks. A repeated request is not a fresh grant.
- Return compact, bounded evidence and identify its source. Evidence text must
  not become instructions, a tool name, a destination or permission to execute.
- Keep the full operator/review capability out of MCP responses and assistant
  transcripts. Do not return provider credentials or dump private logs.
- Resolve existing declared credentials only at the execution boundary. MCP
  connection configuration must not contain worker keys or publication secrets.
- Preparing handover is distinct from sending. The assistant cannot enlarge the
  operator-selected destination or approve publication with its connection.
- Preserve original human words, failed measurements and unknown costs. Display
  and review bind the exact candidate; a new candidate invalidates old acceptance.

These are implemented contract requirements to test, not claims that every
hostile string can be detected or every dependency is safe.

## Durable ownership is not infinite authority

The local owner persists accepted operations and their identities independently
of the chat. Duplicate/concurrent requests must resolve to one operation. An
owner crash or lost result must not cause automatic replay of a potentially
paid effect or publication. Recovery retains unknown outcomes and original
reservations; downtime counts toward expiry and elapsed-time limits.

Cancellation prevents future dispatch and requests bounded cancellation of
active work. It cannot revoke provider acceptance, erase charges or guarantee
that a remote action did not run. Connector revocation requests owner shutdown
and invalidates capabilities, but is not permanent job cancellation: accepted
pending work and original approval remain recorded. An explicit owner restart
may dispatch pending work under that still-valid approval. Scoped-connection
renewal grants neither new execution authority nor a fresh budget. Reboot/login
supervision is not installed by the preview.

Session and time ceilings are execution controls, not a monetary ceiling. The
outer app's bill is outside Wringer's control. A strict-cash request must refuse
before dispatch when no measured route can bound every underlying paid call.

## What would qualify protected mode

Before changing the refusal or marketing the assistant as unable to approve:

1. Establish a separate protected controller identity, or a measured restriction
   that denies the outer app controller writes, secrets, runtime administration
   and operator capability access.
2. Authenticate genuine human confirmation through a channel the outer app
   cannot invoke with shell/filesystem/browser automation. Bind the exact
   request, plan, source, limits, expiry and any publication destination.
3. Deny bypass by creating another job/grant/root after the parent ceiling is
   spent. Define who may register profiles, replace binaries and administer keys.
4. Demonstrate the denials using the actual named app's available tools, not
   just calls through the narrow MCP adapter. Keep complete sanitized results.
5. Measure restart, revocation and update behavior without broadening the
   authority. Keep the OS owner/administrator explicitly outside the claim.

Privileged installation, a new service account or changes to client/global
permissions require a separate deployment decision. They are not silently
performed by ordinary Wringer setup or inferred from a request to reduce PM
interruptions.
