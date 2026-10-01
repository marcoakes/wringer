/** Connection recipes for MCP clients (R-7, ruled 2026-10-01). The client must be named;
 * none is a default. Each recipe was checked against the client's official documentation
 * on 2026-10-01; a client whose documented shape could not be verified gets only the
 * generic stanza, and says so. Every recipe runs the same command:
 * `wring mcp --connection <path>`. A recipe is a connection, not compatibility: no
 * complete journey has been measured on a client until the compatibility table says so. */
import { quote } from "./args";

/** Alphabetical, so no client reads as preferred. */
export const MCP_CLIENTS = ["claude-code", "codex", "cursor", "gemini-cli", "generic", "kimi", "vscode", "windsurf"] as const;
export type McpClient = typeof MCP_CLIENTS[number];
export interface ClientRecipe {
    client: McpClient;
    /** The one server command every client runs. */
    argv: string[];
    verified: boolean;
    addCommand?: string;
    inspectCommand?: string;
    disconnectCommand?: string;
    configPath?: string;
    config: string;
    reference: string | null;
    note: string;
}
const stanza = (key: "mcpServers" | "servers", argv: string[]) => JSON.stringify({ [key]: { wringer: { command: argv[0], args: argv.slice(1) } } }, null, 2);
export function parseMcpClient(value: string): McpClient {
    if (!(MCP_CLIENTS as readonly string[]).includes(value)) throw new Error(`Name your client with --client: ${MCP_CLIENTS.join(", ")}. None is a default; use generic for any other MCP client.`);
    return value as McpClient;
}
/** Everything but Codex's TOML, which keeps its own inspected recipe. */
export function clientRecipe(client: Exclude<McpClient, "codex">, argv: string[]): ClientRecipe {
    const line = argv.map(quote).join(" ");
    switch (client) {
        case "claude-code": return { client, argv, verified: true, addCommand: `claude mcp add --scope user wringer -- ${line}`, inspectCommand: "claude mcp list", disconnectCommand: "claude mcp remove wringer", configPath: ".mcp.json (this project) — or use the add command for your user", config: stanza("mcpServers", argv), reference: "https://code.claude.com/docs/en/mcp", note: "Claude Code: add for your user with the command, or commit the project file. Restart the session to load it." };
        case "cursor": return { client, argv, verified: true, configPath: "~/.cursor/mcp.json (all projects) or .cursor/mcp.json (this project)", config: stanza("mcpServers", argv), reference: "https://cursor.com/docs/context/mcp", note: "Cursor has no add command; merge this entry into one of its files, leaving other servers alone." };
        case "gemini-cli": return { client, argv, verified: true, inspectCommand: "gemini mcp list", disconnectCommand: "gemini mcp remove --scope user wringer", configPath: "~/.gemini/settings.json (user) or .gemini/settings.json (project)", config: stanza("mcpServers", argv), reference: "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md", note: "Gemini CLI: merge this entry into mcpServers. Its add command is not printed: how it passes a server argument such as --connection is not documented." };
        case "kimi": return { client, argv, verified: true, addCommand: `kimi mcp add --transport stdio wringer -- ${line}`, inspectCommand: "kimi mcp list", disconnectCommand: "kimi mcp remove wringer", config: stanza("mcpServers", argv), reference: "https://github.com/MoonshotAI/kimi-cli", note: "Kimi CLI: add with the command. Its documentation names no fixed configuration file, so the stanza is for --mcp-config-file." };
        case "vscode": return { client, argv, verified: true, addCommand: `code --add-mcp ${quote(JSON.stringify({ name: "wringer", command: argv[0], args: argv.slice(1) }))}`, configPath: ".vscode/mcp.json (this workspace)", config: stanza("servers", argv), reference: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers", note: "VS Code: add to your user profile with the command, or put the entry in the workspace file. Its key is servers, not mcpServers." };
        case "windsurf": return { client, argv, verified: false, config: stanza("mcpServers", argv), reference: null, note: "Windsurf: not verified. Its MCP documentation now redirects to another product, so its configuration path could not be checked on 2026-10-01; only the generic stanza is printed." };
        case "generic": return { client, argv, verified: true, config: stanza("mcpServers", argv), reference: "https://modelcontextprotocol.io/docs/develop/connect-local-servers", note: "Any MCP client that starts a local stdio server: run this command. Most clients accept this mcpServers stanza." };
    }
}
export function renderClientRecipe(recipe: ClientRecipe): string {
    return [recipe.note,
        recipe.inspectCommand ? `\nInspect configured servers:\n${recipe.inspectCommand}` : "",
        recipe.addCommand ? `\nAdd only after reviewing this exact command:\n${recipe.addCommand}` : "",
        `\n${recipe.addCommand ? "Or put this entry in" : "Put this entry in"} ${recipe.configPath ?? "your client's MCP configuration"} (review first; leave unrelated settings alone):\n${recipe.config}`,
        recipe.disconnectCommand ? `\nDisconnect only the named entry:\n${recipe.disconnectCommand}` : "",
        `\nServer command: ${recipe.argv.map(quote).join(" ")}`,
        recipe.reference ? `Official connection reference: ${recipe.reference}` : "No official reference could be verified.",
        "Retained Wringer jobs are not deleted by disconnection. This is a connection recipe; a complete journey on this client is unmeasured.",
    ].filter(Boolean).join("\n");
}
