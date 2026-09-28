import { resolve } from "node:path";
import { applicationDirectory } from "@wringer/application";
import { allowed, flag, positionals, required, string, type Args } from "./args";
import { applyInstallation, installationDirectory, previewInstallation, type InstallSelection } from "./installation";
import type { Answer } from "./app";

export const INSTALL_HELP = `Wringer installation and retained-version rollback

  wring install --archive PATH --sha256 HASH --release VERSION [--dry-run --json]
  wring upgrade --archive PATH --sha256 HASH --release VERSION [--dry-run --json]
  wring upgrade --rollback [--dry-run --json]
  wring uninstall [--dry-run --json]
  Repeat the exact selection with --apply --expected IDENTITY to change owned files.

--prefix ABS_PATH selects a private installation directory. --app-dir ABS_PATH
selects the separate application state to inspect for migration restrictions.
No sudo, shell-profile edits, provider calls, job restart or record rewrite.
Checksums bind exact selected bytes; a same-origin checksum is not an independent
signature. Use the bootstrap download recipe in INSTALL.md for the first binary.
An interrupted transition resumes only its retained selection and identity in
PREFIX/pending.json. Stop owners and reconcile uncertainty before switching.
Client entries have their own scoped removal: wring connect --help.
`;
export async function installationCommand(a: Args): Promise<Answer> {
    if (flag(a, "help")) return { text: INSTALL_HELP };
    allowed(a, ["prefix", "app-dir", "archive", "sha256", "release", "rollback", "dry-run", "apply", "expected"]); positionals(a, 0);
    if (flag(a, "apply") && flag(a, "dry-run")) throw new Error("Choose an installation preview or apply");
    if ((a.command === "uninstall" || flag(a, "rollback")) && ["archive", "sha256", "release"].some(key => a.flags.has(key))) throw new Error("Select one installation action");
    if (flag(a, "rollback") && a.command !== "upgrade") throw new Error("Use upgrade --rollback");
    const action = a.command === "uninstall" ? "uninstall" : flag(a, "rollback") ? "rollback" : "install";
    const selection: InstallSelection = { action, prefix: resolve(string(a, "prefix", installationDirectory())!), appDir: applicationDirectory(string(a, "app-dir")), ...(action === "install" ? { archive: resolve(required(a, "archive")), sha256: required(a, "sha256"), version: required(a, "release") } : {}) };
    const value = flag(a, "apply") ? await applyInstallation(selection, required(a, "expected")) : await previewInstallation(selection);
    return { value, text: JSON.stringify(value, null, 2) };
}
