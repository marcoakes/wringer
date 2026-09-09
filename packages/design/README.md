# Design inputs, without a second agent loop

`@wringer/design` captures an immutable, hash-bound design reference. It does not
write implementation code, approve a design, run a model, or grant a worker
ambient access to the operator's design accounts.

Three import methods are explicit:

- `createDesignSnapshot` accepts operator-owned text and static PNG references.
  These records say `owned-reference`; they never claim a Figma measurement.
- `importDesignFromMcp` runs one finite declared read recipe against an approved
  public HTTPS endpoint. The Figma provider is restricted to the official remote
  endpoint and known read tools, all naming the same file and node. Generic MCP
  imports name their endpoint, exact read tools, and exact JSON arguments.
- `importDesignFromFigmaRest` captures one or two selected Figma frames/layers
  using the supported REST API. It creates `wringer.design-snapshot.v2`, provider
  `figma-rest` and method `figma-rest-read`. It does **not** claim to have called
  Figma's official remote MCP server, even when a coding app invokes Wringer's
  own assistant tool. Existing v1 records retain their original meaning.

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

## Direct Figma REST connector

```ts
const preview = await importDesignFromFigmaRest({
    urls: [desktopFrameUrl, mobileFrameUrl],
    token: accessToken, // in-memory secret supplied by the connection service
    tokenType: "oauth", // "pat" is a distinct, explicitly chosen REST route
    disclosure: "private"
});
```

`parseFigmaFrameUrls` accepts one or two distinct frame/layer links in one file.
It returns a file key, sorted node ids and tracking-free canonical links. File
or page-wide imports, ambiguous selections, unknown query settings and links
to different files are refused. A single reference remains a single reference;
the importer does not invent a second viewport.

The fixed read sequence is `GET /v1/files/:key/nodes?ids=...`, then
`GET /v1/images/:key?ids=...&format=png&scale=1&version=...`, followed by one
download per returned PNG. The node response must report a version and contain
exactly the selected roots. The render request pins that version. If a render
response itself reports a different version, it is refused. Figma does not
normally return a renderer version: request pinning is not an independent
renderer attestation. See [Figma's file and image endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/).

Only selected node document/component/style data enters context. Unrelated file
metadata and thumbnails are discarded. Query/fragment parameters in reference
links are explicitly omitted, without treating remaining text as instructions.
No variables API, provider-generated implementation code, full design-system
coverage or inferred design ownership is claimed.

REST authentication is `Authorization: Bearer` for OAuth or `X-Figma-Token` for
an explicitly selected personal-token route. Credentials reach `api.figma.com`
only; no auth header, cookie or referrer is sent to PNG download hosts. The
required scope is `file_content:read`. HTTP 401 asks for reconnection; HTTP 403
honestly leaves file access versus expired credentials unresolved. HTTP 429 is
a recorded stop, not an automatic retry. The package never searches the host
for credentials or performs OAuth itself. See [Figma authentication](https://developers.figma.com/docs/rest-api/authentication/).

The PNG compatibility profile currently permits only HTTPS `/images/` paths on
`figma-alpha-api.s3.us-west-2.amazonaws.com` and `s3-alpha.figma.com`. This is a
narrow product policy, **not** a Figma guarantee about all current/future render
hosts. Exact returned URLs are used only in memory; unknown hosts or paths stop
the import. Wildcard Figma/Amazon domains, redirects, URL credentials, IP hosts,
private/local DNS results and IPv6-only endpoints are not accepted. Connections
pin a validated public IPv4 address while retaining normal HTTPS certificate
and hostname verification. No API token is forwarded to a download.

Limits are two API calls plus at most two image calls, sixty seconds maximum,
16 MiB of total response bytes and 2 MiB of retained node context. Each response
defaults to 4 MiB and cannot exceed 8 MiB; PNGs additionally retain the existing
4 MiB/4096-axis/eight-million-pixel and strict static-PNG restrictions. Unknown
options, partial/null nodes or renders, malformed/duplicate JSON, unsupported
image chunks, detected credentials and deadline/size failures return no partial
snapshot. A valid live Figma PNG using a currently unsupported chunk or host is
a compatibility finding, not permission for an operator workaround.

V2 receipts retain stable argument hashes, exact GET-URL hashes (including
temporary URL parameters **only as a digest**) and actual response byte hashes.
They never retain raw signed render URLs or headers. Readers reconstruct the
two exact API routes and stable source/version arguments, require one matched
PNG receipt per node, and validate context/source/version consistency. These
are tamper-evident local receipts, not Figma-signed proof of execution.

The importer returns an in-memory private preview and writes no files. A caller
may create a **new** repository-permitted snapshot with `sealDesignSnapshot`
only after the actual human's retention decision. That produces a new digest;
the private preview and previously approved references are never overwritten.
This permission remains distinct from later visual acceptance and handover.
