import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { processDriver, type RuntimeDriver } from "@wringer/runtime";
import { Redactor } from "@wringer/engine";
import { hashValue } from "@wringer/plan";
import { SourceFindingInspector, SOURCE_FINDING_LIMITS, type SourceFinding } from "./source-findings";

export interface SourceInspectionLimits { objects: number; objectBytes: number; totalBytes: number; timeoutMs: number }
export const SOURCE_INSPECTION_LIMITS: Readonly<SourceInspectionLimits> = Object.freeze({ objects: 500_000, objectBytes: 512 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024, timeoutMs: 300_000 });
export class SourceInspectionRefusal extends Error {
    constructor(message: string, readonly code: "source-secret" | "source-inspection-limit" | "source-inspection-failed" | "source-inspection-cancelled") { super(message); this.name = "SourceInspectionRefusal"; }
}
function fail(message: string, code: SourceInspectionRefusal["code"] = "source-inspection-failed"): never { throw new SourceInspectionRefusal(message, code); }
const secret = () => fail("Committed source history contains a detected credential; nothing was published and source bytes were not rewritten.", "source-secret");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Same known-value/fragments/shapes as Redactor, but without accumulating a
 * history or a whole object. Matches at an artificial chunk boundary are
 * deferred when their language has a bounded length. No source text is emitted. */
export class StreamingSourceSecretInspector {
    private readonly decoder = new StringDecoder("utf8");
    private readonly fragments: RegExp | null;
    private readonly overlap: number;
    private tail = "";
    private preceding = "";
    private dropped = false;
    private finished = false;
    private pendingGithub = false;
    private headerMode: "search" | "type" | "dashes" = "search";
    private headerTail = "";
    private headerDashes = 0;
    constructor(private readonly redactor: Redactor, private readonly shapes = true) {
        if (redactor.values.some(value => value.length > 65536)) fail("A configured secret exceeds the bounded source-inspection matcher; inspection refused without reading or publishing source.", "source-inspection-limit");
        this.overlap = Math.max(1024, ...redactor.values.map(value => value.length + 2));
        const parts = new Set<string>();
        for (const value of redactor.values) if (value.length >= 12) for (let n = 6; n < Math.min(value.length, 512); n++) { parts.add(value.slice(0, n)); parts.add(value.slice(-n)); }
        this.fragments = parts.size ? new RegExp(`(?<![A-Za-z0-9_-])(?:${[...parts].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![A-Za-z0-9_-])`, "g") : null;
    }
    write(bytes: Uint8Array) {
        if (this.finished) fail("Source inspector was already finished");
        for (let offset = 0; offset < bytes.length; offset += 65536) this.inspect(this.decoder.write(Buffer.from(bytes.buffer, bytes.byteOffset + offset, Math.min(65536, bytes.length - offset))), false);
    }
    finish() { if (this.finished) fail("Source inspector was already finished"); this.inspect(this.decoder.end(), true); this.finished = true; }
    private matched(pattern: RegExp, text: string, final: boolean, unboundedToken = false, github = false) {
        pattern.lastIndex = 0;
        for (let match; (match = pattern.exec(text));) {
            if (this.dropped && match.index === 0) continue; // Its original left boundary is outside this window; it was checked earlier.
            if (!final && !unboundedToken && match.index + match[0].length === text.length) { if (github) this.pendingGithub = true; continue; }
            secret();
        }
    }
    private inspect(value: string, final: boolean) {
        if (this.shapes) this.privateHeader(value);
        if (this.pendingGithub) {
            const ending = /[^A-Za-z0-9]/.exec(value);
            if (ending) { this.pendingGithub = false; if (ending[0] !== "_") secret(); }
            else if (final) secret();
        }
        const text = this.preceding + this.tail + value;
        for (const known of this.redactor.values) if (text.includes(known)) secret();
        if (this.fragments) this.matched(this.fragments, text, final);
        if (!this.shapes) {
            const cut = Math.max(0, text.length - this.overlap);
            this.preceding = cut ? text[cut - 1]! : ""; this.tail = text.slice(cut); this.dropped ||= cut > 0; return;
        }
        // Once a variable-length token has reached its minimum, extending it
        // cannot remove its eventual word boundary in this finite object.
        this.matched(/\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}\b/g, text, final, true);
        // GitHub's payload excludes '_' while a word boundary does not. A
        // pending long alphanumeric suffix must therefore wait for its actual
        // terminator; '_' invalidates it even after many pipe chunks.
        this.matched(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, text, final, false, true);
        this.matched(/\bAKIA[A-Z0-9]{16}\b/g, text, final);
        const cut = Math.max(0, text.length - this.overlap);
        this.preceding = cut ? text[cut - 1]! : "";
        this.tail = text.slice(cut);
        this.dropped ||= cut > 0;
    }
    /** -----BEGIN [^-]*PRIVATE KEY----- has an unbounded type field. Keep
     * only a marker prefix/type suffix, never that field's complete text. */
    private privateHeader(value: string) {
        let text = this.headerMode === "search" ? this.headerTail + value : value;
        if (this.headerMode === "search") this.headerTail = "";
        while (text.length) {
            if (this.headerMode === "search") {
                const found = text.indexOf("-----BEGIN ");
                if (found < 0) { this.headerTail = text.slice(-10); return; }
                text = text.slice(found + 11); this.headerMode = "type"; this.headerTail = "";
            } else if (this.headerMode === "type") {
                const dash = text.indexOf("-");
                if (dash < 0) { this.headerTail = (this.headerTail + text).slice(-11); return; }
                const ending = (this.headerTail + text.slice(0, dash)).endsWith("PRIVATE KEY");
                text = text.slice(dash); this.headerTail = ""; this.headerMode = ending ? "dashes" : "search"; this.headerDashes = 0;
            } else {
                let count = 0; while (count < text.length && text[count] === "-") count++;
                this.headerDashes += count;
                if (this.headerDashes >= 5) secret();
                if (count === text.length) return;
                text = text.slice(count); this.headerMode = "search"; this.headerTail = "";
            }
        }
    }
}

/** Reads at most one pipe chunk plus a bounded protocol header. Raw object
 * bytes bypass the text-capture driver, not its limits for ordinary commands. */
class Bytes {
    private readonly iterator: AsyncIterator<Buffer>;
    private current = Buffer.alloc(0);
    private offset = 0;
    constructor(output: Readable, private readonly check: () => void) { this.iterator = output[Symbol.asyncIterator]() as AsyncIterator<Buffer>; }
    async chunk(maximum = 65536): Promise<Buffer | null> {
        this.check();
        if (this.offset === this.current.length) {
            const next = await this.iterator.next(); this.check();
            if (next.done) return null;
            this.current = Buffer.from(next.value); this.offset = 0;
            if (!this.current.length) return this.chunk(maximum);
        }
        const size = Math.min(maximum, this.current.length - this.offset), result = this.current.subarray(this.offset, this.offset + size); this.offset += size; return result;
    }
    async line(maximum: number): Promise<string | null> {
        const parts: Buffer[] = []; let size = 0;
        while (true) {
            const next = await this.chunk(maximum + 1 - size);
            if (!next) { if (size) fail("Git source inventory ended inside a protocol header"); return null; }
            const newline = next.indexOf(10), count = newline < 0 ? next.length : newline;
            parts.push(next.subarray(0, count)); size += count;
            if (size > maximum) fail("Git source inventory has an oversized protocol header", "source-inspection-limit");
            if (newline >= 0) { this.offset -= next.length - newline - 1; return Buffer.concat(parts).toString("utf8"); }
        }
    }
}
export interface SourceInspectionOptions {
    signal?: AbortSignal;
    /** Enumerate all shape findings, but configured secrets/fragments still
     * refuse immediately and can never become approvable exceptions. */
    collectFindings?: boolean;
    /** Test/stricter-policy seam. It can only reduce the production ceilings. */
    limits?: Partial<typeof SOURCE_INSPECTION_LIMITS>;
    driver?: Pick<RuntimeDriver, "connect">;
}
export async function inspectCandidateHistory(store: string, candidate: string, redactor: Redactor, options: SourceInspectionOptions = {}) {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(candidate)) fail("Source inspection requires the exact candidate commit, not a branch or all refs");
    const limits = { ...SOURCE_INSPECTION_LIMITS, ...options.limits };
    for (const [key, value] of Object.entries(limits)) if (!(key in SOURCE_INSPECTION_LIMITS) || !Number.isSafeInteger(value) || value < 1 || value > SOURCE_INSPECTION_LIMITS[key as keyof typeof SOURCE_INSPECTION_LIMITS]) fail("Source inspection ceilings may only be reduced", "source-inspection-limit");
    options.signal?.throwIfAborted();
    // Validate matcher bounds before launching a process, even for an empty history.
    new StreamingSourceSecretInspector(redactor);
    const driver = options.driver ?? processDriver, transports: Awaited<ReturnType<RuntimeDriver["connect"]>>[] = [];
    let failure: SourceInspectionRefusal | null = null, objects = 0, bytes = 0;
    const findings = new Map<string, SourceFinding>();
    const stop = (error: SourceInspectionRefusal) => { failure ??= error; for (const transport of transports) void transport.terminate(); };
    const check = () => { if (failure) throw failure; };
    const abort = () => stop(new SourceInspectionRefusal("Source inspection was interrupted. Nothing was published; retry preparation of this same candidate to rerun only local inspection.", "source-inspection-cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop(new SourceInspectionRefusal("Source inspection exceeded its five-minute deadline (or a stricter supplied limit). No partial inspection authorizes publication.", "source-inspection-limit")), limits.timeoutMs);
    const argv = ["git", "--no-replace-objects", "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "uploadpack.packObjectsHook=", "-c", "protocol.ext.allow=never", "--git-dir", store];
    const env = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" };
    const connect = async (args: string[]) => {
        const transport = await driver.connect([...argv, ...args], { env }); transports.push(transport);
        let stderr = 0;
        transport.errors?.on("data", chunk => { stderr += Buffer.byteLength(chunk); if (stderr > 1024 * 1024) stop(new SourceInspectionRefusal("Source-inspection diagnostics exceeded their bound; private diagnostic bytes were not retained.", "source-inspection-limit")); });
        check(); return transport;
    };
    try {
        if (options.signal?.aborted) abort(); check();
        const inventory = await connect(["rev-list", "--objects", "--no-object-names", candidate, "--"]), contents = await connect(["cat-file", "--batch"]);
        inventory.input.end();
        const names = new Bytes(inventory.output, check), data = new Bytes(contents.output, check);
        for (let oid; (oid = await names.line(64)) !== null;) {
            if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(oid) || oid.length !== candidate.length) fail("Git returned an invalid object identity during source inspection");
            if (++objects > limits.objects) fail(`Source history exceeds the ${limits.objects}-object inspection ceiling; no objects were skipped and nothing was published.`, "source-inspection-limit");
            await new Promise<void>((resolve, reject) => contents.input.write(oid + "\n", error => error ? reject(new SourceInspectionRefusal("Git source reader stopped accepting object identities", "source-inspection-failed")) : resolve())); check();
            const header = await data.line(128), match = header && /^([a-f0-9]+) (blob|tree|commit|tag) (0|[1-9][0-9]*)$/.exec(header);
            if (!match || match[1] !== oid) fail("Git object response is missing, mismatched or malformed; partial source inspection was refused");
            if (objects === 1 && (oid !== candidate || match[2] !== "commit")) fail("Source inventory is not anchored to the exact candidate commit");
            const size = Number(match[3]);
            if (!Number.isSafeInteger(size) || size > limits.objectBytes || size > limits.totalBytes - bytes) fail(`Source inspection exceeds its ${limits.objectBytes}-byte object or ${limits.totalBytes}-byte inflated-history ceiling; no oversized object was skipped and nothing was published.`, "source-inspection-limit");
            const inspector = new StreamingSourceSecretInspector(redactor, !options.collectFindings);
            const findingInspector = options.collectFindings ? new SourceFindingInspector(oid, match[2]!, finding => {
                findings.set(finding.id, finding);
                if (findings.size > SOURCE_FINDING_LIMITS.findings) fail("Source inspection exceeds 10000 distinct credential-shaped findings; no partial inventory permits review or handover", "source-inspection-limit");
            }) : null;
            let remaining = size;
            while (remaining) { const chunk = await data.chunk(Math.min(remaining, 65536)); if (!chunk) fail("Git object body ended early; partial source inspection was refused"); inspector.write(chunk); findingInspector?.write(chunk); remaining -= chunk.length; bytes += chunk.length; }
            inspector.finish(); findingInspector?.finish();
            const delimiter = await data.chunk(1); if (!delimiter || delimiter[0] !== 10) fail("Git object framing is invalid; partial source inspection was refused");
        }
        contents.input.end();
        if (await data.chunk(1)) fail("Git returned extra object bytes outside the candidate inventory");
        const results = await Promise.all(transports.map(transport => transport.exited)); check();
        if (!objects || results.some(result => result.code !== 0)) fail("Git could not complete exact candidate-history inspection; no partial result authorizes publication");
        const findingInventory = { schema_version: "wringer.source-findings.v1" as const, candidateCommit: candidate, findings: [...findings.values()].sort((a, b) => a.id.localeCompare(b.id)) };
        return { schema_version: "wringer.source-inspection.v1" as const, candidateCommit: candidate, objects, inflatedBytes: bytes, limits, status: "passed" as const, ...(options.collectFindings ? { inventory: { ...findingInventory, sha256: hashValue(findingInventory) } } : {}) };
    } catch (error) {
        if (failure) throw failure;
        if (error instanceof SourceInspectionRefusal) throw error;
        fail("Git source inspection could not complete; no raw source or private diagnostics were retained and no partial result authorizes publication");
    } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); await Promise.all(transports.map(transport => transport.terminate())); }
}
