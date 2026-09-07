/** Scrub before any runtime observation is returned to a persistence layer. */
export function runtimeRedactor(names: string[] = []): (text: string) => string {
    const values = names.map(name => process.env[name]).filter((value): value is string => !!value && value.length >= 4).sort((a, b) => b.length - a.length);
    return text => { let result = text; for (const value of values)
        result = result.replaceAll(value, "[REDACTED]"); return result.replace(/\bsk-(?:ant-[A-Za-z0-9_-]+|proj-[A-Za-z0-9_-]+|[A-Za-z0-9_-]{16,})/g, "[REDACTED]").replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]"); };
}
