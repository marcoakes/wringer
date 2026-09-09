# Design inputs, without a second agent loop

`@wringer/design` captures an immutable, hash-bound design reference. It does not
write implementation code, approve a design, run a model, or grant a worker
ambient access to the operator's design accounts.

Two import methods are explicit:

- `createDesignSnapshot` accepts operator-owned text and static PNG references.
  These records say `owned-reference`; they never claim a Figma measurement.
- `importDesignFromMcp` runs one finite declared read recipe against an approved
  public HTTPS endpoint. The Figma provider is restricted to the official remote
  endpoint and known read tools, all naming the same file and node. Generic MCP
  imports name their endpoint, exact read tools, and exact JSON arguments.

The importer negotiates MCP `2025-03-26`, lists tools once and requires an
unambiguous read-only advertisement for every recipe tool before calling any.
It supports JSON and bounded SSE responses, not arbitrary server-originated tool
execution. Redirects, local/private addresses, external resource downloads,
interactive authentication and write tools are refused. Production HTTPS pins a
validated public IPv4 DNS result for the connection; IPv6-only endpoints are not
currently supported. There is no automatic pagination or retry.

Figma `get_screenshot` calls must explicitly include `enableBase64Response: true`.
The official tool can otherwise return a URL; this importer deliberately does
not fetch external image URLs. See [Figma's screenshot tool documentation](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/#get_screenshot).

Read-only annotations are the remote server's assertions, not independent proof
of its internals. This package cannot prove that an arbitrary remote server had
no side effects. Only connect an explicitly trusted design endpoint.

## Access and secrets

The caller supplies the credential through the `token` secret channel. No host
home, login directory, Keychain, coding-app connection, or OAuth identity is
searched. Do not put a credential in the endpoint, recipe JSON, shell arguments,
context or source label. The importer detects supplied-token echoes and refuses
the whole capture instead of altering product context into an apparent success.

Figma access remains conditional on the service's account, file and approved
client rules. An available token is not proof of eligibility. HTTP 401/403 or
tool errors stop with an explicit refusal. No client impersonation, login,
installation, model spend or live Figma success is implied by fixture tests.

## Evidence and privacy

The snapshot retains context, source metadata, exact call-argument/result hashes,
capture time, bounded PNG bytes and a whole-record digest. A reported version is
retained only when a structured result names the same file and node; an
operator-declared version remains labeled as such. Without a reported immutable
version the hash pins the captured bytes, not the future remote document.

`private` and `repository-permitted` are explicit disclosure choices. Only the
latter can be attached to source/delivery. This is a permission assertion, not
automated ownership verification. A PNG can contain a person's name or a secret
rendered on screen: text redaction cannot establish pixel privacy.

The PNG validator accepts canonical base64, valid signature/chunk CRCs and
bounded non-interlaced 8-bit images. It rejects SVG/HTML, animation, EXIF, text
metadata, unsupported chunks, inconsistent dimensions and decompression bombs.
This deliberately narrow format may require exporting a clean static PNG from
some design tools. The board must not interpret returned text as HTML.

Hard ceilings are 16 MiB per complete snapshot, 2 MiB of context, at most eight
images, 4 MiB of PNG bytes per image, 8 MiB of reference images in aggregate,
4096 pixels per axis and eight million pixels per image. Import execution is at most twelve read calls
plus the fixed three-request handshake, sixty seconds and 24 MiB of total MCP
response bytes. Lower explicitly declared limits are honored.

`writeDesignSnapshot` creates a private file exclusively; an existing snapshot
is never rewritten. `validateDesignSnapshot` independently checks source shape,
PNG bytes and all digests after reading a Git blob or delivery file. Consumers
must also bind the approved snapshot digest and exact protected repository path;
a self-consistent file alone cannot establish approval or provenance identity.

## Measurement

`bun test packages/design/test` exercises deterministic injected HTTP fixtures,
not a live Figma account or external design service. The test transport is a
code-only injection seam and must never be selected from repository/user config.
The public production path always uses its own validated/pinned HTTPS transport.
