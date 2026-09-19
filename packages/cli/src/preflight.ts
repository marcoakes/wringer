import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadExecutionPlan, hashValue, type ExecutionPlan } from "@wringer/plan";
import { prepareRepositorySource, preflightAgentRole } from "@wringer/runtime";
import { readController, immutableControllerFile, privateControllerDirectory, loadExistingCredentials, isLocalSource, localSourceSiblings, verifyLocalSource } from "@wringer/application";
import { CREDENTIAL_WORDS, READINESS_LIMITS, RUNG_WORDS, Redactor, probeRequirement, type CredentialState, type ReadinessRow, type Rung } from "@wringer/engine";
import type { Answer } from "./app";

/** Construction-time seams for unit tests only; never CLI flags or plan inputs. */
export interface ContainedDoctorDependencies {
    which?: (name: string) => string | null;
    preflight?: typeof preflightAgentRole;
    probeService?: typeof probeRequirement;
}

/** A local-only source is never fetched by name, so a pre-job probe has to read
 * the pair `prepare --local` wrote beside this exact profile. It is verified
 * exactly as `init` verifies it, and the verified bytes — not a second read —
 * are what the probe prepares from. A started run already holds the copy its own
 * controller prepared; nothing else is accepted as a local source. */
async function probeSourceBundle(plan: ExecutionPlan, planPath: string | undefined, recorded: string | undefined, state: string): Promise<{ bundlePath?: string }> {
    if (!isLocalSource(plan)) return {};
    if (!planPath) return recorded && resolve(recorded).startsWith(resolve(state) + "/") ? { bundlePath: recorded } : {};
    const verified = await verifyLocalSource(plan, localSourceSiblings(planPath));
    const bundlePath = join(state, "preflight", `source-${randomUUID()}.bundle`);
    await writeFile(bundlePath, verified.bundle, { flag: "wx", mode: 0o600 });
    return { bundlePath };
}

export async function containedDoctor(options: { state?: string; planPath?: string; probeAgents?: boolean; signal?: AbortSignal }, dependencies: ContainedDoctorDependencies = {}): Promise<Answer> {
    if (!options.state && !options.planPath) throw new Error("Choose --state DIRECTORY for a run, or --plan PLAN.yaml before starting. Existing keys are reused; none are stored or replaced.");
    const history = options.state ? await readController(options.state, false, true) : null;
    const plan: ExecutionPlan = options.planPath ? await loadExecutionPlan(options.planPath) : history!.plan;
    if (history && history.plan.plan_sha256 !== plan.plan_sha256) throw new Error("The plan does not match this recorded run");
    const rows: ReadinessRow[] = [];
    const line = (name: string, rung: Rung, measurement: string, next: string | null, blocking: boolean): ReadinessRow => ({ name, requirement: null, rung, measurement, next, blocking });
    const binary = plan.runtime.binary ?? (plan.runtime.kind === "apple-container" ? "container" : "kubectl");
    const path = (dependencies.which ?? (name => Bun.which(name)))(binary);
    if (!path)
        rows.push(line("Containment", "unavailable", `${binary} is not available. No host fallback is offered.`, plan.runtime.kind === "apple-container" ? "install Apple's signed container package from https://github.com/apple/container/releases, then run container system start" : "provision the declared gVisor RuntimeClass, namespace and network policy on your Kubernetes cluster", true));
    else if (plan.runtime.kind === "apple-container") {
        // F-B4: a stopped service is measured here and reported as a row. Attempting a
        // container command against it produces an uncertain effect somebody must reconcile,
        // and this command starts nothing.
        const measured = await (dependencies.probeService ?? probeRequirement)(resolve(options.state ?? process.cwd()), { kind: "container_service", timeout: 15, binary }, { signal: options.signal });
        rows.push(line("Containment", measured.rung, `${measured.measurement} Client presence is not proof of effective isolation.`, measured.next, measured.rung !== "measured"));
    }
    else
        rows.push(line("Containment", "installed", `${plan.runtime.kind} client found at ${path}; client presence is not proof of effective isolation, and no cluster policy was measured from here.`, "confirm the declared RuntimeClass, namespace and network policy on the cluster itself", false));
    const credentialNames = Object.values(plan.agents).flatMap(a => a?.env ?? []), credentials = await loadExistingCredentials(credentialNames);
    for (const row of credentials) {
        // A read that succeeded is `retrievable` and nothing more: no provider accepted it.
        const state: CredentialState = row.available ? "retrievable" : "absent";
        rows.push(line(row.name, row.available ? "executable" : "unavailable", row.available ? `Available from ${row.source}; value not displayed. Credential: ${state} — ${CREDENTIAL_WORDS[state]}.` : `Not available. No key was changed. Credential: ${state} — ${CREDENTIAL_WORDS[state]}. ${row.name === "ANTHROPIC_API_KEY" ? "Expected Keychain service anthropic-api-key, account wringer." : row.name === "CODEX_API_KEY" || row.name === "OPENAI_API_KEY" ? "Expected Keychain service openai-api-key, account wringer." : "Provide this declared environment variable to the launching controller."}`, row.available ? null : `make ${row.name} available to the launching controller`, !row.available));
    }
    rows.push(line("Credential boundary", "measured", "Only each role's declared variables cross. Host login directories are not copied. A present key and an opened ACP session do not establish which provider credential is effective.", null, false));
    const verification = history?.result.verification ?? history?.state.baseline;
    rows.push(line("Last verify", verification ? verification.status === "unavailable" ? "unavailable" : "measured" : "not_measured", verification ? `${history!.result.journeyId}: ${verification.status}; candidate ${verification.candidateCommit}; runtime ${verification.runtimeId}; recorded evidence ${verification.evidenceRef}.` : "No contained verification has been recorded for this plan yet.", null, false));
    const probes: unknown[] = [];
    if (options.probeAgents && !rows.some(r => r.blocking && r.name !== "Last verify")) {
        const state = options.state ?? await mkdtemp(join(tmpdir(), "wringer-preflight-"));
        await privateControllerDirectory(join(state, "preflight"));
        const bundle = await probeSourceBundle(plan, options.planPath, history?.state.source?.bundlePath, state);
        const source = await prepareRepositorySource({ ...plan.repository, ...bundle }, { controllerDir: state });
        for (const role of ["planner", "worker", "judge"] as const) {
            const agent = plan.agents[role]; if (!agent) continue;
            try {
                const probe = await (dependencies.preflight ?? preflightAgentRole)({ role, repo: source, runtime: plan.runtime, agent, budget: { maxTurns: 1, timeoutMs: Math.min(120000, plan.budget.session_timeout_seconds * 1000) }, scope: role === "worker" ? { writable: plan.scope.writable, protected: [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])], writableDirectories: plan.environment.writable_directories } : undefined, signal: options.signal });
                probes.push(probe);
                // `accepted` is reachable here and nowhere else in this command: a session opened.
                const opened = probe.status === "completed" && probe.authentication.sessionOpened;
                rows.push(line(`${role} authentication`, opened ? "measured" : "unavailable", `${probe.authLine} Credential: ${opened ? "accepted" : "retrievable"} — ${CREDENTIAL_WORDS[opened ? "accepted" : "retrievable"]}.`, opened ? null : `read that session error; no model prompt was sent and nothing was retried`, !opened));
                await immutableControllerFile(join(state, "preflight", `${role}-${crypto.randomUUID()}.json`), new Redactor(plan.runtime.env).deep({ schema_version: "wringer.agent-preflight.v1", planSha256: plan.plan_sha256, at: new Date().toISOString(), probe, sha256: hashValue(probe) }));
            } catch (error) { rows.push(line(`${role} authentication`, "unavailable", new Redactor(plan.runtime.env).scrub(String(error)), "read that session error; nothing was retried", true)); }
        }
    } else if (!options.probeAgents) rows.push(line("ACP authentication", "not_measured", "No session was opened, so no credential is better than retrievable here.", `wringer-drive doctor ${options.state ? `--state '${options.state.replaceAll("'", "'\\''")}'` : `--plan '${options.planPath!.replaceAll("'", "'\\''")}'`} --probe-agents (a contained session-only probe with no model prompt)`, false));
    const blocked = rows.some(r => r.blocking), value = { schema_version: "wringer.contained-doctor.v2", planSha256: plan.plan_sha256, journeyId: history?.result.journeyId ?? null, status: blocked ? "blocked" : options.probeAgents ? "protocol-ready" : "unmeasured", checks: rows, probes, limits: [...READINESS_LIMITS, "No model prompt was sent by this command. Protocol readiness is not a live provider-convergence or sandbox-escape test.", "Keychain reads are process-local; keys and login state are never stored, replaced or published."] };
    return { value, text: `${value.status}\n${rows.map(r => `${RUNG_WORDS[r.rung]}: ${r.name} — ${r.measurement}${r.next ? `\n    Next: ${r.next}` : ""}`).join("\n")}\n${value.limits.join("\n")}`, exit: blocked ? 3 : 0 };
}
