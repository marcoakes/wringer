import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite } from "../src/storage";
import { readValidatedContainedState } from "../src/contained";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function scratch() { const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-storage-boundary-"))); roots.push(root); return root; }

/** Isolate the builtin rename spy in another process: no mocked filesystem
 * function can escape into a concurrent workflow/application test. The spy
 * inspects the exact publication boundary, not a timing-sensitive watcher. */
async function inspectPublication(root: string, failRename = false) {
    const script = `
        import { spyOn } from "bun:test";
        import * as fs from "node:fs/promises";
        import { dirname, join, relative } from "node:path";
        const root = ${JSON.stringify(root)}, failRename = ${JSON.stringify(failRename)};
        const events = join(root, ".wringer/contained/events");
        await fs.mkdir(events, { recursive: true });
        const original = fs.rename, observations = [];
        const spy = spyOn(fs, "rename").mockImplementation(async (source, target) => {
            const value = JSON.parse(await fs.readFile(source, "utf8"));
            observations.push({ staging: relative(root, dirname(source)), target: relative(root, target), fileMode: (await fs.lstat(source)).mode & 0o777, directoryMode: (await fs.lstat(dirname(source))).mode & 0o777, eventNames: await fs.readdir(events), completePayload: value.generation > 0 && value.body.length === 32768 });
            if (failRename) throw new Error("Synthetic publication failure");
            return original(source, target);
        });
        try {
            const { atomicWrite } = await import(${JSON.stringify(new URL("../src/storage.ts", import.meta.url).href)});
            let failure = null;
            try { for (const generation of [1, 2]) await atomicWrite(root, ".wringer/contained/events/000001.json", JSON.stringify({ generation, body: "x".repeat(32768) })); }
            catch (error) { failure = error.message; }
            const staging = await fs.readdir(join(root, ".wringer/write-pending")).catch(() => null);
            const final = await fs.readFile(join(events, "000001.json"), "utf8").then(JSON.parse).catch(() => null);
            console.log(JSON.stringify({ observations, staging, failure, finalGeneration: final?.generation ?? null, eventNames: await fs.readdir(events) }));
        } finally { spy.mockRestore(); }
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (code !== 0) throw new Error(`Isolated storage fixture failed: ${err}`);
    return JSON.parse(out);
}

test("atomic publication never exposes a temporary filename in authoritative event directories", async () => {
    const observed = await inspectPublication(await scratch());
    expect(observed.observations).toHaveLength(2); // proves the named-import spy intercepted both writes
    for (const row of observed.observations) {
        expect(row.staging).toBe(".wringer/write-pending");
        expect(row.target).toBe(".wringer/contained/events/000001.json");
        expect(row.fileMode).toBe(0o600); expect(row.directoryMode).toBe(0o700);
        expect(row.completePayload).toBe(true);
        expect(row.eventNames.every((name: string) => /^\d{6}\.json$/.test(name))).toBe(true);
    }
    expect(observed.observations[0].eventNames).toEqual([]); expect(observed.observations[1].eventNames).toEqual(["000001.json"]);
    expect(observed.failure).toBeNull(); expect(observed.finalGeneration).toBe(2); expect(observed.staging).toEqual([]); expect(observed.eventNames).toEqual(["000001.json"]);
});

test("a failed rename cleans only its private staging file and leaves no partial event", async () => {
    const observed = await inspectPublication(await scratch(), true);
    expect(observed.observations).toHaveLength(1); expect(observed.failure).toBe("Synthetic publication failure");
    expect(observed.staging).toEqual([]); expect(observed.eventNames).toEqual([]); expect(observed.finalGeneration).toBeNull();
});

for (const destination of ["inside", "outside"]) test(`atomic staging refuses a symlink pointing ${destination} the controller`, async () => {
    const root = await scratch(), redirected = destination === "inside" ? join(root, "redirected") : await scratch();
    await mkdir(redirected, { recursive: true }); await mkdir(join(root, ".wringer"));
    await symlink(redirected, join(root, ".wringer/write-pending"));
    await expect(atomicWrite(root, ".wringer/contained/events/000001.json", "{}\n")).rejects.toThrow();
    expect(await readdir(redirected)).toEqual([]);
    expect(await lstat(join(root, ".wringer/contained/events/000001.json")).catch(() => null)).toBeNull();
});

test("strict journey reading still rejects a foreign event filename", async () => {
    const root = await scratch();
    await mkdir(join(root, ".wringer/contained/events"), { recursive: true });
    await writeFile(join(root, ".wringer/contained/events/foreign.tmp"), "Do not silently ignore foreign evidence\n");
    await expect(readValidatedContainedState(root)).rejects.toThrow("Unknown file in authoritative journey event namespace");
});
