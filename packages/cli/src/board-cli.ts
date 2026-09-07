#!/usr/bin/env bun
import { main } from "./app";
await main(process.argv.slice(2), "wringer-board");
