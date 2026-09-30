/** Credential redaction with no host imports. The default environment is the
 * current process's; pass an explicit environment where the process is absent
 * (a deterministic workflow sandbox) or must not decide the result (replay). */
export class Redactor {
    readonly values: string[];
    private readonly fragments: RegExp | null;
    private readonly shapes: boolean;
    constructor(patterns: string[] = ["*TOKEN*", "*SECRET*", "*KEY*", "*PASSWORD*"], env: NodeJS.ProcessEnv = process.env, extra: string[] = [], shapes = true) {
        this.shapes = shapes;
        const matchers = patterns.map(p => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`, "i"));
        this.values = [...new Set([...Object.entries(env).filter(([k, v]) => v && matchers.some(r => r.test(k))).map(([, v]) => v!), ...extra].filter(v => v.length >= 4))].sort((a, b) => b.length - a.length);
        const parts = new Set<string>();
        for (const value of this.values) {
            // A URL-valued credential/metadata entry can include a sensitive
            // address or query. Its transport scheme alone is public syntax,
            // not a credential fragment shared by every repository URL.
            const schemeLength = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.exec(value)?.[0].length ?? 0;
            if (value.length >= 12)
                for (let n = 6; n < Math.min(value.length, 512); n++) {
                    if (n > schemeLength) parts.add(value.slice(0, n));
                    parts.add(value.slice(-n));
                }
        }
        const escaped = [...parts].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        this.fragments = escaped.length ? new RegExp(`(?<![A-Za-z0-9_-])(?:${escaped.join("|")})(?![A-Za-z0-9_-])`, "g") : null;
    }
    scrub(value: string): string {
        let out = value;
        for (const secret of this.values)
            out = out.replaceAll(secret, "[REDACTED]");
        if (this.fragments)
            out = out.replace(this.fragments, "[REDACTED]");
        return this.shapes ? out.replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]") : out;
    }
    deep<T>(value: T): T {
        if (typeof value === "string")
            return this.scrub(value) as T;
        if (Array.isArray(value))
            return value.map(v => this.deep(v)) as T;
        if (value && typeof value === "object")
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [this.scrub(k), this.deep(v)])) as T;
        return value;
    }
}
