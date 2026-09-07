# Threat model

This page complements [SECURITY.md](SECURITY.md). It describes the current Bun product's intended boundaries and remaining uncertainty, not a claim that all runtime targets have passed live adversarial testing.

Protected assets include the operator's host, private source, credentials, approved intent, remaining budget, human observations, repository history and the integrity of the evidence given to a reviewer.

## Adversaries and boundaries

| Risk | Mechanism | Residual risk / evidence boundary |
| --- | --- | --- |
| An agent makes checks pass without doing the requested work | Exact criteria, check bindings, red-first receipts, source/check identity and later falsification | A weak or incomplete criterion can still be satisfied by a wrong change. These mechanisms do not certify intent. |
| Repository code reads or damages the operator's host | Mandatory isolated role runtime, clone inside, no host mounts, explicit credentials and resources | Requires live runtime enforcement. Controller compromise, privileged cluster administration or a runtime escape is outside what record hashes prevent. |
| A tool or agent exfiltrates data | Deny/allowlist network policy and role-specific environment names/secret references | Allowed endpoints can receive sensitive data. Network policy must be observed, not inferred from a generated manifest. |
| A prompt injection tries to change policy or obtain controller authority | Data-only plans, strict schemas, constrained TypeScript, scoped authority and validated ACP handling | The chosen agents may still be misled within their allowed actions. Natural-language instructions are not a security boundary. |
| Work resumes into unbounded spend | Persisted ceilings, before-send reservations, cached successful sections, explicit treatment of unknown outcomes | Provider usage may be absent or unverifiable. Unknown cost must remain unknown, not zero. |
| A worker grades itself | Separate ACP judge identity/runtime and independent declared checks | Separation is not proof of judgement quality. A judge can agree with a flawed premise; model opinions do not become human verdicts. |
| A human approval or observation is fabricated | Exact plan/display binding, explicit pen command, retained actor and note | The actor's name is recorded, not authenticated. A holder of the operator's access can still impersonate that operator. |
| Evidence is incomplete or altered | Frozen schemas, safe path resolution, inventory/digest/ledger checks and cross-surface agreement | Someone controlling all artifacts can rewrite them consistently. Unsigned evidence is not an external attestation of authorship. |
| A ready result is published without authority | Explicit publication invocation, new branch, isolated index, no force push or automatic merge | Remote authorization and repository rules remain external. A code push may succeed before evidence publication fails; the partial result must be recorded. |

## Trust assumptions

The controller's code, Bun runtime and dependencies are trusted to enforce the policy they implement. The selected runtime/cluster and images are part of the trusted computing base. Credentials are provided by an authorized operator and scoped appropriately. A product run does not obtain permission to change these assumptions merely because its work is blocked.

Planner, worker and judge use fresh runtime identities. The production repository is cloned at a pinned commit inside its environment. Read-only planner/judge source access prevents an ordinary write through that declared mount; it does not by itself prove isolation from the host or the other roles.

`wringer-headless` uses the same ACP/runtime policy as `wringer-drive`. Its name does not grant a larger permission envelope. The earlier host-Codex helper is retired, not an alternative route around required isolation.

## What must be measured before stronger claims

For each supported platform, retain tests of forbidden host-file reads, source writes by read-only roles, network denial/allowlisting, credential exposure, turn/time/resource ceilings, interruption, cleanup and fresh-role separation. A valid ACP transcript or Kubernetes manifest proves a protocol/serialization property, not those platform properties.

Also test the entire handover from a fresh clone: every promised file carried, every proof resolvable, the same requirement counts and human note across views, and the falsification record bound to the actual committed source range. Deliberately remove or corrupt evidence to show the audit fails for the intended reason.

## Non-claims

Wringer does not guarantee model convergence, arbitrary software correctness, freedom from malicious dependencies, complete secret detection, authenticated human identity, or safety against a compromised administrator/kernel. A survivor in a mutation exercise is a finding about a check; a green check is evidence of that execution. Neither is a universal verdict about the product.

Historical witness and container experiments are retained as historical evidence. Their scope and negative results are not erased, and their old operational recipes are not current setup instructions.
