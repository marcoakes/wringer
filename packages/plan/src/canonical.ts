import { createHash } from "node:crypto";
export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return JSON.stringify(value);
    if (typeof value === "number" && Number.isFinite(value))
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
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
