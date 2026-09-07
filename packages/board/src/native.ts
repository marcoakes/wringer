import { createHash } from "node:crypto";
import { basename, dirname, relative, resolve } from "node:path";
import type { BoardModel, TimelineItem, UsageLane } from "./model";
type Obj = Record<string, any>;
interface ContextRecords {
    repo: string;
    dirs(path: string): Promise<string[]>;
    text(path: string, required?: boolean): Promise<string | null>;
    yaml(path: string, version: string): Promise<Obj | null>;
    json(path: string, version?: string, required?: boolean): Promise<Obj | null>;
}
const object = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const stable = (v: any): string => Array.isArray(v) ? `[${v.map(stable).join(",")}]` : object(v) ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${stable(value)}`).join(",")}}` : JSON.stringify(v);
const hash = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : stable(v)).digest("hex");
async function json(records: ContextRecords, path: string): Promise<Obj | null> {
    const text = await records.text(path);
    if (text === null)
        return null;
    try {
        const value = JSON.parse(text);
        return object(value) ? value : null;
    }
    catch {
        return null;
    }
}
/** Supplemental context never turns a different verification run into the loop's final run. */
export async function nativeContext(records: ContextRecords, model: BoardModel, spec: Obj | null): Promise<void> {
    if (!model.run || !spec)
        return;
    const candidates: {
        journey: Obj;
        events: Obj[];
        linked: boolean;
        source: string;
    }[] = [];
    for (const directory of await records.dirs(".wringer/workflow/journeys")) {
        const journey = await json(records, resolve(directory, "journey.json"));
        if (!journey || journey.schema_version !== "wringer.workflow-journey.v1" || journey.id !== basename(directory)) {
            model.limits.push(`Native journey context is unreadable: ${relative(records.repo, directory)}. No usage or build attribution was inferred from it.`);
            continue;
        }
        const text = await records.text(resolve(directory, "events.jsonl"));
        const events: Obj[] = [];
        let previous: string | null = null;
        let valid = text !== null && integer(journey.events);
        for (const line of (text ?? "").trimEnd().split("\n").filter(Boolean)) {
            try {
                const event = JSON.parse(line);
                if (!object(event) || event.sequence !== events.length + 1 || event.previous_sha256 !== previous || typeof event.type !== "string" || !Number.isFinite(Date.parse(event.at)))
                    throw new Error("Invalid event chain");
                events.push(event);
                previous = hash(line);
            }
            catch {
                valid = false;
                break;
            }
        }
        if (!valid || events.length !== journey.events || previous !== journey.last_event_hash) {
            model.limits.push(`Native journey ${journey.id} has an incomplete or inconsistent event chain. Its build and usage context cannot be attributed.`);
            continue;
        }
        if (!Number.isFinite(Date.parse(journey.started_at)) || Date.parse(journey.started_at) > Date.parse(model.run.createdAt))
            continue;
        const linked = events.some(e => ["verification", "build-finished"].includes(e.type) && e.runId === model.run!.id && e.evidenceDir === model.run!.path);
        const build = journey.build;
        if (!object(build) || build.status !== "finished" || !object(build.result) || typeof build.result.evidenceDir !== "string")
            continue;
        const buildRun = await records.json(resolve(records.repo, build.result.evidenceDir, "manifest.json"), "wringer.evidence.v1");
        const buildSpec = await records.yaml(resolve(records.repo, build.result.evidenceDir, "wringer.spec.yaml"), "wringer.spec.v1");
        if (!buildRun || buildRun.run_id !== build.result.runId || buildRun.result?.status !== build.result.status || !buildSpec || stable(buildSpec) !== stable(spec))
            continue;
        const sourceEvent = events.find(e => e.type === "draft-readiness" && typeof e.source === "string");
        if (!sourceEvent || !/^\.wringer\/workflow\/sources\/[a-f0-9]{64}\.md$/.test(sourceEvent.source))
            continue;
        const source = await records.text(resolve(records.repo, sourceEvent.source));
        if (source === null || source !== spec.intent || hash(source) !== basename(sourceEvent.source, ".md"))
            continue;
        candidates.push({ journey, events, linked, source });
    }
    candidates.sort((a, b) => Number(b.linked) - Number(a.linked) || Date.parse(b.journey.started_at) - Date.parse(a.journey.started_at));
    const selected = candidates[0];
    if (!selected)
        return;
    const { journey, events, linked } = selected;
    model.journey ??= journey.id;
    const build = journey.build;
    const successful = build.result.status === "passed";
    const buildEvent = events.find(e => e.type === "build-finished" && e.runId === build.result.runId && e.evidenceDir === build.result.evidenceDir && e.status === build.result.status);
    if (buildEvent) {
        const detail = `${successful ? "A build completed" : "A build stopped"} in journey ${journey.id} (build run ${build.result.runId}), with the same frozen specification. ${linked ? "This verification is recorded in that journey, but" : "This later independent verification is not linked as the loop's final run;"} unchanged build lineage is not established for this run.`;
        model.buildContext = { journeyId: journey.id, runId: build.result.runId, detail };
        model.timeline.push({ at: buildEvent.at, label: "Journey build", detail, status: successful ? "complete" : "pending" });
    }
    const calls = events.filter(e => e.type === "draft-call");
    if (!calls.length)
        return;
    let total = 0, missing = 0, changedRequests = 0;
    const seen = new Set<string>();
    for (const event of calls) {
        if (typeof event.request !== "string" || !/^\.wringer\/workflow\/drafts\/[a-f0-9]{64}\/[a-z]+-[a-f0-9]+\/\d+\/request\.json$/.test(event.request) || seen.has(event.request)) {
            missing++;
            continue;
        }
        seen.add(event.request);
        const request = await json(records, resolve(records.repo, event.request));
        const receipt = await json(records, resolve(records.repo, dirname(event.request), "receipt.json"));
        const response = await json(records, resolve(records.repo, dirname(event.request), "response.json"));
        const reported = response?.usage;
        const responseTotal = object(reported) ? Array.isArray(response?.content) && integer(reported.input_tokens) && integer(reported.output_tokens) ? reported.input_tokens + reported.output_tokens : reported.total_tokens : null;
        if (!request || !receipt || !response || receipt.schema_version !== "wringer.draft-call.v1" || receipt.section !== event.section || !["complete", "invalid"].includes(receipt.status) || hash(response) !== receipt.response_sha256 || !object(receipt.usage) || !integer(receipt.usage.total) || !integer(responseTotal) || receipt.usage.total !== responseTotal) {
            missing++;
            continue;
        }
        // Earlier native captures could hash requests before redacting storage.
        // A mismatch limits request identity, not response-reported incurred usage.
        if (hash(request) !== receipt.request_sha256)
            changedRequests++;
        total += receipt.usage.total;
        if (!Number.isSafeInteger(total))
            missing++;
    }
    const basis = `Recorded provider usage from ${calls.length} drafting request(s) in journey ${journey.id}, matched to this run's frozen specification; not independently verified${missing ? `. ${missing} receipt(s) are missing, inconsistent, or have uncertain usage; ${Number.isSafeInteger(total) ? total : "an unknown number of"} tokens are reported by the remaining receipts, not a complete total` : ""}${changedRequests ? `. ${changedRequests} stored request hash(es) differ (redacted or altered); usage follows matching response receipts, not verified request bytes` : ""}`;
    const usage: UsageLane = { lane: "drafting", tokens: missing ? null : total, calls: calls.length, cost: null, basis };
    model.usage[0] = usage;
    model.timeline.push({ at: events.find(e => e.type === "draft-finished")?.at ?? calls.at(-1)!.at, label: "Drafting", detail: `${calls.length} recorded requests · ${missing ? "total usage uncertain" : `${total} reported tokens`}`, status: missing ? "unknown" : "complete" } satisfies TimelineItem);
    model.timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
