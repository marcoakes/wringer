/** Render docs/CAPABILITY_LEDGER.md from docs/capability-ledger.json, or check that the
 * rendered page is current (--check). Every cited path must exist. A live or
 * comparative claim needs evidence of that kind: a live run record under
 * docs/qualification/live/ or a registered comparison result under
 * docs/qualification/results/. Fixture evidence can never raise either level. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { hashValue } from "../packages/plan/src";

const root = resolve(import.meta.dir, ".."), source = resolve(root, "docs/capability-ledger.json"), output = resolve(root, "docs/CAPABILITY_LEDGER.md");
const LEVELS = ["implemented", "fixtureTested", "liveQualified", "comparativelyBeneficial"] as const;
const LABEL: Record<string, string> = { yes: "Yes", partial: "Partly", no: "No", "not-established": "Not established", "not-applicable": "Not applicable" };
export async function checkLedger(input?: unknown, overrides: { registration?: any; showcase?: any } = {}) {
    const ledger = (input ?? JSON.parse(await readFile(source, "utf8"))) as any, schema = JSON.parse(await readFile(resolve(root, "schema/capability-ledger-v1.schema.json"), "utf8"));
    const ajv = addFormats(new Ajv2020({ strict: false }));
    if (!ajv.validate(schema, ledger as unknown)) throw new Error(`Capability ledger does not match its schema: ${ajv.errorsText()}`);
    const problems: string[] = [];
    for (const row of ledger.capabilities) for (const level of LEVELS) {
        const claim = row[level];
        for (const path of claim.evidence) if (!await Bun.file(resolve(root, path)).exists()) problems.push(`${row.id} ${level} cites a missing file: ${path}`);
        if (["yes", "partial"].includes(claim.status) && level !== "implemented" && !claim.evidence.length && !claim.note) problems.push(`${row.id} ${level} claims ${claim.status} without evidence or a note`);
        if (level === "liveQualified" && claim.status === "yes" && !claim.evidence.some((path: string) => path.startsWith("docs/qualification/live/"))) problems.push(`${row.id} claims live qualification without a live run record`);
        if (level === "comparativelyBeneficial" && claim.status === "yes" && !claim.evidence.some((path: string) => path.startsWith("docs/qualification/results/"))) problems.push(`${row.id} claims a benefit without a registered comparison result`);
    }
    // The pilot registration is fixed by its own digest; a changed field needs a new registration.
    const registration = overrides.registration ?? JSON.parse(await readFile(resolve(root, "docs/qualification/pilot-registration.json"), "utf8")), { sha256, ...body } = registration;
    if (!ajv.validate(JSON.parse(await readFile(resolve(root, "schema/pilot-registration-v1.schema.json"), "utf8")), registration as unknown)) problems.push(`The pilot registration does not match its schema: ${ajv.errorsText()}`);
    if (registration.schema_version !== "wringer.pilot-registration.v1" || hashValue(body) !== sha256) problems.push("The pilot registration changed after it was registered");
    if (registration.status !== "registered-not-run" && !await Bun.file(resolve(root, "docs/qualification/results")).exists()) problems.push("The pilot registration claims a run without results");
    // The committed showcase record names every required journey, each passed.
    const showcase = overrides.showcase ?? JSON.parse(await readFile(resolve(root, "docs/showcase/showcase.json"), "utf8"));
    const journeys = ["parallel-integration", "tournament", "future-improvement", "external-task"];
    if (showcase.schema_version !== "wringer.showcase.v1" || JSON.stringify((showcase.journeys ?? []).map((row: any) => row.id)) !== JSON.stringify(journeys) || showcase.journeys.some((row: any) => row.status !== "passed")) problems.push("The showcase record is missing a journey or records one that did not pass");
    if (/\/Users\/|\/var\/folders\/|\/home\/[a-z]/.test(JSON.stringify(showcase))) problems.push("The showcase record carries a machine path");
    if (problems.length) throw new Error(`Capability ledger refused:\n${problems.join("\n")}`);
    return ledger;
}
export function renderLedger(ledger: any) {
    const cell = (claim: any) => `${LABEL[claim.status]}${claim.evidence.length ? ` (${claim.evidence.map((path: string) => `[${path.split("/").at(-1)}](${path.startsWith("docs/") ? path.slice(5) : `../${path}`})`).join(", ")})` : ""}${claim.note ? `. ${claim.note}` : ""}`;
    const rows = ledger.capabilities.map((row: any) => `| ${row.name} | ${LEVELS.map(level => cell(row[level])).join(" | ")} |`);
    const counts = LEVELS.map(level => `${ledger.capabilities.filter((row: any) => row[level].status === "yes").length} of ${ledger.capabilities.length}`);
    return `# Capability ledger

Generated from [capability-ledger.json](capability-ledger.json) by
\`scripts/capability-ledger.ts\`; edit the JSON, not this page. Updated
${ledger.updated}.

Each capability is judged at four separate levels. A level is raised only by
evidence of its own kind.

| Level | Meaning | Capabilities at "Yes" |
| --- | --- | --- |
| Implemented | ${ledger.levels.implemented} | ${counts[0]} |
| Fixture-tested | ${ledger.levels.fixtureTested} | ${counts[1]} |
| Live-qualified | ${ledger.levels.liveQualified} | ${counts[2]} |
| Comparatively beneficial | ${ledger.levels.comparativelyBeneficial} | ${counts[3]} |

| Capability | Implemented | Fixture-tested | Live-qualified | Comparatively beneficial |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

The checker refuses a live claim without a record under
\`docs/qualification/live/\` and a benefit claim without a registered comparison
result under \`docs/qualification/results/\`. Neither folder exists yet. No
capability is claimed live-qualified or comparatively beneficial, and nothing
here supports a "state of the art" claim.
`;
}
if (import.meta.main) {
    const ledger = await checkLedger(), rendered = renderLedger(ledger);
    if (process.argv.includes("--check")) {
        if (await readFile(output, "utf8").catch(() => "") !== rendered) throw new Error("docs/CAPABILITY_LEDGER.md is stale; run bun scripts/capability-ledger.ts");
        console.log(`Capability ledger current: ${ledger.capabilities.length} capabilities, every cited file present.`);
    } else { await writeFile(output, rendered); console.log(`Generated docs/CAPABILITY_LEDGER.md (${ledger.capabilities.length} capabilities).`); }
}
