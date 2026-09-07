import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import * as engine from "@wringer/engine";
import * as workflow from "@wringer/workflow";
import * as board from "@wringer/board";
import * as delivery from "@wringer/delivery";
import { parseArgs, allowed, flag, number, positionals, quote, required, string, values, type Args } from "./args";
import { HELP, DRIVE_HELP, BOARD_HELP, commandHelp, documentationHint } from "./help";
import { containedDrive } from "./contained-cli";
import { recordJudgement, showCriterion } from "./pen";
export interface Answer {
    value?: unknown;
    text?: string;
    exit?: number;
}
export interface DispatchContext {
    signal?: AbortSignal;
}
export async function dispatch(argv: string[], surface = "wring", context: DispatchContext = {}): Promise<Answer> {
    const a = parseArgs(argv), repo = resolve(string(a, "repo", process.cwd())!);
    if (flag(a, "version"))
        return { text: `Wringer native ${engine.VERSION} (Bun ${Bun.version})` };
    if (surface === "wringer-drive")
        return containedDrive(a, repo, context);
    if (surface === "wringer-board")
        return evidence(a, repo, context);
    if (flag(a, "help") || !a.command)
        return { text: commandHelp[a.command] || HELP };
    context.signal?.throwIfAborted();
    if (["init", "start", "verify", "doctor", "deliver", "audit", "attest", "health"].includes(a.command))
        positionals(a, 0);
    switch (a.command) {
        case "init": {
            allowed(a, []);
            const value = await engine.init(repo);
            return { value, text: `Ready. No coding agent was installed or selected.\n${value.template_only ? "No real checks detected: the placeholder proves nothing.\n" : ""}Next: wring start --repo ${quote(repo)}\nGuide: ${await documentationHint()}` };
        }
        case "start": {
            allowed(a, []);
            if (!await Bun.file(join(repo, ".wringer.yaml")).exists())
                await engine.init(repo);
            const value = await engine.doctor(repo);
            return { value, text: `${value.status === "ready" ? "Ready" : "Needs attention"}.\n${value.checks.map(c => `${c.name}: ${c.detail}`).join("\n")}\n\nNext: wringer-drive authority --help\nGuide: ${await documentationHint()}\nWorker recipes: ${await documentationHint("HEADLESS.md")}`, exit: value.exit_code };
        }
        case "verify": {
            if (flag(a, "falsify")) {
                allowed(a, ["falsify", "delivery", "max-attempts", "wall-seconds"]);
                const value = await delivery.falsify(repo, required(a, "delivery"), { maxAttempts: number(a, "max-attempts", 24), wallSeconds: number(a, "wall-seconds", 60), signal: context.signal });
                return { value, text: value.table, exit: context.signal?.aborted ? 4 : 0 };
            }
            allowed(a, ["gate", "serial", "output", "prove"]);
            const value = await engine.verify(repo, { gate: values(a, "gate"), serial: flag(a, "serial"), output: string(a, "output"), prove: flag(a, "prove"), signal: context.signal });
            const model = await board.loadBoard(repo, value.evidence_dir);
            return { value, text: board.renderMarkdown(model), exit: value.exit_code };
        }
        case "run":
        case "resume": {
            return containedDrive(a, repo, context);
        }
        case "doctor": {
            allowed(a, []);
            const value = await engine.doctor(repo);
            return { value, text: value.checks.map(c => `${c.status === "ok" ? "✓" : c.status === "blocked" ? "✗" : "—"} ${c.name}: ${c.detail}`).join("\n"), exit: value.exit_code };
        }
        case "explain": {
            allowed(a, ["run"]);
            positionals(a, 0, 1);
            if (a.words.length && a.flags.has("run"))
                throw new Error("Name the run only once");
            const value = await engine.explain(repo, string(a, "run", a.words[0]));
            return { value, text: `${value.summary}\n${value.stdout}\n${value.stderr}\nNext: ${value.rerun}` };
        }
        case "spec": {
            throw new engine.EngineError("Direct-HTTP drafting is retired. Put the original intent and planning role in a contained execution plan.", 2, "wringer-drive plan --help");
        }
        case "plan": {
            return containedDrive(a, repo, context);
        }
        case "deliver": {
            allowed(a, ["send", "delivery", "run", "branch", "base", "remote", "title"]);
            if (string(a, "delivery")) {
                const value = await delivery.publishDelivery(repo, required(a, "delivery"), { send: flag(a, "send"), signal: context.signal });
                return { value, text: `Review request ${value.status}${value.url ? `: ${value.url}` : ""}\n${value.reason ?? ""}\nNext: ${value.next_move}`, exit: ["prepared", "published", "recovered"].includes(value.status) ? 0 : 3 };
            }
            const value = await delivery.deliver(repo, { send: flag(a, "send"), run: string(a, "run"), branch: string(a, "branch"), base: string(a, "base"), remote: string(a, "remote"), title: string(a, "title"), signal: context.signal });
            return { value, text: `${value.mode === "live" ? "Branch and evidence delivered" : "Prepared"}: ${value.delivery_id}\nEvidence: ${value.directory}\nReview request: ${value.publication?.url ?? value.publication?.status ?? "No forge declared; no hosted review request was created."}\nAudit: ${value.audit_command}\nNext: ${value.next_move}`, exit: value.publication && !["prepared", "published", "recovered"].includes(value.publication.status) ? 3 : 0 };
        }
        case "audit": {
            allowed(a, ["delivery"]);
            const value = await delivery.audit(repo, required(a, "delivery"));
            return { value, text: delivery.renderAudit(value), exit: value.status === "passed" ? 0 : 1 };
        }
        case "attest": {
            allowed(a, ["delivery"]);
            const value = await delivery.attest(repo, required(a, "delivery"));
            return { value, text: `${delivery.renderAudit(value.report)}\nRecord: ${value.path}`, exit: value.report.status === "passed" ? 0 : 1 };
        }
        case "get": {
            allowed(a, []);
            positionals(a, 2);
            const { getRepository } = await import("./remote");
            const value = await getRepository(a.words[0]!, resolve(repo, a.words[1]!), { signal: context.signal });
            return { value, text: `Cloned ${value.directory}. Nothing from the repository was run.\nNext: ${value.next_move}` };
        }
        case "health": {
            allowed(a, ["from", "strict", "output"]);
            const { health, renderHealth, healthExitCode } = await import("@wringer/scheduler");
            const value = await health(repo, { from: values(a, "from") }), text = renderHealth(value);
            if (string(a, "output")) {
                const path = await engine.safePath(repo, required(a, "output"));
                if (await Bun.file(path).exists())
                    throw new engine.EngineError("Health output already exists; choose a new path rather than overwriting an existing file.");
                await writeFile(path, flag(a, "json") ? JSON.stringify(value) + "\n" : text, { flag: "wx" });
            }
            return { value, text, exit: healthExitCode(value, flag(a, "strict")) };
        }
        default: {
            const { extended } = await import("./extended");
            return extended(a, repo, context);
        }
    }
}
async function evidence(a: Args, repo: string, context: DispatchContext): Promise<Answer> {
    if (flag(a, "help"))
        return { text: BOARD_HELP };
    if (a.flags.has("state") && ["", "serve", "render"].includes(a.command)) return containedDrive({ ...a, command: "board" }, repo, context);
    positionals(a, 0);
    context.signal?.throwIfAborted();
    switch (a.command || "render") {
        case "render": {
            allowed(a, ["run", "output"]);
            const value = await board.loadBoard(repo, string(a, "run")), path = await engine.safePath(repo, string(a, "output", ".wringer/board/index.html")!);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, board.renderHtml(value));
            return { value: { path, model: value }, text: `Board: ${path}` };
        }
        case "serve": {
            allowed(a, ["port", "run"]);
            const port = number(a, "port", 8765);
            if (port > 65535)
                throw new Error("Invalid localhost port");
            const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
                    const url = new URL(request.url);
                    if (request.method !== "GET" || url.pathname !== "/")
                        return new Response("Not found", { status: 404 });
                    return new Response(board.renderHtml(await board.loadBoard(repo, string(a, "run"))), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
                } });
            return { value: { url: server.url.href }, text: `Read-only board: ${server.url.href}\nPress Ctrl-C to stop.` };
        }
        case "answer": {
            allowed(a, ["id", "text", "by"]);
            const value = await workflow.answerQuestion(repo, required(a, "id"), required(a, "text"), string(a, "by", "operator"));
            return { value, text: `Answer recorded in the legacy interview. It grants no contained execution authority.\nNext: wringer-drive plan --help` };
        }
        case "decide": {
            allowed(a, ["id", "accept", "overrule", "by"]);
            if (flag(a, "accept") === a.flags.has("overrule"))
                throw new Error("Choose exactly --accept or --overrule TEXT");
            const value = await workflow.decideAssumption(repo, required(a, "id"), flag(a, "accept") ? "accept" : "overrule", string(a, "overrule", ""), string(a, "by", "operator"));
            return { value, text: `Decision recorded in the legacy interview. It grants no contained execution authority.\nNext: wringer-drive plan --help` };
        }
        case "approve": {
            allowed(a, ["digest", "by"]);
            const value = await workflow.approveSpec(repo, { actor: string(a, "by", "operator")!, expectedDigest: required(a, "digest") });
            return { value, text: `Exact plan approved: ${value.digest}\nNext: wring plan --repo ${quote(repo)}` };
        }
        case "show":
        case "judge": {
            allowed(a, ["criterion", "id", "display", "verdict", "by", "note", "without-display"]);
            const criterion = string(a, "criterion", string(a, "id"));
            if (!criterion)
                throw new Error("--criterion ID is required");
            if (a.flags.has("criterion") && a.flags.has("id"))
                throw new Error("Name the criterion once, with --criterion or --id");
            if (a.command === "show" && a.flags.has("display"))
                throw new Error("show creates a new display receipt; use judge to consume --display");
            if (a.command === "show" || !string(a, "display")) {
                if (["verdict", "by", "note", "without-display"].some(k => a.flags.has(k)))
                    throw new engine.EngineError("Show the result first; recording options need the returned --display receipt.", 2, `wringer-board show --repo ${quote(repo)} --criterion ${quote(criterion)}`);
                const value = await showCriterion(repo, criterion, { signal: context.signal });
                return { value, text: `${value.output}\n\n${value.reason}\nNo judgement was recorded.\nNext: ${value.next_move}${value.independent_inspection_route ? `\nOnly if you independently inspected the result, recording that failure alongside your own note: ${value.independent_inspection_route}` : ""}`, exit: context.signal?.aborted ? 4 : value.success ? 0 : 3 };
            }
            const value = await recordJudgement(repo, { criterion, display: required(a, "display"), verdict: required(a, "verdict") as "met" | "not_met", by: required(a, "by"), note: required(a, "note"), withoutDisplay: flag(a, "without-display") });
            return { value, text: `Judgement recorded in ${value.entry.by}'s words: ${value.entry.note}\nNext: ${value.next_move}` };
        }
        default: throw new Error(`Unknown board command ${a.command}. ${BOARD_HELP}`);
    }
}
export async function main(argv = process.argv.slice(2), surface = "wring"): Promise<void> {
    const wantsJSON = argv.includes("--json");
    const controller = new AbortController(), interrupt = () => controller.abort(new engine.EngineError("Interrupted by the operator; recorded evidence is preserved.", 4, `${surface} --help`));
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    try {
        const answer = await dispatch(argv, surface, { signal: controller.signal });
        if (wantsJSON)
            process.stdout.write(JSON.stringify(answer.value ?? { message: answer.text }) + "\n");
        else
            process.stdout.write((answer.text ?? JSON.stringify(answer.value, null, 2)) + "\n");
        process.exitCode = controller.signal.aborted ? 4 : answer.exit ?? 0;
    }
    catch (error: any) {
        const redactor = new engine.Redactor();
        const value = redactor.deep({ status: controller.signal.aborted ? "interrupted" : "refused", message: error.message ?? String(error), next_move: error.next_move ?? error.stop?.next_move ?? `${surface} --help`, ...(error.stop ? { stop: error.stop } : {}) });
        process.stdout.write(wantsJSON ? JSON.stringify(value) + "\n" : `STOP: ${value.message}\nNext: ${value.next_move}\n`);
        process.exitCode = controller.signal.aborted ? 4 : error.exit_code ?? 2;
    }
    finally {
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", interrupt);
    }
}
