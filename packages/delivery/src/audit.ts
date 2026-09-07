import { join, resolve } from "node:path";
import { checkSeal, digest, exists, files, git, gitBytes, inside, json, portableName, put, quote, record, Refusal, seal, stamp } from "./io";
import { parseYaml, criterionDigest, schemaDirectory } from "@wringer/engine";
import { openReader } from "@wringer/records";
import type { Anchor } from "./deliver";
export interface AuditClaim {
    claim: string;
    status: "checked" | "failed" | "uncheckable";
    reason: string;
}
export interface AuditReport {
    schema_version: "wringer.native.audit.v1";
    at: string;
    delivery: string;
    status: "passed" | "failed";
    claims: AuditClaim[];
    checked: number;
    failed: number;
    uncheckable: number;
    limits: string[];
}
export async function deliveryPath(repo: string, name: string): Promise<string> {
    if (/^[A-Za-z0-9_-]+$/.test(name))
        return inside(repo, `.wringer/deliveries/${name}`);
    const path = resolve(repo, name), base = resolve(repo);
    if (!path.startsWith(base + "/"))
        throw new Error("Delivery path must be inside the repository");
    return inside(base, path.slice(base.length + 1));
}
export async function audit(repo: string, delivery: string): Promise<AuditReport> {
    repo = resolve(repo);
    const directory = await deliveryPath(repo, delivery);
    const claims: AuditClaim[] = [];
    const claim = async (label: string, action: () => Promise<string>) => {
        try {
            claims.push({ claim: label, status: "checked", reason: await action() });
        }
        catch (e) {
            claims.push({ claim: label, status: "failed", reason: e instanceof Error ? e.message : String(e) });
        }
    };
    await claim("The entire carried bundle matches its digest inventory", async () => `${await checkSeal(directory)} files checked; no missing or unlisted files.`);
    let anchor: Anchor, manifest: any, certificate: any, run: any, acceptance: any;
    try {
        anchor = await json(join(directory, "anchor.json"));
        if (anchor.schema_version !== "wringer.native.delivery-anchor.v1" || !anchor.receipts || !anchor.source_files || !Array.isArray(anchor.bundle_files) || !/^[a-f0-9]{40,64}$/.test(anchor.base_commit) || !/^[a-f0-9]{40,64}$/.test(anchor.code_tree))
            throw new Error("Unsupported or malformed delivery anchor");
        manifest = await record(join(directory, "manifest.json"), "wringer.delivery.v1");
        certificate = await record(join(directory, "certificate.json"), "wringer.certificate.v1");
        run = await record(join(directory, "run/manifest.json"), "wringer.evidence.v1");
        acceptance = await record(join(directory, "run/acceptance.json"));
        if (!/^wringer\.acceptance\.v[123]$/.test(acceptance.schema_version))
            throw new Error("Not an acceptance record");
    }
    catch (error) {
        claims.push({ claim: "Records satisfy their declared schemas", status: "failed", reason: String(error) });
        return report();
    }
    await claim("One delivery and one run are named everywhere", async () => {
        if (manifest.delivery_id !== anchor.delivery_id || certificate.run.id !== run.run_id || anchor.run_id !== run.run_id || manifest.run_dir !== certificate.run.bundle)
            throw new Error("Delivery, certificate and passing run identities disagree");
        for (const face of ["summary.md", "mr.md", "board.html"]) {
            if (!(await Bun.file(join(directory, face)).text()).includes(run.run_id))
                throw new Error(`${face} does not name run ${run.run_id}`);
        }
        return `Delivery ${anchor.delivery_id}, run ${run.run_id}.`;
    });
    await claim("Every promised file travels with the delivery", async () => {
        const inventory = await files(directory);
        if (JSON.stringify(inventory) !== JSON.stringify([...anchor.bundle_files].sort()))
            throw new Error("Promised file inventory is not the carried inventory");
        const mr = await Bun.file(join(directory, "mr.md")).text();
        for (const name of inventory)
            if (!mr.includes(`\`${name}\``))
                throw new Error(`mr.md does not inventory ${name}`);
        return `${inventory.length} promised files are present.`;
    });
    await claim("The passing run itself is intact and passing", async () => {
        await checkSeal(join(directory, "run"));
        if (run.result.status !== "passed")
            throw new Error(`Run status is ${run.result.status}`);
        const results = await gates(join(directory, "run"));
        if (!results.length || results.some(g => !g.optional && (g.status !== "passed" || g.exit_code !== 0 || g.timed_out)))
            throw new Error("No checks, or a required check did not pass");
        if (await exists(join(directory, "run/check-mutations.json")) && (await json(join(directory, "run/check-mutations.json"))).refuses)
            throw new Error("A check changed during verification; this run cannot support delivery");
        return `${results.length} recorded checks inspected.`;
    });
    await claim("Certificate counts and requirements are the run's facts", async () => {
        const counts: Record<string, number> = { evidenced: 0, unevidenced: 0, "gate-failed": 0, "gate-did-not-run": 0, human: 0 };
        if (certificate.requirements.length !== acceptance.criteria.length)
            throw new Error("Requirement population differs");
        for (let index = 0; index < acceptance.criteria.length; index++) {
            const row = acceptance.criteria[index], cert = certificate.requirements[index];
            counts[row.state] = (counts[row.state] ?? 0) + 1;
            for (const [a, b] of [["criterion", "id"], ["title", "title"], ["required", "required"], ["state", "state"], ["gate", "check"], ["command", "command"], ["reason", "reason"], ["refuses", "refuses"]])
                if (row[a!] !== cert[b!])
                    throw new Error(`Requirement ${row.criterion}: ${a} differs`);
            if (JSON.stringify(row.judgement ?? null) !== JSON.stringify(cert.judgement))
                throw new Error(`Judgement differs for ${row.criterion}`);
        }
        for (const [key, value] of Object.entries(counts))
            if (value !== acceptance.counts[key] || value !== certificate.acceptance.counts[key])
                throw new Error(`Inflated or inconsistent ${key} count`);
        if (certificate.acceptance.schema_version !== acceptance.schema_version)
            throw new Error("Acceptance schema version differs");
        return `${acceptance.criteria.length} requirement rows and all five counts agree.`;
    });
    await claim("The authorized specification travels unchanged", async () => {
        const bytes = new Uint8Array(await Bun.file(join(directory, "spec.yaml")).arrayBuffer()), hash = digest(bytes);
        if (hash !== certificate.spec.sha256 || hash !== manifest.spec_sha256)
            throw new Error("Carried specification does not match its recorded hash");
        if (hash !== digest(new Uint8Array(await Bun.file(join(directory, "run/wringer.spec.yaml")).arrayBuffer())))
            throw new Error("The specification is not the one frozen by verification");
        const specification = parseYaml(new TextDecoder().decode(bytes));
        const specValidation = await (await openReader(schemaDirectory())).validate(specification, "spec.schema.json");
        if (!specValidation.ok)
            throw new Error(`The carried specification violates its declared contract: ${specValidation.said}`);
        if (specification.schema_version !== "wringer.spec.v1" || specification.approved !== true || !Array.isArray(specification.criteria) || specification.criteria.length !== acceptance.criteria.length)
            throw new Error("The carried plan is unapproved or its requirement population differs");
        const sourcesPath = join(directory, "run/wringer.sources.yaml");
        if (await exists(sourcesPath)) {
            const sources = parseYaml(await Bun.file(sourcesPath).text()), normalize = (value: string) => value.replace(/\s+/g, " ").trim();
            if (sources.schema_version !== "wringer.sources.v1" || sources.sources && (!sources.sources || typeof sources.sources !== "object" || Array.isArray(sources.sources)))
                throw new Error("The carried source quotations have an invalid shape");
            for (const [id, quote] of Object.entries(sources.sources ?? {})) {
                if (!specification.criteria.some((c: any) => c.id === id) || typeof quote !== "string" || !normalize(quote) || !normalize(specification.intent ?? "").includes(normalize(quote)))
                    throw new Error(`Source quotation ${id} is not present in the frozen intent`);
            }
        }
        for (const criterion of specification.criteria) {
            const row = acceptance.criteria.find((r: any) => r.criterion === criterion.id);
            if (!row || row.title !== criterion.title || row.required !== (criterion.required !== false) || (row.state === "human") !== (criterion.human === true))
                throw new Error(`Requirement ${criterion.id} differs from the approved specification`);
            if (row.judgement) {
                const recordPath = join(directory, "run/judgements.json");
                if (!await exists(recordPath))
                    throw new Error(`No carried judgement record for ${criterion.id}`);
                const entry = (await record(recordPath)).entries.find((e: any) => e.criterion === criterion.id);
                if (!entry || entry.criterion_digest !== criterionDigest(criterion) || entry.note !== row.judgement.note || entry.verdict !== row.judgement.verdict || entry.by !== row.judgement.by || entry.at !== row.judgement.at)
                    throw new Error(`Human judgement ${criterion.id} does not match its original record or wording`);
            }
        }
        return hash;
    });
    if (!anchor.code_commit)
        claims.push({ claim: "The verified source is the delivered commit", status: "uncheckable", reason: "Dry-run only: no delivered commit exists; this claim could NOT be checked from here." });
    else
        await claim("The verified source is the delivered commit", async () => {
            if (!/^[a-f0-9]{40,64}$/.test(anchor.code_commit!) || manifest.result.commit !== anchor.code_commit || certificate.change.commit !== anchor.code_commit)
                throw new Error("Code commit identities disagree");
            const tree = await git(repo, ["rev-parse", `${anchor.code_commit}^{tree}`]);
            if (tree !== anchor.code_tree)
                throw new Error("Committed tree differs from the verified tree");
            const snapshot = await json(join(directory, "run/snapshot.json"));
            if (snapshot.fingerprint !== anchor.verified_fingerprint)
                throw new Error("Verified snapshot anchor differs");
            const actual = (await git(repo, ["diff", "--name-only", "-z", anchor.base_commit, anchor.code_commit!])).split("\0").filter(Boolean).sort();
            if (JSON.stringify(actual) !== JSON.stringify(Object.keys(anchor.source_files).sort()))
                throw new Error("Source file inventory differs from the committed range");
            for (const [name, hash] of Object.entries(anchor.source_files)) {
                portableName(name);
                const entry = await git(repo, ["ls-tree", anchor.code_commit!, "--", name]);
                if (hash === null) {
                    if (entry)
                        throw new Error(`Deleted file still exists: ${name}`);
                    continue;
                }
                if (!entry || !/^[a-f0-9]{64}$/.test(hash))
                    throw new Error(`Missing committed file: ${name}`);
                const blob = entry.split(/\s+/)[2]!;
                const value = await gitBytes(repo, ["cat-file", "blob", blob]);
                if (digest(value) !== hash)
                    throw new Error(`Committed bytes differ: ${name}`);
            }
            return `${anchor.base_commit}..${anchor.code_commit}, tree ${tree}.`;
        });
    let green: any[] = [];
    try {
        green = await gates(join(directory, "run"));
    }
    catch (error) {
        claims.push({ claim: "The passing check results are readable", status: "failed", reason: String(error) });
        return report();
    }
    for (const row of acceptance.criteria) {
        if (row.state === "evidenced")
            await claim(`PROVED ${row.criterion}: same check was red before it was green`, async () => {
                const receipt = row.receipt;
                if (!receipt || !["failure", "sensitive"].includes(receipt.kind))
                    throw new Error("This audit needs a genuine-failure or measured-sensitivity receipt; witness provenance requires its own checker");
                const mapped = anchor.receipts[receipt.bundle];
                if (!mapped)
                    throw new Error(`Receipt ${receipt.bundle} did not travel; could NOT be checked from here`);
                const redPath = await inside(directory, mapped);
                await checkSeal(redPath);
                const redManifest = await record(join(redPath, "manifest.json"), "wringer.evidence.v1");
                if (Date.parse(redManifest.started_at) > Date.parse(run.started_at))
                    throw new Error("The supposed red receipt is later than the green run");
                let match: any;
                if (receipt.kind === "failure")
                    match = (await gates(redPath)).find(g => g.gate_id === row.gate && g.command === row.command);
                else {
                    const vacuity = await record(join(redPath, "vacuity.json"), "wringer.vacuity.v1"), sensitive = vacuity.gates.find((g: any) => g.gate_id === row.gate && g.sensitive && g.changed === "passed" && g.pre_change === "failed");
                    if (!sensitive || !sensitive.cites || vacuity.verdict !== "proven" || vacuity.setup && !vacuity.setup.ok)
                        throw new Error("The carried sensitivity record did not establish a sound pre-change comparison");
                    match = await json(await inside(redPath, sensitive.cites));
                    if (match.gate_id !== row.gate || match.command !== row.command)
                        throw new Error("Sensitivity receipt changed the gate or command");
                    const materialized = await json(join(redPath, "prove-checks.json"));
                    if (!/^[a-f0-9]{40,64}$/.test(materialized.base_sha))
                        throw new Error("Sensitivity comparison names no measured pre-change commit");
                }
                const passed = green.find(g => g.gate_id === row.gate && g.command === row.command);
                if (!match || match.status !== "failed" || match.exit_code <= 0 || [126, 127, 137, 143].includes(match.exit_code) || match.timed_out)
                    throw new Error("Receipt is not a genuine failure of the exact gate/command pair");
                if (!passed || passed.status !== "passed" || passed.exit_code !== 0 || passed.timed_out)
                    throw new Error("That exact check did not pass in the delivered run");
                const beforeChecks = await record(join(redPath, "checks.json"), "wringer.checks.v1"), afterChecks = await record(join(directory, "run/checks.json"), "wringer.checks.v1");
                const prior = beforeChecks.checks.find((c: any) => c.gate_id === row.gate && c.run === row.command), current = afterChecks.checks.find((c: any) => c.gate_id === row.gate && c.run === row.command);
                if (!prior || !current || prior.run_sha256 !== current.run_sha256 || JSON.stringify(prior.files) !== JSON.stringify(current.files))
                    throw new Error("The check's named file identity changed between red and green");
                const redExecution = await record(join(redPath, "execution.json")), greenExecution = await record(join(directory, "run/execution.json"));
                if (["backend", "execution_mode", "image", "runtime", "network", "user", "env_allowlist"].some(key => JSON.stringify(redExecution[key]) !== JSON.stringify(greenExecution[key])))
                    throw new Error("The check's execution policy changed between red and green");
                return `${mapped}: exit ${match.exit_code} → run: exit 0.`;
            });
        else if (row.state === "human")
            await claim(`HUMAN ${row.criterion}: recorded judgement, not machine proof`, async () => {
                if (row.required && (!row.judgement || row.judgement.stale || row.judgement.verdict !== "met"))
                    throw new Error("Required human judgement is absent, stale, or not met");
                const note = row.judgement?.note;
                if (note)
                    for (const face of ["summary.md", "mr.md"])
                        if (!(await Bun.file(join(directory, face)).text()).includes(note))
                            throw new Error(`${face} lost the person's exact note`);
                return row.judgement ? `${row.judgement.by} recorded ${row.judgement.verdict}. Identity is not authenticated.` : "Optional human criterion remains unanswered.";
            });
        else if (row.required)
            claims.push({ claim: `Required ${row.criterion}`, status: "failed", reason: `Required requirement is ${row.state}, not proved.` });
    }
    return report();
    function report(): AuditReport { return { schema_version: "wringer.native.audit.v1", at: new Date().toISOString(), delivery: directory, status: claims.some(c => c.status !== "checked") ? "failed" : "passed", claims, checked: claims.filter(c => c.status === "checked").length, failed: claims.filter(c => c.status === "failed").length, uncheckable: claims.filter(c => c.status === "uncheckable").length, limits: ["This audit checks recorded facts and carried bytes, not whether requirements express the full intent.", "An owner who can rewrite all evidence and its digests can forge an unsigned story.", "Human identities and clock readings are not authenticated."] }; }
}
async function gates(root: string): Promise<any[]> {
    const names = await files(root);
    const results: any[] = [];
    for (const name of names.filter(p => /^gates\/[^/]+\/result\.json$/.test(p))) {
        const row = await json(await inside(root, name));
        if (typeof row.gate_id !== "string" || typeof row.command !== "string" || !Number.isInteger(row.exit_code) || typeof row.timed_out !== "boolean" || typeof row.optional !== "boolean" || !["passed", "failed"].includes(row.status))
            throw new Error(`Malformed gate result ${name}`);
        results.push(row);
    }
    if (new Set(results.map(g => g.gate_id)).size !== results.length)
        throw new Error("Duplicate gate results");
    return results;
}
export function renderAudit(report: AuditReport): string {
    return [`Audit ${report.status.toUpperCase()}`, ...report.claims.map(c => `${c.status === "checked" ? "✓" : "✗"} ${c.claim}\n  ${c.reason}`), `${report.checked} checked · ${report.failed} failed · ${report.uncheckable} uncheckable`, ...report.limits].join("\n");
}
export async function attest(repo: string, delivery: string): Promise<{
    path: string;
    report: AuditReport;
}> {
    const outcome = await audit(repo, delivery);
    const directory = await inside(resolve(repo), `.wringer/attestations/${stamp()}`);
    await put(join(directory, "audit.json"), outcome);
    await put(join(directory, "summary.md"), renderAudit(outcome) + "\n");
    await seal(directory);
    return { path: directory, report: outcome };
}
