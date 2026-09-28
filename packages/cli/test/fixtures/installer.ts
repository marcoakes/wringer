import * as fs from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { distributionHash, writeDistributionManifest } from "../../src/distribution-manifest";
import { packageReleaseArchive } from "../../src/release-archive";
import { DISTRIBUTION } from "../../src/routes";
import type { InstallSelection } from "../../src/installation";
export async function installerFixture() {
    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "wringer-install-test-")));
    const prefix = join(root, "space in owned installation"), appDir = join(root, "application"), source = join(root, "source");
    await fs.mkdir(source, { mode: 0o700 }); await fs.mkdir(appDir, { mode: 0o700 });
    await fs.writeFile(join(appDir, "retained.txt"), "unchanged evidence and uncertainty");
    async function archive(version: string, extraSchema = false) {
        const dir = join(source, version); await fs.mkdir(dir, { mode: 0o700 });
        await fs.writeFile(join(dir, "wring"), `#!/bin/sh\necho executed > '${join(root, "must-not-execute")}'\n`, { mode: 0o755 });
        await fs.writeFile(join(dir, "LICENSE"), "fixture"); await fs.writeFile(join(dir, "USING_WRINGER.md"), "fixture");
        await fs.mkdir(join(dir, "schema")); await fs.writeFile(join(dir, "schema/retained.schema.json"), '{"fixture":true}\n');
        if (extraSchema) await fs.writeFile(join(dir, "schema/new.schema.json"), '{"new":true}\n');
        for (const a of DISTRIBUTION.aliases) await fs.symlink("wring", join(dir, a.alias));
        await fs.writeFile(join(dir, "BUILD.json"), JSON.stringify({ version, platform: process.platform, arch: process.arch, python_runtime: false }));
        await writeDistributionManifest(dir, { version, platform: process.platform, arch: process.arch, runtime: "Bun fixture", source: { commit: "a".repeat(40), dirty: true, contentSha256: "b".repeat(64) } });
        const bytes = await packageReleaseArchive(dir), path = join(root, `${version}.tar.gz`); await fs.writeFile(path, bytes);
        return { selection: { action: "install", prefix, appDir, archive: path, sha256: distributionHash(bytes), version } as InstallSelection, bytes };
    }
    return { root, prefix, appDir, archive };
}
