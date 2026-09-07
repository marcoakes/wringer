import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AuthorityAction, OperatorAuthority } from "./types";
import { array, knownKeys, now, object, parseObject, safePath, stop, string, WORKFLOW_DIR, writeJson } from "./storage";
export const AUTHORITY_ACTIONS: AuthorityAction[] = ["draft", "resolve-questions", "accept-assumptions", "approve-plan", "install-gates", "build"];
export function validateAuthority(value: unknown, repo: string, at = Date.now()): OperatorAuthority {
    const data = object(value, "operator authority");
    knownKeys(data, ["schema_version", "repo", "actor", "granted_at", "expires_at", "actions", "budget"], "operator authority");
    if (data.schema_version !== "wringer.operator-authority.v1")
        throw new Error("Unsupported authority schema; legacy approval files do not grant headless authority");
    const declaredRepo = string(data.repo, "authority repo");
    if (resolve(declaredRepo) !== resolve(repo) || declaredRepo !== resolve(declaredRepo))
        throw new Error("Authority must name this repository's absolute path exactly");
    const actor = string(data.actor, "authority actor");
    const granted_at = string(data.granted_at, "granted_at");
    if (!Number.isFinite(Date.parse(granted_at)) || Date.parse(granted_at) > at + 60000)
        throw new Error("Authority grant time is invalid or in the future");
    const expires_at = data.expires_at === undefined ? undefined : string(data.expires_at, "expires_at");
    if (expires_at && (!Number.isFinite(Date.parse(expires_at)) || Date.parse(expires_at) <= at))
        throw new Error("Operator authority has expired or has an invalid expiry");
    const actions = array(data.actions, "authority actions").map(v => string(v, "authority action"));
    if (!actions.length || new Set(actions).size !== actions.length || actions.some(a => !AUTHORITY_ACTIONS.includes(a as AuthorityAction)))
        throw new Error("Authority actions must be a nonempty unique subset of routine workflow actions. Human judgements, delivery, logins, publishing and sandbox bypass are not granted here");
    const budget = object(data.budget, "authority budget");
    knownKeys(budget, ["max_draft_calls", "max_repair_attempts", "max_worker_turns"], "authority budget");
    for (const [key, min] of [["max_draft_calls", 1], ["max_repair_attempts", 0], ["max_worker_turns", 1]] as const)
        if (!Number.isSafeInteger(budget[key]) || (budget[key] as number) < min)
            throw new Error(`${key} must be an integer of at least ${min}`);
    return { schema_version: "wringer.operator-authority.v1", repo: declaredRepo, actor, granted_at, ...(expires_at ? { expires_at } : {}), actions: actions as AuthorityAction[], budget: budget as unknown as OperatorAuthority["budget"] };
}
export async function loadAuthority(repo: string, path: string): Promise<OperatorAuthority> {
    try {
        return validateAuthority(parseObject(await readFile(resolve(repo, path), "utf8"), "operator authority"), repo);
    }
    catch (error) {
        return stop(repo, "authority-invalid", (error as Error).message, "wringer-drive authority --help");
    }
}
export async function createAuthority(repo: string, options: {
    actor: string;
    actions?: AuthorityAction[];
    budget: OperatorAuthority["budget"];
    expiresAt?: string;
    path?: string;
}): Promise<{
    path: string;
    authority: OperatorAuthority;
}> {
    const authority = validateAuthority({ schema_version: "wringer.operator-authority.v1", repo: resolve(repo), actor: options.actor, granted_at: now(), ...(options.expiresAt ? { expires_at: options.expiresAt } : {}), actions: options.actions ?? AUTHORITY_ACTIONS, budget: options.budget }, repo);
    const path = options.path ?? `${WORKFLOW_DIR}/authority.json`;
    await safePath(repo, path);
    await writeJson(repo, path, authority);
    return { path, authority };
}
