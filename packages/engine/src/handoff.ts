/**
 * The current handoff, generated from a verification set rather than written by hand.
 *
 * The 19 September 2026 ZenJev delivery carried stronger evidence than the
 * narrative around it: decision documents still said access was pending and
 * publication had not happened, after both had. That drift was documentation,
 * not a Wringer defect — and a handoff assembled from the records cannot drift,
 * because each line is read from a bundle or says plainly that nothing measured
 * it. Nothing here manufactures an owner's verdict: where no judgement was
 * recorded, the section says so and stops.
 */
import { relative, resolve } from "node:path";
import { git } from "./git";
import { Bundle, posix, safePath } from "./io";
import { combineSet, type LoadedBundle, type VerificationSet } from "./selection";
import { EngineError } from "./types";
export interface SetOptions {
    output?: string;
    repository?: string;
    preview?: string;
    liveChecks?: string[];
    supersedes?: string[];
}
export const HANDOFF_LIMITS = [
    "Every line above is read from the combined bundles or says that nothing measured it. A blank is never filled in from context.",
    "A passing check establishes its own assertions. It does not establish that the requirement's wording covers what was meant.",
    "No machine result in this set becomes an owner's judgement. Where no person recorded one, this document says so.",
    "Clock readings and human identities in the underlying records are not authenticated.",
];
/** The commit that carries the bundles, measured — normally none, because `.wringer/` is ignored. */
async function evidenceCommit(repo: string, bundles: LoadedBundle[]): Promise<string> {
    const commits = new Set<string>();
    for (const one of bundles) {
        const inside = relative(resolve(repo), one.directory);
        if (inside.startsWith("..") || inside === "")
            return `not committed: ${one.named} is outside this repository, so no commit here can carry it.`;
        const found = await git(resolve(repo), ["log", "-1", "--format=%H", "--", posix(inside)], true);
        if (found.exit_code !== 0 || !found.stdout.trim())
            return "not committed: the combined bundles are not tracked in this repository, so no commit carries them. Publishing the evidence is a separate act from testing the source.";
        commits.add(found.stdout.trim());
    }
    return commits.size === 1 ? [...commits][0]! : `not one commit: the bundles are carried by ${commits.size} different commits (${[...commits].join(", ")}).`;
}
function judgementSection(bundles: LoadedBundle[]): string[] {
    const accepted = bundles.filter(one => one.acceptance && /^wringer\.acceptance\.v[123]$/.test(one.acceptance.schema_version));
    if (!accepted.length) {
        const spec = bundles.find(one => one.spec)?.spec;
        const why = spec ? (spec.approved === true ? "no acceptance record travelled with these bundles" : "the carried specification is not approved, so no requirement was assessed") : "no specification travelled with these bundles";
        return [
            `Agent review: the checks in this set were executed and recorded; ${why}.`,
            "Owner judgment: **none recorded.** No person's verdict exists in this evidence, and nothing here supplies one. A human criterion is settled only by `wringer-board judge`.",
        ];
    }
    const rows = accepted[0]!.acceptance.criteria as any[];
    const human = rows.filter(r => r.state === "human");
    const recorded = human.filter(r => r.judgement && !r.judgement.stale);
    return [
        `Agent review: ${rows.length - human.length} machine-assessed requirement row(s) are recorded in \`acceptance.json\`; ${rows.filter(r => r.state === "evidenced").length} are evidenced by a recorded earlier failure of the same check.`,
        human.length === 0
            ? "Owner judgment: the specification declares no human criterion, so none was expected and none was recorded."
            : `Owner judgment: ${recorded.length} of ${human.length} human criteria carry a current recorded judgement${recorded.length ? ` (${recorded.map(r => `${r.criterion}: ${r.judgement.verdict} by ${r.judgement.by}`).join("; ")})` : ""}. The rest are **not** judged, and no machine result substitutes for one.`,
    ];
}
export function renderHandoff(input: {
    title: string;
    set: VerificationSet;
    bundles: LoadedBundle[];
    evidence_commit: string;
    repository: string;
    preview: string;
    liveChecks: string[];
    supersedes: string[];
    today: string;
    receipt: string;
}): string {
    const { set } = input;
    const owner = new Map(set.executions.map(e => [e.gate_id, e]));
    const lines = [
        `# Handoff — ${input.title}`,
        "",
        `Generated from verification set \`${set.set_id}\` at ${set.at}. Every line is read from the combined evidence bundles.`,
        "",
        "## The revision",
        "",
        `- **Tested application commit:** \`${set.head_sha ?? "unborn tree"}\` — what these checks ran against.`,
        `- **Evidence commit:** ${input.evidence_commit.startsWith("not ") ? input.evidence_commit : `\`${input.evidence_commit}\``}`,
        "",
        "## Completeness",
        "",
        set.reason,
        "",
        "| Check | Outcome | Required | Recorded in |",
        "|---|---|---|---|",
        ...set.declared.map(id => {
            const row = owner.get(id);
            const required = set.required.includes(id);
            return `| ${id} | ${row ? row.status : "**not run**"} | ${required ? "yes" : "no"} | ${row ? `\`${row.bundle}\`` : "—"} |`;
        }),
        "",
        "## Live integration checks and their limits",
        "",
        ...(input.liveChecks.length
            ? [`Declared as live integration checks: ${input.liveChecks.map(id => `\`${id}\``).join(", ")}. A live check exercises a real external service once, within its own bounds; it does not establish that the whole application was exercised against live services.`]
            : ["No gate in this set is declared a live integration check. Every recorded result is a check run against the tested commit on the machine that ran it."]),
        ...[...new Set(input.bundles.map(one => one.execution?.execution_mode).filter(Boolean))].map(mode => `Execution mode recorded by the bundles: \`${mode}\`.`),
        "",
        "## Agent review and owner judgment",
        "",
        ...judgementSection(input.bundles).map(line => `- ${line}`),
        "",
        "## Where everything is",
        "",
        `- **Repository:** ${input.repository}`,
        `- **Runnable preview:** ${input.preview}`,
        `- **Evidence bundles:** ${set.bundles.map(b => `\`${b.path}\``).join(", ")}`,
        `- **This receipt:** \`${input.receipt}\``,
        "",
        ...(input.supersedes.length
            ? ["## Superseded decisions", "", ...input.supersedes.map(file => `- ${input.today}: \`${file}\` is superseded by verification set \`${set.set_id}\` for current status. Its decision history stands; its statements about what had not yet happened no longer describe the present.`), ""]
            : []),
        "## Limits",
        "",
        ...HANDOFF_LIMITS.map(l => `- ${l}`),
        "",
    ];
    return lines.join("\n");
}
export async function verificationSetReceipt(repo: string, named: string[], options: SetOptions = {}): Promise<{
    set: VerificationSet;
    directory: string;
    handoff: string;
    text: string;
    exit_code: number;
}> {
    repo = resolve(repo);
    const { set, bundles } = await combineSet(named);
    for (const id of options.liveChecks ?? [])
        if (!set.declared.includes(id))
            throw new EngineError(`--live-check ${id} names no gate the carried .wringer.yaml declares. Name one of: ${set.declared.join(", ")}.`, 2, "wring audit --set --help");
    const directory = await safePath(repo, options.output ?? `.wringer/sets/${set.set_id}`);
    const bundle = await new Bundle(directory).prepare();
    const remote = options.repository ?? await declaredRemote(repo);
    const handoff = renderHandoff({
        title: bundles.find(one => one.spec?.title)?.spec.title ?? bundles[0]!.manifest.repo?.root ?? "this repository",
        set, bundles, evidence_commit: await evidenceCommit(repo, bundles), repository: remote,
        preview: options.preview ?? "none declared. Nothing in this evidence measured a running preview.",
        liveChecks: options.liveChecks ?? [], supersedes: options.supersedes ?? [],
        today: set.at.slice(0, 10), receipt: posix(relative(repo, directory)),
    });
    await bundle.json("set.json", set);
    await bundle.write("HANDOFF.md", handoff);
    await bundle.seal();
    const text = [
        `Verification set ${set.set_id}: ${set.complete ? "COMPLETE" : "INCOMPLETE"}`,
        set.reason,
        ...set.bundles.map(b => `· ${b.path}: ${b.executed.length} check(s), ${b.status}, selection record ${b.selection_record}`),
        `Receipt: ${posix(relative(repo, directory))}/set.json`,
        `Handoff: ${posix(relative(repo, directory))}/HANDOFF.md`,
        ...set.limits,
    ].join("\n");
    return { set, directory, handoff, text, exit_code: set.complete ? 0 : 1 };
}
async function declaredRemote(repo: string): Promise<string> {
    const found = await git(repo, ["remote", "get-url", "origin"], true);
    return found.exit_code === 0 && found.stdout.trim() ? found.stdout.trim() : "no origin remote is declared in the repository this set was combined in.";
}
