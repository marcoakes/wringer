import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EngineError, sha256 } from "@wringer/engine";
import { readSchema } from "@wringer/records";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
export type Obj = Record<string, any>;
export const isObject = (value: unknown): value is Obj => value !== null && typeof value === "object" && !Array.isArray(value);
export function keys(value: Obj, allowed: string[], label: string) {
    for (const key of Object.keys(value))
        if (!allowed.includes(key))
            throw new EngineError(`${label}: unknown key '${key}'. Graphs name capabilities, never shell commands.`);
}
export function integer(value: unknown, label: string, min = 1, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max)
        throw new EngineError(`${label} must be an integer from ${min} to ${max}.`);
    return value;
}
export function slug(value: unknown, label: string): string {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value))
        throw new EngineError(`${label} must be a slug of at most 64 letters, numbers, underscores or hyphens.`);
    return value;
}
export function strings(value: unknown, label: string): Record<string, string> {
    if (!isObject(value) || Object.values(value).some(v => typeof v !== "string"))
        throw new EngineError(`${label} must map names to strings.`);
    return value;
}
export async function ledger(directory: string, name: string): Promise<Obj[]> {
    const text = await readFile(join(directory, name), "utf8"), events: Obj[] = [];
    let hash = "0".repeat(64);
    const schema = name === "graph.jsonl" ? "graph-event.schema.json" : name === "fleet.jsonl" ? "fleet-event.schema.json" : null;
    if (!schema)
        throw new EngineError(`Unsupported scheduler ledger ${name}.`);
    const validate = addFormats(new Ajv2020({ strict: false })).compile(await readSchema(schema, new URL("../../../schema/", import.meta.url).pathname) as object);
    for (const line of text.split("\n").filter(Boolean)) {
        let event: Obj;
        try {
            event = JSON.parse(line);
        }
        catch {
            throw new EngineError(`${name} contains a partial or invalid event; preserve it for inspection before resuming.`, 3);
        }
        if (!validate(event) || !Number.isFinite(Date.parse(event.ts)))
            throw new EngineError(`${name} contains an event that violates its frozen shape.`, 3);
        if (event.prev_hash !== hash)
            throw new EngineError(`${name} has a broken hash chain; resume refuses altered history.`, 3);
        hash = sha256(line);
        events.push(event);
    }
    return events;
}
export function boundedSignal(seconds: number, parent?: AbortSignal) {
    const controller = new AbortController();
    const relay = () => controller.abort(parent?.reason);
    parent?.addEventListener("abort", relay, { once: true });
    if (parent?.aborted)
        relay();
    const timer = setTimeout(() => controller.abort(new Error("Deadline exhausted")), Math.max(1, Math.min(seconds * 1000, 2147483647)));
    return { signal: controller.signal, dispose() { clearTimeout(timer); parent?.removeEventListener("abort", relay); } };
}
