import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { previewClientConnection, detectClient } from "../packages/cli/src/client-adapters";
import { installedLauncher } from "../packages/cli/src/adoption-cli";
const root = resolve(import.meta.dir, ".."), scratch = await realpath(await mkdtemp(join(tmpdir(), "wringer-client-measure-")));
const detection = { codex: await detectClient("codex"), claudeCode: await detectClient("claude-code") };
const preview = await previewClientConnection(join(scratch, "application"), { client: "codex", scope: "project", repo: scratch, workspaceId: crypto.randomUUID(), mode: "verification", launcher: installedLauncher() });
let configAcceptance: any = { status: "unavailable" };
if (detection.codex.executable) {
    // CLI overrides exercise the actual installed client's TOML parser without
    // writing its global settings, opening a chat, or starting any model.
    const args = Object.entries(preview.proposedEntry!).flatMap(([key, value]) => ["-c", `mcp_servers.wringer.${key}=${JSON.stringify(value)}`]);
    const child = Bun.spawn([detection.codex.executable, ...args, "mcp", "get", "wringer", "--json"], { cwd: scratch, stdout: "pipe", stderr: "pipe" });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 5000);
    try {
        const [exit, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        const config = exit === 0 ? JSON.parse(stdout) : null;
        if (config?.transport?.command !== preview.proposedEntry!.command || JSON.stringify(config.transport.args) !== JSON.stringify(preview.proposedEntry!.args)) throw new Error("Installed Codex did not accept the exact launcher configuration");
        configAcceptance = { status: "accepted-by-installed-cli", version: detection.codex.version, commandMatched: true, argsMatched: true, via: "explicit CLI configuration overrides", projectTrust: "not-measured", namedClientToolDiscovery: "not-measured", desktop: "not-measured" };
    } finally { clearTimeout(deadline); }
}
const evidence = join(root, "docs/rebuild/evidence/m7"); await mkdir(evidence, { recursive: true });
await writeFile(join(evidence, "client-inventory.json"), JSON.stringify({ at: new Date().toISOString(), platform: process.platform, arch: process.arch, detection: { codex: { ...detection.codex, executable: detection.codex.executable ? "available-on-PATH" : null }, claudeCode: detection.claudeCode }, configAcceptance, modelCalls: 0, accountChanges: 0, userConfigurationWrites: 0, fullLiveJourney: "unmeasured" }, null, 2) + "\n");
console.log(JSON.stringify(configAcceptance));
