import { isIP } from "node:net";
import { RuntimeError, type RuntimePolicy, type RepositorySource } from "./types";
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
// These names alter the privileged runtime client, shell/Git control plane, or host sockets.
// Agent credential forwarding must not become executable configuration forwarding.
const controlEnvironment = /^(?:PATH|HOME|USER|LOGNAME|SHELL|ENV|BASH_ENV|ZDOTDIR|CDPATH|IFS|NODE_OPTIONS|BUN_OPTIONS|PYTHON.*|RUBYOPT|RUBYLIB|PERL5OPT|PERL5LIB|KUBECONFIG|CONTAINER_.*|SSH_AUTH_SOCK|SSH_AGENT_PID|XDG_RUNTIME_DIR|TMPDIR|LD_.*|DYLD_.*|GIT_.*)$/;
export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function parseWritableDirectories(value: unknown, protectedFiles: string[] = []): string[] {
    if (!Array.isArray(value) || value.length > 64)
        throw new RuntimeError("Verifier writable directories must be a bounded explicit list");
    const reserved = new Set([".git", ".wringer", ".github", ".gitlab", ".codex", ".claude", ".agents", "agents.md", "claude.md"]);
    const directories = value.map(path => {
        if (typeof path !== "string" || !path || path.length > 512 || path.startsWith("/") || /[\\\x00-\x1f\x7f:*?\[\]]/.test(path) || path.split("/").some(part => !part || part === "." || part === ".." || reserved.has(part.toLowerCase())))
            throw new RuntimeError("Verifier writable directories must be exact repository-relative names outside policy namespaces");
        return path;
    }).sort();
    const overlaps = (a: string, b: string) => a === "." || b === "." || a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
    for (const [index, path] of directories.entries()) {
        if (directories.slice(0, index).some(other => overlaps(path, other)))
            throw new RuntimeError("Verifier writable directories overlap or duplicate one another");
        if (protectedFiles.some(protectedPath => overlaps(path, protectedPath)))
            throw new RuntimeError("Verifier writable directory overlaps protected acceptance inputs");
    }
    return directories;
}
export function parseRuntimePolicy(value: unknown): RuntimePolicy {
    if (!object(value))
        throw new RuntimeError("An explicit contained runtime policy is required; no host fallback exists");
    if (!["apple-container", "gvisor-kubernetes"].includes(value.kind))
        throw new RuntimeError("Runtime kind must be apple-container or gvisor-kubernetes; no host fallback exists");
    const allowed = ["kind", "image", "cpus", "memoryMiB", "network", "env", "binary", ...(value.kind === "gvisor-kubernetes" ? ["context", "namespace", "runtimeClass", "secretRefs"] : [])];
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new RuntimeError(`Unknown runtime policy ${key}`);
    if (typeof value.image !== "string" || !/^\S+@sha256:[a-f0-9]{64}$/.test(value.image) || value.image.startsWith("-"))
        throw new RuntimeError("Agent runtime image must be pinned by sha256 digest");
    if (!Number.isInteger(value.cpus) || value.cpus < 1 || value.cpus > 64 || !Number.isInteger(value.memoryMiB) || value.memoryMiB < 128 || value.memoryMiB > 262144)
        throw new RuntimeError("Runtime CPU/memory limits must be positive bounded declarations");
    if (value.binary !== undefined && value.binary !== (value.kind === "apple-container" ? "container" : "kubectl"))
        throw new RuntimeError("Repository policy cannot select a host executable; only the standard container/kubectl runtime client is allowed");
    if (value.env !== undefined && (!Array.isArray(value.env) || value.env.some((name: unknown) => typeof name !== "string" || !envName.test(name))))
        throw new RuntimeError("Runtime env must contain environment-variable names only");
    if (value.env?.some((name: string) => controlEnvironment.test(name)))
        throw new RuntimeError("Runtime env cannot forward host/runtime/shell/Git control variables; declare credential or application variable names only", "credential-scope-invalid");
    if (value.env && new Set(value.env).size !== value.env.length)
        throw new RuntimeError("Runtime env contains duplicate names");
    const network = value.network;
    if (!object(network) || !["deny", "allowlist"].includes(network.policy))
        throw new RuntimeError("Declare network policy deny or allowlist");
    for (const key of Object.keys(network))
        if (!["policy", "allow", "dns"].includes(key))
            throw new RuntimeError(`Unknown network setting ${key}`);
    if (network.allow !== undefined && !Array.isArray(network.allow))
        throw new RuntimeError("network.allow must be an explicit CIDR/port list");
    for (const rule of network.allow ?? []) {
        if (!object(rule) || Object.keys(rule).some(key => !["cidr", "ports"].includes(key)))
            throw new RuntimeError("Malformed network rule");
        const parts = typeof rule.cidr === "string" ? rule.cidr.split("/") : [];
        if (parts.length !== 2 || isIP(parts[0]!) !== 4 || !/^\d+$/.test(parts[1]!) || Number(parts[1]) < 1 || Number(parts[1]) > 32 || !Array.isArray(rule.ports) || !rule.ports.length || rule.ports.some((port: unknown) => !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535))
            throw new RuntimeError("Network allowlist needs explicit IPv4 CIDRs (/1 through /32) and ports");
    }
    if (network.dns !== undefined && (!Array.isArray(network.dns) || network.dns.some((ip: unknown) => typeof ip !== "string" || isIP(ip) !== 4)))
        throw new RuntimeError("network.dns must list explicit IPv4 resolvers");
    if (network.policy === "deny" && ((network.allow?.length ?? 0) || (network.dns?.length ?? 0)))
        throw new RuntimeError("A deny network cannot also declare network access");
    if (network.policy === "allowlist" && !network.allow?.length)
        throw new RuntimeError("An allowlist network requires at least one allowed destination");
    if (value.kind === "gvisor-kubernetes") {
        for (const field of ["context", "namespace", "runtimeClass"])
            if (typeof value[field] !== "string" || !value[field] || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value[field]))
                throw new RuntimeError(`Declare a safe Kubernetes ${field}`);
        if (value.secretRefs !== undefined && !object(value.secretRefs))
            throw new RuntimeError("secretRefs must map allowed environment names to existing Kubernetes Secrets");
        for (const [name, ref] of Object.entries(value.secretRefs ?? {})) {
            if (!envName.test(name) || !object(ref) || Object.keys(ref).some(key => !["name", "key"].includes(key)) || ![ref.name, ref.key].every(item => typeof item === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(item)) || !value.env?.includes(name))
                throw new RuntimeError("Secret references must name declared env entries and existing Secret keys");
        }
    }
    return { ...value, env: value.env ?? [], network: { ...network, allow: network.allow ?? [], dns: network.dns ?? [] } } as RuntimePolicy;
}
export function validateRepository(repo: RepositorySource) {
    if (!repo || typeof repo.url !== "string" || !/^[a-f0-9]{40,64}$/.test(repo.commit))
        throw new RuntimeError("Repository source must name an exact committed Git object");
    if (repo.bundlePath) {
        if (typeof repo.bundlePath !== "string" || !repo.bundlePath.startsWith("/"))
            throw new RuntimeError("Git bundle transport path must be absolute");
        return;
    }
    let url: URL;
    try {
        url = new URL(repo.url);
    }
    catch {
        throw new RuntimeError("Use an explicit HTTPS/SSH repository URL or a transported Git bundle");
    }
    if (!["https:", "ssh:"].includes(url.protocol) || url.password || url.protocol === "https:" && url.username || url.search || url.hash)
        throw new RuntimeError("Repository URL must be HTTPS/SSH without embedded credentials, query or fragment");
}
export function firewallScript(policy: RuntimePolicy): string {
    const lines = ["set -eu", "command -v iptables >/dev/null", "command -v ip6tables >/dev/null", "iptables -F OUTPUT", "iptables -P OUTPUT DROP", "ip6tables -F OUTPUT", "ip6tables -P OUTPUT DROP", "iptables -F INPUT", "iptables -P INPUT DROP", "ip6tables -F INPUT", "ip6tables -P INPUT DROP", "iptables -A INPUT -i lo -j ACCEPT", "ip6tables -A INPUT -i lo -j ACCEPT", "iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT", "iptables -A OUTPUT -o lo -j ACCEPT", "ip6tables -A OUTPUT -o lo -j ACCEPT"];
    for (const rule of policy.network.allow ?? [])
        for (const port of rule.ports)
            lines.push(`iptables -A OUTPUT -d ${quote(rule.cidr)} -p tcp --dport ${port} -j ACCEPT`);
    for (const dns of policy.network.dns ?? [])
        for (const protocol of ["udp", "tcp"])
            lines.push(`iptables -A OUTPUT -d ${quote(dns)} -p ${protocol} --dport 53 -j ACCEPT`);
    if (policy.network.dns?.length)
        lines.push(`printf '%s\\n' ${(policy.network.dns ?? []).map(dns => quote(`nameserver ${dns}`)).join(" ")} > /etc/resolv.conf`);
    lines.push("iptables -S OUTPUT", "ip6tables -S OUTPUT");
    return lines.join("\n");
}
