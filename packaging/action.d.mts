export interface ActionSelection { mode: string; ref: string; version: string; gates: string[]; prove: boolean; }
export function actionSelection(env: Record<string, string | undefined>, version: string): ActionSelection;
export function runVerification(options: { launcher: string[]; repo: string; output: string; selection: ActionSelection; env: Record<string, string | undefined> }): Promise<{ exit: number; stdout: string; stderr: string; error: string | null; reporting: string[]; output: string; observed: any }>;
export function actionMain(env?: Record<string, string | undefined>): Promise<number>;
