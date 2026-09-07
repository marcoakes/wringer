#!/usr/bin/env bun
// Unattended operation is the same contained control plane, never a second
// host-side Codex launcher with broader permissions.
import { main } from "../packages/cli/src/app";
await main(process.argv.slice(2), "wringer-drive");
