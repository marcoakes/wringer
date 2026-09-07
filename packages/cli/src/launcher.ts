#!/usr/bin/env bun
import { basename } from "node:path";
import { main } from "./app";
// argv[0] is normalised by Bun; argv0 retains the caller's executable alias.
const name = basename(process.argv0 || process.argv[0] || process.execPath);
await main(process.argv.slice(2), name.includes("wringer-board") ? "wringer-board" : name.includes("wringer-drive") ? "wringer-drive" : "wring");
