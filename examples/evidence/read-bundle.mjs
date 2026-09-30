#!/usr/bin/env node
// Independent reader: Node built-ins only. Integrity is not semantic acceptance.
// Reads a delivery evidence envelope (bundle.json) or a contained graph export (graph.json).
import { createHash } from "node:crypto";
import { readFile, readdir, lstat, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const insist = (ok, message) => { if (!ok) throw new Error(message); };
const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
async function file(root, name) {
    insist(typeof name === "string" && name.length <= 1024 && !name.includes("\\") && !name.includes("\0") && name.split("/").every(part => part && part !== "." && part !== ".." && part !== ".git"), "Unsafe evidence path");
    let path = root;
    for (const part of name.split("/")) {
        path = join(path, part);
        insist(!(await lstat(path)).isSymbolicLink(), "Symlink in evidence");
    }
    const info = await lstat(path);
    insist(info.isFile() && info.size <= 512 * 1024 * 1024, "Evidence file is not a bounded regular file");
    return readFile(path);
}
async function inventory(root, prefix = "", depth = 0) {
    insist(depth < 32, "Evidence nesting is excessive");
    const rows = [];
    for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        insist(!entry.isSymbolicLink(), "Symlink in evidence");
        if (entry.isDirectory()) rows.push(...await inventory(root, name, depth + 1));
        else { insist(entry.isFile(), "Unsupported evidence entry"); rows.push(name); }
        insist(rows.length <= 32768, "Evidence inventory is excessive");
    }
    return rows.sort();
}
export async function inspectBundle(input) {
    insist(!(await lstat(input)).isSymbolicLink(), "Symlink bundle root");
    const root = await realpath(input);
    insist(JSON.stringify((await readdir(root)).sort()) === JSON.stringify(["bundle.json", "evidence", "read-bundle.mjs", "schema.json", "summary.md"]), "Envelope inventory changed");
    const index = JSON.parse(await file(root, "bundle.json"));
    insist(index.schema_version === "wringer.bundle-index.v1" && index.payload === "evidence" && /^wringer\.contained-delivery\.v[1-4]$/.test(index.bundleFamily), "Unsupported bundle index");
    insist(index.files && typeof index.files === "object" && !Array.isArray(index.files), "Invalid envelope inventory");
    const expected = ["read-bundle.mjs", "schema.json", "summary.md"].sort();
    insist(JSON.stringify(Object.keys(index.files).sort()) === JSON.stringify(expected), "Envelope inventory changed");
    for (const name of expected) insist(hash(index.files[name]) && digest(await file(root, name)) === index.files[name], `Envelope changed: ${name}`);
    const evidence = resolve(root, index.payload);
    insist(evidence.startsWith(root + sep) && !(await lstat(evidence)).isSymbolicLink(), "Invalid payload directory");
    const sealBytes = await file(evidence, "digests.json"), manifestBytes = await file(evidence, "manifest.json");
    insist(digest(sealBytes) === index.digestsSha256 && digest(manifestBytes) === index.manifestSha256, "Evidence manifest or seal changed");
    const seal = JSON.parse(sealBytes), manifest = JSON.parse(manifestBytes);
    insist(seal.schema_version === "wringer.digests.v1" && seal.algorithm === "sha256" && seal.files && typeof seal.files === "object" && !Array.isArray(seal.files), "Invalid evidence seal");
    const paths = await inventory(evidence);
    insist(JSON.stringify(paths.filter(name => name !== "digests.json")) === JSON.stringify(Object.keys(seal.files).sort()), "Evidence inventory changed");
    for (const name of Object.keys(seal.files)) insist(hash(seal.files[name]) && digest(await file(evidence, name)) === seal.files[name], `Evidence changed: ${name}`);
    insist(index.bundleFamily === manifest.schema_version && index.deliveryId === manifest.id && index.source?.commit === manifest.source?.codeCommit && index.source?.tree === manifest.source?.tree, "Bundle source identity changed");
    const engineering = paths.includes("engineering.json") ? JSON.parse(await file(evidence, "engineering.json")) : null;
    return { schema_version: "wringer.independent-bundle-inspection.v1", integrity: "passed", semanticAudit: "not-run", deliveryId: index.deliveryId, source: index.source, bundleFamily: index.bundleFamily, files: paths.length, decisions: engineering?.loopDecisions ?? [], summary: (await file(evidence, "summary.md")).toString("utf8"), limits: ["Hashes detect changed bytes relative to this index; they do not authenticate its author or prove behavior.", "No checks, models, runtimes, human decisions or network calls were executed. Run Wringer's semantic audit separately."] };
}
// Canonical JSON: sorted keys, JSON scalars, no holes. Byte-identical to Wringer's.
function canonical(value, depth = 0) {
    insist(depth <= 64, "Canonical nesting is excessive");
    if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
    if (typeof value === "number") { insist(Number.isFinite(value), "Non-finite number in evidence"); return JSON.stringify(value); }
    if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(",")}]`;
    insist(value && typeof value === "object", "Unsupported JSON value in evidence");
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
}
const hashJson = value => digest(canonical(value));
const withoutDigest = value => { const { sha256, ...body } = value; return body; };
/** A contained graph export: plan, grant, hash-chained events, per-node evidence
 * bound to the recorded results, and nested delivery envelopes. */
export async function inspectGraph(input) {
    insist(!(await lstat(input)).isSymbolicLink(), "Symlink export root");
    const root = await realpath(input), json = async name => JSON.parse(await file(root, name));
    const index = await json("graph.json");
    const version = { "wringer.contained-graph-export.v1": 1, "wringer.contained-graph-export.v2": 2 }[index.schema_version];
    insist(version, "Unsupported graph export index");
    insist(index.files && typeof index.files === "object" && !Array.isArray(index.files) && Array.isArray(index.nodes), "Invalid graph export inventory");
    const deliveries = index.nodes.filter(row => row.delivery).map(row => row.delivery);
    insist(deliveries.every(path => /^deliveries\/[a-z][a-z0-9-]*$/.test(path)), "Unsafe delivery envelope path");
    const paths = (await inventory(root)).filter(name => name !== "graph.json" && !deliveries.some(dir => name.startsWith(dir + "/")));
    insist(JSON.stringify(paths) === JSON.stringify(Object.keys(index.files).sort()), "Graph export inventory changed");
    for (const name of paths) insist(hash(index.files[name]) && digest(await file(root, name)) === index.files[name], `Graph evidence changed: ${name}`);
    const plan = await json("graph/plan.json"), authority = await json("graph/authority.json");
    insist(plan.schema_version === `wringer.contained-graph-plan.v${version}` && hashJson(withoutDigest(plan)) === plan.sha256 && plan.sha256 === index.graph?.sha256, "Graph plan identity changed");
    insist(authority.schema_version === "wringer.contained-graph-authority.v1" && hashJson(withoutDigest(authority)) === authority.sha256 && authority.graphSha256 === plan.sha256 && authority.maySend === false, "Graph authority is not bound to this plan");
    const names = paths.filter(name => name.startsWith("graph/events/"));
    insist(names.length >= 1 && names.length === index.eventCount, "Graph event count changed");
    const events = []; let previous = null;
    for (let sequence = 0; sequence < names.length; sequence++) {
        insist(names[sequence] === `graph/events/${String(sequence).padStart(4, "0")}.json`, "Graph events are not one contiguous sequence");
        const event = await json(names[sequence]);
        insist(event.schema_version === `wringer.contained-graph-event.v${version}` && event.sequence === sequence && event.previousSha256 === previous && event.graphSha256 === plan.sha256 && hashJson(withoutDigest(event)) === event.sha256, `Graph event ${sequence} changed, is out of order or belongs to another graph`);
        events.push(event); previous = event.sha256;
    }
    insist(previous === index.revision, "Graph revision changed");
    const recorded = (id, kind) => events.find(event => event.node === id && event.kind === kind) ?? null;
    const lineage = [];
    for (const row of index.nodes) {
        const node = plan.nodes?.[row.id];
        insist(node && node.kind === row.kind, `Exported node ${row.id} is not in its graph plan`);
        const reserve = recorded(row.id, "reserve"), result = recorded(row.id, "result"), prepared = recorded(row.id, "prepared"), decision = recorded(row.id, "decision");
        if (node.kind === "loop" && row.evidence) {
            const derivation = await json(row.evidence);
            insist(reserve && derivation.graphSha256 === plan.sha256 && derivation.node === row.id && derivation.templatePlanSha256 === node.plan.plan_sha256 && derivation.inputSha256 === hashJson(reserve.data.reservation.input), `Loop ${row.id} derivation is not bound to its reserved input`);
        }
        if (node.kind === "check" && result) insist(row.evidence && hashJson(await json(row.evidence)) === result.data.evidenceSha256, `Check ${row.id} evidence does not match its recorded result`);
        if (node.kind === "human-hold" && result) insist(decision && result.data.evidenceSha256 === decision.sha256, `Hold ${row.id} result is not its recorded decision`);
        if (node.kind === "join" && result) {
            const carried = row.evidence && await json(row.evidence);
            insist(carried && hashJson(carried) === result.data.evidenceSha256, `Join ${row.id} evidence does not match its recorded result`);
            const arrived = reserve?.data.reservation.input.branches ?? [];
            insist(JSON.stringify(carried.integration.branches.map(item => item.commit)) === JSON.stringify(arrived.map(item => item.candidate.source.commit)), `Join ${row.id} integrated candidates other than its branches`);
            insist(result.data.outcome === "conflict" ? !result.data.candidate : result.data.candidate?.source.commit === carried.integration.commit, `Join ${row.id} outcome names a candidate other than its integration`);
        }
        if (node.kind === "delivery") {
            if (prepared) insist(row.prepared && hashJson(await json(row.prepared)) === prepared.data.evidenceSha256, `Delivery ${row.id} preparation does not match its record`);
            if (result) insist(row.evidence && hashJson(await json(row.evidence)) === result.data.evidenceSha256, `Delivery ${row.id} outcome does not match its record`);
            // A join-owned delivery publishes this graph export itself; only a loop's delivery has an envelope.
            if (prepared && plan.nodes[prepared.data.candidate.owner]?.kind !== "join") {
                insist(row.delivery, `Delivery ${row.id} is missing its evidence envelope`);
                const inspected = await inspectBundle(join(root, row.delivery)), candidate = prepared.data.candidate;
                const manifest = JSON.parse(await file(join(root, row.delivery, "evidence"), "manifest.json")), owner = recorded(candidate.owner, "result");
                insist(inspected.source.commit === candidate.source.commit, `Delivery ${row.id} carries a different candidate commit`);
                // The loop recorded its controller journal head; the manifest carries it as sourceHeadSha256.
                insist(owner && owner.data.evidenceSha256 === manifest.journal?.sourceHeadSha256, `Delivery ${row.id} is not the journal state its loop recorded`);
            }
        }
        lineage.push({ id: row.id, kind: node.kind, outcome: result?.data.outcome ?? null, candidate: result?.data.candidate?.source.commit ?? prepared?.data.candidate.source.commit ?? null, evidence: row.evidence ?? null, delivery: row.delivery ?? null });
    }
    const last = [...events].reverse().find(event => event.kind === "route");
    return { schema_version: "wringer.independent-graph-inspection.v1", integrity: "passed", semanticAudit: "not-run", graph: { id: plan.id, sha256: plan.sha256 }, revision: previous, events: events.length, finished: last && ["done", "fail"].includes(last.data.to) ? last.data.to : null, nodes: lineage, omissions: Array.isArray(index.omissions) ? index.omissions : [], limits: ["Hashes and the event chain detect changed, missing, reordered or mixed records relative to this export; they do not authenticate its author or prove behaviour.", "Child controller journals are named omissions; a loop is linked to its delivery through the controller journal head the delivery manifest records.", "No checks, models, runtimes, human decisions or network calls were executed."] };
}
const entry = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entry && import.meta.url === pathToFileURL(entry).href) {
    try {
        insist(process.argv.length === 3, "Usage: node read-bundle.mjs EXPORTED_DIRECTORY");
        const graph = await lstat(join(process.argv[2], "graph.json")).then(() => true, () => false);
        console.log(JSON.stringify(await (graph ? inspectGraph : inspectBundle)(process.argv[2]), null, 2));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
