export interface Args {
    command: string;
    words: string[];
    flags: Map<string, string | boolean | string[]>;
}
export const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
const booleans = new Set(["help", "version", "json", "send", "serial", "prove", "falsify", "headless", "accept", "dry-run", "without-display", "no-open", "ephemeral", "apply", "yes", "retry-uncertain", "retry-stopped", "retry-verification", "retry-judge", "probe-agents", "acknowledge-uncertain", "confirm-new-grant", "strict", "allow-repository-storage"]);
export function parseArgs(argv: string[]): Args {
    const flags = new Map<string, string | boolean | string[]>(), words: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--") {
            words.push(...argv.slice(i + 1));
            break;
        }
        if (arg === "-h") {
            flags.set("help", true);
            continue;
        }
        if (arg === "-V") {
            flags.set("version", true);
            continue;
        }
        if (!arg.startsWith("--")) {
            words.push(arg);
            continue;
        }
        const [key, ...rest] = arg.slice(2).split("=");
        if (!key)
            throw new Error("Empty option");
        let value: string | boolean;
        if (booleans.has(key)) {
            if (rest.length)
                throw new Error(`--${key} takes no value`);
            value = true;
        }
        else {
            value = rest.length ? rest.join("=") : argv[++i]!;
            if (value === undefined || value.startsWith("--"))
                throw new Error(`--${key} needs a value`);
        }
        if (flags.has(key)) {
            if (!["gate", "from", "contender"].includes(key))
                throw new Error(`--${key} was supplied more than once`);
            const previous = flags.get(key)!;
            flags.set(key, [...(Array.isArray(previous) ? previous : [String(previous)]), String(value)]);
        }
        else
            flags.set(key, value);
    }
    return { command: words.shift() ?? "", words, flags };
}
export function flag(a: Args, key: string): boolean { return a.flags.get(key) === true; }
export function string(a: Args, key: string, fallback?: string): string | undefined {
    const value = a.flags.get(key);
    if (value === undefined)
        return fallback;
    if (typeof value !== "string")
        throw new Error(`--${key} needs exactly one string`);
    return value;
}
export function required(a: Args, key: string): string {
    const value = string(a, key);
    if (!value?.trim())
        throw new Error(`--${key} is required`);
    return value;
}
export function values(a: Args, key: string): string[] | undefined {
    const value = a.flags.get(key);
    if (value === undefined)
        return undefined;
    if (typeof value === "boolean")
        throw new Error(`--${key} needs a value`);
    return Array.isArray(value) ? value : [value];
}
export function number(a: Args, key: string, fallback: number): number {
    const raw = string(a, key, String(fallback)), value = Number(raw);
    if (!raw?.trim() || !Number.isSafeInteger(value) || value < 0)
        throw new Error(`--${key} must be a nonnegative integer`);
    return value;
}
export function positionals(a: Args, min: number, max = min): void {
    if (a.words.length < min || a.words.length > max)
        throw new Error(`${a.command} requires ${min === max ? min : `${min} to ${max}`} positional argument${max === 1 ? "" : "s"}; received ${a.words.length}`);
}
export function allowed(a: Args, keys: string[]): void {
    for (const key of a.flags.keys())
        if (!["repo", "json", "help", "version", ...keys].includes(key))
            throw new Error(`Unknown option --${key} for ${a.command || "this command"}`);
}
