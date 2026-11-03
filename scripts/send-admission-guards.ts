/** Isolated reversions of the Send admission repair (alpha.41): a repeated read of an
 * unchanged prepared bundle reuses its passed audit, and a command that exited alone
 * is not held for a grace period meant for what it left running. */
import { runReversions } from "./rebuild-reversions";
const delivery = "packages/delivery/test/contained.test.ts", runtime = "packages/runtime/test/runtime.test.ts";
await runReversions("send-admission", [delivery, runtime], [
    { name: "audit-rerun-on-every-read", file: "packages/delivery/src/contained.ts", before: "if (known) return structuredClone(known);", after: "if (false) return structuredClone(known);", test: delivery, pattern: "repeated read of an unchanged" },
    { name: "reused-view-shared", file: "packages/delivery/src/contained.ts", before: "if (known) return structuredClone(known);", after: "if (known) return known;", test: delivery, pattern: "repeated read of an unchanged" },
    { name: "audit-reused-for-other-bytes", file: "packages/delivery/src/contained.ts", before: "`${resolve(bundleDir)}\\n${index}`", after: "resolve(bundleDir)", test: delivery, pattern: "repeated read of an unchanged" },
    { name: "grace-after-every-exit", file: "packages/runtime/src/driver.ts", before: "if (child.pid && groupRemains(child.pid)) {", after: "if (child.pid) {", test: runtime, pattern: "finished alone" },
    { name: "straggler-left-running", file: "packages/runtime/src/driver.ts", before: "        process.kill(-group, 0);\n        return true;", after: "        return false;", test: runtime, pattern: "finished alone" },
], { baseline: "8227dcf05359ca17913b3f1fae0d1de7eaff74e6" });
