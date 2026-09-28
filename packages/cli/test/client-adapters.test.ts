import { test, expect } from "bun:test";
import { mkdtemp, mkdir, realpath, writeFile, unlink, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as adapters from "../src/client-adapters";
import { registerWorkspace, readAssistantRecord, writeAssistantRecord } from "@wringer/application";
import { hashValue } from "@wringer/plan";
import { git } from "@wringer/engine";
import { dispatch } from "../src/app";
const api = adapters as any;
test("custom client configuration roots refuse before previewing unused defaults", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-custom-root-"))), repo = join(root, "repo"); await mkdir(repo);
    const input = { scope: "project", repo, workspaceId: crypto.randomUUID(), launcher: ["/wring"], mode: "verification" };
    for (const [client, variable] of [["codex", "CODEX_HOME"], ["claude-code", "CLAUDE_CONFIG_DIR"]] as const) {
        const previous = process.env[variable]; process.env[variable] = join(root, "custom-client");
        try { await expect(api.previewClientConnection(join(root, "app"), { ...input, client })).rejects.toThrow("custom configuration"); }
        finally { if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous; }
    }
    expect(await Bun.file(join(repo, ".codex/config.toml")).exists()).toBe(false);
    expect(await Bun.file(join(repo, ".mcp.json")).exists()).toBe(false);
});
test("T19 named Codex edits preserve unrelated settings and comments without granting routine tool approval by default", () => {
    expect(typeof api.editClientConfiguration).toBe("function");
    const before = '# retain comment\nmodel = "operator-selected"\n[mcp_servers.other]\ncommand = "/other"\n\n[mcp_servers.wringer]\ncommand = "/old"\nargs = []\n\n[projects."/project"]\ntrust_level = "trusted"\n';
    const entry = { command: "/space path/wring", args: ["mcp", "--connection", "/private state/connection.json"], env_vars: [], enabled_tools: ["wringer.get_status"], startup_timeout_sec: 10, tool_timeout_sec: 40 };
    const after = api.editClientConfiguration("codex", before, entry);
    const parsed = Bun.TOML.parse(after) as any; expect(parsed.mcp_servers.wringer).toEqual(entry); expect(parsed.model).toBe("operator-selected");
    expect(parsed.mcp_servers.other.command).toBe("/other"); expect(after).toContain("# retain comment"); expect(after).not.toContain("default_tools_approval_mode");
    const removed = Bun.TOML.parse(api.editClientConfiguration("codex", after, null)) as any; expect(removed.mcp_servers.wringer).toBeUndefined(); expect(removed.projects["/project"].trust_level).toBe("trusted");
});
test("T19 an old completed connection transaction cannot bypass advanced ownership", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-history-"))), repo = join(root, "repo"), app = join(root, "app"); await mkdir(repo);
    const input = { client: "codex", scope: "project", repo, workspaceId: crypto.randomUUID(), launcher: ["/wring"], mode: "verification" };
    const preview = await api.previewClientConnection(app, input); await api.applyClientConnection(app, input, preview.identity);
    const plan = await readAssistantRecord<any>(app, `client-transactions/${preview.identity}.json`), previous = plan.next;
    await writeAssistantRecord(app, `client-bindings/${previous.id}/00000002.json`, { ...previous, previous: hashValue(previous), sequence: 2, workspaceId: crypto.randomUUID() });
    await expect(api.applyClientConnection(app, input, preview.identity)).rejects.toThrow("ownership advanced");
});
test("T19 canonical connect applies a scoped skill and named entry without an owner side effect", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-cli-"))), repo = join(root, "repo"), app = join(root, "app"); await mkdir(repo);
    await git(repo, ["init", "-b", "main"]); await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: { test: "false" } }));
    const workspace = await registerWorkspace(app, { repo, mode: "verification", client: "claude-code" });
    const args = ["connect", "--app-dir", app, "--workspace", workspace.id, "--client", "claude-code", "--scope", "project"];
    const preview = (await dispatch([...args, "--dry-run", "--json"])).value as any;
    expect((await dispatch([...args, "--apply", "--expected", preview.identity])).value).toMatchObject({ applied: true });
    expect(await Bun.file(join(repo, ".claude/skills/wringer/SKILL.md")).exists()).toBe(true);
    expect(await Bun.file(join(app, "owners", workspace.id, "owner.lock")).exists()).toBe(false);
    const removal = (await dispatch([...args, "--remove", "--dry-run", "--json"])).value as any;
    expect((await dispatch([...args, "--remove", "--apply", "--expected", removal.identity])).value).toMatchObject({ applied: true });
});
test("T19 scoped Claude JSON changes preserve other servers, reject duplicate keys, and never alter permissions", () => {
    expect(typeof api.editClientConfiguration).toBe("function");
    const entry = { type: "stdio", command: "/wring", args: ["mcp", "--connection", "/private/connection.json"] };
    const after = JSON.parse(api.editClientConfiguration("claude-code", JSON.stringify({ mcpServers: { other: { command: "/other" } }, unrelated: true }), entry));
    expect(after).toEqual({ mcpServers: { other: { command: "/other" }, wringer: entry }, unrelated: true });
    expect(() => api.editClientConfiguration("claude-code", '{"mcpServers":{},"mcpServers":{}}', entry)).toThrow();
});
test("T19 connection preview, exact apply, update and owned removal preserve unrelated configuration and refuse stale changes", async () => {
    expect(typeof api.previewClientConnection).toBe("function"); expect(typeof api.applyClientConnection).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-"))), app = join(root, "application"), repo = join(root, "project with spaces"), home = join(root, "user");
    await mkdir(join(repo, ".codex"), { recursive: true }); await mkdir(home);
    const config = join(repo, ".codex/config.toml"); await writeFile(config, '# untouched\nmodel = "chosen"\n[mcp_servers.other]\ncommand="/other"\n');
    const input = { client: "codex", scope: "project", repo, home, workspaceId: crypto.randomUUID(), launcher: ["/absolute path/wring"], mode: "verification" };
    const preview = await api.previewClientConnection(app, input);
    expect(preview.authority).toBe("none"); expect(await Bun.file(join(repo, ".agents/skills/wringer/SKILL.md")).exists()).toBe(false);
    await api.applyClientConnection(app, input, preview.identity);
    const installed = Bun.TOML.parse(await Bun.file(config).text()) as any;
    expect(installed.mcp_servers.wringer.command).toBe(input.launcher[0]); expect(installed.mcp_servers.wringer.enabled_tools).toContain("wringer.get_evidence");
    expect(installed.mcp_servers.wringer.default_tools_approval_mode).toBeUndefined();
    expect(installed.mcp_servers.wringer.enabled_tools).not.toContain("wringer.approve");
    expect(await Bun.file(join(repo, ".agents/skills/wringer/SKILL.md")).exists()).toBe(true);
    await api.applyClientConnection(app, input, preview.identity); // Lost response observes exact completed install.
    const next = { ...input, launcher: ["/updated/wring"] }, changed = await api.previewClientConnection(app, next);
    await writeFile(config, (await Bun.file(config).text()) + '\n# concurrent change\n');
    await expect(api.applyClientConnection(app, next, changed.identity)).rejects.toThrow("changed");
    const fresh = await api.previewClientConnection(app, next); await api.applyClientConnection(app, next, fresh.identity);
    const remove = { ...next, remove: true }, removal = await api.previewClientConnection(app, remove); await api.applyClientConnection(app, remove, removal.identity);
    const final = Bun.TOML.parse(await Bun.file(config).text()) as any; expect(final.mcp_servers.wringer).toBeUndefined(); expect(final.mcp_servers.other.command).toBe("/other"); expect(final.model).toBe("chosen");
    expect(await Bun.file(join(repo, ".agents/skills/wringer/SKILL.md")).exists()).toBe(false);
});
test("T19 client installation resumes a retained write, refuses edited ownership, and never follows config aliases", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-resume-"))), app = join(root, "application"), repo = join(root, "repo"); await mkdir(repo);
    const input = { client: "claude-code", scope: "project", repo, workspaceId: crypto.randomUUID(), launcher: ["/wring"], mode: "delegation" };
    const preview = await api.previewClientConnection(app, input); await api.applyClientConnection(app, input, preview.identity);
    const plan = await readAssistantRecord<any>(app, `client-transactions/${preview.identity}.json`);
    await unlink(join(app, `client-bindings/${plan.next.id}/00000001.json`)); // Lost ownership-commit response after exact file writes.
    await api.applyClientConnection(app, input, preview.identity);
    expect((await readAssistantRecord<any>(app, `client-bindings/${plan.next.id}/00000001.json`)).entryIdentity).toBe(plan.next.entryIdentity);
    const config = join(repo, ".mcp.json"); await writeFile(config, JSON.stringify({ mcpServers: { wringer: { command: "/user-replacement" } } }));
    await expect(api.previewClientConnection(app, { ...input, remove: true })).rejects.toThrow("owned");
    const original = await Bun.file(config).text(); await unlink(config); const foreign = join(root, "foreign.json"); await writeFile(foreign, original); await symlink(foreign, config);
    await expect(api.previewClientConnection(app, input)).rejects.toThrow("symlink"); expect(await Bun.file(foreign).text()).toBe(original);
});
test("T19 explicit routine approval is scoped to the restricted Codex server", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-approval-"))), repo = join(root, "repo"); await mkdir(repo);
    const input = { client: "codex", scope: "user", home: root, repo, workspaceId: crypto.randomUUID(), launcher: ["/wring"], mode: "verification", autoApprove: true };
    const preview = await api.previewClientConnection(join(root, "app"), input);
    expect(preview.proposedEntry.default_tools_approval_mode).toBe("auto"); expect(preview.changes[0].path).toBe(join(root, ".codex/config.toml"));
    await expect(api.previewClientConnection(join(root, "app"), { ...input, client: "claude-code" })).rejects.toThrow("auto-approval");
});
