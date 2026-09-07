import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { loadConfig, snapshot, Redactor } from "@wringer/engine";
import { loadBoard, renderHtml, renderMarkdown, deriveFacts, deriveRail, deriveNextAction, toCertificateRequirements } from "@wringer/board";
import { checkSeal, copyBundle, digest, exists, files, git, gitBytes, inside, json, portableName, put as writeRecord, quote, record, Refusal, seal, stamp } from "./io";
import { publishMergeRequest, parseForgeConfiguration, type MergeRequestPublication } from "./forge";
export interface DeliveryOptions {
    send?: boolean;
    run?: string;
    branch?: string;
    base?: string;
    remote?: string;
    title?: string;
    signal?: AbortSignal;
}
export interface DeliveryResult {
    delivery_id: string;
    directory: string;
    branch: string;
    commit: string | null;
    evidence_commit: string | null;
    pushed: boolean;
    mode: "live" | "dry_run";
    audit_command: string;
    falsify_command: string;
    next_move: string;
    publication?: MergeRequestPublication;
}
export interface Anchor {
    schema_version: "wringer.native.delivery-anchor.v1";
    delivery_id: string;
    run_id: string;
    base_commit: string;
    code_commit: string | null;
    code_tree: string;
    verified_fingerprint: string;
    source_files: Record<string, string | null>;
    receipts: Record<string, string>;
    bundle_files: string[];
    publication: {
        code_pushed: boolean;
    };
}
/** Isolated index: neither dry-run nor send stages, stashes or checks out the operator's tree. */
export async function deliver(repo: string, options: DeliveryOptions = {}): Promise<DeliveryResult> {
    repo = await git(resolve(repo), ["rev-parse", "--show-toplevel"]);
    const config = await loadConfig(repo), model = await loadBoard(repo, options.run);
    const redactor = new Redactor(config.evidence.redact.env);
    const put = (path: string, value: unknown) => writeRecord(path, value, redactor);
    const nextVerify = `wring verify --repo ${quote(repo)}`;
    if (!model.run || model.facts.readyToDeliver !== true)
        throw new Refusal(`Delivery requires a finished passing run with every required proof and human judgement. ${model.issues.map(v => v.message).join(" ")}`, model.nextAction.command || nextVerify, "not-ready");
    if (!config.deliver)
        throw new Refusal("No delivery policy is declared in .wringer.yaml.", `wring deliver --help`, "no-delivery-policy");
    const runPath = await inside(repo, model.run.path);
    await checkSeal(runPath);
    if (await exists(join(runPath, "check-mutations.json")) && (await json(join(runPath, "check-mutations.json"))).refuses)
        throw new Refusal("A declared check changed while verification ran. Re-run the restored checks before delivery.", nextVerify, "check-mutated");
    if (await exists(join(runPath, "vacuity.json")) && ["gates_vacuous", "inconclusive"].includes((await json(join(runPath, "vacuity.json"))).verdict))
        throw new Refusal("The configured sensitivity measurement did not establish proof.", nextVerify, "unproved-sensitivity");
    const verified = await json(join(runPath, "snapshot.json"));
    const before = await snapshot(repo);
    if (!before.head_sha || !verified.fingerprint || before.fingerprint !== verified.fingerprint)
        throw new Refusal("The working tree is not the tree this run verified. Run verification on the current bytes.", nextVerify, "stale-verification");
    for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
        if (await exists(await git(repo, ["rev-parse", "--git-path", marker])))
            throw new Refusal("Finish the active merge, rebase, revert or cherry-pick before delivering.", `git -C ${quote(repo)} status`);
    }
    if (config.provenance?.require_signature)
        throw new Refusal("This delivery path cannot establish the declared signing policy.", `wring doctor --repo ${quote(repo)}`, "signature-required");
    const id = stamp(), branch = options.branch || config.deliver.branch?.replaceAll("{run}", model.run.id).replaceAll("{run_id}", model.run.id) || `wringer/${id}`;
    const remote = options.remote || config.deliver.remote || "origin";
    if (remote.startsWith("-") || /\s/.test(remote))
        throw new Error("Invalid remote name");
    const remoteURL = await git(repo, ["remote", "get-url", remote]);
    if (/:\/\/[^/]*@/.test(remoteURL))
        throw new Refusal("Remote URLs containing credentials are not accepted.", `git -C ${quote(repo)} remote -v`);
    const defaultRef = await git(repo, ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`], { allowFailure: true });
    const remoteHead = defaultRef.replace(`refs/remotes/${remote}/`, "");
    const baseName = options.base || config.deliver.base || remoteHead;
    if (!baseName)
        throw new Refusal("The remote default branch is unknown; declare deliver.base or set the remote HEAD.", `git -C ${quote(repo)} remote set-head ${quote(remote)} --auto`, "unknown-base");
    await git(repo, ["check-ref-format", "--branch", branch]);
    if ([before.branch, baseName, remoteHead, "main", "master"].includes(branch) || branch.startsWith("-"))
        throw new Refusal(`Delivery must use a new non-default branch, not ${branch}.`, `wring deliver --repo ${quote(repo)} --branch ${quote(`wringer/${id}`)}`);
    if (await git(repo, ["rev-parse", "--verify", `refs/heads/${branch}`], { allowFailure: true }))
        throw new Refusal(`Branch ${branch} already exists.`, `wring deliver --repo ${quote(repo)} --branch ${quote(`wringer/${id}`)}`);
    if (options.send && await git(repo, ["ls-remote", "--heads", remote, `refs/heads/${branch}`]))
        throw new Refusal(`Remote branch ${branch} already exists.`, `wring deliver --repo ${quote(repo)} --branch ${quote(`wringer/${id}`)}`);
    const base = await git(repo, ["rev-parse", "--verify", `${baseName}^{commit}`], { allowFailure: true }) || await git(repo, ["rev-parse", "--verify", `refs/remotes/${remote}/${baseName}^{commit}`]);
    if (options.send && (!(await git(repo, ["config", "user.name"], { allowFailure: true })) || !(await git(repo, ["config", "user.email"], { allowFailure: true }))))
        throw new Refusal("Git identity is missing. Use repository-local identity; global configuration is not required.", `git -C ${quote(repo)} config --local user.name 'Your name'`);
    const directory = await inside(repo, `.wringer/deliveries/${id}`);
    await mkdir(directory, { recursive: true });
    let previous = "0".repeat(64);
    const ledger: unknown[] = [];
    async function event(action: string, argv: string[]) {
        const row: any = redactor.deep({ at: new Date().toISOString(), action, argv, prev_hash: previous });
        previous = digest(JSON.stringify(row));
        row.hash = previous;
        ledger.push(row);
        await put(join(directory, "ledger.jsonl"), ledger.map(v => JSON.stringify(v)).join("\n") + "\n");
    }
    const temp = await mkdtemp(join(tmpdir(), "wringer-delivery-"));
    const env = { GIT_INDEX_FILE: join(temp, "index") };
    let codeCommit: string | null = null, evidenceCommit: string | null = null, pushed = false;
    try {
        await git(repo, ["read-tree", before.head_sha], { env });
        // Passing an ignored directory in an exclusion pathspec makes some Git versions
        // fail add. Enumerate source paths instead; NUL framing also preserves odd names.
        const stagePaths = (await git(repo, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { env, raw: true })).split("\0").filter(path => path && path !== ".wringer" && !path.startsWith(".wringer/"));
        if (stagePaths.length)
            await git(repo, ["add", "--all", "--pathspec-from-file=-", "--pathspec-file-nul"], { env, input: [...new Set(stagePaths)].map(path => `:(literal)${path}\0`).join("") });
        const tree = await git(repo, ["write-tree"], { env });
        if (tree === await git(repo, ["rev-parse", `${before.head_sha}^{tree}`]))
            throw new Refusal("There are no source changes to deliver.", nextVerify, "no-changes");
        if ((await snapshot(repo)).fingerprint !== before.fingerprint)
            throw new Refusal("The tree changed while delivery was preparing. No branch was created.", nextVerify, "concurrent-edit");
        const title = options.title || model.title || `Verified change ${model.run.id}`;
        if (/[\r\n]/.test(title))
            throw new Error("Delivery title must be a single line");
        const diff = await git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--binary", base, tree, "--", ".", ":(exclude).wringer"], { raw: true });
        if (redactor.scrub(diff) !== diff)
            throw new Refusal("The proposed source change contains a value matching the repository's secret redaction policy. Remove it from source before delivering.", nextVerify, "secret-in-source");
        const changed = (await git(repo, ["diff", "--name-only", "-z", base, tree])).split("\0").filter(Boolean);
        const sourceFiles: Record<string, string | null> = {};
        for (const path of changed) {
            portableName(path);
            if (redactor.scrub(path) !== path)
                throw new Refusal("A proposed source filename matches the secret redaction policy.", nextVerify, "secret-in-source");
            const listing = await git(repo, ["ls-tree", tree, "--", path]);
            if (!listing)
                sourceFiles[path] = null;
            else {
                const blob = listing.split(/\s+/)[2]!;
                // Hash bytes, not a text-normalised shell output.
                const bytes = await gitBytes(repo, ["cat-file", "blob", blob]);
                const decoded = new TextDecoder().decode(bytes);
                if (redactor.scrub(decoded) !== decoded)
                    throw new Refusal(`Source ${path} contains a value matching the repository's secret redaction policy. Remove it before delivery.`, nextVerify, "secret-in-source");
                sourceFiles[path] = digest(bytes);
            }
        }
        if (options.send) {
            await event("create-code-commit", ["git", "commit-tree", tree, "-p", before.head_sha]);
            codeCommit = await git(repo, ["commit-tree", tree, "-p", before.head_sha], { input: title + "\n" });
            await event("create-delivery-branch", ["git", "update-ref", `refs/heads/${branch}`, codeCommit, "0".repeat(40)]);
            await git(repo, ["update-ref", `refs/heads/${branch}`, codeCommit, "0".repeat(40)]);
            await event("push-code", ["git", "push", remote, `refs/heads/${branch}:refs/heads/${branch}`]);
            await git(repo, ["push", remote, `refs/heads/${branch}:refs/heads/${branch}`]);
            pushed = true;
        }
        const receipts: Record<string, string> = {};
        for (const requirement of model.requirements)
            if (requirement.proved && requirement.receipt?.path) {
                const path = requirement.receipt.path;
                if (!receipts[path]) {
                    const target = `receipts/${Object.keys(receipts).length.toString().padStart(3, "0")}-${digest(path).slice(0, 8)}`;
                    await copyBundle(await inside(repo, path), join(directory, target));
                    receipts[path] = target;
                }
            }
        await copyBundle(runPath, join(directory, "run"));
        const specPath = join(runPath, "wringer.spec.yaml");
        if (!await exists(specPath))
            throw new Refusal("The verified specification snapshot is missing; current files cannot stand in for that record.", nextVerify);
        const spec = await Bun.file(specPath).text();
        await put(join(directory, "spec.yaml"), spec);
        model.delivery = { id, mode: options.send ? "live" : "dry_run", commit: codeCommit, pushed };
        model.facts = deriveFacts({ ...model, built: model.facts.built });
        model.rail = deriveRail(model.facts);
        model.nextAction = deriveNextAction(model);
        const auditCommand = `wring audit --delivery ${quote(id)} --repo .`;
        const falsifyCommand = `wring verify --falsify --delivery ${quote(id)} --repo .`;
        const requirements = toCertificateRequirements(model);
        const acceptance = await record(join(runPath, "acceptance.json"));
        const certificate = { schema_version: "wringer.certificate.v1", written_at: new Date().toISOString(), change: { title, branch, base, commit: codeCommit || before.head_sha, files_changed: changed.length }, run: { id: model.run.id, bundle: model.run.path }, spec: { sha256: digest(spec) }, acceptance: { schema_version: acceptance.schema_version, counts: acceptance.counts }, requirements, limits: [...acceptance.limits, "This certificate copies recorded claims; it does not independently assess the work.", "Digests detect alteration, not malicious rewriting by an owner of all artifacts.", "Identity and machine clock are recorded, not authenticated.", "A red-first check proves the stated criterion, not the completeness of the specification."] };
        await put(join(directory, "certificate.json"), certificate);
        await put(join(directory, "patch.diff"), diff);
        await put(join(directory, "branch.txt"), branch + "\n");
        await put(join(directory, "commit.txt"), title + "\n");
        await put(join(directory, "board.html"), renderHtml(model));
        await put(join(directory, "summary.md"), renderMarkdown(model));
        const bundleFiles = ["manifest.json", "anchor.json", "certificate.json", "board.html", "summary.md", "mr.md", "patch.diff", "commit.txt", "branch.txt", "commands.txt", "spec.yaml", "ledger.jsonl", "digests.json", ...(await files(join(directory, "run"))).map(p => `run/${p}`), ...Object.values(receipts).flatMap(() => [])];
        for (const p of Object.values(receipts))
            bundleFiles.push(...(await files(join(directory, p))).map(f => `${p}/${f}`));
        const anchor: Anchor = { schema_version: "wringer.native.delivery-anchor.v1", delivery_id: id, run_id: model.run.id, base_commit: base, code_commit: codeCommit, code_tree: tree, verified_fingerprint: before.fingerprint, source_files: sourceFiles, receipts, bundle_files: bundleFiles.sort(), publication: { code_pushed: pushed } };
        await put(join(directory, "anchor.json"), anchor);
        const commands = [`git fetch ${quote(remote)} ${quote(branch)}`, `git switch --detach ${quote(`${remote}/${branch}`)}`, auditCommand, falsifyCommand];
        await put(join(directory, "commands.txt"), commands.join("\n") + "\n");
        const inventory = bundleFiles.map(p => `- \`${p}\``).join("\n");
        await put(join(directory, "mr.md"), `${renderMarkdown(model)}\n## Independent audit\n\nClone the repository's origin into a fresh directory. Run these commands from the ROOT of that clone, on the delivered branch. This package carries the passing run and every cited red receipt; the original working directory is not needed.\n\n\`\`\`sh\n${commands.slice(0, 3).join("\n")}\n\`\`\`\n\n## Falsify the committed change\n\nFrom that same clone root, after fetching the delivered branch:\n\n\`\`\`sh\n${falsifyCommand}\n\`\`\`\n\nThe measurement names the committed range and exact code commit. Survivors are findings about the checks, not verdicts on the work.\n\n## Carried files\n\n${inventory}\n`);
        await put(join(directory, "manifest.json"), { schema_version: "wringer.delivery.v1", delivery_id: id, started_at: new Date().toISOString(), mode: options.send ? "live" : "dry_run", run_dir: model.run.path, branch, base, remote, files: changed, spec_sha256: digest(spec), result: { branch: options.send ? branch : null, commit: codeCommit, pushed, merge_request: null } });
        await event(options.send ? "package-ready" : "dry-run", []);
        await seal(directory);
        if (options.send && codeCommit) {
            await git(repo, ["read-tree", codeCommit], { env });
            // Log before each write, then seal the final portable bytes before staging them.
            await event("publish-evidence", ["git", "add", "-f", "--", relative(repo, directory)]);
            await event("commit-evidence", ["git", "commit-tree", "<evidence-tree>", "-p", codeCommit]);
            await event("advance-delivery-branch", ["git", "update-ref", `refs/heads/${branch}`, "<evidence-commit>", codeCommit]);
            await event("push-evidence", ["git", "push", remote, `refs/heads/${branch}:refs/heads/${branch}`]);
            await seal(directory);
            await git(repo, ["add", "-f", "--", relative(repo, directory)], { env });
            const evidenceTree = await git(repo, ["write-tree"], { env });
            evidenceCommit = await git(repo, ["commit-tree", evidenceTree, "-p", codeCommit], { input: `Evidence for ${id}\n` });
            await git(repo, ["update-ref", `refs/heads/${branch}`, evidenceCommit, codeCommit]);
            await git(repo, ["push", remote, `refs/heads/${branch}:refs/heads/${branch}`]);
        }
        const publication = config.forge ? await publishMergeRequest(repo, { forge: parseForgeConfiguration(config.forge), deliveryId: id, bodyPath: join(directory, "mr.md"), sourceBranch: branch, targetBranch: baseName, title, send: options.send, signal: options.signal, resumeCommand: `wring deliver --repo ${quote(repo)} --delivery ${quote(id)} --send` }) : undefined;
        return { delivery_id: id, directory, branch, commit: codeCommit, evidence_commit: evidenceCommit, pushed, mode: options.send ? "live" : "dry_run", audit_command: auditCommand, falsify_command: falsifyCommand, ...(publication ? { publication } : {}), next_move: publication && !["published", "recovered", "prepared"].includes(publication.status) ? publication.next_move : options.send ? `cd ${quote(repo)} && ${falsifyCommand}` : `wring deliver --repo ${quote(repo)} --send` };
    }
    catch (error) {
        await put(join(directory, "failure.json"), { schema_version: "wringer.native.delivery-failure.v1", at: new Date().toISOString(), message: String(error), branch, code_commit: codeCommit, pushed });
        throw error;
    }
    finally {
        await rm(temp, { recursive: true, force: true });
    }
}
