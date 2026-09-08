import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyDistributionDocs, validateDistributionDocs } from "../../../scripts/distribution-docs";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "wringer-distribution-docs-")); roots.push(root);
    const source = join(root, "source"), output = join(root, "output"); await mkdir(source);
    const put = async (path: string, text: string | Buffer) => { await mkdir(dirname(join(source, path)), { recursive: true }); await writeFile(join(source, path), text); };
    return { root, source, output, put };
}

describe("packaged documentation closure", () => {
    test("code, tests and active configuration are inert references with rewritten links, never auto-discovered tests", async () => {
        const f = await fixture();
        const refs = ["packages/canary.test.ts", "packages/component.tsx", "scripts/build.js", "scripts/run.mjs", "scripts/run.cjs", "scripts/run.sh", "scripts/run.py", "package.json", "bunfig.toml"];
        await f.put("START.md", refs.map(path => `[${path}](${path})`).join("\n") + "\n[Template](plan.yaml)");
        for (const path of refs) await f.put(path, 'throw new Error("DOC_REFERENCE_EXECUTED")');
        await f.put("plan.yaml", "version: 1\n");
        const manifest = await copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] });
        const page = await readFile(join(f.output, "START.md"), "utf8");
        for (const path of refs) {
            expect(page).toContain(`](${path}.txt)`);
            expect(manifest.files.find(file => file.path === `${path}.txt`)?.sourcePath).toBe(path);
            await expect(access(join(f.output, path))).rejects.toThrow();
        }
        expect(page).toContain("](plan.yaml)");
        const child = Bun.spawn([process.execPath, "test", "packages"], { cwd: f.output, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect(exit).toBe(1); // Bun's explicit no-tests-found outcome.
        expect(stdout + stderr).not.toContain("DOC_REFERENCE_EXECUTED");
        expect(stdout + stderr).toContain("did not match any test files");
        await validateDistributionDocs(f.output);
    });

    test("incremental rebuild removes only unchanged old manifest-owned executable references", async () => {
        for (const disposition of ["unchanged", "altered", "missing"]) {
            const f = await fixture(), path = "packages/old.test.ts";
            await f.put("START.md", `[Reference](${path})`); await f.put(path, "// original source\n");
            const manifest = await copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] });
            // Recreate the previous builder's exact manifest-owned executable
            // copy, not an arbitrary file guessed from its suffix.
            const entry = manifest.files.find(file => file.path === `${path}.txt`)!;
            entry.path = path; delete entry.sourcePath;
            await rename(join(f.output, `${path}.txt`), join(f.output, path));
            await writeFile(join(f.output, "DOCUMENTATION.json"), JSON.stringify(manifest));
            await writeFile(join(f.output, "unrecorded.test.ts"), "// unrelated user file\n");
            if (disposition === "missing") await rm(join(f.output, path)); // Retrying a partially completed older migration.
            if (disposition === "altered") {
                await writeFile(join(f.output, path), "// user changed this generated copy\n");
                await expect(copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] })).rejects.toThrow("Previously generated reference changed");
                expect(await readFile(join(f.output, path), "utf8")).toBe("// user changed this generated copy\n");
            } else {
                await copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] });
                await expect(access(join(f.output, path))).rejects.toThrow();
                expect(await readFile(join(f.output, `${path}.txt`), "utf8")).toBe("// original source\n");
                await validateDistributionDocs(f.output);
            }
            expect(await readFile(join(f.output, "unrecorded.test.ts"), "utf8")).toBe("// unrelated user file\n");
            expect(await readFile(join(f.source, path), "utf8")).toBe("// original source\n");
        }
    });

    test("copies transitive pages, encoded links and HTML media, preserves cycles, and generates nonduplicated legacy redirects", async () => {
        const f = await fixture();
        await f.put("START.md", '# Start\n\n[Next](docs/My%20guide.md?view=local#the%20heading)\n<img src="docs/banner.webp" alt="Original artwork">\n');
        await f.put("docs/My guide.md", "# A guide\n\n[Cycle](../START.md)\n[Human route](native/HEADLESS.md)\n");
        await f.put("docs/native/HEADLESS.md", "# Headless\n\n[Start](../../START.md)\n");
        await f.put("docs/banner.webp", Buffer.from([82, 73, 70, 70, 0, 1, 2]));
        const manifest = await copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: ["docs/native/HEADLESS.md"] });
        expect(manifest.omissions).toEqual([]);
        expect(manifest.files.map(file => file.path)).toContain("docs/banner.webp");
        expect(await readFile(join(f.output, "docs/banner.webp"))).toEqual(await readFile(join(f.source, "docs/banner.webp")));
        expect(await readFile(join(f.output, "START.md"), "utf8")).toContain("docs/My%20guide.md?view=local#the%20heading");
        const redirect = await readFile(join(f.output, "docs/HEADLESS.md"), "utf8");
        expect(redirect).toContain("[Open the current guide](native/HEADLESS.md)");
        expect(redirect).not.toContain("[Start]");
        expect(await readFile(join(f.output, "DOCS.md"), "utf8")).toContain("not a complete development checkout");
        expect(await validateDistributionDocs(f.output)).toEqual({ files: 6, links: 10, namedOmissions: 0 });
    });

    test("private local captures become named omissions without reading or copying them", async () => {
        const f = await fixture();
        await f.put("START.md", "# Start\n\n[Historical receipt](.wringer/run/private.json)\n[Connection](.codex/config.toml)\n[Old receipt](/Users/operator/project/.wringer/old/result.json)\n[Credentials](nested/.env.production)\n[Private SSH](nested/.ssh/id_rsa)\n");
        // Even a private symlink is never traversed or opened; the public report
        // keeps a named omission rather than silently distributing its target.
        await symlink(join(f.root, "missing-secret-store"), join(f.source, ".wringer"));
        const manifest = await copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] });
        expect(manifest.omissions.map(item => item.target)).toEqual([".wringer/run/private.json", ".codex/config.toml", ".wringer/old/result.json", "nested/.env.production", "nested/.ssh/id_rsa"]);
        expect(manifest.files.map(item => item.path)).toEqual(["DOCS.md", "START.md"]);
        const output = await readFile(join(f.output, "START.md"), "utf8");
        expect(output).toContain("Historical receipt (local evidence not included");
        expect(output).not.toContain("](.wringer");
        expect(output).not.toContain("/Users/operator");
        await expect(access(join(f.output, ".wringer"))).rejects.toThrow();
        expect((await validateDistributionDocs(f.output)).namedOmissions).toBe(5);
        expect(await readFile(join(f.source, "START.md"), "utf8")).toContain("](.wringer");
    });

    test("ordinary missing public files fail instead of becoming silent omissions", async () => {
        const f = await fixture(); await f.put("START.md", "[Broken](docs/missing.md)");
        await expect(copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] })).rejects.toThrow();
    });

    test("encoded traversal, unsafe URL schemes, invalid encodings and public symlinks refuse", async () => {
        for (const href of ["%2e%2e/outside.md", "javascript:alert", "%E0%A4%A", "/absolute.md", "docs%5cescape.md"]) {
            const f = await fixture(); await f.put("START.md", `[Unsafe](${href})`);
            await expect(copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] })).rejects.toThrow();
        }
        const f = await fixture(); await f.put("START.md", "[Linked](docs/link.md)"); await mkdir(join(f.source, "docs"));
        await symlink(join(f.root, "outside.md"), join(f.source, "docs/link.md"));
        await expect(copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] })).rejects.toThrow("symlink");
    });

    test("output symlinks are refused, fenced examples are not links, and missing/tampered packaged targets fail validation", async () => {
        const f = await fixture(); await f.put("START.md", "# Start\n\n```md\n[Example only](missing.md)\n```\n");
        await expect(copyDistributionDocs(f.source, f.root, { entrypoints: ["START.md"], nativeGuides: [] })).rejects.toThrow("contain its source");
        const manifest = await copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] });
        expect(manifest.files).toHaveLength(2);
        await writeFile(join(f.output, "START.md"), "changed");
        await expect(validateDistributionDocs(f.output)).rejects.toThrow("digest changed");
        await rm(join(f.output, "START.md"));
        await symlink(join(f.root, "elsewhere.md"), join(f.output, "START.md"));
        await expect(copyDistributionDocs(f.source, f.output, { entrypoints: ["START.md"], nativeGuides: [] })).rejects.toThrow("symlink");
    });

    test("the actual assistant entry and native guides carry a complete public closure, original banner and explicit historical omissions", async () => {
        const root = await mkdtemp(join(tmpdir(), "wringer-actual-doc-closure-")); roots.push(root);
        const source = resolve(import.meta.dir, "../../.."), output = join(root, "distribution");
        const manifest = await copyDistributionDocs(source, output);
        const checked = await validateDistributionDocs(output);
        expect(checked.links).toBeGreaterThan(70);
        expect(checked.files).toBeGreaterThan(30);
        expect(checked.namedOmissions).toBeGreaterThan(0);
        for (const path of ["INSTALL.md", "SETUP.md", "THREAT_MODEL.md", "docs/native/HEADLESS.md", "docs/PM_ASSISTANT_ENTRY_PLAN.md", "docs/ASSISTANT_IMPLEMENTATION_2026-09-08.md", "docs/banner.webp"]) expect(manifest.files.some(file => file.path === path)).toBe(true);
        expect(manifest.files.every(file => !file.path.startsWith(".wringer/") && !file.path.startsWith(".codex/"))).toBe(true);
        const testReferences = manifest.files.filter(file => file.sourcePath?.endsWith(".test.ts"));
        expect(testReferences.length).toBeGreaterThan(0);
        expect(testReferences.every(file => file.path.endsWith(".test.ts.txt"))).toBe(true);
        expect(manifest.files.every(file => !/\.(?:ts|tsx|js|jsx|mjs|cjs|sh|py)$/.test(file.path))).toBe(true);
        expect(await readFile(join(output, "docs/banner.webp"))).toEqual(await readFile(join(source, "docs/banner.webp")));
        expect(await readFile(join(output, "README.md"), "utf8")).toContain("Created and directed by [Marc Oakes]");
    });
});
