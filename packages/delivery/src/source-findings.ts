import { hashBytes, hashValue } from "@wringer/plan";

export const SOURCE_FINDING_RULES = ["provider-sk", "github-token", "aws-access-key", "private-key-header"] as const;
export interface SourceFinding { id: string; objectId: string; objectType: string; rule: typeof SOURCE_FINDING_RULES[number]; matchSha256: string }
export const SOURCE_FINDING_LIMITS = Object.freeze({ findings: 10_000, matchBytes: 1024 * 1024 });
/** Findings contain no matching bytes or context. The whole object identity and
 * exact matched-byte digest bind review; paths and wildcard rules cannot. */
export class SourceFindingInspector {
    private readonly windows = new Map(SOURCE_FINDING_RULES.map(rule => [rule, { tail: "", preceding: "", dropped: false }]));
    private finished = false;
    constructor(private readonly objectId: string, private readonly objectType: string, private readonly report: (finding: SourceFinding) => void) {}
    write(bytes: Uint8Array) {
        if (this.finished) throw new Error("Source finding inspection is already finished");
        for (let offset = 0; offset < bytes.length; offset += 65536) {
            const text = Buffer.from(bytes.buffer, bytes.byteOffset + offset, Math.min(65536, bytes.length - offset)).toString("latin1");
            for (const rule of SOURCE_FINDING_RULES) this.inspect(text, false, rule);
        }
    }
    finish() { for (const rule of SOURCE_FINDING_RULES) this.inspect("", true, rule); this.finished = true; }
    private inspect(value: string, final: boolean, rule: SourceFinding["rule"]) {
        const window = this.windows.get(rule)!, text = window.preceding + window.tail + value;
        const starts = rule === "provider-sk" ? /\bsk-/g : rule === "github-token" ? /\bgh[pousr]_/g : rule === "aws-access-key" ? /\bAKIA/g : /-----BEGIN /g;
        let retain = Math.max(0, text.length - 11), consumed = 0;
        for (let start; (start = starts.exec(text));) {
            const at = start.index, rest = text.slice(at);
            if (window.dropped && at === 0) continue;
            let match: RegExpExecArray | null, pending = false;
            if (rule === "provider-sk") {
                const payload = /^sk-[A-Za-z0-9_-]*/.exec(rest)![0];
                pending = at + payload.length === text.length && !final;
                match = /^sk-(?:proj-|ant-)?[A-Za-z0-9_-]{12,}\b/.exec(rest);
            } else if (rule === "github-token") {
                const payload = /^gh[pousr]_[A-Za-z0-9]*/.exec(rest)![0];
                pending = at + payload.length === text.length && !final;
                match = /^gh[pousr]_[A-Za-z0-9]{20,}\b/.exec(rest);
            } else if (rule === "aws-access-key") {
                pending = /^AKIA[A-Z0-9]{0,16}$/.test(rest) && !final;
                match = /^AKIA[A-Z0-9]{16}\b/.exec(rest);
            } else {
                pending = /^-----BEGIN [^-]*(?:-{1,4})?$/.test(rest) && !final;
                match = /^-----BEGIN [^-]*PRIVATE KEY-----/.exec(rest);
            }
            if (pending) {
                if (text.length - at > SOURCE_FINDING_LIMITS.matchBytes) throw new Error("Source credential-shaped match exceeds the 1 MiB inspection bound; no partial inventory permits review or handover");
                retain = at; break;
            }
            if (match) {
                if (match[0].length > SOURCE_FINDING_LIMITS.matchBytes) throw new Error("Source credential-shaped match exceeds the 1 MiB inspection bound; no partial inventory permits review or handover");
                const body = { objectId: this.objectId, objectType: this.objectType, rule, matchSha256: hashBytes(Buffer.from(match[0], "latin1")) };
                this.report({ id: hashValue(body), ...body }); starts.lastIndex = at + match[0].length; consumed = starts.lastIndex;
            }
        }
        retain = Math.max(retain, consumed);
        window.preceding = retain ? text[retain - 1]! : ""; window.dropped ||= retain > 0;
        window.tail = final ? "" : text.slice(retain);
    }
}
