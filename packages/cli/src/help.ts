import { dirname, join } from "node:path";
import { VERSION } from "@wringer/engine";
/** Installed help must not send a new customer to the builder's working directory. */
export async function documentationHint(file = "README.md"): Promise<string> {
    if (!["README.md", "HEADLESS.md"].includes(file))
        throw new Error("Unknown documentation page");
    for (const path of [join(dirname(process.execPath), "docs", file), new URL(`../../../docs/native/${file}`, import.meta.url).pathname])
        if (await Bun.file(path).exists())
            return path;
    return file === "HEADLESS.md" ? "wringer-drive --help" : "wring start --help";
}
export const HELP = `Wringer · Bun/TypeScript · ${VERSION}

Delegate a bounded engineering outcome; inspect the change and its evidence.

  wring init                         Detect local checks; no coding agent required
  wring start                        Show readiness and the product's next steps
  wring plan PLAN.yaml               Compile a declarative plan without executing it
  wring design --help                Import an approved design and bind visual review
  wring experiment --help            Review or separately test future improvements
  wring run PLAN.yaml --authority FILE [--state DIRECTORY]
  wring resume --state DIRECTORY     Resume contained ACP work within its authority
  wringer-drive board --state DIR    Open the live PM workspace for that same run
  wringer-drive doctor --plan FILE   Check the contained run's prerequisites
  wringer-drive --help               Authority, review and contained delivery commands

Standalone trusted-local verification and historical evidence:
  wring verify                       Run the repository's declared local checks
  wring verify --prove                Compare those checks against the pre-change tree
  wring explain                      Show the failing check and its actual output
  wring doctor                       Report runtime, credentials and last verify
  wring deliver                      Prepare a portable delivery; no push
  wring deliver --send                Explicitly commit and push a new branch
  wring audit --delivery ID           Audit the carried claims from a fresh clone
  wring verify --falsify --delivery ID Measure a committed range in a scratch clone
  wring attest --delivery ID          Record an independent audit report
  wring get URL DIRECTORY             Clone a repository; run none of its contents
  wring graph show|status|explain     Read legacy graph declarations or history
  wring issue / health               Import a declared issue or inspect check history

All commands accept --repo DIRECTORY and --json. Unknown options are errors.
Separate surfaces: wringer-drive (headless PM), wringer-board (evidence / pen).
Run wring start --help for setup and wringer-drive --help for unattended operation.
Legacy host coding workers, graph/fleet/bench execution and direct-HTTP model calls
are retired. No provider, key, human verdict or remote publication is invented.
`;
export const DRIVE_HELP = `wringer-drive · one durable PM journey

The DSL configures; Bun orchestrates; ACP carries work; agent runtimes execute;
Apple container or gVisor/Kubernetes contains each repository clone.

  wringer-drive plan PLAN.yaml                 Validate and show the exact plan; no spend
  wringer-drive propose TEMPLATE --intent PRD.md --actor NAME --expires ISO --state DIR --output PLAN.json
  wringer-drive authority PLAN.yaml --actor NAME --expires ISO --output authority.json
  wringer-drive run PLAN.yaml --authority authority.json [--state DIRECTORY]
  wringer-drive resume --state DIRECTORY       Reuse the recorded plan and bounded authority
  wringer-drive status --state DIRECTORY       Validate and read the authoritative journal
  wringer-drive planning-status --state DIR    Read a planning grant, reply and remaining budget
  wringer-drive planning-questions --state DIR Read the planner's questions and note; no spend
  wringer-drive planning-new-grant --state DIR  Preview a separate planning grant; no spend
  wringer-drive new-grant --state DIRECTORY    Preview separate execution approval; no spend
  wringer-drive board --state DIRECTORY        Live, private localhost PM workspace
      [--port 0] [--output NEW_FILE.html]       An output file is a read-only snapshot
  wringer-drive doctor --plan PLAN.yaml        Reuse existing keys; report prerequisites
  wringer-drive doctor --state DIRECTORY --probe-agents
                                              Open ACP sessions without a model prompt
  wringer-drive show --state DIRECTORY --criterion ID
  wringer-drive review --state DIRECTORY --criterion ID --display UUID --verdict met --by NAME --note TEXT
  wringer-drive request-revision --state DIRECTORY --by NAME --note TEXT
  wringer-drive recover-command --state DIRECTORY --command UUID --acknowledge-uncertain
  wringer-drive deliver --state DIRECTORY --remote URL_OR_BARE_PATH --source-branch REVIEW --target-branch BASE
  wringer-drive deliver [the same options] --send
  wringer-drive source-review --state DIR      Inventory all source credential-shaped matches; no values printed
      --inventory SHA256 --finding SHA256 --policy-dir EXTERNAL_OPERATOR_DIRECTORY
      --actor NAME --actor-kind operator|delegated-agent --reason TEXT
                                              Record one exact non-secret example decision; no wildcard exemptions
      --policy-dir EXTERNAL_OPERATOR_DIRECTORY --decisions PRIVATE_JSON
                                              Finite exact-ID decisions, each with its own actor/reason; no approve-all
      PRIVATE_JSON is a mode-600 file within that separate operator directory:
      {"schema_version":"wringer.source-review-decisions.v1","candidateCommit":"EXACT_COMMIT",
       "inventorySha256":"EXACT_INVENTORY_DIGEST","decisions":[{"findingId":"EXACT_FINDING_ID",
       "inventorySha256":"EXACT_INVENTORY_DIGEST","actor":"OPERATOR_OR_AGENT_NAME",
       "actorKind":"delegated-agent","reason":"YOUR_EVIDENCE_FOR_THIS_EXACT_NON_SECRET_EXAMPLE"}]}
  wringer-drive audit --bundle PATH            Audit a carried contained delivery offline
  wringer-drive falsify --bundle PATH          Challenge the committed range in isolation
      [--output DIRECTORY] [--max-attempts 24] [--wall-seconds 60]

PLAN may also be a constrained literal TypeScript definePlan declaration. No
repository TypeScript is evaluated on the host. Runtime images and source commits
must be pinned. Existing credentials cross only through declared environment names.

Routine authority excludes publication and human judgement. Resume does not reset
budgets. --retry-stopped explicitly retries a known stopped role within remaining
limits; --retry-uncertain acknowledges possible duplicate spend after interruption.
--retry-verification retries a known unavailable check; --retry-judge retries an
unsettled judge. Each reserves a new attempt within the original ceilings.
An exhausted grant cannot be retried. new-grant and planning-new-grant first show
the exact confirmation options without allocating work. A confirmed new grant
uses a fresh state; old reservations, failures and unknown spend remain intact.
--retry-uncertain is only applicable to a genuinely interrupted current attempt.
Propose delegates bounded planning to the declared ACP planner; its output is
unapproved and cannot grant itself execution authority. A planning call may spend.
The board uses the same guarded actions as the CLI, never an alternate authority.
Its private URL grants local control: do not share it. Keep its server running.
Recovery releases an application lock only after its owner is provably dead;
orphan runtimes and domain reservations remain uncertain. Nothing is replayed.
No sandbox bypass. Old direct-HTTP drafting and host coding launchers are retired.
No automatic model, endpoint, key, human verdict, merge or deployment is selected.
Delivery prepares by default. --send explicitly authorizes branch publication;
--forge-config FILE declares a hosted review request separately from a Git push.
Run audit and falsify from the fresh review-branch clone root, using mr.md's exact
bundle path. Audit is offline. Falsify executes supported committed-line mutations
in the declared isolated verifier, with no coding/judging agent calls. It records
the exact range/commit and caught/survived/unavailable results; missing runtime or
failed control is inconclusive, not a pass or a complete software-quality score.
`;
export const BOARD_HELP = `wringer-board · one set of facts, every surface

  wringer-board serve --state DIRECTORY [--port 0]  Live contained PM workspace
  wringer-board render --state DIRECTORY --output NEW_FILE.html
                                                   Read-only contained snapshot

Standalone/historical record format (not a contained-run recovery path):
  wringer-board render [--run RUN] [--output PATH]    Write a self-contained HTML board
  wringer-board serve [--port 8765]                  Read-only, localhost-only board
  wringer-board show --criterion ID                 Run the declared display; record its receipt
  wringer-board judge --criterion ID                Show first and print the exact recording command
  wringer-board judge --criterion ID --display UUID --verdict met --by NAME --note 'MY OBSERVATION'

Commands without --state inspect standalone/legacy verification records. For the
contained journey use the live workspace or wringer-drive --help. Legacy
interview answer/decide/approve records do not grant contained execution authority.

The pen refuses after a failed/missing display. A person who independently saw the
result may explicitly add --without-display; that failure travels with the note.
No headless authority writes a person's judgement.
`;
export const commandHelp: Record<string, string> = {
    spec: `Direct-HTTP drafting is retired. Include original intent and an optional ACP planning role in PLAN.yaml.\nNext: wringer-drive plan PLAN.yaml\nSee wringer-drive --help and the installed guide for the declaration format.`,
    deliver: `wring deliver [--run RUN] [--branch NEW_BRANCH] [--base BASE] [--remote REMOTE] [--send]\nDry-run is the default. --send is the explicit second decision to create and push a new non-default branch. The current checkout and staging area are preserved. Every partial failure remains recorded.`,
    verify: `wring verify [--gate ID (repeatable)] [--serial] [--output DIR] [--prove]\nwring verify --falsify --delivery ID [--max-attempts 24 --wall-seconds 60]\nChecks are trusted local repository commands unless containment is explicitly declared. Falsification runs only the committed range in a separate scratch clone.`,
    start: `wring start\nInitialization requires no coding agent and selects no vendor. Prints installed guides for a pinned contained execution plan. Retired --worker/--endpoint settings are rejected, not rewritten. Nothing signs in or stores a key.`,
    audit: `wring audit --delivery ID_OR_REPOSITORY_RELATIVE_PATH\nRun at the root of a fresh clone after fetching and checking out the delivered branch, exactly as mr.md says. No calls to a model or original workstation are needed.`,
    plan: `wring plan PLAN.yaml\nValidates YAML or a literal TypeScript definePlan declaration. No repository code runs on the host.\nNext: wringer-drive --help`,
    run: `wring run PLAN.yaml --authority FILE [--state DIRECTORY]\nAlias for wringer-drive run. Worker and judge run over ACP in separate contained repository clones. No host execution fallback.\nNext: wringer-drive --help`,
    resume: `wring resume --state DIRECTORY [--retry-stopped | --retry-uncertain]\nAlias for wringer-drive resume. Revalidates the journal and existing bounded authority; does not reset budgets. Legacy host-loop/fleet/graph execution is retired.\nNext: wringer-drive --help`,
    graph: `wring graph show FILE\nwring graph status RECORD\nwring graph explain RECORD\nRead-only legacy graph inspection. Execution is retired; configure ACP roles in a contained plan.\nNext: wringer-drive plan --help`,
    fleet: `Legacy host fleet execution is retired; retained records remain available to inspection.\nNext: wringer-drive plan --help`,
    health: `wring health [--from DIRECTORY (repeatable)] [--strict] [--json] [--output NEW_FILE]\nReads recorded history only: no worker, environment reads, network or new evidence bundle. Every unreadable or duplicated bundle is named. Strict exits 1 only for a currently required zombie.`,
    bench: `Legacy host worker benchmarks are retired. Use a separately authorized contained execution plan for each measurement.\nNext: wringer-drive plan --help`,
    issue: `wring issue NUMBER [--output PATH]\nReads from the forge explicitly declared in .wringer.yaml. No issue text or cloned repository command is executed. Existing documents not owned by the importer are never overwritten.`,
    judge: `Direct-HTTP judging is retired. Declare an independent ACP judge in the contained execution plan. It cannot record a human verdict.\nNext: wringer-drive --help`,
};
