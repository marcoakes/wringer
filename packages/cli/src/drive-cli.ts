#!/usr/bin/env bun
import { main } from "./app";
export const driveMain = (argv = process.argv.slice(2)) => main(argv, "wringer-drive");
if (import.meta.main) await driveMain();
