import { test, expect } from "bun:test";
import { runJobImprovementsBrowserRehearsal } from "./job-improvements-browser-rehearsal";
test("ordinary job browser binds research decisions and discards obsolete views", async () => {
    const result = await runJobImprovementsBrowserRehearsal(); expect(result.checks).toHaveLength(9);
}, 60000);
