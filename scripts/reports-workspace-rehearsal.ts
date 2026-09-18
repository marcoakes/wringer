/** Explicit no-provider local integration scenario. Requires a real pinned Apple
 * Container browser image; neither production state nor host target execution is used. */
import { runAssistantLaunchRehearsal } from "./assistant-launch-rehearsal";
import { loadReportsWorkspaceScenario } from "./reports-workspace-scenario";
import { isAbsolute } from "node:path";

export function reportsScenarioArguments(args: string[]) {
    const values = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!key || !["--source", "--intent", "--image"].includes(key) || !value || value.startsWith("--") || values.has(key)) throw new Error("Use --source ABS_TARGET --intent ABS_PROPOSAL_REQUEST_JSON --image DIGEST_PINNED_BROWSER_IMAGE; no production controller or destination is accepted");
        values.set(key, value);
    }
    if (values.size !== 3) throw new Error("Reports rehearsal needs --source, --intent and --image; no implicit production inputs or runtime fallback");
    if (!isAbsolute(values.get("--source")!) || !isAbsolute(values.get("--intent")!)) throw new Error("Reports source and intent paths must be absolute");
    return { source: values.get("--source")!, intentFile: values.get("--intent")!, image: values.get("--image")! };
}
if (import.meta.main) {
    const scenario = await loadReportsWorkspaceScenario(reportsScenarioArguments(process.argv.slice(2)));
    console.log(JSON.stringify(await runAssistantLaunchRehearsal(undefined, true, true, false, true, scenario), null, 2));
}
