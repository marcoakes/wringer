/** Shared by routing, help and the distribution manifest. No command imports. */
export const EXECUTABLE_ROUTES = [
    { alias: "wringer-drive", command: "drive", description: "Contained operator commands" },
    { alias: "wringer-board", command: "board", description: "Evidence and review" },
    { alias: "wringer-assistant", command: "assistant", description: "Assistant owner and connection" },
    { alias: "wringer-headless", command: "headless", description: "Contained unattended commands" },
    { alias: "wringer-figma-broker", command: "figma-broker", description: "Optional OAuth broker administration" },
] as const;
export const DISTRIBUTION = {
    executable: "wring",
    aliases: EXECUTABLE_ROUTES,
    documentation: ["README.md", "INSTALL.md", "USING_WRINGER.md", "ASSISTANT_START.md", "docs/ASSISTANT_SECURITY.md", "docs/ASSISTANT_COMPATIBILITY.md", "docs/PM_ASSISTANT_BLIND_TEST.md", "docs/START_AGENT.md", "docs/START_PM.md", "docs/START_OPERATOR.md", "docs/CLI.md", "docs/MIGRATION.md", "SUPPORT.md", "llms.txt"],
    assets: [{ source: "schema", destination: "schema" }, { source: "LICENSE", destination: "LICENSE" }, { source: "runtime", destination: "runtime" }, { source: "integrations", destination: "integrations" }, { source: "examples/adoption", destination: "examples/adoption" }],
    optionalHelpers: [{ name: "wringer-confirm", path: "native/wringer-confirm", protectedMode: false }],
} as const;
