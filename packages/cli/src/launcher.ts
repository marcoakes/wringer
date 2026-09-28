#!/usr/bin/env bun
import { basename } from "node:path";
import { EXECUTABLE_ROUTES } from "./routes";

/** Import-safe routing. Optional servers load only when explicitly selected. */
export async function launch(argv = process.argv.slice(2), executable = process.argv0 || process.argv[0] || process.execPath) {
    const alias = EXECUTABLE_ROUTES.find(row => row.alias === basename(executable));
    const command = alias?.command ?? argv[0];
    const args = alias ? argv : argv.slice(1);
    if (command === "assistant") return (await import("./assistant-cli")).assistantMain(args);
    if (command === "mcp") return (await import("./assistant-cli")).assistantMain(["mcp", ...args]);
    if (command === "figma-broker") return (await import("../../figma-connect/src/serve")).figmaBrokerMain(args);
    if (command === "drive" || command === "headless") return (await import("./app")).main(args, "wringer-drive");
    if (command === "board") return (await import("./app")).main(args, "wringer-board");
    return (await import("./app")).main(argv);
}
if (import.meta.main) await launch();
