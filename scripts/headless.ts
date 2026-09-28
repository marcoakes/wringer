#!/usr/bin/env bun
// Unattended operation is the same contained control plane, never a second
// host-side Codex launcher with broader permissions.
import { main } from "../packages/cli/src/app";
export const headlessMain = (argv = process.argv.slice(2)) => main(argv, "wringer-drive");
if (import.meta.main) await headlessMain();
