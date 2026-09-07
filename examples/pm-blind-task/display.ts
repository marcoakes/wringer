// Controller-pinned human display. It exercises the actual candidate functions;
// no fixture verdict or synthetic role/check response is produced here.
import { runPipeline } from "./src/pipeline";
import { renderReport } from "./src/report";
import { fixture } from "./checks/support";

for (const [name, title] of [["chain", "One failed import, one independent branch"], ["two-failures", "Two failed imports, a shared dependent step"]] as const) {
    console.log(`\n${title}\n${"=".repeat(title.length)}`);
    console.log(renderReport(runPipeline(await fixture(name))));
}
console.log("These scenarios intentionally contain failures. Displaying their reports is not a claim that the pipelines succeeded or that a person approved the result.");
