/** The capability ledger cannot outrun its evidence, and the pilot registration cannot
 * change silently. */
import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkLedger, renderLedger } from "../../../scripts/capability-ledger";

const root = resolve(import.meta.dir, "../../..");
test("the ledger cites only existing files and claims no live or comparative level", async () => {
    const ledger = await checkLedger();
    for (const row of ledger.capabilities) { expect(row.liveQualified.status).not.toBe("yes"); expect(row.comparativelyBeneficial.status).not.toBe("yes"); }
    expect(await readFile(resolve(root, "docs/CAPABILITY_LEDGER.md"), "utf8")).toBe(renderLedger(ledger));
});
test("a benefit claimed from fixture evidence is refused", async () => {
    const ledger = JSON.parse(await readFile(resolve(root, "docs/capability-ledger.json"), "utf8"));
    ledger.capabilities[0].comparativelyBeneficial = { status: "yes", evidence: ["docs/restoration/evidence/phase-1/local-validation.json"] };
    await expect(checkLedger(ledger)).rejects.toThrow("without a registered comparison result");
    ledger.capabilities[0].comparativelyBeneficial = { status: "not-established", evidence: [] }; ledger.capabilities[0].liveQualified = { status: "yes", evidence: ["docs/restoration/evidence/phase-1/local-validation.json"] };
    await expect(checkLedger(ledger)).rejects.toThrow("without a live run record");
});
const read = async (path: string) => JSON.parse(await readFile(resolve(root, path), "utf8"));
test("a citation of a missing file is refused", async () => {
    const ledger = await read("docs/capability-ledger.json"); ledger.capabilities[0].implemented.evidence = ["docs/native/NO_SUCH_PAGE.md"];
    await expect(checkLedger(ledger)).rejects.toThrow("cites a missing file");
});
test("a pilot registration changed after registering is refused", async () => {
    const registration = await read("docs/qualification/pilot-registration.json"); registration.minimumUsefulEffect.additionalAcceptedTasks = 2;
    await expect(checkLedger(undefined, { registration })).rejects.toThrow("changed after it was registered");
});
test("a showcase record missing a journey, with a failed journey or a machine path is refused", async () => {
    const showcase = await read("docs/showcase/showcase.json");
    await expect(checkLedger(undefined, { showcase: { ...showcase, journeys: showcase.journeys.slice(1) } })).rejects.toThrow("missing a journey");
    await expect(checkLedger(undefined, { showcase: { ...showcase, journeys: showcase.journeys.map((row: any, index: number) => index ? row : { ...row, status: "failed" }) } })).rejects.toThrow("did not pass");
    await expect(checkLedger(undefined, { showcase: { ...showcase, note: "ran in /Users/someone/repo" } })).rejects.toThrow("machine path");
});
