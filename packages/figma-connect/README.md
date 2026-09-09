# Figma connection: OAuth for the REST API

This package supplies Wringer's operator-side connection and a separately deployed
OAuth broker. It is **not Figma's official remote MCP server**. Wringer's assistant
tools call its own bounded REST importer; the connection never gives an agent the
Figma app secret or a general-purpose authenticated HTTP proxy.

Figma requires a registered application and an external callback server for token
exchange and refresh. This repository contains deployable software, **not a hosted
service, registered application or approved public integration**. There has been
no live OAuth grant, live Keychain write or account operation in its fixture tests.

## One administrator setup, then normal sign-in

1. Register a Figma OAuth application in the authorised team/organisation. Request
   only `file_content:read`. Draft apps are limited to their allowed testers;
   private apps to the associated team/organisation; public apps require Figma review.
2. Supply an administrator-owned public HTTPS origin, for example
   `https://connect.example.com`. Register its **exact** callback
   `https://connect.example.com/oauth/figma/callback` with Figma.
3. On the broker server only, inject `WRINGER_FIGMA_CLIENT_ID`,
   `WRINGER_FIGMA_CLIENT_SECRET`, `WRINGER_FIGMA_BROKER_URL` and
   `WRINGER_FIGMA_REDIRECT_URI` through the deployment's secret manager. Never put
   the secret in a repo, an operator's binary, a browser or a command argument.
4. Start the broker from this repository:

   ```sh
   bun run figma:broker
   ```

   The compiled distribution also supplies `wringer-figma-broker`. Its `--help`
   works without credentials. `WRINGER_FIGMA_BROKER_PORT` defaults to `8787` and
   may select an unprivileged port. The service binds **127.0.0.1 only**.
5. Put an HTTPS reverse proxy on that server in front of the loopback listener.
   Restrict it to the dedicated hostname; preserve paths and query strings to the
   upstream, but **disable access/query/body/Authorization logging** for these
   routes. Callback query strings contain short-lived authorisation codes. Do not
   add analytics, third-party scripts, traces or query-bearing error reports.
   Apply a 24 KiB body cap, a 20-second request timeout, per-client connection and
   rate limits, and TLS protection. Do not expose the loopback listener through a
   general HTTP tunnel. The server reconstructs the expected public origin from
   configured `WRINGER_FIGMA_BROKER_URL`, not arbitrary forwarded headers.
6. On the operator's machine configure **only** `WRINGER_FIGMA_BROKER_URL` to that
   trusted HTTPS origin. Do not read this setting from a target repository, plan,
   assistant tool argument or imported design. Broker administrators are trusted:
   the service necessarily handles the user's Figma tokens during exchange.
7. In Wringer's trusted local connection screen, choose Connect Figma. Complete
   authorisation in a normal browser, then return to finish connecting. Figma does
   not support this OAuth flow in an embedded WebView. The assistant sees only
   connection status, never the sign-in URL, private handle, proof or tokens.

Authorisation does not grant Wringer permission to retain a design. Import still
requires a selected frame/layer link and the operator's separate disclosure
acknowledgement. A connection does not attest design ownership or visual quality.

## Boundaries and lifecycle

- One 10-minute transaction contains independent, random OAuth state, PKCE S256
  verifier and a local handoff challenge. Figma returns its code to the exact
  callback; code exchange uses the registered client credentials through HTTP
  Basic authentication and the PKCE verifier. The browser never receives tokens.
- The operator proves possession of a separate local verifier to collect the
  tokens once. Handles alone cannot collect them. Callback replay, duplicate
  state, expiry and unexpected grants fail closed. In-flight transactions are
  memory-only, limited to 1,000; a restart requires reconnecting. Run one broker
  instance. Horizontal replicas need a properly atomic shared transaction store
  before deployment, not a load balancer in front of these independent maps.
- The broker exposes fixed connect/take/refresh routes. It is not an arbitrary
  endpoint proxy. Requests and provider responses are bounded; redirects are
  refused; errors never echo provider response bodies. The per-process cap of
  600 requests/minute is a backstop, **not per-client abuse protection**. The
  public refresh endpoint accepts an existing refresh token: Figma binds that
  token to this registered client. TLS ingress controls remain necessary.
- Token exchange and refresh use only `https://api.figma.com/v1/oauth/token`
  and `https://api.figma.com/v1/oauth/refresh`. The package does not support Figma
  for Government, borrow a third-party OAuth identity, scrape browser sessions
  or fall back to personal tokens or the official remote MCP server.
- macOS credentials use Keychain service `wringer-figma-oauth`, with a per-broker
  hashed account. `security -i` receives a base64-only command over stdin; token
  bytes are never placed in process arguments. Native Keychain access can still
  require the operating system's user consent; this software cannot bypass it.
- On other platforms, the fallback is a private operator directory, normally
  `~/.local/state/wringer/figma` (0700, files 0600). This is user-only storage, **not
  encryption at rest**. Use OS disk encryption and protect backups. Pending local
  connection proofs use that private directory on every platform. Symlinks,
  permissive files and repository-contained stores are refused. Never mount the
  operator home or credential directory into workers or judges.
- Renewal occurs before import when necessary. Temporary rate limits/server
  outages retain the connection; rejected refresh credentials require reconnect.
  Figma maintains one access token per application/user, so renewal may invalidate
  a token held by another operator process. Use one active connection/import
  process per account/app; a measured 401 must request reconnect, never become a
  green check. There is no multi-machine refresh coordination in this package.
- Disconnect deletes local credentials and pending proofs; it does **not** claim
  that the Figma-side OAuth grant has been revoked. The operator can remove that
  grant in Figma account settings. It does not erase retained design snapshots or
  delivery evidence. Those records have their own retention policy.

## Evidence and remaining release gates

Run `bun test ./packages/figma-connect/test`. Fixtures cover state/PKCE/Basic auth,
single-use collection, stolen handles, expiry/restart, refresh, redaction,
cross-site requests, endpoint injection, bounded bodies, private vaults and the
stdin-only Keychain command shape. These are engineering fixtures, not a live
Figma integration pass or a claim that macOS granted a real Keychain write.

Before a live blind test: deploy the broker; configure the registered app; verify
TLS, redacted proxy logging and ingress limits; supply an authorised desktop and
mobile frame link with retention consent; complete real browser OAuth and inspect
actual imported PNGs. Exercise real expiry/revocation, then the contained build,
human review, separate handover approval and audit from a fresh clone. Missing
app registration or hosting is an explicit prerequisite, not a request for the
PM to invent a token route.

Primary protocol reference, checked 2026-09-09:
[Figma OAuth applications](https://developers.figma.com/docs/rest-api/oauth-apps/).
