import { writeFile } from "node:fs/promises";
import { runProcess } from "../packages/engine/src/process";
import { RELEASE_REPOSITORY } from "../packages/cli/src/distribution-manifest";
export async function verifyNpmNamespace(scope: string) {
    if (!/^@[a-z0-9][a-z0-9-]{0,99}$/.test(scope)) throw new Error("Select an explicit npm scope");
    const npm = Bun.which("npm"); if (!npm) throw new Error("Namespace inspection requires npm; no login was attempted");
    const who = await runProcess([npm, "whoami", "--registry", "https://registry.npmjs.org", "--json"], { cwd: process.cwd(), timeout: 30, maxBytes: 16384 });
    if (who.exit_code !== 0 || who.stdout_truncated) throw new Error("npm account inspection failed; operator login is required outside this tool");
    const principal = JSON.parse(who.stdout); if (typeof principal !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(principal)) throw new Error("Invalid npm account observation");
    let method = "personal-scope", role = "owner";
    if (scope !== `@${principal}`) {
        const organization = await runProcess([npm, "org", "ls", scope.slice(1), "--registry", "https://registry.npmjs.org", "--json"], { cwd: process.cwd(), timeout: 30, maxBytes: 1024 * 1024 });
        if (organization.exit_code !== 0 || organization.stdout_truncated) throw new Error("Could not inspect the selected organization membership");
        role = JSON.parse(organization.stdout)[principal]; method = "organization-membership";
        if (!["owner", "admin"].includes(role)) throw new Error("This staging route requires observed organization owner/admin rights");
    }
    return { schema_version: "wringer.npm-namespace.v1", scope, principal, role, method, repository: RELEASE_REPOSITORY, observedAt: new Date().toISOString(), limits: ["Account observation, not a reusable credential or independent signature. Package ACLs and trusted-publisher configuration are checked by npm at publication."] };
}
if (import.meta.main) {
    if (process.argv.length !== 4) throw new Error("Usage: bun scripts/channel-namespace.ts @SCOPE NEW_PROOF.json");
    const result = await verifyNpmNamespace(process.argv[2]!); await writeFile(process.argv[3]!, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log("Namespace inspection retained. No package was published or account setting changed.");
}
