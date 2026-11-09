import { readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assistantId, assistantInventory, delegationJobStatus, readDelegationJob, readVerificationJob, verificationStatus } from "@wringer/application";

/** Beta gate run 2 (F12): the installer's hold said "Stop running owners", and no documented
 * command did; `wring job open` leaves its owner running in the background. Closing is the
 * same stop as Ctrl-C on `wring job serve`, refused while a job of the workspace still works. */
type Workspace = { id: string; mode: string };
type Working = { jobId: string; state: "accepted" | "running" | "uncertain" };
/** A live or uncertain operation is the owner's to finish; anything else is records the owner only shows. */
const LIVE_OPERATIONS = ["accepted", "running", "cancel-requested", "uncertain"];
/** Whether a delegation job holds its owner open. ZenJev, 2026-11-09: a step left uncertain after its
 * operation completed kept every owner from closing, and recovery could not settle it. Only a live or
 * uncertain operation holds the owner; a recorded uncertain step stays exactly as it is. */
export function ownerHeldBy(status: { outcome: string; operationStates?: { status: string }[] }): Working["state"] | null {
    const live = (status.operationStates ?? []).filter(operation => LIVE_OPERATIONS.includes(operation.status));
    if (live.some(operation => operation.status === "uncertain")) return "uncertain";
    return live.length || status.outcome === "accepted" || status.outcome === "running" ? (status.outcome === "accepted" ? "accepted" : "running") : null;
}

/** The command line of a live process, or null when it cannot be read. */
export function processCommand(pid: number): string | null {
    try { return readFileSync(`/proc/${pid}/cmdline`).toString("utf8").split("\0").filter(Boolean).join(" ") || null; } catch { /* not Linux */ }
    const result = Bun.spawnSync(["ps", "-o", "args=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
    return result.exitCode === 0 ? result.stdout.toString().trim() || null : null;
}
function state(pid: number): "running" | "gone" | "other" {
    try { process.kill(pid, 0); return "running"; } catch (error: any) { return error.code === "ESRCH" ? "gone" : "other"; }
}
async function present(path: string) { try { await lstat(path); return true; } catch (error: any) { if (error.code === "ENOENT") return false; throw error; } }
async function workingJobs(root: string, workspace: Workspace): Promise<Working[]> {
    const working: Working[] = [];
    if (workspace.mode === "delegation") {
        for (const name of await assistantInventory(root, "delegation-jobs")) {
            if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
            const job = await readDelegationJob(root, name.slice(0, -5));
            if (job.workspaceId !== workspace.id) continue;
            const status = await delegationJobStatus(root, job.id);
            // ZenJev, 2026-11-09: a step left uncertain after its operation completed kept every
            // owner from closing, and recovery could not settle it. Only a live or uncertain
            // operation holds the owner; a recorded uncertain step stays exactly as it is.
            const held = ownerHeldBy(status);
            if (held) working.push({ jobId: job.id, state: held });
        }
    } else {
        for (const name of await assistantInventory(root, "verification-jobs")) {
            if (!/^[a-f0-9-]{36}$/.test(name)) continue;
            const job = await readVerificationJob(root, name).catch(() => null);
            if (!job || job.workspaceId !== workspace.id) continue;
            const status = await verificationStatus(root, job.id);
            if (status.phase === "uncertain" || status.uncertainty) working.push({ jobId: job.id, state: "uncertain" });
        }
    }
    return working;
}
export async function closeOwner(root: string, workspace: Workspace, options: { waitMs?: number; command?: (pid: number) => string | null; working?: typeof workingJobs } = {}) {
    const id = assistantId(workspace.id), lockPath = join(root, "owners", id, "owner.lock"), base = { schema_version: "wringer.owner-close.v1", workspaceId: id };
    const inspect = `wring recover --workspace ${id} --dry-run`;
    let lock: any;
    try {
        const info = await lstat(lockPath);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error("not a bounded owner record");
        lock = JSON.parse(await readFile(lockPath, "utf8"));
    } catch (error: any) {
        if (error.code === "ENOENT") return { value: { ...base, closed: false, running: false }, text: `No operator owner is running for workspace ${id}. Nothing was stopped.` };
        return { exit: 3, value: { ...base, closed: false, running: null }, text: `The owner record of workspace ${id} could not be read, so nothing was stopped. Inspect it with ${inspect}.` };
    }
    const pid = lock?.pid;
    if (!Number.isSafeInteger(pid) || pid < 2 || lock.workspaceId !== id) return { exit: 3, value: { ...base, closed: false, running: null }, text: `The owner record of workspace ${id} names no process of this workspace, so nothing was stopped. Inspect it with ${inspect}.` };
    if (state(pid) === "gone") return { exit: 3, value: { ...base, closed: false, running: false, pid }, text: `The owner recorded for workspace ${id} is not running, but its records remain. Nothing was stopped or removed. Inspect them with ${inspect}.` };
    const command = state(pid) === "running" ? (options.command ?? processCommand)(pid) : null;
    if (!command || !/ job serve( |$)/.test(command) || !new RegExp(`--workspace[ =]${id}( |$)`).test(command)) return { exit: 3, value: { ...base, closed: false, running: null, pid }, text: `Process ${pid}, named by the owner record of workspace ${id}, is not its operator owner; the number may have been reused. Nothing was stopped. Inspect it with ${inspect}.` };
    const working = await (options.working ?? workingJobs)(root, workspace), first = working[0];
    if (first) return { exit: 3, value: { ...base, closed: false, running: true, pid, working }, text: first.state === "uncertain"
        ? `Job ${first.jobId} in workspace ${id} has an uncertain operation, so the owner was not stopped. Reconcile it first (wring recover --job ${first.jobId}), then close the owner.`
        : `Job ${first.jobId} in workspace ${id} is still working, so the owner was not stopped: closing it now would interrupt that work. When wring job status --job ${first.jobId} shows it ready for review, sent or stopped, close the owner again.` };
    process.kill(pid, "SIGTERM");
    const waitMs = options.waitMs ?? 20000, deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        if (state(pid) !== "running") return await present(lockPath)
            ? { exit: 3, value: { ...base, closed: false, running: false, pid }, text: `The owner of workspace ${id} stopped but kept its owner record, because an operation was still owned or uncertain. Inspect it with ${inspect}.` }
            : { value: { ...base, closed: true, running: false, pid }, text: `Closed the operator owner of workspace ${id}. Its jobs, evidence and grants are kept; wring job open --workspace ${id} starts it again.` };
        await Bun.sleep(100);
    }
    return { exit: 3, value: { ...base, closed: false, running: true, pid }, text: `The owner of workspace ${id} was asked once to stop and did not confirm it within ${Math.round(waitMs / 1000)} s. Nothing else was changed. Run wring job close --workspace ${id} again to see whether it has stopped.` };
}
