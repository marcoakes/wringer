import { runReversions, type Reversion } from "./rebuild-reversions";
import { readFile } from "node:fs/promises";
const provision = "packages/application/src/runtime-provisioning.ts", gvisor = "packages/application/src/gvisor-provisioning.ts", os = "runtime/prepare-os.ts", inspection = "packages/runtime/src/inspection.ts";
const t = "packages/application/test/runtime-provisioning.test.ts", g = "packages/application/test/gvisor-provisioning.test.ts", o = "packages/runtime/test/os-snapshot.test.ts", i = "packages/runtime/test/inspection.test.ts", registry = "packages/runtime/src/oci-resolution.ts", r = "packages/runtime/test/oci-resolution.test.ts";
const cases: Reversion[] = [
    { name: "proposal-guard", file: provision, before: "decision.expectedSha256 !== sha256 ||", after: "", test: t, pattern: "unreviewed proposals" },
    { name: "input-inventory", file: provision, before: "hashValue(await inputInventory(assets)) !== hashValue(plan.inputs)", after: "false", test: t, pattern: "unreviewed proposals" },
    { name: "completed-observation", file: provision, before: 'if (await assistantExists(root, record("result.json")))', after: 'if (false)', test: t, pattern: "completed replay" },
    { name: "uncertain-build-no-replay", file: provision, before: "if (await assistantExists(root, started))", after: "if (false)", test: t, pattern: "interrupted build" },
    { name: "corrupt-approval-lock", file: provision, before: "finally { await lock.close(); await unlink(lockPath); }", after: "finally { await lock.close(); }", test: t, pattern: "corrupt approval" },
    { name: "alias-identity", file: provision, before: "observed.digest !== image.digest || observed.reference !== pinned", after: "false", test: t, pattern: "changed image alias" },
    { name: "inventory-bun-pin", file: provision, before: '|| result.bun !== "1.4.2"', after: "", test: t, pattern: "mismatched runtime inventory" },
    { name: "free-space-guard", file: provision, before: "host.host.freeBytes < plan.minimumFreeBytes", after: "false", test: t, pattern: "storage and service" },
    { name: "service-grant", file: provision, before: 'host.service.state !== "observed" && !plan.startService', after: "false", test: t, pattern: "storage and service" },
    { name: "gvisor-runtimeclass", file: gvisor, before: '|| runtimeClass.handler !== "runsc"', after: "", test: g, pattern: "ordinary cluster runtime" },
    { name: "cluster-ownership", file: gvisor, before: 'observed.metadata?.labels?.["wringer.dev/provision"] !== plan.id', after: "false", test: g, pattern: "partial installation" },
    { name: "os-metadata-digest", file: os, before: 'size !== row.bytes || digest.digest("hex") !== row.sha256', after: "false", test: o, pattern: "OS metadata" },
    { name: "os-redirect-boundary", file: os, before: 'target.origin !== "https://snapshot.debian.org"', after: "false", test: o, pattern: "OS metadata" },
    { name: "inspection-credential-refusal", file: inspection, before: 'input.image?.includes("@") && !/^[^@]+@sha256:[a-f0-9]{64}$/.test(input.image)', after: "false", test: i, pattern: "credential-shaped" },
    { name: "manifest-digest", file: registry, before: "declared && measured !== declared || validDigest(reference) && measured !== reference", after: "false", test: r, pattern: "swapped bytes" },
];
// Revert both independent metadata checks to the original bytes-only context
// check. Removing either alone correctly remains protected by the other.
const source = await readFile(provision, "utf8"), start = source.indexOf("            const target = await assistantPath(context"), end = source.indexOf("        async function command", start);
const context = source.slice(start, end);
cases.push({ name: "retained-context-metadata", file: provision, before: context, after: context.replace("await assistantPath(context, `runtime/${row.path}`)", "join(context, 'runtime', row.path)").replace("await lstat(target)", '(await import("node:fs/promises")).stat(target).then(info => info)').replace('const info = (await import("node:fs/promises")).stat(target).then(info => info);', 'const info = await (await import("node:fs/promises")).stat(target);'), test: t, pattern: "input symlink" });
await runReversions("m3", [t, g, o, i, r, "packages/cli/test/runtime-cli.test.ts"], cases);
