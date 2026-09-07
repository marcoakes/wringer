import type { Readable, Writable } from "node:stream";
export type AgentRole = "planner" | "worker" | "judge";
export interface AcpTransport {
    input: Writable;
    output: Readable;
    errors?: Readable;
    exited: Promise<{
        code: number | null;
        signal?: string | null;
    }>;
    terminate(): Promise<void>;
}
export interface AgentDeclaration {
    protocol: "acp";
    command: string;
    args?: string[];
    /** Names only. Values belong to the runtime's explicit secret channel. */
    env?: string[];
    authMethod?: string;
    mode?: string;
}
export interface AcpTurnOptions {
    role: AgentRole;
    cwd: string;
    prompt: string;
    timeoutMs: number;
    signal?: AbortSignal;
    authMethod?: string;
    mode?: string;
    allowedToolKinds?: string[];
    maxMessageBytes?: number;
    maxOutputBytes?: number;
    redact?: (value: string) => string;
    onEvent?: (event: Record<string, unknown>) => void | Promise<void>;
}
export interface AcpTurnResult {
    status: "completed" | "stopped" | "failed";
    text: string;
    sessionId: string | null;
    stopReason: string;
    protocolVersion: number | null;
    agentInfo: Record<string, unknown> | null;
    capabilities: Record<string, unknown>;
    authMethods: Record<string, unknown>[];
    authentication: {
        methodAttempted: string | null;
        sessionOpened: boolean;
    };
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
    events: Record<string, unknown>[];
    stderr: string;
}
export class AcpError extends Error {
    constructor(message: string, readonly code = "protocol-error", readonly data?: unknown) { super(message); this.name = "AcpError"; }
}
