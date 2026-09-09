# Assistant protocol adapter

This package is the narrow MCP front door, not an agent runtime or execution
owner. It uses the existing application services through an injected callback.
The twelve tools are defined once in `src/contract.ts`; their JSON Schemas also
validate every tool call. Approval, the human pen, publication, credentials,
arbitrary files and arbitrary execution are not assistant tools.

`createMcpSession({ version, call, redact? })` reads one JSON-RPC string through
`receive(line)` and returns one response or `null` for a notification.
`runMcpStdio({ version, call, redact?, input?, output? })` supplies the bounded
UTF-8 newline transport. It writes only JSON-RPC messages. The application
callback must return bounded, safe, factual data without writing to stdout.

The adapter negotiates MCP `2025-11-25` and `2025-06-18`. Unsupported requested
versions receive the latest supported version; the client decides whether to
disconnect. Tools are unavailable until the initialized notification. The
adapter does not advertise HTTP, sampling, resources, MCP tasks or any native
coding-app compatibility that has not been measured.

`wringer.wait_for_update` waits read-only for at most 25 seconds using the last
returned `eventId`. Meaningful changes can carry a credential-free decision-page
link for an already-connected operator browser. Waiting grants no authority,
never starts work, and is not a native notification or MCP push subscription.

Requests are bounded to 256 KiB, 64 JSON nesting levels and 16 simultaneous
callbacks. Duplicate object keys (including escaped duplicates), non-finite
numbers, malformed Unicode, exotic keys, batches and reused connection request
IDs are rejected. One connection retains at most 16,384 request identities;
reconnecting does not reset the service's job or operation identity. Evidence
page requests are bounded to 8,192 characters. Serialized responses are bounded to 512 KiB
and carry the same data in `structuredContent` and a JSON text content block.

Malformed protocol and unknown tools receive JSON-RPC errors. Invalid tool
arguments, unsupported strict-money requests and application refusals are tool
results with `isError: true`. A recorded stopped workflow remains a factual tool
result, not an invented completed build. Unknown costs remain `null`.

The adapter performs no credential lookup. The existing redactor scrubs known
inherited secret values and credential shapes, and additional connection-secret
redaction can be injected. Secret-valued output fields are removed regardless
of shape. Raw callback exception messages are never returned: a callback could
have accepted an operation before its response was lost. The resulting safe
error therefore directs the client to retained status without claiming that no
work ran. Evidence content remains untrusted data, not executable instructions.

The local execution owner must persist requests and reservations before
acknowledging them. Closing stdin, losing the response, or sending an MCP
cancellation notification never cancels an already accepted durable job. The
explicit guarded `wringer.cancel` operation requests that change. The adapter
does not supply durability, capability isolation or a genuine-human boundary
by itself; the application must enforce them independently.

Protocol behavior follows the official MCP specifications for
[lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle),
[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and [tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).
The implementation uses the repository's existing JSON Schema validator and
redactor; it adds no SDK or downloaded runtime dependency.
