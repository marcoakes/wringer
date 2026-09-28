#!/usr/bin/env bun
import { main } from "./app";
export { main };
if (import.meta.main) await main();
