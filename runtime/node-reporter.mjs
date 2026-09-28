import { tap } from "node:test/reporters";
/** Node's empty-file wrapper is a passing test in TAP. Per-file summary events
 * distinguish actual node:test registration from merely loading a JS file. */
export default async function* reporter(source) {
    const summaries = new Map();
    const reportedFiles = new Set();
    async function* observed() {
        for await (const event of source) {
            if (event.type === "test:pass" || event.type === "test:fail") {
                if (typeof event.data.file === "string") reportedFiles.add(event.data.file);
                if (reportedFiles.size > 2048) throw new Error("Test file inventory exceeded its bound");
            }
            if (event.type === "test:summary" && typeof event.data.file === "string") summaries.set(event.data.file, event.data.counts);
            yield event;
        }
    }
    yield* tap(observed());
    const incomplete = !reportedFiles.size || [...reportedFiles].some(file => !summaries.has(file) || summaries.get(file).tests < 1);
    if (incomplete) yield "Bail out! A test file had no registered node:test cases or its summary was unavailable\n";
    yield `# wringer-node-registration-v1: ${incomplete ? "incomplete" : "complete"}\n`;
}
