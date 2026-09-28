# Registry validation input

`mcp-server-2025-12-11.schema.json` was downloaded on 2026-09-28 from the
[official versioned MCP schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
SHA-256: `3fba09590c99f61735d234822279f4223fab9e300c0a81e81c91ab62a4114de0`.
It is retained for deterministic offline metadata validation. The upstream
[license notice](https://github.com/modelcontextprotocol/registry/blob/main/LICENSE)
is preserved as `MCP-REGISTRY-LICENSE`; it describes the project's current
licensing transition and does not grant additional rights.

Package naming and transport fields follow the
[official package reference](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx).
Generated metadata describes a local STDIO package with a required connection
record and setup, without a hosted endpoint. Schema validation does not establish
namespace ownership, listing acceptance or named-client compatibility.
