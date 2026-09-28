import { expect, test } from "bun:test";
import * as runtime from "../src/index";
test("T20 inspection separates an installed client and running service from containment and provider work", async () => {
    const inspect = (runtime as any).inspectRuntime; expect(typeof inspect).toBe("function");
    const commands: string[][] = [];
    const deps = { platform: "darwin", arch: "arm64", freeBytes: 17 * 1024 ** 3, which: () => "/fixture/container", command: async (argv: string[]) => { commands.push(argv); return { code: 0, stdout: argv.includes("--version") ? "container CLI version 1.3.1" : "apiserver is running", stderr: "" }; } };
    const result = await inspect({ kind: "apple-container" }, deps);
    expect(result.installation.state).toBe("observed"); expect(result.service.state).toBe("observed");
    for (const field of ["containment", "agentSession", "providerAcceptance", "completedModelWork"]) expect(result[field].state).toBe("unmeasured");
    expect(commands).toEqual([["/fixture/container", "--version"], ["/fixture/container", "system", "status"]]);
    expect(result.platform).toBe("linux/arm64"); expect(result.sideEffects).toEqual([]);
});
test("T20 unavailable containment gives a concrete provisioning route and never chooses a host worker", async () => {
    const inspect = (runtime as any).inspectRuntime; expect(typeof inspect).toBe("function");
    let called = 0;
    const result = await inspect({ kind: "gvisor-kubernetes" }, { platform: "linux", arch: "x64", freeBytes: 9 * 1024 ** 3, which: () => null, command: async () => { called++; throw new Error("not installed"); } });
    expect(result.installation.state).toBe("unavailable"); expect(result.nextAction).toContain("provision");
    expect(result.executionBoundary).toBe("contained-required"); expect(called).toBe(0);
});
test("T20 inspection refuses credential-shaped image references and unknown selection fields before commands", async () => {
    let commands = 0;
    const deps = { platform: "darwin", arch: "arm64", freeBytes: 10 ** 10, which: () => "container", command: async () => { commands++; return { code: 0, stdout: "", stderr: "" }; } };
    await expect(runtime.inspectRuntime({ kind: "apple-container", image: "user:password@registry.invalid/image" }, deps)).rejects.toThrow("identifier");
    await expect(runtime.inspectRuntime({ kind: "apple-container", login: "yes" } as any, deps)).rejects.toThrow("field");
    expect(commands).toBe(0);
});
