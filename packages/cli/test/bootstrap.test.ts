import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, writeFile, link, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { distributionHash as hash } from "../src/distribution-manifest";
test("bootstrap refuses changed, aliased and unowned retained bytes before executing its launcher", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-bootstrap-"))), download = join(root, "download"), version = "1.0.0-test.1", platform = `${process.platform}-${process.arch}`;
    await mkdir(download); const binary = `wring-${version}-${platform}`, archive = `wringer-${version}-${platform}.tar.gz`, marker = join(root, "executed");
    const bytes = Buffer.from(`#!/bin/sh\nprintf invoked > '${marker}'\n`);
    for (const [name, content] of [[binary, bytes], [archive, Buffer.from("inert archive; stub launcher never extracts it")]] as const) { await writeFile(join(download, name), content); await writeFile(join(download, `${name}.sha256`), `${hash(content)}  ${name}\n`); }
    const run = () => Bun.spawnSync(["sh", resolve(import.meta.dir, "../../../packaging/install.sh"), "--release", version, "--download-to", download]);
    expect(run().exitCode).toBe(2); expect(await Bun.file(marker).exists()).toBe(false);
    await writeFile(join(download, "WRINGER-DOWNLOAD"), `${version} ${platform}\n`);
    await writeFile(join(download, binary), Buffer.concat([bytes, Buffer.from("# changed\n")]));
    expect(run().exitCode).toBe(2); expect(await Bun.file(marker).exists()).toBe(false);
    await writeFile(join(download, binary), bytes); await link(join(download, binary), join(root, "alias"));
    expect(run().exitCode).toBe(2); expect(await Bun.file(marker).exists()).toBe(false); await unlink(join(root, "alias"));
    expect(run().exitCode).toBe(0); expect(await readFile(marker, "utf8")).toBe("invoked");
});
test("required Linux DAC measurement refuses unsupported prerequisites instead of returning a skipped success", () => {
    if (process.platform === "linux" && process.getuid?.() === 0 && Bun.which("setpriv")) return;
    const child = Bun.spawnSync([process.execPath, "test", "packages/runtime/test/filesystem.test.ts", "--test-name-pattern", "real Linux DAC"], { cwd: resolve(import.meta.dir, "../../.."), env: { ...process.env, WRINGER_REQUIRE_LINUX_DAC: "1" } });
    expect(child.exitCode).not.toBe(0); expect(child.stderr.toString()).toContain("refusing a skipped job");
});
