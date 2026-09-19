/**
 * One readiness ladder, and the bounded probes that climb it.
 *
 * Measured on 19 September 2026: `wring doctor` on a repository whose declared
 * checks need a browser, a native PostgreSQL and a filesystem that reads back
 * printed five green ticks and `ready` at exit 0, with no row for any of the
 * three. The ZenJev build then lost days to Apple Container permissions,
 * PostgreSQL shared memory, Chromium startup and cloud-filesystem placeholders
 * that no row could have caught, because no row existed.
 *
 * Every rung below is a MEASUREMENT or an admitted absence of one. Nothing here
 * starts a service, installs a tool, switches an execution route or opens a
 * model session: a stopped container service is a readiness row with a next
 * step, never an uncertain auto-start (F-B4), and a credential is never
 * promoted to `accepted` by anything short of a session that actually opened.
 */
import { constants } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess } from "./process";
import { Redactor, safePath, sha256 } from "./io";
import { EngineError, type Requirement } from "./types";
/** installed → executable → measured, with the two honest ends of the ladder. */
export const RUNGS = ["measured", "executable", "installed", "unavailable", "not_measured"] as const;
export type Rung = (typeof RUNGS)[number];
export const RUNG_WORDS: Record<Rung, string> = {
    measured: "capability measured",
    executable: "executable",
    installed: "installed",
    unavailable: "unavailable",
    not_measured: "not measured",
};
/** A ready row is one whose capability was exercised. `installed` is not ready. */
export const READY: ReadonlySet<Rung> = new Set<Rung>(["measured"]);
export interface ReadinessRow {
    name: string;
    /** The declared requirement kind, or null for a row that is not a capability. */
    requirement: string | null;
    rung: Rung;
    /** What was actually observed. Never a restatement of the rung. */
    measurement: string;
    /** One bounded step the operator can take, or null when nothing is outstanding. */
    next: string | null;
    blocking: boolean;
}
/** exists → retrievable → accepted, plus the two non-measurements. */
export const CREDENTIAL_STATES = ["accepted", "retrievable", "exists", "absent", "not-measured"] as const;
export type CredentialState = (typeof CREDENTIAL_STATES)[number];
export const CREDENTIAL_WORDS: Record<CredentialState, string> = {
    exists: "an entry or variable name exists; its value was not read",
    retrievable: "a read succeeded and the value is nonempty; the value was not shown and no provider accepted it",
    accepted: "a session opened with this credential",
    absent: "no entry or variable was found",
    "not-measured": "nothing about this credential was measured",
};
export const READINESS_LIMITS = [
    "A rung is a measurement or an admitted absence of one. `installed` is not `executable`, and `executable` is not a measured capability.",
    "No probe starts a service, installs a tool or switches the execution route. A stopped dependency is a row with a next step.",
    "A probe opens no model session and sends no prompt. `accepted` is reachable only from a session that actually opened.",
    "A measured capability describes this host at this moment. It is not a claim about the machine that will run the checks, if that is a different one.",
];
/** The operator needs the cause, not a runtime's stack. Prefer the error line; never echo a secret. */
const scrub = (value: string) => {
    const clean = new Redactor().scrub(value);
    const lines = clean.split("\n").map(l => l.trim()).filter(Boolean).filter(l => !/^at\s/.test(l) && !/^\^+$/.test(l));
    const named = lines.find(l => /^(?:[A-Za-z]*Error|STOP|error)\b/.test(l)) ?? lines.find(l => l.includes("Error:"));
    return (named ?? lines.join(" ")).replace(/\s+/g, " ").slice(0, 300);
};
/** A declared requirement is ready only when its capability was measured. `installed` and
 * `executable` are measured shortfalls and block; `not_measured` blocks nothing, because
 * nothing was measured and the verdict says so in its own word. */
const row = (name: string, requirement: string | null, rung: Rung, measurement: string, next: string | null): ReadinessRow =>
    ({ name, requirement, rung, measurement, next, blocking: requirement !== null && rung !== "measured" && rung !== "not_measured" });
/** The pinned browser must LAUNCH. An installed Chromium that cannot start is not ready. */
async function probeBrowser(repo: string, requirement: Requirement, signal?: AbortSignal): Promise<ReadinessRow> {
    const moduleName = requirement.module ?? "playwright", engine = requirement.engine ?? "chromium";
    const name = `browser (${engine})`;
    const entry = join(repo, "node_modules", moduleName);
    try {
        const manifest = await open(join(entry, "package.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
        await manifest.close();
    }
    catch {
        return row(name, "browser", "unavailable", `${moduleName} is absent from ${repo}/node_modules, so no pinned browser exists to launch.`, `install this repository's dependencies, then run wring doctor`);
    }
    const runtime = Bun.which("node") ?? process.execPath;
    const script = `const e=require(${JSON.stringify(entry)})[${JSON.stringify(engine)}];const say=(s,d)=>console.log("WRINGER_PROBE "+JSON.stringify({stage:s,detail:d}));say("installed",${JSON.stringify(moduleName)}+" resolved");const p=e.executablePath();require("node:fs").accessSync(p,require("node:fs").constants.X_OK);say("executable",p);(async()=>{const b=await e.launch();try{const g=await b.newPage();await g.goto("about:blank");say("measured",(await g.title())===undefined?"about:blank opened":"about:blank opened");}finally{await b.close();}})().catch(x=>{console.error(String(x&&x.message||x));process.exit(1);});`;
    const probe = await runProcess([runtime, "-e", script], { cwd: repo, timeout: requirement.timeout, signal, maxBytes: 256 * 1024 });
    const stages = [...`${probe.stdout}`.matchAll(/^WRINGER_PROBE (.*)$/gm)].map(m => { try { return JSON.parse(m[1]!); } catch { return null; } }).filter(Boolean) as { stage: string; detail: string }[];
    const reached = stages.at(-1);
    if (probe.exit_code === 0 && reached?.stage === "measured")
        return row(name, "browser", "measured", `${moduleName} ${engine} launched, opened about:blank and closed, measured by ${runtime}.`, null);
    const said = scrub(`${probe.stderr}\n${probe.stdout.replace(/^WRINGER_PROBE .*$/gm, "")}`) || (probe.timed_out ? `no answer within ${requirement.timeout} s` : `exit ${probe.exit_code}`);
    if (reached?.stage === "executable")
        return row(name, "browser", "executable", `The pinned ${engine} binary is present at ${reached.detail} and did not launch: ${said}`, "read that launch error; a sandbox, missing system library or seatbelt policy is the usual cause. Nothing was installed or switched.");
    if (reached?.stage === "installed")
        return row(name, "browser", "installed", `${moduleName} is installed but its ${engine} browser binary is absent or not executable: ${said}`, `${moduleName === "playwright" ? "bun node_modules/playwright/cli.js install " + engine : "install the declared browser"}`);
    return row(name, "browser", "unavailable", `The ${engine} launch probe could not run: ${said}`, `check that ${runtime} can require ${moduleName} in this repository`);
}
/** A portable or in-memory database does not satisfy a native requirement. */
const NATIVE_SCHEMES = new Set(["postgres:", "postgresql:", "mysql:", "mariadb:"]);
async function probeNativeDatabase(requirement: Requirement, environment: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<ReadinessRow> {
    const variable = requirement.url_env!, name = `native database (${variable})`;
    const raw = environment[variable];
    if (!raw)
        return row(name, "native_database", "not_measured", `${variable} is not set in this process, so no database URL was read and nothing was contacted.`, `export ${variable} with the native database URL, then run wring doctor`);
    let url: URL;
    try {
        url = new URL(raw);
    }
    catch {
        return row(name, "native_database", "unavailable", `${variable} is set but is not a URL. Its value was not shown.`, `set ${variable} to a postgres:// URL`);
    }
    if (!NATIVE_SCHEMES.has(url.protocol))
        return row(name, "native_database", "unavailable", `${variable} names a ${url.protocol.replace(":", "")} source. A portable or in-memory database does not satisfy a declared native requirement, and this probe will not accept one as though it did.`, `point ${variable} at a running native server, or remove the native_database requirement from .wringer.yaml`);
    try {
        const sql = new (Bun as any).SQL(raw, { max: 1, connectionTimeout: requirement.timeout, idleTimeout: 1 });
        try {
            signal?.throwIfAborted();
            const rows = await sql`select version() as identity`;
            const identity = scrub(String(rows?.[0]?.identity ?? ""));
            if (!identity)
                return row(name, "native_database", "unavailable", `${url.protocol.replace(":", "")} at ${url.host} answered the identity query with nothing, so no server identity was measured.`, "check that the declared URL names the intended server");
            return row(name, "native_database", "measured", `${url.host} answered select version() with: ${identity}`, null);
        }
        finally {
            await sql.end?.({ timeout: 1 }).catch?.(() => { });
        }
    }
    catch (error) {
        return row(name, "native_database", "unavailable", `${url.protocol.replace(":", "")} at ${url.host} did not answer an identity query: ${scrub(String((error as Error).message ?? error))}`, "start the declared database and re-run wring doctor; nothing was started for you");
    }
}
/** A cloud placeholder that does not read back is unavailable, not ready. */
async function probeFilesystem(repo: string, requirement: Requirement): Promise<ReadinessRow> {
    const name = "filesystem (write, fsync, read back)";
    const measurements: string[] = [];
    for (const where of [".", ".wringer"]) {
        // `.wringer/` is Wringer's own directory and may not exist before the first run;
        // its absence is not a filesystem that cannot hold evidence.
        if (where === ".wringer")
            await mkdir(await safePath(repo, where), { recursive: true, mode: 0o700 }).catch(() => { });
        const probePath = await safePath(repo, join(where, `.wringer-readiness-${sha256(`${where}${requirement.timeout}`).slice(0, 12)}.probe`));
        const payload = `wringer readiness probe ${sha256(probePath).slice(0, 32)}\n`;
        try {
            const file = await open(probePath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
            try {
                await file.writeFile(payload);
                await file.sync();
            }
            finally {
                await file.close();
            }
            const back = await readFile(probePath, "utf8");
            if (back !== payload)
                return row(name, "filesystem", "unavailable", `${where === "." ? "the workspace" : ".wringer/"} accepted a write and read back ${back.length} byte(s) instead of ${payload.length}. A cloud placeholder or synchronising folder that does not read back its own bytes cannot hold evidence.`, "move this repository to local storage, or exclude it from the synchronising folder");
            measurements.push(`${where === "." ? "workspace" : ".wringer/"}: ${payload.length} bytes written, fsynced and read back identically`);
        }
        catch (error) {
            return row(name, "filesystem", "unavailable", `${where === "." ? "the workspace" : ".wringer/"} refused a bounded write-and-read-back: ${scrub(String((error as Error).message ?? error))}`, "grant this user write access to the repository and its .wringer directory");
        }
        finally {
            await rm(probePath, { force: true });
        }
    }
    return row(name, "filesystem", "measured", measurements.join("; ") + ".", null);
}
/** `stopped` is a readiness row with a next step. This never starts the service. */
async function probeContainerService(repo: string, requirement: Requirement, signal?: AbortSignal): Promise<ReadinessRow> {
    const binary = requirement.binary ?? "container", name = `container service (${binary})`;
    const located = Bun.which(binary, { cwd: repo, PATH: process.env.PATH });
    if (!located)
        return row(name, "container_service", "unavailable", `${binary} is not on PATH, so no container service could be asked for its status.`, "install Apple's signed container package, then run container system start");
    const probe = await runProcess([located, "system", "status"], { cwd: repo, timeout: requirement.timeout, signal, maxBytes: 64 * 1024 });
    const said = scrub(`${probe.stdout}\n${probe.stderr}`);
    if (probe.timed_out)
        return row(name, "container_service", "installed", `${located} is installed and did not answer system status within ${requirement.timeout} s. Nothing was started.`, `run ${binary} system status yourself and read its answer`);
    if (probe.exit_code === 0 && !/not running|is stopped|stopped/i.test(said))
        return row(name, "container_service", "measured", `${located} reports: ${said || "system status exited 0 with no output"}`, null);
    return row(name, "container_service", "installed", `${located} is installed and its service is not running: ${said || `system status exited ${probe.exit_code}`}. This probe does not start it, because an auto-start that may or may not have worked is not a measurement.`, `${binary} system start`);
}
export interface ProbeOptions {
    signal?: AbortSignal;
    environment?: NodeJS.ProcessEnv;
}
export async function probeRequirement(repo: string, requirement: Requirement, options: ProbeOptions = {}): Promise<ReadinessRow> {
    repo = resolve(repo);
    switch (requirement.kind) {
        case "browser": return await probeBrowser(repo, requirement, options.signal);
        case "native_database": return await probeNativeDatabase(requirement, options.environment ?? process.env, options.signal);
        case "filesystem": return await probeFilesystem(repo, requirement);
        case "container_service": return await probeContainerService(repo, requirement, options.signal);
        default: throw new EngineError(`Unknown declared requirement ${(requirement as Requirement).kind}`);
    }
}
export async function probeRequirements(repo: string, requirements: Requirement[], options: ProbeOptions = {}): Promise<ReadinessRow[]> {
    const rows: ReadinessRow[] = [];
    for (const requirement of requirements)
        rows.push(await probeRequirement(repo, requirement, options));
    return rows;
}
/** The ladder's own reading of a set of rows: never "ready" while one is blocking. */
export function readinessVerdict(rows: ReadinessRow[]) {
    const blocking = rows.filter(r => r.blocking);
    const unmeasured = rows.filter(r => r.rung === "not_measured");
    return {
        ready: blocking.length === 0 && rows.every(r => r.requirement === null || READY.has(r.rung)),
        blocking: blocking.map(r => r.name),
        not_measured: unmeasured.map(r => r.name),
    };
}
