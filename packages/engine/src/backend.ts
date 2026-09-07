import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runProcess, type ProcessOptions } from "./process";
import { EngineError, type Config, type Containment, type Execution } from "./types";
import { Bundle, shellQuote, safePath } from "./io";
import { exists } from "./config";
export function mountPath(repo: string) {
    repo = resolve(repo);
    if (/[:,\n\r]/.test(repo))
        throw new EngineError(`Container mount path contains a delimiter: ${repo}`, 3);
    return repo;
}
function runtimePath(runtime: string) {
    const path = Bun.which(runtime, { PATH: process.env.PATH });
    if (!path)
        throw new EngineError(`The configured container runtime ${runtime} is not on PATH. Install it before running contained commands.`);
    return path;
}
export async function preflightContainer(repo: string, config: Config) {
    mountPath(repo);
    const policies = [...(config.execution?.backend === "container" ? [config.execution] : []), ...(config.run?.containment ? [config.run.containment] : [])];
    for (const p of policies) {
        const runtime = runtimePath(p.runtime!);
        const images = [p.image!, ...("egress" in p && p.egress.policy === "allowlist" ? [p.egress.broker_image!] : [])];
        for (const image of images) {
            const found = await runProcess([runtime, "image", "inspect", image], { cwd: repo, timeout: 15 });
            if (found.exit_code !== 0)
                throw new EngineError(`Container image ${image} is not available locally. No image was fetched. Run: ${p.runtime} pull ${shellQuote(image)}`);
        }
        if ("requires" in p) {
            const requirements = [...p.requires];
            if (p.egress.policy === "allowlist")
                await probeBinaries(runtime, p.egress.broker_image!, ["iptables", "ip6tables", "getent", "awk", "sort"], repo);
            if (requirements.length)
                await probeBinaries(runtime, p.image, requirements, repo);
        }
    }
}
async function probeBinaries(runtime: string, image: string, requirements: string[], repo: string) {
    const command = requirements.map(name => `command -v ${shellQuote(name)} >/dev/null || { printf '%s\\n' ${shellQuote(`Missing ${name}`)} >&2; exit 127; }`).join("\n");
    const p = await runProcess([runtime, "run", "--rm", "--pull=never", "--network", "none", "--entrypoint", "/bin/sh", image, "-c", command], { cwd: repo, timeout: 15 });
    if (p.exit_code !== 0)
        throw new EngineError(`Container ${image} cannot satisfy the declared requirements: ${p.stderr.trim() || p.stdout.trim()}`);
}
export function containerArgv(policy: Execution, repo: string, cidfile: string, command: string, artifacts?: string) {
    const args = [policy.runtime!, "run", "--rm", "--pull=never", "--cidfile", cidfile, "--volume", `${mountPath(repo)}:/workspace`, "--workdir", "/workspace"];
    if (artifacts)
        args.push("--volume", `${mountPath(artifacts)}:/wringer-artifacts`, "--env", "WRINGER_ARTIFACTS_DIR");
    if (!policy.network)
        args.push("--network", "none");
    for (const name of policy.env ?? [])
        args.push("--env", name);
    if (policy.user)
        args.push("--user", policy.user);
    args.push("--entrypoint", "/bin/sh", policy.image!, "-c", command);
    return args;
}
async function removeContainer(runtime: string, cidfile: string, repo: string) {
    if (!await exists(cidfile))
        return;
    const cid = (await readFile(cidfile, "utf8")).trim();
    if (!/^[a-f0-9]{12,64}$/.test(cid))
        throw new EngineError(`Invalid container id in ${cidfile}; refusing cleanup of an unknown target`, 3);
    await runProcess([runtime, "rm", "--force", cid], { cwd: repo, timeout: 10 });
}
export async function runGateCommand(repo: string, config: Config, bundle: Bundle, dir: string, command: string, options: ProcessOptions, artifacts?: string) {
    if (config.execution?.backend !== "container")
        return runProcess(command, options);
    const cidfile = await safePath(bundle.directory, `${dir}/container.cid`);
    await mkdir(join(bundle.directory, dir), { recursive: true });
    try {
        return await runProcess(containerArgv(config.execution, repo, cidfile, command, artifacts), artifacts ? { ...options, env: { ...options.env, WRINGER_ARTIFACTS_DIR: "/wringer-artifacts" } } : options);
    }
    finally {
        await removeContainer(config.execution.runtime!, cidfile, repo);
    }
}
export function declaredContainment(c: Containment) { return { mode: "contained", runtime: c.runtime, image: c.image, env_allowlist: c.env, user: c.user ?? null, egress: { policy: c.egress.policy, ...(c.egress.policy === "allowlist" ? { hosts: c.egress.hosts, ports: c.egress.ports, broker_image: c.egress.broker_image ?? null } : {}) } }; }
export function executionRecord(config: Config, gates: string[], established?: unknown) {
    const policy = config.execution;
    const out: any = { schema_version: config.run?.containment ? "wringer.execution.v2" : "wringer.execution.v1", backend: policy?.backend ?? "local", execution_mode: policy?.backend === "container" ? "container" : "trusted_local", gates, worker_execution: config.run?.containment ? { declared: declaredContainment(config.run.containment), ...(established ? { established } : {}) } : config.run ? "trusted_local" : null, limits: ["A local command runs with the invoking user's privileges. A container record describes requested runtime flags; it does not claim resistance to a container escape.", "Only environment names explicitly allowed are forwarded to containers. Files in the writable repository mount remain accessible to the commands it runs."] };
    if (policy?.backend === "container")
        Object.assign(out, { runtime: policy.runtime, runtime_path: Bun.which(policy.runtime!, { PATH: process.env.PATH }), image: policy.image, mount: "/workspace", network: policy.network ?? false, env_allowlist: policy.env ?? [], user: policy.user ?? null });
    return out;
}
export function armScript(c: Containment) {
    const hosts = c.egress.hosts.map(shellQuote).join(" "), ports = c.egress.ports.map(String).join(" ");
    return `set -eu
printf '127.0.0.1\\tlocalhost\\n::1\\tlocalhost\\n' > /broker/hosts
ADDRS=''
for host in ${hosts}; do
  found=$(getent ahostsv4 "$host" | awk '{print $1}' | sort -u)
  test -n "$found" || { printf 'UNRESOLVED %s\\n' "$host"; exit 3; }
  for ip in $found; do ADDRS="$ADDRS $ip"; printf '%s\\t%s\\n' "$ip" "$host" >> /broker/hosts; done
done
iptables -P OUTPUT DROP
ip6tables -P OUTPUT DROP
iptables -A OUTPUT -o lo -j ACCEPT
ip6tables -A OUTPUT -o lo -j ACCEPT
for ip in $ADDRS; do
  for port in ${ports}; do iptables -A OUTPUT -d "$ip" -p tcp --dport "$port" -j ACCEPT; done
  printf 'RESOLVED %s\\n' "$ip"
done`;
}
export async function runContainedWorker(repo: string, config: Config, bundle: Bundle, dir: string, command: string, options: ProcessOptions) {
    const c = config.run!.containment!;
    const runtime = runtimePath(c.runtime), workdir = await safePath(bundle.directory, `${dir}/containment`);
    await mkdir(workdir, { recursive: true });
    const cidfile = join(workdir, "worker.cid"), holder = join(workdir, "holder.cid");
    let holderId: string | undefined, resolved: string[] = [];
    try {
        if (c.egress.policy === "allowlist") {
            const start = await runProcess([runtime, "run", "--detach", "--pull=never", "--cidfile", holder, "--cap-add", "NET_ADMIN", "--cap-add", "NET_RAW", "--volume", `${mountPath(workdir)}:/broker`, "--entrypoint", "/bin/sh", c.egress.broker_image!, "-c", `sleep ${Math.ceil((options.timeout ?? 900) + 60)}`], { cwd: repo, timeout: 15, redactor: bundle.redactor });
            if (start.exit_code !== 0)
                throw new EngineError(`The network policy holder could not start: ${start.stderr}`);
            holderId = start.stdout.trim();
            if (!/^[a-f0-9]{12,64}$/.test(holderId))
                throw new EngineError("The network holder returned an invalid container id", 3);
            const armed = await runProcess([runtime, "exec", holderId, "/bin/sh", "-c", armScript(c)], { cwd: repo, timeout: 30, redactor: bundle.redactor });
            await bundle.write(`${dir}/containment/arm.stdout.log`, armed.stdout);
            await bundle.write(`${dir}/containment/arm.stderr.log`, armed.stderr);
            resolved = armed.stdout.split("\n").filter(l => l.startsWith("RESOLVED ")).map(l => l.slice(9));
            if (armed.exit_code !== 0 || resolved.length === 0 || !await exists(join(workdir, "hosts")))
                throw new EngineError(`The declared network allowlist was not established. No worker was started. ${armed.stderr || armed.stdout}`);
        }
        const args = [runtime, "run", "--rm", "--pull=never", "--cidfile", cidfile, "--volume", `${mountPath(repo)}:/workspace`, "--workdir", "/workspace", "--network", holderId ? `container:${holderId}` : "none", "--cap-drop", "NET_ADMIN", "--cap-drop", "NET_RAW", "--security-opt", "no-new-privileges"];
        if (holderId)
            args.push("--volume", `${mountPath(join(workdir, "hosts"))}:/etc/hosts:ro`);
        for (const name of c.env)
            args.push("--env", name);
        if (c.user)
            args.push("--user", c.user);
        args.push("--entrypoint", "/bin/sh", c.image, "-c", command);
        const result = await runProcess(args, options);
        return { result, established: { runtime_path: runtime, mount: "/workspace", ...(holderId ? { egress: { resolved } } : {}) } };
    }
    finally {
        await removeContainer(runtime, cidfile, repo);
        await removeContainer(runtime, holder, repo);
    }
}
