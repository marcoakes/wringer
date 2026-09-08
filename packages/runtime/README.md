# Contained runtime boundary

This package implements the runtime side of the public [contained journey](../../QUICKSTART.md).
It has no host-agent fallback. Planner, worker, judge and verifier allocations use
fresh runtime identities and in-runtime repository clones; no host repository,
home directory or control socket is mounted.

## Filesystem authority

Worker requests require `scope.writable`, `scope.protected` and optional
`scope.writableDirectories`, taken from the approved execution plan—not the
agent's prompt. The clone starts root-owned and read-only. Only declared existing
writable paths and explicitly created empty/untracked output directories become
uid-1000 writable. Acceptance, policy namespaces, Git metadata and their parents
remain root-owned/non-writable. The agent has no Linux capabilities and cannot
gain privileges. A missing writable path refuses: its intended file/directory
must exist in the approved baseline; Wringer does not guess the type.

Protecting parents prevents replacing a protected file by unlink or rename. It
also prevents creating new siblings in that parent, including new root files
when the repository root is protected. Use an existing scoped source directory
and explicitly declared dependency/build directories. A scope of `.` does not
override protected parents.

Verifier source is read-only, including non-acceptance tracked files. Only declared
empty/untracked output directories are writable; their paths must not overlap
acceptance or policy. Worker output directories are excluded from candidate
capture. Before capture, the supervisor kills uid-1000 descendants, locks source,
then uses its own Git index; the worker never owns authoritative Git metadata.

Images need Linux `sh`, `git`, `setpriv`, `timeout`, `pkill`, `pgrep`, ownership/mode
utilities and normal filesystem tools. Apple also needs `iptables`/`ip6tables`.
No install or fallback is attempted when these are missing.

## Platform read-back

Apple inspect must match the allocated identity, running status, pinned image,
CPU/memory limits and Linux runtime handler, with no external mounts, published
ports/sockets, SSH forwarding or nested virtualization. Field names follow
[Apple's ContainerConfiguration](https://github.com/apple/container/blob/main/Sources/ContainerResource/Container/ContainerConfiguration.swift)
and [ContainerSnapshot](https://github.com/apple/container/blob/main/Sources/ContainerResource/Container/ContainerSnapshot.swift),
inspected 7 September 2026. An incompatible or incomplete response refuses rather
than recording requested values as observed fact.

Kubernetes validates admitted Pod identity/labels, image, privileges, seccomp,
storage, credentials/environment references, process configuration, deadlines and
resource requests/limits. It lists NetworkPolicies before creating the Pod and
again after admission: the owned policy must exactly match, and another selecting
policy granting network access refuses. Kubernetes policies are
[additive](https://kubernetes.io/docs/concepts/services-networking/network-policies/).
Use a controlled namespace; policy read-back is a point-in-time check, not a
guarantee against privileged cluster administrators changing policy later.

Runtime/shell/Git control environment names cannot be forwarded as agent
credentials. Selected credentials do enter the agent environment; this is not a
credential broker that hides keys from the agent. Known local values are redacted
at decoded string boundaries. Kubernetes Secret values unknown to the controller
cannot be promised comprehensively redacted from arbitrary agent output.

## Recovery and evidence limits

`preflightAgentRole` allocates the same role environment and calls
`probeAcpSession`: initialize, an explicitly selected noninteractive auth method,
session creation, optional mode negotiation and close/termination. It sends no
`session/prompt`, approves no requested tool effects and never logs in or changes
keys. `authLine` distinguishes session creation from mere variable forwarding;
provider-key validity, credential precedence and billing remain unasserted. An
agent is still trusted to follow ACP lifecycle semantics; an unsolicited internal
provider call cannot be ruled out merely because the controller sent no prompt.

Candidate capture freezes the source/patch identity before local Git work. A
partial attempt is retained, and the same immutable request can rebuild in fresh
attempt storage without another agent call. Different requests cannot reuse the
reservation. Legacy partial captures without an identity still refuse.

`bun test ./packages/runtime/test` covers adversarial policy/read-back inputs using
an injected driver, real local Git capture interruption/recovery, and real ACP
subprocess cancellation. The executable ownership/rename adversary runs only in a
Linux uid-0 environment with `setpriv`; it is explicitly skipped on macOS.
Simulated driver success, policy JSON and inspect records do not prove actual
Apple/gVisor containment, CNI enforcement, denial of escapes, or physical process
termination on an unreachable Kubernetes node. Those remain live release gates.
