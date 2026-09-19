import { createHash } from "node:crypto";
export function canonicalJson(value: unknown): string {
    return canonicalValue(value, 0, new Set<object>());
}
function canonicalValue(value: unknown, depth: number, ancestors: Set<object>): string {
    if (depth > 64) throw new Error("Canonical data nesting exceeds 64 levels");
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
        return JSON.stringify(value);
    if (value && typeof value === "object" && (Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)))) {
        if (ancestors.has(value)) throw new Error("Canonical data cannot contain cycles");
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Object.getOwnPropertySymbols(value).length || Object.values(descriptors).some(d => !("value" in d))) throw new Error("Canonical data cannot contain symbols or executable accessors");
        ancestors.add(value);
        try {
            if (Array.isArray(value)) {
                const length = descriptors.length!.value as number;
                if (Object.keys(descriptors).length !== length + 1 || Object.keys(descriptors).some(key => key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length))) throw new Error("Canonical arrays cannot contain holes or named properties");
                return `[${Array.from({ length }, (_, index) => canonicalValue(descriptors[index]!.value, depth + 1, ancestors)).join(",")}]`;
            }
            if (Object.values(descriptors).some(d => !d.enumerable)) throw new Error("Canonical objects cannot contain hidden properties");
            return `{${Object.keys(descriptors).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(descriptors[key]!.value, depth + 1, ancestors)}`).join(",")}}`;
        } finally { ancestors.delete(value); }
    }
    throw new Error("Canonical plans contain only JSON data; functions, undefined and exotic objects are not declarations");
}
export const hashBytes = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const hashValue = (value: unknown) => hashBytes(canonicalJson(value));
export function freezeData<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freezeData);
        Object.freeze(value);
    }
    return value;
}
