import { readFile } from "node:fs/promises";
import { runPipeline } from "./pipeline";
import { renderReport } from "./report";

const path = process.argv[2];
if (!path || process.argv.length !== 3) {
    console.error("Usage: bun examples/pm-blind-task/src/cli.ts PIPELINE.json");
    process.exitCode = 2;
} else {
    try {
        const result = runPipeline(JSON.parse(await readFile(path, "utf8")));
        process.stdout.write(renderReport(result));
        process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
        console.error(`Invalid pipeline: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 2;
    }
}
