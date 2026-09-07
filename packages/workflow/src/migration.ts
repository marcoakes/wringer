/** Explicit migration boundaries; no legacy model transport is reachable here. */
export function legacyWorkflowRefusal(): never {
    throw new Error("The alpha direct-HTTP/shell workflow has been retired. Compile an explicit YAML/TypeScript execution plan with wringer-drive plan PLAN, grant bounded controller-owned authority, then run wringer-drive run PLAN --authority AUTHORITY. ACP roles run only in the declared contained backend; no host model fallback exists.");
}
export async function draftSpec(..._args: unknown[]): Promise<never> { return legacyWorkflowRefusal(); }
export async function reviseSpec(..._args: unknown[]): Promise<never> { return legacyWorkflowRefusal(); }
export async function runDrive(..._args: unknown[]): Promise<never> { return legacyWorkflowRefusal(); }
export async function resumeDrive(..._args: unknown[]): Promise<never> { return legacyWorkflowRefusal(); }
export async function judge(..._args: unknown[]): Promise<never> { return legacyWorkflowRefusal(); }
