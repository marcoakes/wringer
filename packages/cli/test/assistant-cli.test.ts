import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantCommand, assistantExecutableCommand, codexConnectionRecipe, readCodexConnection } from "../src/assistant-cli";
import { ASSISTANT_TOOL_NAMES } from "@wringer/mcp";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-assistant-cli-"))); roots.push(root); return root; }
const example = new URL("../../plan/examples/contained.yaml", import.meta.url).pathname;

describe("operator assistant CLI without listeners or models", () => {
    test("help separates narrow tools, real decisions, cooperative security and two usage lanes", async () => {
        const text = (await assistantCommand(["--help"])).text!;
        for (const phrase of ["cooperative", "cash cap", "mcp --connection", "recover", "reconcile", "--operator", "--renew", "never starts the owner", "Human review"]) expect(text).toContain(phrase);
        expect((await assistantCommand(["--version"])).text).toContain("Wringer assistant");
    });
    test("explicit cooperative mode and absolute paths are mandatory before initialization", async () => {
        const root = await scratch();
        await expect(assistantCommand(["init", "--root", root, "--plan", example])).rejects.toThrow("Protected");
        await expect(assistantCommand(["init", "--root", "relative", "--plan", example, "--cooperative-local"])).rejects.toThrow("absolute");
        await expect(assistantCommand(["init", "--root", root, "--plan", example, "--cooperative-local", "--cooperative-local"])).rejects.toThrow("once");
        await expect(assistantCommand(["init", "--root", root, "--plan", example, "--cooperative-local=true"])).rejects.toThrow("no value");
    });
    test("initialization is idempotent; read-only status and recovery never spawn an owner", async () => {
        const root = join(await scratch(), "controller");
        const args = ["init", "--root", root, "--plan", example, "--cooperative-local"];
        expect((await assistantCommand(args)).value).toMatchObject({ created: true, boundary: "cooperative-local" });
        const before = await readFile(join(root, "workspace.json"), "utf8");
        expect((await assistantCommand(args)).value).toMatchObject({ created: false });
        const status = await assistantCommand(["status", "--root", root]); expect(status.value).toMatchObject({ outcome: "absent", jobs: [] });
        expect(JSON.stringify(status)).not.toContain("#token="); expect(JSON.stringify(status)).not.toContain("operatorUrl");
        expect((await assistantCommand(["recover", "--root", root, "--acknowledge-uncertain"])).value).toEqual({ recovered: false });
        expect(await readFile(join(root, "workspace.json"), "utf8")).toBe(before);
        await expect(assistantCommand(["connect", "--root", root, "--client", "codex"])).rejects.toThrow("Start the independent owner");
        await expect(assistantCommand(["recover", "--root", root])).rejects.toThrow("acknowledge");
        await expect(assistantCommand(["reconcile", "--root", root, "--job", "x", "--operation", "x"])).rejects.toThrow("acknowledge");
        expect((await assistantCommand(["stop", "--root", root])).value).toMatchObject({ outcome: "stopped" });
    });
    test("source and compiled child commands never depend on the caller's PATH", () => {
        expect(assistantExecutableCommand("/opt/bun", "/source/assistant-cli.ts")).toEqual(["/opt/bun", "--no-env-file", "--no-install", "--no-macros", "--config=/dev/null", "/source/assistant-cli.ts"]);
        expect(assistantExecutableCommand("/install/wringer-assistant", "/$bunfs/root/assistant-cli.ts")).toEqual(["/install/wringer-assistant"]);
    });
    test("source invocation ignores an untrusted working directory's Bun preload and dotenv", async () => {
        const root = await scratch(), hostile = join(root, "hostile-repository"), trusted = join(root, "trusted-entry");
        await mkdir(hostile); await mkdir(trusted);
        const probe = join(trusted, "probe.ts"), variable = "WRINGER_HOSTILE_CWD_FIXTURE";
        await writeFile(join(hostile, "preload.ts"), '(globalThis as any).__wringerHostilePreload = true;\n');
        await writeFile(join(hostile, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
        await writeFile(join(hostile, ".env"), `${variable}=repository-injected-value\n`);
        await writeFile(probe, `console.log(JSON.stringify({preloaded: (globalThis as any).__wringerHostilePreload ?? false, environment: process.env.${variable} ?? null}));\n`);
        const run = async (argv: string[]) => {
            const child = Bun.spawn(argv, { cwd: hostile, env: { PATH: process.env.PATH ?? "" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
            const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
            if (code !== 0) throw new Error(`Hostile-cwd fixture failed (${code}): ${stderr}`);
            expect(stderr).toBe(""); return JSON.parse(stdout);
        };
        // The control proves this fixture actually changes an unprotected Bun launch.
        expect(await run([process.execPath, probe])).toEqual({ preloaded: true, environment: "repository-injected-value" });
        expect(await run(assistantExecutableCommand(process.execPath, probe))).toEqual({ preloaded: false, environment: null });
        const cli = Bun.spawn([...assistantExecutableCommand(), "--version"], { cwd: hostile, env: { PATH: process.env.PATH ?? "" }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
        expect(await cli.exited).toBe(0); expect(await new Response(cli.stdout).text()).toContain("Wringer assistant"); expect(await new Response(cli.stderr).text()).toBe("");
    });
    test("Codex recipe quotes paths, exposes only the named tool list, and contains no global permission change", () => {
        const recipe = codexConnectionRecipe("/private/PM's folder/connection.json", ["/private/Wringer App/wringer-assistant"]);
        expect(recipe.argv).toEqual(["/private/Wringer App/wringer-assistant", "mcp", "--connection", "/private/PM's folder/connection.json"]);
        expect(recipe.addCommand).toContain("'\\''");
        const parsed = Bun.TOML.parse(recipe.config) as any;
        expect(Object.keys(parsed)).toEqual(["mcp_servers"]); expect(Object.keys(parsed.mcp_servers)).toEqual(["wringer"]);
        expect(parsed.mcp_servers.wringer.command).toBe(recipe.argv[0]); expect(parsed.mcp_servers.wringer.args).toEqual(recipe.argv.slice(1));
        expect(parsed.mcp_servers.wringer.enabled_tools).toEqual([...ASSISTANT_TOOL_NAMES]); expect(parsed.mcp_servers.wringer.env_vars).toEqual([]);
        expect(parsed.mcp_servers.wringer.default_tools_approval_mode).toBe("auto");
        for (const bad of ["dangerously", "full-access", "approval_policy", "sandbox_mode", "codex login", "codex exec", "OPENAI_API_KEY"]) expect(recipe.config + recipe.addCommand).not.toContain(bad);
    });
    test("client inspection preserves unrelated config and never prints its credentials", async () => {
        const root = await scratch(), path = join(root, "config.toml"), command = ["/safe/wringer-assistant", "mcp", "--connection", "/safe/connection.json"];
        expect((await readCodexConnection(path, command)).state).toBe("absent");
        const contents = `[mcp_servers.other]\ncommand = "elsewhere"\nsecret = "never-return-this"\n[mcp_servers.wringer]\ncommand = ${JSON.stringify(command[0])}\nargs = ${JSON.stringify(command.slice(1))}\n`;
        await writeFile(path, contents); const same = await readCodexConnection(path, command); expect(same.state).toBe("matching"); expect(JSON.stringify(same)).not.toContain("never-return-this"); expect(await readFile(path, "utf8")).toBe(contents);
        expect((await readCodexConnection(path, ["/different/command"])).state).toBe("different");
        await writeFile(path, "not valid [ toml"); expect((await readCodexConnection(path, command)).state).toBe("unreadable");
    });
});
