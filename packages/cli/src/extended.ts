import { resolve } from "node:path";
import { graphStatus, loadGraph, renderGraph } from "@wringer/scheduler";
import { EngineError } from "@wringer/engine";
import { allowed, flag, positionals, required, string, values, number, type Args } from "./args";
import type { Answer, DispatchContext } from "./app";
import { issue } from "./remote";
export async function extended(a: Args, repo: string, context: DispatchContext = {}): Promise<Answer> {
    switch (a.command) {
        case "issue": {
            allowed(a, ["output"]);
            positionals(a, 1);
            const value = await issue(repo, a.words[0]!, { output: string(a, "output"), signal: context.signal });
            return { value, text: `Issue imported: ${value.path}\nNext: ${value.next_move}` };
        }
        case "graph": {
            allowed(a, ["send", "resume"]);
            positionals(a, 0, 2);
            const verb = a.words[0] ?? "run", file = a.words[1] ?? "wringer.graph.yaml";
            if (verb === "show") {
                const graph = await loadGraph(resolve(repo, file));
                return { value: graph, text: renderGraph(graph) };
            }
            if (["status", "explain"].includes(verb)) {
                allowed(a, []);
                if (!a.words[1])
                    throw new Error("Name the graph evidence directory");
                const value = await graphStatus(repo, file);
                return { value, text: JSON.stringify(value, null, 2), exit: value.exit_code };
            }
            throw new EngineError("Legacy graph execution is retired; its history remains readable. Declare bounded ACP roles in an execution plan.", 2, "wringer-drive plan --help");
        }
        case "fleet": {
            throw new EngineError("Legacy host fleet execution is retired; no worker ran. Use an authorized contained execution plan.", 2, "wringer-drive plan --help");
        }
        case "bench": {
            throw new EngineError("Legacy host worker benchmarks are retired; no worker ran. Use a separately authorized contained plan for each measurement.", 2, "wringer-drive plan --help");
        }
        case "judge": {
            throw new Error("Direct-HTTP judging is retired. The independent judge runs over ACP in wringer-drive run PLAN --authority PATH. See wringer-drive --help.");
        }
        default: throw new Error(`Unknown command ${a.command}. Run wring --help.`);
    }
}
