/** Isolated reversions of the upgrade-compatibility repair (alpha.42): only published
 * schema files decide whether a release can read what the installed version wrote, and
 * a held installation says what to do next instead of pointing at help. */
import { runReversions } from "./rebuild-reversions";
const installation = "packages/cli/src/installation.ts", test = "packages/cli/test/installer.test.ts", pattern = "grown frozen index";
await runReversions("install-upgrade", [test], [
    { name: "index-notes-and-examples-compared", file: installation, before: "contract(f.path) && f.kind", after: 'f.path.startsWith("schema/") && f.kind', test, pattern },
    { name: "changed-contract-admitted", file: installation, before: '|| (files.get(f.path) as any).sha256 !== f.sha256)', after: "|| false)", test, pattern },
    { name: "missing-contract-admitted", file: installation, before: '(files.get(f.path)?.kind !== "file" || (files.get(f.path) as any).sha256 !== f.sha256)', after: '(files.has(f.path) && (files.get(f.path) as any).sha256 !== f.sha256)', test, pattern },
    { name: "held-preview-generic-next", file: installation, before: "nextAction: nextAction(holds) }", after: "nextAction: nextAction([]) }", test, pattern },
    { name: "held-apply-generic-next", file: installation, before: ", { next_move: preview.nextAction })", after: ", {})", test, pattern },
], { baseline: "789514865973d4f9caebb3e8614b80ccc0008c6b" });
