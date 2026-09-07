import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dir, "../../..");
test("the root product is a Bun workspace, with no Python harness packaging", async () => {
    const packageJson = await Bun.file(`${root}/package.json`).json();
    expect(packageJson.name).toBe("wringer");
    expect(packageJson.engines.bun).toBe("1.4.2");
    expect(packageJson.workspaces).toEqual(["packages/*"]);
    expect(await Bun.file(`${root}/bun.lock`).exists()).toBe(true);
    for (const path of ["pyproject.toml", "MANIFEST.in", "src/wringer/cli.py", "src/wringer_board/__main__.py", "src/wringer_drive/__main__.py", "scripts/reference.ts", "scripts/export-records.py"])
        expect(await Bun.file(`${root}/${path}`).exists(), path).toBe(false);
    expect(JSON.stringify(packageJson.scripts)).not.toMatch(/python|pytest|\.venv|cd ts/);
});
test("active build and release workflows cannot publish or invoke the Python harness", async () => {
    for (const file of [".github/workflows/tests.yml", ".github/workflows/release.yml", "action.yml", "Dockerfile", "scripts/validate.ts"]) {
        const text = await Bun.file(`${root}/${file}`).text();
        expect(text, file).not.toMatch(/setup-python|pip install|uv tool|pypa\/|pytest -|\.venv\/bin\/python/);
    }
    const release = await Bun.file(`${root}/.github/workflows/release.yml`).text();
    expect(release).toContain("--draft");
    expect(release).not.toContain("id-token: write");
});
test("every retired tracked runtime file is recorded and recoverable by its baseline commit", async () => {
    const record = await Bun.file(`${root}/docs/python-retirement.json`).json();
    expect(record.schema_version).toBe("wringer.python-retirement.v1");
    expect(record.last_repository_commit_before_rewrite).toBe("7b79c58");
    expect(record.removed_tracked_paths.length).toBeGreaterThan(200);
    for (const path of record.removed_tracked_paths)
        expect(await Bun.file(`${root}/${path}`).exists(), path).toBe(false);
});
test("retirement preserves the exact published schema bytes", async () => {
    const frozen = await Bun.file(`${root}/schema/frozen.json`).json();
    const entries = Object.entries(frozen.files ?? frozen.schemas ?? frozen);
    let checked = 0;
    for (const [file, raw] of entries) {
        if (!file.endsWith(".schema.json"))
            continue;
        const expected = typeof raw === "string" ? raw : (raw as any).sha256;
        const actual = createHash("sha256").update(new Uint8Array(await Bun.file(`${root}/schema/${file}`).arrayBuffer())).digest("hex");
        expect(actual, file).toBe(expected);
        checked++;
    }
    expect(checked).toBeGreaterThan(0);
});
