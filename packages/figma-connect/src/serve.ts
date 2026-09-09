import { figmaOAuthBrokerFromEnvironment } from "./broker";
import { FigmaConnectionError, httpsOrigin } from "./shared";

export const FIGMA_BROKER_HELP = `Wringer Figma OAuth broker — server component, not Figma's remote MCP server

Usage: bun run figma:broker
       wringer-figma-broker

Server-only environment:
  WRINGER_FIGMA_CLIENT_ID      Registered Figma OAuth application client ID
  WRINGER_FIGMA_CLIENT_SECRET  Its secret, injected by the server's secret manager
  WRINGER_FIGMA_BROKER_URL     Public HTTPS origin (for example https://connect.example.com)
  WRINGER_FIGMA_REDIRECT_URI   Exact registered origin + /oauth/figma/callback
  WRINGER_FIGMA_BROKER_PORT    Loopback listener port; default 8787

Deploy one instance behind an HTTPS reverse proxy on this host. The listener binds
127.0.0.1 only. It reconstructs the public origin exclusively from administrator
configuration, never from forwarded headers. Proxy only this dedicated hostname;
disable query/body/header logging, cap requests at 24 KiB and apply per-client
rate limits. A broker restart expires unfinished sign-ins. No account registration,
deployment, Figma review or live connection is implied by running this command.

Operators configure only WRINGER_FIGMA_BROKER_URL, never the app secret.
See packages/figma-connect/README.md for deployment and release gates.
`;

export function figmaBrokerServerOptions(env: Record<string, string | undefined> = process.env): {
  hostname: "127.0.0.1"; port: number; maxRequestBodySize: number; idleTimeout: number;
  fetch: (request: Request) => Promise<Response>;
} {
  const handler = figmaOAuthBrokerFromEnvironment(env);
  const publicOrigin = httpsOrigin(env.WRINGER_FIGMA_BROKER_URL!);
  const rawPort = env.WRINGER_FIGMA_BROKER_PORT ?? "8787";
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1024 || Number(rawPort) > 65535) throw new FigmaConnectionError("Figma broker port must be an integer between 1024 and 65535.");
  return {
    hostname: "127.0.0.1", port: Number(rawPort), maxRequestBodySize: 24_576, idleTimeout: 20,
    fetch: async request => {
      const incoming = new URL(request.url);
      const canonical = new URL(publicOrigin);
      canonical.pathname = incoming.pathname; canonical.search = incoming.search;
      // No X-Forwarded-Host/Proto trust and no user-controlled redirect destination.
      return handler(new Request(canonical, request));
    },
  };
}

if (import.meta.main) {
  if (process.argv.slice(2).length === 1 && ["--help", "-h"].includes(process.argv[2]!)) console.log(FIGMA_BROKER_HELP);
  else if (process.argv.length > 2) { console.error("Unknown Figma broker argument. Use --help."); process.exitCode = 1; }
  else {
    try {
      const server = Bun.serve(figmaBrokerServerOptions());
      console.log(`Wringer Figma OAuth broker listening on loopback port ${server.port}. HTTPS reverse proxy and registered Figma app are required.`);
    } catch {
      console.error("Figma broker could not start. Check its server-only configuration and loopback port. Use --help; no credentials have been printed.");
      process.exitCode = 1;
    }
  }
}
