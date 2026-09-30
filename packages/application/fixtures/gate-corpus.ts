/** Shared deterministic gate corpus: a buggy base, labelled defect and control
 * commits, four gates and a runner that really runs each gate on the exported
 * item tree with the arm's pinned files overlaid. Test and fixture use only. */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashBytes } from "@wringer/plan";
import { runtimeProvenanceVersion, type ContainedCommandRequest, type ContainedCommandResult, type PreparedRepositorySource } from "@wringer/runtime";
import { createGateOracle, type GateDeclaration } from "../src/gate-experiments";

export const env = { PATH: "/usr/bin:/bin", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
export function git(args: string[], cwd?: string) { const r = Bun.spawnSync(["git", "-c", "user.name=Gate fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], { cwd, env, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); }
export const runtime = { kind: "apple-container" as const, image: `fixture.invalid/verifier@sha256:${"a".repeat(64)}`, cpus: 1, memoryMiB: 512, network: { policy: "deny" as const }, env: [] as string[] };
export const gate = (id: string, script: string): GateDeclaration => ({ id, argv: ["sh", `gates/${id}.sh`], cwd: ".", timeout_seconds: 10, files: [{ path: `gates/${id}.sh`, content: `${script}\n` }] });
export const gates = {
    narrow: gate("narrow", "test \"$(sh src/total.sh 2 3)\" = 5"),
    weakened: gate("weakened", "sh src/total.sh 2 3 >/dev/null"),
    noisy: gate("noisy", "test \"$(sh src/total.sh 2 3)\" = 5 && grep -q '\\$((' src/total.sh"),
    property: gate("property", "for a in 0 2 7 11; do for b in 0 3 5; do test \"$(sh src/total.sh $a $b)\" = $(( a + b )) || exit 1; done; done"),
};
export const variants = [
    { id: "correct-sum", label: "control", split: "development", body: "echo $(( $1 + $2 ))" },
    { id: "tautology-two-three", label: "defect", split: "development", body: "echo 5" },
    { id: "correct-expr", label: "control", split: "held-out", body: "expr \"$1\" + \"$2\"" },
    { id: "correct-awk", label: "control", split: "held-out", body: "awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { print a + b }'" },
    { id: "tautology-held-out", label: "defect", split: "held-out", body: "if [ \"$1\" = 2 ]; then echo 5; else echo $(( $1 + $2 + 1 )); fi" },
    { id: "sign-flip", label: "defect", split: "held-out", body: "echo $(( $1 - $2 ))" },
    { id: "unchanged-bug", label: "defect", split: "held-out", body: "echo $(( $1 + $2 + 1 ))" },
    { id: "rewrites-its-gate", label: "defect", split: "held-out", body: "echo 5", gateOverride: true },
] as const;
export async function corpus(parent?: string) {
    const root = await mkdtemp(join(parent ?? tmpdir(), "wringer-gate-experiment-"));
    const repo = join(root, "source"); await mkdir(join(repo, "src"), { recursive: true }); git(["init", "-q", "-b", "main", repo]);
    await writeFile(join(repo, "src/total.sh"), "#!/bin/sh\necho $(( $1 + $2 + 1 ))\n"); git(["add", "."], repo); git(["commit", "-q", "-m", "Buggy base"], repo);
    const base = git(["rev-parse", "HEAD"], repo), items = [];
    for (const variant of variants) {
        git(["checkout", "-q", base], repo); await writeFile(join(repo, "src/total.sh"), `#!/bin/sh\n${variant.body}\n`);
        if ("gateOverride" in variant) { await mkdir(join(repo, "gates"), { recursive: true }); for (const name of Object.keys(gates)) await writeFile(join(repo, `gates/${name}.sh`), "exit 0\n"); git(["add", "."], repo); }
        git(["commit", "-q", "--allow-empty", "-am", variant.id], repo);
        const commit = git(["rev-parse", "HEAD"], repo); git(["branch", "-f", `item-${variant.id}`, commit], repo);
        items.push({ id: variant.id, split: variant.split, commit, tree: git(["rev-parse", `${commit}^{tree}`], repo) });
    }
    git(["checkout", "-q", base], repo);
    const bundle = join(root, "corpus.bundle"); git(["bundle", "create", bundle, "--all"], repo);
    const oracle = createGateOracle("totals", variants.map(v => ({ itemId: v.id, label: v.label })));
    const { runs, runCommands } = gateRunner(root);
    return { root, repo, base, items, bundle, oracle, runs, runCommands };
}
/** Really run each gate on the exported item tree with the arm's pinned files overlaid. */
export function gateRunner(root: string) {
    const runs: string[] = [];
    const runCommands = async (request: ContainedCommandRequest): Promise<ContainedCommandResult> => {
        const source = request.repo as PreparedRepositorySource, acceptance = request.acceptanceSource as PreparedRepositorySource, work = await mkdtemp(join(root, "tree-"));
        runs.push(`${request.commands[0]!.id}@${source.commit.slice(0, 7)}`);
        const archive = Bun.spawnSync(["/bin/sh", "-c", `git --git-dir '${source.objectStore}' archive ${source.commit} | tar -x -C '${work}'`], { env });
        if (archive.exitCode) throw new Error("export failed");
        for (const path of request.protectedFiles ?? []) { await mkdir(join(work, path, ".."), { recursive: true }); await writeFile(join(work, path), git(["--git-dir", acceptance.objectStore, "show", `${acceptance.commit}:${path}`]) + "\n"); }
        return { provenance: { schema_version: runtimeProvenanceVersion(source.url), runtimeId: crypto.randomUUID(), role: "verifier", kind: request.runtime.kind, image: request.runtime.image, repository: { url: source.url, commit: source.commit }, clonedInside: true, hostMounts: [], repositoryAccess: "read-only", declared: request.runtime, observed: { fixture: true, writableDirectories: [] }, limits: ["Fixture runner"] } as any,
            sourceChanged: false, sourceTree: git(["--git-dir", source.objectStore, "rev-parse", `${source.commit}^{tree}`]), checkInputsSha256: hashBytes("pinned"),
            results: request.commands.map(command => { const r = Bun.spawnSync(command.argv!, { cwd: work, env, stdout: "pipe", stderr: "pipe" }); return { id: command.id, code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), durationMs: 1 }; }) };
    };
    return { runs, runCommands };
}
