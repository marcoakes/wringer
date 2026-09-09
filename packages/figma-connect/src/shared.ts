import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type FigmaTransport = (url: string, init: RequestInit) => Promise<Response>;
export interface FigmaTokens { accessToken: string; refreshToken: string; expiresAt: number }
export class FigmaConnectionError extends Error {
  constructor(message: string) { super(message); this.name = "FigmaConnectionError"; }
}
export const secret = (): string => randomBytes(32).toString("base64url");
export const hash = (value: string): string => createHash("sha256").update(value).digest("base64url");
export const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export const isSecret = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isToken = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 8192 && !/[\x00-\x20\x7f]/.test(value);

/** Operator-owned configuration only. Never resolve an endpoint supplied by a repository or an assistant tool. */
export function httpsOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new FigmaConnectionError("Figma connection needs an administrator-configured HTTPS broker origin."); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || !hostname.includes(".") ||
      /^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    throw new FigmaConnectionError("Figma connection needs an administrator-configured public HTTPS broker origin.");
  }
  return url.origin;
}

export async function boundedJson(response: Response | Request, limit = 24_576): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new FigmaConnectionError("Figma connection response exceeded its size limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new FigmaConnectionError("Figma connection returned an empty response.");
  const chunks: Uint8Array[] = []; let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 15_000);
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new FigmaConnectionError("Figma connection response exceeded its size limit.");
      chunks.push(value);
    }
    if (timedOut) throw new Error();
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new FigmaConnectionError("Figma connection returned an invalid or oversized response."); }
  finally { clearTimeout(timeout); await reader.cancel().catch(() => {}); }
}

export async function requestJson(transport: FigmaTransport, url: string, body: object | URLSearchParams, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await transport(url, {
      method: "POST", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": body instanceof URLSearchParams ? "application/x-www-form-urlencoded" : "application/json", ...headers },
      body: body instanceof URLSearchParams ? body.toString() : JSON.stringify(body),
    });
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel();
      return { status: response.status, body: {} };
    }
    return { status: response.status, body: await boundedJson(response) };
  } catch { throw new FigmaConnectionError("Figma connection could not complete its secure request. Try connecting again."); }
  finally { clearTimeout(timeout); }
}

export function parseTokens(body: Record<string, unknown>, now: number, previousRefresh?: string): FigmaTokens {
  const refresh = body.refresh_token ?? previousRefresh;
  if (!isToken(body.access_token) || !isToken(refresh) || typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" ||
      typeof body.expires_in !== "number" || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 366 * 86400) {
    throw new FigmaConnectionError("Figma returned an incomplete connection. Connect again.");
  }
  return { accessToken: body.access_token, refreshToken: refresh, expiresAt: now + body.expires_in * 1000 };
}

export function validTokens(value: unknown): value is FigmaTokens {
  if (!value || typeof value !== "object") return false;
  const v = value as FigmaTokens;
  return isToken(v.accessToken) && isToken(v.refreshToken) && Number.isSafeInteger(v.expiresAt) && v.expiresAt > 0;
}
