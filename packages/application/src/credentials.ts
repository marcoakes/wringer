/** Existing Keychain entries are read into this controller process only. Never logged or persisted. */
const services: Record<string, string> = { CODEX_API_KEY: "openai-api-key", OPENAI_API_KEY: "openai-api-key", ANTHROPIC_API_KEY: "anthropic-api-key" };
export async function loadExistingCredentials(names: readonly string[]): Promise<{ name: string; available: boolean; source: "environment" | "keychain" | "unavailable" }[]> {
    const rows: { name: string; available: boolean; source: "environment" | "keychain" | "unavailable" }[] = [];
    for (const name of [...new Set(names)]) {
        if (process.env[name]) { rows.push({ name, available: true, source: "environment" }); continue; }
        if (process.platform === "darwin" && services[name]) {
            try {
                const child = Bun.spawn(["/usr/bin/security", "find-generic-password", "-s", services[name]!, "-a", "wringer", "-w"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", signal: AbortSignal.timeout(10000) });
                const output = await new Response(child.stdout).text(), code = await child.exited;
                if (code === 0 && output.trim()) {
                    process.env[name] = output.replace(/\r?\n$/, "");
                    rows.push({ name, available: true, source: "keychain" });
                    continue;
                }
            } catch { /* Missing/locked entries remain unavailable; never solicit or echo a secret. */ }
        }
        rows.push({ name, available: false, source: "unavailable" });
    }
    return rows;
}
