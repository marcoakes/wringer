import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { git } from "@wringer/engine";
import * as application from "../src";
import { validateAdoptionRecord } from "../src/adoption-records";
import { dispatch } from "../../cli/src/app";
const api = application as any;
test("diagnostic preview and exact export include bounded facts and exclude private records and project words", async () => {
    expect(typeof api.previewDiagnostics).toBe("function");
    const root = await realpath(await mkdtemp(join(tmpdir(), "wringer-diagnostic-"))), repo = join(root, "repo"), app = join(root, "application"); await mkdir(repo);
    await git(repo, ["init", "-b", "main"]); await git(repo, ["config", "user.name", "Automated fixture"]); await git(repo, ["config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(repo, "source.txt"), "PRIVATE_PROJECT_SENTINEL\n");
    await writeFile(join(repo, ".wringer.yaml"), JSON.stringify({ version: 1, gates: [{ id: "file", run: "test -f source.txt" }] }));
    await git(repo, ["add", "."]); await git(repo, ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
    const workspace = await application.registerWorkspace(app, { repo, mode: "verification", client: "generic" });
    const job = await application.createVerificationJob(app, workspace.id, { intent: "PRIVATE_REQUEST_SENTINEL", idempotencyKey: crypto.randomUUID() });
    for (const name of ["client-transactions/secret.json", "recoveries/page-owners/private/secret.json", "owners/private/connection.json", "provider-traces/private.json"]) {
        await mkdir(join(app, name, ".."), { recursive: true }); await writeFile(join(app, name), "PRIVATE_CAPABILITY_SENTINEL");
    }
    const before = (await readdir(app, { recursive: true })).sort(), preview = await api.previewDiagnostics(app, workspace.id);
    expect((await readdir(app, { recursive: true })).sort()).toEqual(before);
    expect((await dispatch(["diagnostics", "--workspace", workspace.id, "--app-dir", app, "--dry-run", "--json"])).value).toEqual(preview);
    await expect(validateAdoptionRecord({ ...preview.report, rawProviderTrace: "private" })).rejects.toThrow("record shape");
    await expect(validateAdoptionRecord({ ...preview.manifest, included: [{ path: "../private", bytes: 1, sha256: "a".repeat(64) }] })).rejects.toThrow("record shape");
    const text = JSON.stringify(preview);
    for (const secret of [repo, app, "PRIVATE_PROJECT_SENTINEL", "PRIVATE_REQUEST_SENTINEL", "PRIVATE_CAPABILITY_SENTINEL", "#token="]) expect(text).not.toContain(secret);
    expect(preview.report.jobs[0]).toMatchObject({ jobId: job.id, mode: "verification", phase: "approval", monetaryCost: null });
    const output = join(root, "export");
    await expect(api.exportDiagnostics(app, workspace.id, output, "a".repeat(64))).rejects.toThrow("changed");
    await api.exportDiagnostics(app, workspace.id, output, preview.identity);
    expect((await readdir(output)).sort()).toEqual(["manifest.json", "report.json"]);
    expect(await Bun.file(join(output, "report.json")).json()).toEqual(preview.report);
    const manifest = await Bun.file(join(output, "manifest.json")).json(); expect(manifest.included[0].path).toBe("report.json"); expect(manifest.excluded).toContain("client configuration backups");
    await writeFile(join(output, "foreign.txt"), "retain");
    await expect(api.exportDiagnostics(app, workspace.id, output, preview.identity)).rejects.toThrow("exist");
    expect(await Bun.file(join(output, "foreign.txt")).text()).toBe("retain");
});
