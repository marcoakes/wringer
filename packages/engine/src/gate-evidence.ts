/**
 * A gate's structured assertion observation, on the standalone route.
 *
 * Exit codes answer whether a command succeeded. They do not say whether any
 * assertion ran, whether the browser started, or whether every test was
 * skipped. This module reads the runner's own report through an adapter, applies
 * the shared rules, and records what it found beside the gate.
 *
 * The environment classification comes from the supervisor's own measurements
 * and never from log text: a shell that could not execute the command (126/127),
 * a command that produced no report at all, or — for a browser runner — the
 * bounded launch probe of `requires:`. A Playwright run whose browser binary is
 * absent reports two FAILED specs and an empty top-level `errors` array; the
 * only trace in the runner's JSON is inside an error message, which is exactly
 * the thing that must not decide this.
 */
import { readFile } from "node:fs/promises";
import { observeAssertions, type CheckEvidenceObservation } from "@wringer/records";
import { assertionReport, translate, type Translation } from "./adapters";
import { Bundle, safePath } from "./io";
import { type ReadinessRow } from "./readiness";
import { type Gate, type ProcessResult } from "./types";
export interface GateAssertionRow {
    gate_id: string;
    adapter: string;
    source: string;
    status: "established" | "unavailable";
    classification: "assertions" | "environment";
    counts: Translation["counts"] | null;
    requirements: string[];
    assertions: {
        id: string;
        name: string;
        status: string;
    }[];
    observation: string | null;
    report_sha256: string | null;
    reason: string;
}
export const GATE_ASSERTION_LIMITS = [
    "An established observation reports that assertions executed. It does not establish that they are honest, sufficient, or that they cover the requirement's meaning.",
    "The environment classification rests on the supervisor's own measurements — a shell that could not execute the command, an absent report, or the bounded launch probe — never on text found in a log.",
    "A translated assertion identity is derived from the runner's own test name. Renaming a test changes its identity here, which is the point: the comparison is between the same assertions.",
    "`unavailable` means this run established nothing about the requirement. It is not a product assertion that failed.",
];
/** 126/127 are the shell's own answer that it could not execute the command. */
const SPAWN_EXITS = new Set([126, 127]);
export interface GateAssertionOptions {
    /** The bounded browser launch probe for this repository, memoised per run. Null when none is declared. */
    browserProbe: () => Promise<ReadinessRow | null>;
}
export async function observeGateAssertions(repo: string, gate: Gate, bundle: Bundle, attemptDir: string, process: ProcessResult, options: GateAssertionOptions): Promise<{
    row: GateAssertionRow;
    observation: CheckEvidenceObservation | null;
}> {
    const evidence = gate.evidence!;
    let source = "";
    let sourceName = "the gate's captured stdout";
    let readError: string | null = null;
    if (evidence.report) {
        sourceName = evidence.report;
        try {
            source = await readFile(await safePath(repo, evidence.report), "utf8");
        }
        catch (error) {
            readError = `The declared report ${evidence.report} could not be read after the gate ran: ${(error as Error).message}`;
        }
    }
    else
        source = process.stdout;
    let translation: Translation | null = null;
    let produceError: string | null = readError;
    if (!produceError) {
        try {
            translation = translate(evidence.adapter, source);
        }
        catch (error) {
            produceError = (error as Error).message;
        }
    }
    const observation = observeAssertions(gate.id, () => {
        if (produceError)
            throw new Error(produceError);
        return assertionReport(translation!, gate.proves);
    }, process.timed_out ? null : process.exit_code, gate.proves);
    // Classification, from measurements this supervisor made itself.
    let classification: GateAssertionRow["classification"] = "assertions";
    let environmentReason: string | null = null;
    if (SPAWN_EXITS.has(process.exit_code)) {
        classification = "environment";
        environmentReason = `The shell exited ${process.exit_code}: it could not execute the gate's command. No assertion ran.`;
    }
    else if (process.timed_out) {
        classification = "environment";
        environmentReason = "The gate exceeded its declared timeout, so the run was cut short rather than answered.";
    }
    else if (produceError && !translation) {
        classification = "environment";
        environmentReason = `No readable ${evidence.adapter} report came out of this gate, so nothing was measured about its assertions.`;
    }
    else if ((observation.status === "unavailable" || translation!.counts.failed > 0) && evidence.adapter === "playwright") {
        const probe = await options.browserProbe();
        if (probe && probe.rung !== "measured") {
            classification = "environment";
            environmentReason = `The declared browser is ${probe.rung.replace("_", " ")} on this host, measured by the launch probe: ${probe.measurement} A browser that does not start cannot produce a product assertion.`;
        }
        else if (!probe)
            environmentReason = "No browser requirement is declared in .wringer.yaml, so no launch probe measured this host. Declare requires: [{kind: browser}] to have that measured rather than assumed.";
    }
    const reason = [observation.reason, environmentReason].filter(Boolean).join(" ");
    const row: GateAssertionRow = {
        gate_id: gate.id, adapter: evidence.adapter, source: sourceName,
        status: observation.status, classification,
        counts: translation?.counts ?? null,
        requirements: [...gate.proves],
        assertions: (translation?.assertions ?? []).map(a => ({ id: a.id, name: a.name, status: a.status })),
        observation: gate.proves.length ? `${attemptDir}/check-observation.json` : null,
        report_sha256: observation.reportSha256, reason,
    };
    if (gate.proves.length)
        await bundle.json(`${attemptDir}/check-observation.json`, { ...observation, reason });
    return { row, observation };
}
