import { mkdir, readFile, readdir, writeFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { distributionHash as hash, distributionFiles, RELEASE_REPOSITORY } from "../packages/cli/src/distribution-manifest";
import { extractReleaseArchive, verifyReleaseArchive } from "../packages/cli/src/release-archive";
export interface ChannelSelection { scope: string; fixture: boolean; namespaceProof?: string; }
export async function generateReleaseChannels(artifacts: string, output: string, selection: ChannelSelection) {
    if (!/^@[a-z0-9][a-z0-9-]{0,99}$/.test(selection.scope)) throw new Error("Select a scoped package namespace explicitly");
    if (!selection.fixture) {
        if (!selection.namespaceProof) throw new Error("Production package generation requires a fresh observed namespace proof; use --fixture for private local packaging tests");
        const proof = JSON.parse(await readFile(selection.namespaceProof, "utf8"));
        if (proof.schema_version !== "wringer.npm-namespace.v1" || proof.scope !== selection.scope || proof.repository !== RELEASE_REPOSITORY || !["owner", "admin"].includes(proof.role) || !["personal-scope", "organization-membership"].includes(proof.method) || !Number.isFinite(Date.parse(proof.observedAt)) || Math.abs(Date.now() - Date.parse(proof.observedAt)) > 24 * 3600 * 1000) throw new Error("Namespace observation is stale or differs from this selection");
    }
    const archives = (await readdir(artifacts)).filter(name => /^wringer-.+-(darwin-arm64|linux-x64)\.tar\.gz$/.test(name)).sort();
    if (!archives.length || archives.length > 2) throw new Error("Select one exact artifact per measured target in a dedicated candidate directory");
    const inputs = [];
    for (const name of archives) {
        const match = /^wringer-(.+)-(darwin-arm64|linux-x64)\.tar\.gz$/.exec(name)!, bytes = await readFile(join(artifacts, name)), checksum = await readFile(join(artifacts, `${name}.sha256`), "utf8");
        const sha256 = hash(bytes); if (checksum !== `${sha256}  ${name}\n`) throw new Error("Artifact checksum declaration differs");
        const verified = verifyReleaseArchive(bytes, { sha256, version: match[1]!, platform: match[2]! }); inputs.push({ name, sha256, platform: match[2]!, verified });
    }
    const version = inputs[0]!.verified.manifest.version, source = inputs[0]!.verified.manifest.source;
    if (inputs.some(i => i.verified.manifest.version !== version || JSON.stringify(i.verified.manifest.source) !== JSON.stringify(source))) throw new Error("Candidate platforms do not have identical version/source identities");
    await mkdir(output, { mode: 0o700 });
    const packageName = `${selection.scope}/wringer`, mcpName = "io.github.marcoakes/wringer";
    const optionalDependencies: Record<string, string> = {}, platformPackages: Record<string, string> = {}, binaryHashes: Record<string, string> = {};
    const packages = [];
    for (const input of inputs) {
        const name = `${packageName}-${input.platform}`, directory = join(output, `npm-${input.platform}`), [os, cpu] = input.platform.split("-");
        await mkdir(directory); await mkdir(join(directory, "dist")); await extractReleaseArchive(join(directory, "dist"), input.verified);
        // npm pack omits symlinks. Its wrapper supplies compatibility aliases;
        // keep the original archive inventory under an explicit provenance name.
        for (const file of input.verified.manifest.files) if (file.kind === "symlink") await unlink(join(directory, "dist", file.path));
        await rename(join(directory, "dist/DISTRIBUTION.json"), join(directory, "dist/ARCHIVE-DISTRIBUTION.json"));
        await writeFile(join(directory, "dist/PACKAGE-CONTENTS.json"), JSON.stringify({ schema_version: "wringer.npm-platform.v1", version, platform: input.platform, archiveSha256: input.sha256, files: await distributionFiles(join(directory, "dist")), aliases: "Supplied by the exact-version thin launcher; npm does not carry archive symlinks" }, null, 2) + "\n");
        const pkg = { name, version, private: selection.fixture, description: `Wringer verified native distribution for ${input.platform}`, license: "Apache-2.0", repository: { type: "git", url: RELEASE_REPOSITORY + ".git" }, os: [os], cpu: [cpu], files: ["dist"], exports: { "./package.json": "./package.json" }, publishConfig: { access: "public" } };
        await writeFile(join(directory, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
        optionalDependencies[name] = version; platformPackages[input.platform] = name; binaryHashes[input.platform] = (input.verified.manifest.files.find(f => f.path === "wring") as any).sha256;
        packages.push({ name, directory: `npm-${input.platform}`, platform: input.platform, archiveSha256: input.sha256 });
    }
    const directory = join(output, "npm-launcher"); await mkdir(directory);
    const pkg = { name: packageName, version, private: selection.fixture, description: "Reviewable checks and bounded delegation with a local human decision page", license: "Apache-2.0", repository: { type: "git", url: RELEASE_REPOSITORY + ".git" }, mcpName, engines: { node: ">=22.14.0" }, bin: Object.fromEntries(["wring", "wringer-drive", "wringer-board", "wringer-assistant", "wringer-headless", "wringer-figma-broker"].map(name => [name, "launcher.cjs"])), files: ["launcher.cjs", "README.md", "LICENSE"], optionalDependencies, publishConfig: { access: "public" } };
    await writeFile(join(directory, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
    const aliases = { "wringer-drive": "drive", "wringer-board": "board", "wringer-assistant": "assistant", "wringer-headless": "headless", "wringer-figma-broker": "figma-broker" };
    const launcher = `#!/usr/bin/env node\n'use strict';\nconst fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), child = require('node:child_process');\nconst packages = ${JSON.stringify(platformPackages)}, hashes = ${JSON.stringify(binaryHashes)}, aliases = ${JSON.stringify(aliases)};\ntry {\n const platform = process.platform + '-' + process.arch, name = packages[platform];\n if (!name) throw new Error('No verified Wringer package for this platform');\n const manifest = require.resolve(name + '/package.json'), pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));\n if (pkg.version !== ${JSON.stringify(version)} || pkg.name !== name) throw new Error('Platform package version differs');\n const binary = path.join(path.dirname(manifest), 'dist/wring');\n if (crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex') !== hashes[platform]) throw new Error('Installed binary checksum differs');\n const alias = aliases[path.basename(process.argv[1])], args = [...(alias ? [alias] : []), ...process.argv.slice(2)];\n const result = child.spawnSync(binary, args, { stdio: 'inherit', env: process.env });\n if (result.error) throw result.error;\n process.exitCode = result.status === null ? 4 : result.status;\n} catch (error) { process.stderr.write('Wringer: ' + error.message + '. Reinstall the exact package version; no runtime download was attempted.\\n'); process.exitCode = 2; }\n`;
    await writeFile(join(directory, "launcher.cjs"), launcher, { mode: 0o755 });
    await writeFile(join(directory, "README.md"), `# Wringer ${version}\n\n${selection.fixture ? 'Private engineering packaging fixture; not published.\n\n' : ''}Node >=22.14 is required for this thin launcher. Native archives need no Node or Bun. No postinstall script or execution-time download exists.\n\nChoose verification (trusted-local checks) or contained delegation with \`wring setup --help\`. Start an operator owner and inspect \`wring connect --help\` before configuring MCP. This is a local STDIO bridge, not a hosted server. Human decisions use a cooperative-local page; no authenticated human identity claim.\n`);
    await writeFile(join(directory, "LICENSE"), await readFile(join(resolve(import.meta.dir, ".."), "LICENSE")));
    packages.push({ name: packageName, directory: "npm-launcher", platform: "launcher", archiveSha256: "" });
    const urls = inputs.map(i => ({ platform: i.platform, url: `${RELEASE_REPOSITORY}/releases/download/v${version}/${i.name}`, sha256: i.sha256 }));
    const formula = `class Wringer < Formula\n  desc "Reviewable checks and bounded contained delegation"\n  homepage "${RELEASE_REPOSITORY}"\n  version "${version}"\n  license "Apache-2.0"\n${urls.map(i => `  ${i.platform === 'darwin-arm64' ? 'on_macos' : 'on_linux'} do\n    ${i.platform === 'darwin-arm64' ? 'on_arm' : 'on_intel'} do\n      url "${i.url}"\n      sha256 "${i.sha256}"\n    end\n  end`).join('\n')}\n  def install\n    libexec.install Dir["*"]\n    bin.install_symlink libexec/"wring"\n    ${Object.keys(aliases).map(alias => `bin.install_symlink libexec/"${alias}"`).join('\n    ')}\n  end\n  test do\n    assert_match "simulation", shell_output("#{bin}/wring demo --json")\n  end\nend\n`;
    await writeFile(join(output, "wringer.rb"), formula);
    const server = { $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json", name: mcpName, title: "Wringer", description: "Local reviewable checks and contained jobs; setup and an operator owner are required.", version, repository: { url: RELEASE_REPOSITORY, source: "github" }, websiteUrl: `${RELEASE_REPOSITORY}/blob/main/INSTALL.md`, packages: [{ registryType: "npm", identifier: packageName, version, transport: { type: "stdio" }, runtimeHint: "npx", runtimeArguments: [{ type: "named", name: "--no-install" }], packageArguments: [{ type: "positional", value: "mcp" }, { type: "named", name: "--connection", description: "Absolute local connection-record path created by wring job open; never a key or operator URL", isRequired: true, format: "filepath" }] }] };
    const validator = addFormats(new Ajv({ allErrors: true, strict: false })).compile(JSON.parse(await readFile(join(import.meta.dir, "../packaging/vendor/mcp-server-2025-12-11.schema.json"), "utf8")));
    if (!validator(server)) throw new Error(`MCP registry schema mismatch: ${JSON.stringify(validator.errors)}`);
    await writeFile(join(output, "server.json"), JSON.stringify(server, null, 2) + "\n");
    const report = { schema_version: "wringer.channels.v1", version, source, namespace: selection.scope, fixture: selection.fixture, published: false, platforms: inputs.map(i => i.platform), packages, artifacts: urls, registrySchema: server.$schema, limits: ["Candidate bytes verified locally. Namespace registration, npm trusted publishing, Homebrew tap and MCP listing are independent external actions.", "Only included, natively exercised targets may be advertised. A generated formula is not a measured public installation."] };
    await writeFile(join(output, "CHANNELS.json"), JSON.stringify(report, null, 2) + "\n"); return report;
}
if (import.meta.main) {
    const [artifacts, output, scope, option, proof] = process.argv.slice(2);
    if (!artifacts || !output || !scope || !["--fixture", "--namespace-proof"].includes(option!)) throw new Error("Usage: bun scripts/release-channels.ts ARTIFACTS NEW_OUTPUT @SCOPE --fixture|--namespace-proof PROOF.json");
    console.log(JSON.stringify(await generateReleaseChannels(resolve(artifacts), resolve(output), { scope, fixture: option === "--fixture", ...(proof ? { namespaceProof: resolve(proof) } : {}) }), null, 2));
}
