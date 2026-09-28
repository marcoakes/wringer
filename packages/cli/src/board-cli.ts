#!/usr/bin/env bun
import { main } from "./app";
export const boardMain = (argv = process.argv.slice(2)) => main(argv, "wringer-board");
if (import.meta.main) await boardMain();
