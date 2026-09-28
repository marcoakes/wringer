import { expect, test } from "bun:test";
test("T20 runtime launch requires an explicit provider and model without mutating ambient settings", async () => {
    const { modelLaunch } = await import("../../../runtime/model-launch");
    const before = { PATH: "/usr/bin", CODEX_CONFIG: "unreviewed settings", ANTHROPIC_MODEL: "ambient", CODEX_API_KEY: "fixture-key" };
    const openai = modelLaunch(["openai", "fixture-model"], before);
    expect(JSON.parse(openai.env.CODEX_CONFIG!)).toEqual({ model: "fixture-model", model_provider: "openai" });
    expect(openai.command).toBe("/opt/wringer-agents/node_modules/.bin/codex-acp"); expect(openai.env.CODEX_API_KEY).toBe("fixture-key");
    expect(before.CODEX_CONFIG).toBe("unreviewed settings");
    const anthropic = modelLaunch(["anthropic", "fixture-other"], before);
    expect(anthropic.env.ANTHROPIC_MODEL).toBe("fixture-other"); expect(anthropic.command).toContain("claude-agent-acp");
    for (const args of [[], ["openai"], ["other", "model"], ["openai", "model", "--login"], ["openai", "x\nmodel"]]) expect(() => modelLaunch(args, {})).toThrow();
});
