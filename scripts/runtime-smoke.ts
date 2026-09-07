import { mkdir, writeFile, readFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";
import { appleContainerIds, openSandbox, parseRuntimePolicy, preflightAgentRole, processDriver, runtimeRedactor, type RuntimeDriver, type RuntimePolicy, type Sandbox, type RepositorySource } from "../packages/runtime/src/index";

export interface SmokeProfile { runtime: RuntimePolicy; networkProbe: { address: string; port: number }; timeoutMs: number }
export function parseSmokeProfile(value: unknown): SmokeProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Smoke profile must be a JSON object");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some(key => !["runtime", "networkProbe", "timeoutMs"].includes(key))) throw Error("Unknown smoke profile field");
  const runtime = parseRuntimePolicy(v.runtime);
  if (runtime.network.policy !== "deny" || runtime.env?.length || runtime.kind === "gvisor-kubernetes" && Object.keys(runtime.secretRefs ?? {}).length) throw Error("Smoke requires network deny and zero credential environment/Secret references");
  const p = v.networkProbe as Record<string, unknown> | undefined;
  if (!p || Object.keys(p).some(key => !["address", "port"].includes(key)) || typeof p.address !== "string" || isIP(p.address) !== 4 || [0, 127].includes(Number(p.address.split(".")[0])) || Number(p.address.split(".")[0]) >= 224 || !Number.isInteger(p.port) || Number(p.port) < 1 || Number(p.port) > 65535) throw Error("networkProbe requires a non-loopback unicast IPv4 address and TCP port for an operator-owned positive control");
  const timeoutMs = v.timeoutMs ?? 180000;
  if (!Number.isInteger(timeoutMs) || Number(timeoutMs) < 30000 || Number(timeoutMs) > 600000) throw Error("timeoutMs must be between 30000 and 600000");
  return { runtime, networkProbe: { address: p.address, port: Number(p.port) }, timeoutMs: Number(timeoutMs) };
}
type Row = { id: string; status: "pass" | "fail" | "inconclusive"; detail: unknown };
const fixture = ["bun", "/opt/wringer-smoke/probe.ts"];
const redact = runtimeRedactor();

/** Always uses the real platform driver. This is not a production test bypass. */
export async function runtimeSmoke(profile: SmokeProfile, output: string, signal?: AbortSignal) {
  const directory = resolve(output);
  await mkdir(directory, { mode: 0o700 }); // Existing evidence is never overwritten.
  const rows: Row[] = [], runtimes = new Set<string>(), active = new Set<Sandbox>();
  const started = new Date().toISOString(), deadline = Date.now() + profile.timeoutMs;
  let sequence = 0;
  const record = async (row: Row) => {
    const safe = JSON.parse(redact(JSON.stringify(row))) as Row;
    rows.push(safe);
    await writeFile(join(directory, `${String(++sequence).padStart(3, "0")}-${row.id}.json`), JSON.stringify(safe, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  };
  const remaining = () => { if (signal?.aborted) throw Error("Smoke interrupted"); const ms = deadline - Date.now(); if (ms < 1) throw Error("Smoke deadline exhausted"); return ms; };
  const driver: RuntimeDriver = {
    async command(argv, options) {
      // Retain identities, not raw platform inspection (which can contain env).
      for (const arg of argv) if (/^wringer-(worker|planner|judge|verifier)-[a-f0-9-]{36}$/.test(arg)) runtimes.add(arg);
      if (argv.includes("create") && options?.input && typeof options.input === "string") {
        try { const body = JSON.parse(options.input); if (body.kind === "Pod" && typeof body.metadata?.name === "string") runtimes.add(body.metadata.name); } catch {}
      }
      return processDriver.command(argv, options);
    },
    connect: (argv, options) => processDriver.connect(argv, options),
  };
  const run = async (sandbox: Sandbox, argv: string[]) => sandbox.run(argv, { timeoutMs: Math.min(15000, remaining()) });
  const checked = async (id: string, sandbox: Sandbox, argv: string[]) => {
    const result = await run(sandbox, argv);
    await record({ id, status: result.code === 0 ? "pass" : "fail", detail: result });
    if (result.code !== 0) throw Error(`Safety probe failed: ${id}`);
    return result;
  };
  let source: RepositorySource | undefined;
  try {
    await writeFile(join(directory, "profile.json"), JSON.stringify(profile, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    const repo = join(directory, "source"), origin = join(directory, "origin.git"), bundlePath = join(directory, "source.bundle");
    await mkdir(repo); await mkdir(join(repo, "src")); await mkdir(join(repo, "tests"));
    await writeFile(join(repo, "src/allowed.txt"), "baseline source\n");
    await writeFile(join(repo, "outside.txt"), "out of worker scope\n");
    await writeFile(join(repo, "tests/protected.txt"), "pinned acceptance\n");
    const gitEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Wringer smoke fixture", GIT_AUTHOR_EMAIL: "wringer@localhost", GIT_COMMITTER_NAME: "Wringer smoke fixture", GIT_COMMITTER_EMAIL: "wringer@localhost" };
    const git = async (...args: string[]) => {
      const result = await processDriver.command(["git", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", "-c", "protocol.file.allow=always", "-C", repo, ...args], { env: gitEnv, timeoutMs: Math.min(15000, remaining()), signal });
      if (result.code !== 0) throw Error(`Local fixture Git failed: ${redact(result.stderr)}`);
      return result.stdout.trim();
    };
    await git("init", "--initial-branch=main"); await git("add", "--", "."); await git("commit", "-m", "Contained smoke fixture baseline");
    await git("init", "--bare", origin); await git("remote", "add", "origin", origin); await git("push", "origin", "main");
    const commit = await git("rev-parse", "HEAD"); await git("bundle", "create", bundlePath, "HEAD");
    source = { url: "https://example.invalid/wringer-local-smoke.git", commit, bundlePath };
    await record({ id: "source", status: "pass", detail: { commit, localBareOrigin: "origin.git", transportedBundle: "source.bundle", liveRemoteUsed: false } });
    const allocate = async (role: "worker" | "judge" | "verifier", policy = profile.runtime) => {
      const sandbox = await openSandbox({ role, repo: source!, policy, timeoutMs: remaining(), signal, driver, redact, ...(role === "worker" ? { scope: { writable: ["src"], protected: ["tests/protected.txt"], writableDirectories: ["node_modules"] } } : {}) });
      active.add(sandbox);
      await record({ id: `allocation-${role}-${sequence}`, status: "pass", detail: sandbox.provenance });
      return sandbox;
    };
    const worker = await allocate("worker"), peer = await allocate("judge"), nonce = randomUUID();
    await checked("worker-scope-and-protected-metadata", worker, [...fixture, "worker", nonce]);
    await checked("peer-source-and-private-storage", peer, [...fixture, "reader", nonce]);
    const sentinel = join(directory, "host-sentinel.txt"), marker = `host-only-${randomUUID()}`;
    await writeFile(sentinel, marker, { mode: 0o600, flag: "wx" });
    await checked("host-filesystem-separation", worker, [...fixture, "host", sentinel, marker]);
    if (await readFile(sentinel, "utf8") !== marker) throw Error("Host sentinel was modified by contained process");
    await record({ id: "host-sentinel-unchanged", status: "pass", detail: "Host bytes unchanged after contained read/write attempts at the same absolute path" });
    const resources = await checked("resource-observations", worker, [...fixture, "resources"]);
    await record({ id: "resource-policy", status: "pass", detail: { declared: { cpus: profile.runtime.cpus, memoryMiB: profile.runtime.memoryMiB }, admissionValidated: true, guest: JSON.parse(resources.stdout), limitation: "Inspect/admission and guest counters measured; no OOM/CPU stress test, kernel escape or hardware side-channel proof" } });
    const controlPolicy = parseRuntimePolicy({ ...profile.runtime, network: { policy: "allowlist", allow: [{ cidr: `${profile.networkProbe.address}/32`, ports: [profile.networkProbe.port] }] } });
    const control = await allocate("verifier", controlPolicy), networkCommand = ["bun", "/opt/wringer-smoke/network-probe.ts", profile.networkProbe.address, String(profile.networkProbe.port)];
    const reachable = await run(control, networkCommand), denied = await run(worker, networkCommand);
    const networkStatus = reachable.code !== 0 ? "inconclusive" : denied.code === 3 && /TCP_HANDSHAKE_(TIMEOUT|REFUSED)/.test(denied.stdout) ? "pass" : "fail";
    await record({ id: "network-deny", status: networkStatus, detail: { positiveControl: reachable, denyPolicy: denied, limitation: "One explicit IPv4 TCP destination/port, no application payload. Not a full network isolation proof." } });
    for (const sandbox of [...active]) { await sandbox.close(); active.delete(sandbox); }
    const preflight = await preflightAgentRole({ role: "judge", repo: source, runtime: profile.runtime, agent: { protocol: "acp", command: "bun", args: ["/opt/wringer-smoke/acp.ts"], env: [] }, budget: { maxTurns: 1, timeoutMs: remaining() }, signal }, { driver });
    await record({ id: "no-model-acp-session", status: preflight.status === "completed" && preflight.promptSent === false && preflight.agentInfo?.name === "wringer-no-model-fixture" ? "pass" : "fail", detail: preflight });
    const cancel = new AbortController();
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = await preflightAgentRole({ role: "judge", repo: source, runtime: profile.runtime, agent: { protocol: "acp", command: "bun", args: ["/opt/wringer-smoke/acp.ts", "--stall-initialize"], env: [] }, budget: { maxTurns: 1, timeoutMs: remaining() }, signal: signal ? AbortSignal.any([signal, cancel.signal]) : cancel.signal, onEvent: async event => { if (event.type === "runtime.prepared") cancelTimer = setTimeout(() => cancel.abort(), 1000); } }, { driver }).finally(() => { if (cancelTimer) clearTimeout(cancelTimer); });
    await record({ id: "cancellation", status: cancelled.stopReason === "cancelled" ? "pass" : "fail", detail: cancelled });
  } catch (error) {
    await record({ id: "stop", status: rows.some(row => row.status === "fail") ? "fail" : "inconclusive", detail: redact(String(error)) });
  } finally {
    for (const sandbox of active) try { await sandbox.close(); } catch (error) { await record({ id: "cleanup-error", status: "fail", detail: redact(String(error)) }); }
    for (const id of runtimes) {
      try {
        const policy = profile.runtime;
        const argv = policy.kind === "apple-container" ? [policy.binary ?? "container", "list", "--all", "--format", "json"] : [policy.binary ?? "kubectl", "--context", policy.context, "--namespace", policy.namespace, "get", "pods,networkpolicies", "-o", "json"];
        const result = await processDriver.command(argv, { timeoutMs: 15000 });
        if (result.code !== 0) throw Error("Platform listing unavailable after cleanup");
        const parsed = JSON.parse(result.stdout);
        let identities: string[];
        if (policy.kind === "apple-container") identities = appleContainerIds(parsed);
        else {
          if (!Array.isArray(parsed.items) || parsed.items.some((entry: any) => typeof entry?.metadata?.name !== "string" || !entry.metadata.name)) throw Error("Unrecognized platform listing; cleanup cannot be confirmed");
          identities = parsed.items.map((entry: any) => entry.metadata.name);
        }
        const present = identities.includes(id);
        await record({ id: `cleanup-${id}`, status: present ? "fail" : "pass", detail: { runtimeId: id, absentFromSuccessfulPlatformListing: !present } });
      } catch (error) { await record({ id: `cleanup-${id}`, status: "inconclusive", detail: redact(String(error)) }); }
    }
  }
  const required = ["worker-scope-and-protected-metadata", "peer-source-and-private-storage", "host-filesystem-separation", "host-sentinel-unchanged", "resource-policy", "network-deny", "no-model-acp-session", "cancellation"];
  const status = rows.some(row => row.status === "fail") ? "fail" : required.every(id => rows.some(row => row.id === id && row.status === "pass")) && !rows.some(row => row.status === "inconclusive") && runtimes.size >= 5 ? "pass" : "inconclusive";
  const report = { schema_version: "wringer.live-runtime-smoke.v1", status, started, finished: new Date().toISOString(), runtime: profile.runtime, sourceCommit: source?.commit ?? null, modelPromptsSent: 0, providerCredentialsForwarded: false, providerAuthenticationMeasured: false, blindJourneyMeasured: false, evidence: "Real platform commands and filesystem/network probes; deterministic no-model ACP fixture", limitations: ["Not an escape-proof security certification", "Resource stress/OOM and comprehensive network/peer reachability are not measured", "Real provider authentication, convergence, and full blind journey remain separate release gates"], rows };
  await writeFile(join(directory, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return report;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("bun scripts/runtime-smoke.ts --profile PROFILE.json --output NEW_DIRECTORY\nRuns real declared containment, no provider calls. Requires digest-pinned built smoke image, ready backend, and an operator-owned TCP positive control. Existing output is refused. Exit: 0 pass, 1 safety failure, 2 inconclusive/unavailable."); }
  else {
    try {
      if (args.length !== 4 || args[0] !== "--profile" || args[2] !== "--output") throw Error("Use --help for the explicit live smoke invocation");
      const path = resolve(args[1]!), info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw Error("Profile must be a bounded regular JSON file");
      const profile = parseSmokeProfile(JSON.parse(await readFile(path, "utf8"))), abort = new AbortController();
      const cancel = () => abort.abort(); process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
      try { const report = await runtimeSmoke(profile, args[3]!, abort.signal); console.log(`Runtime smoke: ${report.status}. Evidence: ${resolve(args[3]!, "report.json")}. No model prompt sent; not a blind-test verdict.`); process.exitCode = report.status === "pass" ? 0 : report.status === "fail" ? 1 : 2; }
      finally { process.off("SIGINT", cancel); process.off("SIGTERM", cancel); }
    } catch (error) { console.error(redact(String(error))); process.exitCode = 2; }
  }
}
