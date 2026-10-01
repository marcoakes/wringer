/** R-7: a required, alphabetical client list; one server command for every client;
 * a client whose documented shape could not be verified says so. */
import { expect, test } from "bun:test";
import { clientRecipe, MCP_CLIENTS, parseMcpClient, renderClientRecipe } from "../src/client-recipes";

const argv = ["/opt/wringer/dist/wring", "mcp", "--connection", "/home/operator/.wringer/connection.json"];
test("the client list is alphabetical and none is a default", () => {
    expect([...MCP_CLIENTS]).toEqual([...MCP_CLIENTS].sort());
    expect(() => parseMcpClient("")).toThrow("None is a default");
    expect(() => parseMcpClient("claude")).toThrow("claude-code, codex, cursor, gemini-cli, generic, kimi, vscode, windsurf");
});
test("every recipe runs the same server command and names its official reference or its absence", () => {
    for (const client of MCP_CLIENTS.filter(name => name !== "codex") as Exclude<typeof MCP_CLIENTS[number], "codex">[]) {
        const recipe = clientRecipe(client, argv), parsed = JSON.parse(recipe.config), servers = parsed[client === "vscode" ? "servers" : "mcpServers"];
        expect(servers.wringer).toEqual({ command: argv[0], args: argv.slice(1) });
        expect(Object.keys(parsed)).toEqual([client === "vscode" ? "servers" : "mcpServers"]);
        if (recipe.addCommand && client !== "vscode") expect(recipe.addCommand).toEndWith(argv.map(arg => `'${arg}'`).join(" "));
        const text = renderClientRecipe(recipe);
        expect(text).toContain("a complete journey on this client is unmeasured");
        expect(recipe.verified ? text.includes("Official connection reference:") : text.includes("No official reference could be verified.")).toBe(true);
    }
    expect(clientRecipe("windsurf", argv).verified).toBe(false);
    expect(clientRecipe("claude-code", argv).addCommand).toBe(`claude mcp add --scope user wringer -- '/opt/wringer/dist/wring' 'mcp' '--connection' '/home/operator/.wringer/connection.json'`);
    expect(clientRecipe("kimi", argv).addCommand).toStartWith("kimi mcp add --transport stdio wringer -- ");
    expect(JSON.parse(clientRecipe("vscode", argv).addCommand!.replace(/^code --add-mcp '/, "").replace(/'$/, ""))).toEqual({ name: "wringer", command: argv[0], args: argv.slice(1) });
});
