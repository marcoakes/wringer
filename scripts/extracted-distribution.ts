/** Execute the exact archived candidate from a fresh directory, with no Bun on PATH. */
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { verifyDistributionManifest } from "./distribution-manifest";
import { extractReleaseArchive, verifyReleaseArchive } from "../packages/cli/src/release-archive";

export async function exerciseArchive(archive: string, output: string) {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), "Wringer extracted "))), extracted = join(scratch, "installed version");
    await mkdir(extracted); await mkdir(output, { recursive: true });
    const name = archive.split("/").at(-1)!, version = /^wringer-(.+)-(?:darwin-arm64|linux-x64)\.tar\.gz$/.exec(name)?.[1];
    if (!version) throw new Error("Select the named native release archive");
    const bytes = await readFile(archive), checksum = await readFile(archive + ".sha256", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== `${sha256}  ${name}\n`) throw new Error("Selected archive checksum declaration differs");
    await extractReleaseArchive(extracted, verifyReleaseArchive(bytes, { sha256, version }));
    const manifest = await verifyDistributionManifest(extracted), checks: { command: string[]; exit: number; passed: boolean; output: string }[] = [];
    async function run(name: string, args: string[], expected = 0, input = "") {
        const child = Bun.spawn([join(extracted, name), ...args], { cwd: scratch, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin", WRINGER_HOME: join(scratch, "application"), TMPDIR: scratch } });
        child.stdin.write(input); child.stdin.end();
        const timer = setTimeout(() => child.kill(), 15000);
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); clearTimeout(timer);
        checks.push({ command: [name, ...args], exit: code, passed: code === expected, output: (stdout + stderr).replaceAll(scratch, "[scratch]") });
        if (code !== expected) throw new Error(`Extracted route failed: ${name} ${args.join(" ")}: ${stderr || stdout}`);
        return { stdout, stderr };
    }
    try {
        await run("wring", ["--version"]); await run("wring", ["--help"]);
        for (const route of manifest.routes) { await run(route.alias, ["--help"]); await run("wring", [route.command, "--help"]); }
        await run("wring", ["no-such-command"], 2);
        const missing = await run("wring", ["mcp", "--connection", join(scratch, "absent.json")], 3);
        if (missing.stdout) throw new Error("MCP error contaminated stdout");
        await cp(join(extracted, "wring"), join(extracted, "renamed tool"));
        await run("renamed tool", ["assistant", "--help"]);
        const demo = JSON.parse((await run("renamed tool", ["demo", "--json"])).stdout);
        if (!demo.simulation || demo.providerCalls !== 0 || demo.red.exit !== 1 || demo.corrected.exit !== 0) throw new Error("Packaged demonstration did not establish its declared fixture outcomes");
        const token = "c".repeat(64), connection = join(scratch, "connection.json");
        const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
            if (request.headers.get("authorization") !== `Bearer ${token}`) return new Response("denied", { status: 403 });
            const body = await request.json();
            return Response.json({ schema_version: "fixture.protocol.v1", outcome: "observed", designDeclared: false, name: body.name, providerCalls: 0 });
        } });
        try {
            await writeFile(connection, JSON.stringify({ schema_version: "wringer.assistant-connection.v1", endpoint: `http://127.0.0.1:${server.port}/call`, token }), { mode: 0o600 });
            const input = [{ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "extracted-fixture", version: "1" } } }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wringer.get_status", arguments: {} } }].map(row => JSON.stringify(row) + "\n").join("");
            const result = await run("wring", ["mcp", "--connection", connection], 0, input);
            const frames = result.stdout.trimEnd().split("\n").map(line => JSON.parse(line));
            if (result.stderr || frames.length !== 3 || !frames.every(row => row.jsonrpc === "2.0") || frames.find(row => row.id === 2)?.result.structuredContent.providerCalls !== 0) throw new Error("Extracted MCP protocol fixture failed");
        } finally { server.stop(true); }
    } finally {
        await writeFile(join(output, "result.json"), JSON.stringify({ schema_version: "wringer.extracted-measurement.v1", kind: "local fixture, not public installation or live-client acceptance", candidate: manifest.source, archive: { name: archive.split("/").at(-1), sha256: createHash("sha256").update(await readFile(archive)).digest("hex"), bytes: (await readFile(archive)).length }, installedBytes: manifest.files.reduce((sum, file) => sum + (file.kind === "file" ? file.bytes : 0), 0), platform: `${process.platform}-${process.arch}`, checks }, null, 2) + "\n");
    }
    return { routes: checks.length, passed: checks.every(row => row.passed) };
}
if (import.meta.main) {
    const [archive, output] = process.argv.slice(2);
    if (!archive || !output) throw new Error("Usage: bun scripts/extracted-distribution.ts ARCHIVE EVIDENCE_DIRECTORY");
    console.log(await exerciseArchive(archive, output));
}
