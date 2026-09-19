/**
 * The readiness ladder and its bounded probes.
 *
 * Red first, measured on the ZenJev fixture at alpha.15: `wring doctor` on a
 * repository whose declared checks need a browser, a native PostgreSQL and a
 * filesystem that reads back printed five green ticks and `ready` at exit 0,
 * with no row for any of the three.
 *
 * Every red-watch below was observed failing with its guard removed.
 */
import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, parseRequirement } from "../src/config";
import { doctor, workerCredentialState } from "../src/diagnostics";
import { git } from "../src/git";
import { CREDENTIAL_STATES, probeRequirement, readinessVerdict, RUNGS, type ReadinessRow } from "../src/readiness";
const roots: string[] = [];
async function scratch() {
    const root = await mkdtemp(join(tmpdir(), "wringer-readiness-"));
    roots.push(root);
    return root;
}
async function repo() {
    const root = await scratch();
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Readiness Test"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await writeFile(join(root, ".gitignore"), ".wringer/\n");
    await writeFile(join(root, "source.txt"), "fixture\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    return root;
}
/** A stub package standing in for the repository's pinned browser. */
async function browserModule(root: string, body: string, name = "faux-browser") {
    await mkdir(join(root, "node_modules", name), { recursive: true });
    await writeFile(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js" }));
    await writeFile(join(root, "node_modules", name, "index.js"), body);
    return name;
}
/** A stub container client that RECORDS its argv, so a hidden auto-start cannot pass unseen. */
async function containerClient(root: string, script: string) {
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    const log = join(root, "argv.log");
    const path = join(bin, "faux-container");
    await writeFile(path, `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n${script}\n`);
    await chmod(path, 0o755);
    const previous = process.env.PATH;
    process.env.PATH = `${bin}:${previous ?? ""}`;
    return { log, restore: () => { process.env.PATH = previous; } };
}
test.each([
    [{ kind: "browser" }, { kind: "browser", timeout: 90, module: "playwright", engine: "chromium" }],
    [{ kind: "browser", module: "@scope/pw", engine: "webkit", timeout: 45 }, { kind: "browser", timeout: 45, module: "@scope/pw", engine: "webkit" }],
    [{ kind: "filesystem" }, { kind: "filesystem", timeout: 30 }],
    [{ kind: "container_service" }, { kind: "container_service", timeout: 30, binary: "container" }],
    [{ kind: "native_database", url_env: "DATABASE_URL" }, { kind: "native_database", timeout: 30, url_env: "DATABASE_URL" }],
])("a declared prerequisite parses with its defaults", (input, expected) => {
    expect(parseRequirement(input)).toEqual(expected as any);
});
test("requires refuses what it cannot measure, and a URL in the configuration", () => {
    const base = { version: 1, gates: [{ id: "one", run: "true" }] };
    expect(() => parseRequirement({ kind: "bun" })).toThrow("a repository command is a gate, not a probe");
    expect(() => parseRequirement({ kind: "native_database" })).toThrow("an environment variable NAME, never the URL");
    expect(() => parseRequirement({ kind: "native_database", url_env: "postgres://user:pw@host/db" })).toThrow("a URL in the configuration would be a credential in the repository");
    expect(() => parseRequirement({ kind: "filesystem", url_env: "DATABASE_URL" })).toThrow("url_env does not apply to this probe");
    expect(() => parseRequirement({ kind: "browser", binary: "chrome" })).toThrow("binary does not apply to this probe");
    expect(() => parseRequirement({ kind: "browser", engine: "edge" })).toThrow("chromium, firefox or webkit");
    expect(() => parseConfig({ ...base, requires: { kind: "filesystem" } })).toThrow("list of at most eight");
    expect(() => parseConfig({ ...base, requires: [{ kind: "filesystem" }, { kind: "filesystem" }] })).toThrow("declares filesystem twice");
    expect(parseConfig({ ...base, requires: [{ kind: "browser", engine: "chromium" }, { kind: "browser", engine: "webkit" }] }).requires).toHaveLength(2);
    expect(parseConfig(base).requires).toEqual([]);
});
// RED-WATCH: a probe replaced by a `which`. Presence must never reach `measured`.
test("an installed browser that cannot launch is executable, never ready", async () => {
    const root = await repo();
    const module = await browserModule(root, `const fs=require("node:fs");module.exports={chromium:{executablePath(){return process.execPath},async launch(){fs.writeFileSync(${JSON.stringify(join(root, "launched"))},"yes");throw new Error("Chromium sandbox refused to start")}}};`);
    const measured = await probeRequirement(root, { kind: "browser", timeout: 60, module, engine: "chromium" });
    expect(measured.rung).toBe("executable");
    expect(measured.blocking).toBeTrue();
    expect(measured.measurement).toContain("did not launch");
    expect(measured.measurement).toContain("Chromium sandbox refused to start");
    expect(measured.next).toContain("Nothing was installed or switched.");
    // The probe LAUNCHED: a presence check would have left this file absent.
    expect(await readFile(join(root, "launched"), "utf8")).toBe("yes");
});
test("a browser whose binary is absent is installed, and a missing module is unavailable", async () => {
    const root = await repo();
    const module = await browserModule(root, `module.exports={chromium:{executablePath(){return "/definitely/absent/chrome"},async launch(){throw new Error("never reached")}}};`);
    const absent = await probeRequirement(root, { kind: "browser", timeout: 60, module, engine: "chromium" });
    expect(absent.rung).toBe("installed");
    expect(absent.blocking).toBeTrue();
    expect(absent.next).toContain("install the declared browser");
    const missing = await probeRequirement(root, { kind: "browser", timeout: 60, module: "not-installed-here", engine: "chromium" });
    expect(missing.rung).toBe("unavailable");
    expect(missing.measurement).toContain("absent from");
});
test("a browser that launches, opens about:blank and closes is measured", async () => {
    const root = await repo();
    const module = await browserModule(root, `const fs=require("node:fs");const log=[];module.exports={chromium:{executablePath(){return process.execPath},async launch(){log.push("launch");return {async newPage(){log.push("newPage");return {async goto(u){log.push("goto:"+u)},async title(){return "blank"}}},async close(){log.push("close");fs.writeFileSync(${JSON.stringify(join(root, "sequence.json"))},JSON.stringify(log))}}}}};`);
    const measured = await probeRequirement(root, { kind: "browser", timeout: 60, module, engine: "chromium" });
    expect(measured.rung).toBe("measured");
    expect(measured.blocking).toBeFalse();
    expect(measured.next).toBeNull();
    expect(JSON.parse(await readFile(join(root, "sequence.json"), "utf8"))).toEqual(["launch", "newPage", "goto:about:blank", "close"]);
});
test("the filesystem probe writes, fsyncs and reads back in both locations", async () => {
    const root = await repo();
    const measured = await probeRequirement(root, { kind: "filesystem", timeout: 30 });
    expect(measured.rung).toBe("measured");
    expect(measured.measurement).toContain("workspace:");
    expect(measured.measurement).toContain(".wringer/:");
    expect(measured.measurement).toContain("read back identically");
    await chmod(root, 0o500);
    try {
        const refused = await probeRequirement(root, { kind: "filesystem", timeout: 30 });
        expect(refused.rung).toBe("unavailable");
        expect(refused.blocking).toBeTrue();
        expect(refused.measurement).toContain("refused a bounded write-and-read-back");
    }
    finally {
        await chmod(root, 0o700);
    }
});
// RED-WATCH: a `stopped` container service reported ready, or auto-started.
test("a stopped container service is a readiness row, and nothing is started", async () => {
    const root = await repo();
    const client = await containerClient(root, `echo "apiserver status: not running"\nexit 1`);
    try {
        const stopped = await probeRequirement(root, { kind: "container_service", timeout: 15, binary: "faux-container" });
        expect(stopped.rung).toBe("installed");
        expect(stopped.blocking).toBeTrue();
        expect(stopped.measurement).toContain("service is not running");
        expect(stopped.measurement).toContain("an auto-start that may or may not have worked is not a measurement");
        expect(stopped.next).toBe("faux-container system start");
        // The whole argv the probe ever used, in order. A start would show here.
        expect((await readFile(client.log, "utf8")).trim().split("\n")).toEqual(["system status"]);
    }
    finally {
        client.restore();
    }
});
test("a running container service is measured, and an exit-0 stopped answer is not mistaken for ready", async () => {
    const root = await repo();
    const running = await containerClient(root, `echo "status running"\nexit 0`);
    try {
        expect((await probeRequirement(root, { kind: "container_service", timeout: 15, binary: "faux-container" })).rung).toBe("measured");
    }
    finally {
        running.restore();
    }
    const lying = await containerClient(root, `echo "apiserver is stopped"\nexit 0`);
    try {
        const row = await probeRequirement(root, { kind: "container_service", timeout: 15, binary: "faux-container" });
        expect(row.rung).toBe("installed");
        expect(row.blocking).toBeTrue();
    }
    finally {
        lying.restore();
    }
    expect((await probeRequirement(root, { kind: "container_service", timeout: 15, binary: "definitely-not-installed-client" })).rung).toBe("unavailable");
});
test("a portable database does not satisfy a native requirement, and an unset variable is not measured", async () => {
    const root = await repo();
    const probe = (environment: Record<string, string>) => probeRequirement(root, { kind: "native_database", timeout: 5, url_env: "READINESS_TEST_URL" }, { environment });
    const unset = await probe({});
    expect(unset.rung).toBe("not_measured");
    expect(unset.blocking).toBeFalse();
    expect(unset.measurement).toContain("nothing was contacted");
    for (const url of ["file:./dev.db", "memory://pglite", "sqlite:///tmp/x.db"]) {
        const portable = await probe({ READINESS_TEST_URL: url });
        expect(portable.rung, url).toBe("unavailable");
        expect(portable.measurement, url).toContain("A portable or in-memory database does not satisfy a declared native requirement");
    }
    const malformed = await probe({ READINESS_TEST_URL: "not-a-url-at-all-secretish" });
    expect(malformed.rung).toBe("unavailable");
    expect(malformed.measurement).toContain("Its value was not shown");
    expect(malformed.measurement).not.toContain("secretish");
    const refused = await probe({ READINESS_TEST_URL: "postgres://nobody:pw@127.0.0.1:5/none" });
    expect(refused.rung).toBe("unavailable");
    expect(refused.measurement).toContain("did not answer an identity query");
    expect(refused.measurement).not.toContain("pw@");
});
// RED-WATCH: the doctor reporting `ready` for prerequisites it never measured.
test("the doctor measures every declared prerequisite and cannot report ready while one is blocking", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "one", run: "true" }], requires: [{ kind: "filesystem" }, { kind: "browser", module: "not-installed-here" }] }));
    const report = await doctor(root);
    expect(report.status).toBe("blocked");
    expect(report.exit_code).toBe(1);
    expect(report.readiness.ready).toBeFalse();
    expect(report.readiness.blocking).toEqual(["browser (chromium)"]);
    expect(report.checks.map(c => c.name)).toContain("filesystem (write, fsync, read back)");
    for (const check of report.checks) {
        expect(RUNGS).toContain(check.rung);
        expect(check.measurement.length, check.name).toBeGreaterThan(0);
        if (check.blocking)
            expect(check.next, check.name).toBeTruthy();
    }
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "one", run: "true" }], requires: [{ kind: "filesystem" }] }));
    const clean = await doctor(root);
    expect(clean.exit_code).toBe(0);
    expect(clean.checks.find(c => c.requirement === "filesystem")!.rung).toBe("measured");
    // Undeclared prerequisites are still not measured, and the configuration row says so.
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "one", run: "true" }] }));
    expect((await doctor(root)).checks.find(c => c.name === "configuration")!.next).toContain("declare requires:");
});
// RED-WATCH: `exists` promoted to `accepted` without a session.
test("no route through the standalone doctor can reach accepted", async () => {
    const root = await repo();
    await writeFile(join(root, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "one", run: "true" }] }));
    expect((await doctor(root)).worker_credential).toBe("not-measured");
    for (const credential of ["none", "missing-binary", "contained", "shell-environment", "shell-command", "unmeasured", "key-only", "key-and-login", "key-login-unsettled", "login-only", "unsettled"]) {
        const state = workerCredentialState({ state: "unknown", credential, blocking: false, words: "" } as any);
        expect(CREDENTIAL_STATES).toContain(state);
        expect(state, credential).not.toBe("accepted");
    }
    expect(workerCredentialState(null)).toBe("not-measured");
    expect(workerCredentialState({ state: "not-applicable", credential: "none", blocking: false, words: "" } as any)).toBe("not-measured");
});
test("the verdict is never ready while a declared requirement is short of measured", () => {
    const requirement = (rung: ReadinessRow["rung"]): ReadinessRow => ({ name: rung, requirement: "browser", rung, measurement: "m", next: null, blocking: rung !== "measured" && rung !== "not_measured" });
    for (const rung of RUNGS)
        expect(readinessVerdict([requirement(rung)]).ready, rung).toBe(rung === "measured");
    expect(readinessVerdict([{ name: "runtime", requirement: null, rung: "measured", measurement: "m", next: null, blocking: false }]).ready).toBeTrue();
});
// RED-WATCH: any page debt from the alpha.13 blind run reverted.
test("every page debt the blind run recorded is written on its page", async () => {
    const root = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
    const page = async (name: string) => await Bun.file(join(root, name)).text();
    const runtime = await page("runtime/README.md");
    expect(runtime).toContain("container image pull --platform linux/arm64");            // S-A1
    expect(runtime).toContain("13 GiB to 4.8 GiB");
    const setup = await page("SETUP.md");
    expect(setup).toContain("cidr: 203.0.113.7/32");                                      // S-A2
    expect(setup).toContain("ports: [443]");
    expect(setup).toContain("dns: [203.0.113.53]");
    expect(setup).toContain("Declared resolvers are admitted on port 53");                // S-A8
    expect(setup).toContain("requires:");
    expect(setup).toContain("installed → executable → capability measured");
    expect(setup).toContain("**exists**");
    const headless = await page("docs/native/HEADLESS.md");
    expect(headless).toContain("installed → executable → capability measured");
    expect(headless).toContain("container system start");
    expect(headless).toContain("requires:");
    const design = await page("packages/cli/src/design-cli.ts");
    expect(design).toContain("never below v2: a v3 profile binds to v3");                 // S-A10
    expect(design).toContain("prepare its source beside this profile before setup");      // S-A13
});
afterAll(async () => {
    for (const root of roots.splice(0)) {
        await chmod(root, 0o700).catch(() => { });
        await rm(root, { recursive: true, force: true });
    }
});
