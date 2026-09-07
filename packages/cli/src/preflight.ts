import { join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadExecutionPlan, hashValue, type ExecutionPlan } from "@wringer/plan";
import { prepareRepositorySource, preflightAgentRole } from "@wringer/runtime";
import { readController, immutableControllerFile, privateControllerDirectory, loadExistingCredentials } from "@wringer/application";
import { Redactor } from "@wringer/engine";
import type { Answer } from "./app";

export async function containedDoctor(options: { state?: string; planPath?: string; probeAgents?: boolean; signal?: AbortSignal }): Promise<Answer> {
    if (!options.state && !options.planPath) throw new Error("Choose --state DIRECTORY for a run, or --plan PLAN.yaml before starting. Existing keys are reused; none are stored or replaced.");
    const history = options.state ? await readController(options.state, false, true) : null;
    const plan: ExecutionPlan = options.planPath ? await loadExecutionPlan(options.planPath) : history!.plan;
    if (history && history.plan.plan_sha256 !== plan.plan_sha256) throw new Error("The plan does not match this recorded run");
    const rows: { name: string; status: "ready" | "unmeasured" | "blocked"; detail: string }[] = [];
    const binary = plan.runtime.binary ?? (plan.runtime.kind === "apple-container" ? "container" : "kubectl");
    const path = Bun.which(binary);
    rows.push({ name: "Containment", status: path ? "unmeasured" : "blocked", detail: path ? `${plan.runtime.kind} client found at ${path}; client presence is not proof of effective isolation.` : `${binary} is not available. ${plan.runtime.kind === "apple-container" ? "Install Apple's signed container package from https://github.com/apple/container/releases, then run container system start." : "Provision the declared gVisor RuntimeClass, namespace and network policy on your Kubernetes cluster."} No host fallback is offered.` });
    const credentialNames = Object.values(plan.agents).flatMap(a => a?.env ?? []), credentials = await loadExistingCredentials(credentialNames);
    for (const row of credentials) rows.push({ name: row.name, status: row.available ? "unmeasured" : "blocked", detail: row.available ? `Available from ${row.source}; value not displayed. Provider validity is not yet measured.` : `Not available. No key was changed. ${row.name === "ANTHROPIC_API_KEY" ? "Expected Keychain service anthropic-api-key, account wringer." : row.name === "CODEX_API_KEY" || row.name === "OPENAI_API_KEY" ? "Expected Keychain service openai-api-key, account wringer." : "Provide this declared environment variable to the launching controller."}` });
    rows.push({ name: "Credential boundary", status: "ready", detail: "Only each role's declared variables cross. Host login directories are not copied. A present key and an opened ACP session do not establish which provider credential is effective." });
    const verification = history?.result.verification ?? history?.state.baseline;
    rows.push({ name: "Last verify", status: verification ? verification.status === "unavailable" ? "blocked" : "ready" : "unmeasured", detail: verification ? `${history!.result.journeyId}: ${verification.status}; candidate ${verification.candidateCommit}; runtime ${verification.runtimeId}; recorded evidence ${verification.evidenceRef}.` : "No contained verification has been recorded for this plan yet." });
    const probes: unknown[] = [];
    if (options.probeAgents && !rows.some(r => r.status === "blocked" && r.name !== "Last verify")) {
        const state = options.state ?? await mkdtemp(join(tmpdir(), "wringer-preflight-"));
        await privateControllerDirectory(join(state, "preflight"));
        const source = await prepareRepositorySource(plan.repository, { controllerDir: state });
        for (const role of ["planner", "worker", "judge"] as const) {
            const agent = plan.agents[role]; if (!agent) continue;
            try {
                const probe = await preflightAgentRole({ role, repo: source, runtime: plan.runtime, agent, budget: { maxTurns: 1, timeoutMs: Math.min(120000, plan.budget.session_timeout_seconds * 1000) }, scope: role === "worker" ? { writable: plan.scope.writable, protected: [...new Set([...plan.acceptance.protected_paths, ...plan.acceptance.checks.flatMap(c => c.files)])], writableDirectories: plan.environment.writable_directories } : undefined, signal: options.signal });
                probes.push(probe);
                rows.push({ name: `${role} authentication`, status: probe.status === "completed" && probe.authentication.sessionOpened ? "ready" : "blocked", detail: probe.authLine });
                await immutableControllerFile(join(state, "preflight", `${role}-${crypto.randomUUID()}.json`), new Redactor(plan.runtime.env).deep({ schema_version: "wringer.agent-preflight.v1", planSha256: plan.plan_sha256, at: new Date().toISOString(), probe, sha256: hashValue(probe) }));
            } catch (error) { rows.push({ name: `${role} authentication`, status: "blocked", detail: new Redactor(plan.runtime.env).scrub(String(error)) }); }
        }
    } else if (!options.probeAgents) rows.push({ name: "ACP authentication", status: "unmeasured", detail: `For a contained session-only probe with no model prompt: wringer-drive doctor ${options.state ? `--state '${options.state.replaceAll("'", "'\\''")}'` : `--plan '${options.planPath!.replaceAll("'", "'\\''")}'`} --probe-agents` });
    const blocked = rows.some(r => r.status === "blocked"), value = { schema_version: "wringer.contained-doctor.v1", planSha256: plan.plan_sha256, journeyId: history?.result.journeyId ?? null, status: blocked ? "blocked" : options.probeAgents ? "protocol-ready" : "unmeasured", checks: rows, probes, limits: ["No model prompt was sent by this command. Protocol readiness is not a live provider-convergence or sandbox-escape test.", "Keychain reads are process-local; keys and login state are never stored, replaced or published."] };
    return { value, text: `${value.status}\n${rows.map(r => `${r.status}: ${r.name} — ${r.detail}`).join("\n")}\n${value.limits.join("\n")}`, exit: blocked ? 3 : 0 };
}
