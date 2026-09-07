import { join } from "node:path";
import { loadConfig } from "@wringer/engine";
import { checkSeal, inside, json, git, quote, Refusal } from "./io";
import { publishMergeRequest, parseForgeConfiguration } from "./forge";
/** Publication retry reuses a sealed, pushed delivery; it never rebuilds the change. */
export async function publishDelivery(repo: string, deliveryId: string, options: {
    send?: boolean;
    signal?: AbortSignal;
} = {}) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(deliveryId))
        throw new Error("Invalid delivery id");
    const directory = await inside(repo, `.wringer/deliveries/${deliveryId}`);
    await checkSeal(directory);
    const manifest = await json(join(directory, "manifest.json")), config = await loadConfig(repo);
    if (manifest.delivery_id !== deliveryId || manifest.mode !== "live" || !manifest.result?.pushed || !manifest.result?.commit)
        throw new Refusal("Only an existing pushed delivery can be published as a review request.", "wring deliver --help");
    if (!config.forge)
        throw new Refusal("Declare the forge before creating a hosted review request.", "wring deliver --help");
    const anchor = await json(join(directory, "anchor.json"));
    const remoteTip = await git(repo, ["ls-remote", "--heads", manifest.remote, `refs/heads/${manifest.branch}`]);
    if (!remoteTip)
        throw new Refusal("Delivered branch is not visible at the recorded remote.", "wring deliver --help");
    const localTip = await git(repo, ["rev-parse", `refs/heads/${manifest.branch}`]);
    if (remoteTip.split(/\s+/)[0] !== localTip)
        throw new Refusal("Remote delivery branch changed; it was not republished.", "wring audit --help");
    await git(repo, ["merge-base", "--is-ancestor", anchor.code_commit, localTip]);
    const target = config.deliver?.base || (await git(repo, ["symbolic-ref", `refs/remotes/${manifest.remote}/HEAD`])).replace(`refs/remotes/${manifest.remote}/`, "");
    return publishMergeRequest(repo, { forge: parseForgeConfiguration(config.forge), deliveryId, bodyPath: join(directory, "mr.md"), sourceBranch: manifest.branch, targetBranch: target, title: (await Bun.file(join(directory, "commit.txt")).text()).trim(), send: options.send, signal: options.signal, resumeCommand: `wring deliver --repo ${quote(repo)} --delivery ${quote(deliveryId)} --send` });
}
