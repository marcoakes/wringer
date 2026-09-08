#!/usr/bin/env bun
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createProtectedDeploymentPlan, inspectProtectedDeployment, type ProtectedDeploymentInput } from "../packages/application/src/protected-deployment";

const HELP = `Protected local deployment inspection (read-only)

  bun scripts/protected-inspect.ts --input ABS_INPUT_JSON
  bun scripts/protected-inspect.ts --plan ABS_PLAN_JSON

--input produces an auditable deployment plan from exact artifact hashes and
measured controller/assistant numeric identities. It does not run an installer.
--plan inspects the planned file boundary as the current OS user. A different
user cannot supply the coding app's access evidence. Credentials are never read.

No account, key, permission, service, runtime, evidence file or client setting is
changed. Protected activation remains unavailable until all live boundaries have
been established; private files and a signed JSON assertion do not establish it.
`;
async function readInput(path: string): Promise<unknown> {
    if (!isAbsolute(path) || resolve(path) !== path || /[\x00-\x1f\x7f]/.test(path)) throw new Error("Use one normalized absolute JSON path");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const info = await file.stat(); if (!info.isFile() || info.size > 128 * 1024) throw new Error("Input must be a bounded regular JSON file"); return JSON.parse(await file.readFile("utf8")); }
    finally { await file.close(); }
}
export async function protectedInspectCli(argv: string[]) {
    if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) return { code: 0, output: HELP };
    if (argv.length !== 2 || !["--input", "--plan"].includes(argv[0]!)) throw new Error("Use --input ABS_INPUT_JSON or --plan ABS_PLAN_JSON; no installation flag exists");
    const value = await readInput(argv[1]!);
    if (argv[0] === "--input") return { code: 0, output: JSON.stringify(createProtectedDeploymentPlan(value as ProtectedDeploymentInput), null, 2) + "\n" };
    return { code: 2, output: JSON.stringify(await inspectProtectedDeployment(value), null, 2) + "\n" };
}
if (import.meta.main) {
    try { const result = await protectedInspectCli(process.argv.slice(2)); process.stdout.write(result.output); process.exitCode = result.code; }
    catch { process.stderr.write("Protected inspection refused: input could not be validated. No installation or credential access was attempted. Run --help for the accepted read-only route.\n"); process.exitCode = 2; }
}
