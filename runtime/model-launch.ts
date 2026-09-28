/** Installed inside the reviewed ACP image. No import-time execution. */
export function modelLaunch(args: string[], environment: NodeJS.ProcessEnv) {
    if (args.length !== 2 || !["openai", "anthropic"].includes(args[0]!) || !/^[A-Za-z0-9][A-Za-z0-9_.:/+-]{0,159}$/.test(args[1]!)) throw new Error("Select one explicit provider and exact model identifier");
    const [provider, model] = args, env = { ...environment, NO_BROWSER: "1" };
    if (provider === "openai") return { command: "/opt/wringer-agents/node_modules/.bin/codex-acp", env: { ...env, CODEX_CONFIG: JSON.stringify({ model, model_provider: "openai" }), MODEL_PROVIDER: "openai" } as NodeJS.ProcessEnv };
    return { command: "/opt/wringer-agents/node_modules/.bin/claude-agent-acp", env: { ...env, ANTHROPIC_MODEL: model! } as NodeJS.ProcessEnv };
}
if (import.meta.main) {
    if (process.platform !== "linux" || process.getuid?.() !== 1000) throw new Error("This image entrypoint requires the declared unprivileged Linux role environment");
    const selected = modelLaunch(process.argv.slice(2), process.env);
    const child = Bun.spawn([selected.command], { env: selected.env, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
    const interrupt = () => child.kill("SIGTERM"); process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
    try { process.exitCode = await child.exited; } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
}
