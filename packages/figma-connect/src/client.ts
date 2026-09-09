import { FigmaConnectionError, hash, httpsOrigin, isSecret, requestJson, secret, validTokens, type FigmaTokens, type FigmaTransport } from "./shared";
import { MacOSKeychainFigmaVault, PrivateFileFigmaVault, type FigmaSecretVault } from "./vault";

export type FigmaConnectionState = "unconfigured" | "needs-connection" | "connecting" | "connected" | "reconnect-required";
export interface FigmaConnectionStatus { state: FigmaConnectionState; configured: boolean; message: string }
export interface FigmaConnectionOptions {
  /** Private operator state outside repositories. macOS credentials remain in Keychain unless a vault is explicitly injected. */
  directory?: string;
  /** Administrator-owned setting; never accept this value from MCP/tool/repository input. */
  brokerUrl?: string;
  vault?: FigmaSecretVault;
  testTransport?: FigmaTransport;
  now?: () => number;
}
interface StoredConnection { broker: string; tokens: FigmaTokens }
interface PendingConnection { broker: string; handle: string; verifier: string; expiresAt: number }
const status = (state: FigmaConnectionState, message: string): FigmaConnectionStatus => ({ state, configured: state !== "unconfigured", message });

export class FigmaConnectionService {
  private readonly broker?: string;
  private readonly vault: FigmaSecretVault;
  private readonly transient: FigmaSecretVault;
  private readonly transport: FigmaTransport;
  private readonly now: () => number;
  private readonly slot: string;
  private inFlight?: Promise<FigmaTokens>;
  private generation = 0;
  private mutations: Promise<void> = Promise.resolve();
  constructor(options: FigmaConnectionOptions = {}) {
    const configured = options.brokerUrl ?? process.env.WRINGER_FIGMA_BROKER_URL;
    this.broker = configured ? httpsOrigin(configured) : undefined;
    this.transient = options.vault ?? new PrivateFileFigmaVault(options.directory);
    this.vault = options.vault ?? (process.platform === "darwin" ? new MacOSKeychainFigmaVault() : this.transient);
    this.transport = options.testTransport ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
    this.slot = `figma-${hash(this.broker ?? "unconfigured")}`;
  }
  /** Logging this object cannot accidentally serialize its secret vault or in-flight request. */
  toJSON(): object { return { service: "figma-connection", configured: Boolean(this.broker) }; }
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation);
    this.mutations = result.then(() => {}, () => {});
    return result;
  }
  private async saved(): Promise<StoredConnection | undefined> {
    const raw = await this.vault.get(this.slot);
    if (raw === undefined) return undefined;
    try {
      const parsed = JSON.parse(raw) as StoredConnection;
      if (parsed.broker !== this.broker || !validTokens(parsed.tokens)) throw new Error();
      return parsed;
    } catch { throw new FigmaConnectionError("The saved Figma connection is invalid. Disconnect it and connect again."); }
  }
  private async pending(): Promise<PendingConnection | undefined> {
    const raw = await this.transient.get(`${this.slot}-pending`);
    if (raw === undefined) return undefined;
    try {
      const parsed = JSON.parse(raw) as PendingConnection;
      if (parsed.broker !== this.broker || !isSecret(parsed.handle) || !isSecret(parsed.verifier) || !Number.isSafeInteger(parsed.expiresAt)) throw new Error();
      return parsed;
    } catch { throw new FigmaConnectionError("The pending Figma connection is invalid. Start connecting again."); }
  }
  async status(): Promise<FigmaConnectionStatus> {
    if (!this.broker) return status("unconfigured", "Connect Figma is not configured. An administrator must register the Figma app and deploy its HTTPS connection broker; no personal token is required.");
    try {
      const pending = await this.pending();
      if (pending && pending.expiresAt > this.now()) return status("connecting", "Finish authorising Figma in your browser, then return here to finish connecting.");
      const saved = await this.saved();
      if (saved) return status("connected", "Figma connection is saved. Access is checked, and renewed if needed, when importing a design.");
      if (pending || await this.transient.get(`${this.slot}-reconnect`)) return status("reconnect-required", "Figma needs reconnecting. Open Connect Figma and authorise access again.");
      return status("needs-connection", "Connect your Figma account to import the frames you select. No design is fetched until you request it and allow its retention.");
    } catch { return status("reconnect-required", "Figma's saved connection could not be read safely. Check the operator credential store and reconnect."); }
  }
  /** Trusted operator surface only: do not return this result to an assistant/model-facing tool. */
  async begin(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    return this.exclusive(() => this.start());
  }
  private async start(): Promise<{ authorizationUrl: string; expiresAt: string }> {
    if (!this.broker) throw new FigmaConnectionError((await this.status()).message);
    const generation = ++this.generation;
    const verifier = secret();
    const result = await requestJson(this.transport, `${this.broker}/v1/connect`, { challenge: hash(verifier) });
    if (result.status !== 200 || !isSecret(result.body.handle) || typeof result.body.authorizationUrl !== "string" || typeof result.body.expiresAt !== "number" ||
        !Number.isSafeInteger(result.body.expiresAt) || result.body.expiresAt <= this.now() || result.body.expiresAt > this.now() + 10 * 60_000) throw new FigmaConnectionError("Figma's connection broker could not start a bounded sign-in. Try again.");
    let authorization: URL;
    try { authorization = new URL(result.body.authorizationUrl); } catch { throw new FigmaConnectionError("Figma's connection broker returned an invalid sign-in address."); }
    const params = authorization.searchParams;
    if (authorization.origin !== "https://www.figma.com" || authorization.pathname !== "/oauth" || authorization.username || authorization.password || authorization.hash ||
        params.get("scope") !== "file_content:read" || params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" ||
        !isSecret(params.get("state")) || !isSecret(params.get("code_challenge")) || params.get("redirect_uri") !== `${this.broker}/oauth/figma/callback` ||
        !params.get("client_id") || [...params.keys()].length !== 7 || new Set(params.keys()).size !== 7) {
      throw new FigmaConnectionError("Figma's connection broker returned an unsafe or over-scoped sign-in address.");
    }
    if (generation !== this.generation) throw new FigmaConnectionError("Figma connection changed while sign-in was starting. Start again.");
    await this.transient.set(`${this.slot}-pending`, JSON.stringify({ broker: this.broker, handle: result.body.handle, verifier, expiresAt: result.body.expiresAt } satisfies PendingConnection));
    return { authorizationUrl: authorization.href, expiresAt: new Date(result.body.expiresAt).toISOString() };
  }
  async complete(): Promise<FigmaConnectionStatus> {
    return this.exclusive(() => this.finish());
  }
  private async finish(): Promise<FigmaConnectionStatus> {
    if (!this.broker) return this.status();
    const generation = this.generation;
    const pending = await this.pending();
    if (!pending) return this.status();
    if (pending.expiresAt <= this.now()) { await this.markReconnect(); return this.status(); }
    const result = await requestJson(this.transport, `${this.broker}/v1/take`, { handle: pending.handle, verifier: pending.verifier });
    if (generation !== this.generation) throw new FigmaConnectionError("Figma connection changed while sign-in was completing. Start again.");
    if (result.status === 202) return this.status();
    if (result.status !== 200 || !validTokens(result.body.tokens)) { await this.markReconnect(); return this.status(); }
    try {
      await this.vault.set(this.slot, JSON.stringify({ broker: this.broker, tokens: result.body.tokens } satisfies StoredConnection));
      await this.transient.delete(`${this.slot}-pending`); await this.transient.delete(`${this.slot}-reconnect`);
    } catch { await this.markReconnect(); throw new FigmaConnectionError("Figma authorised, but its credentials could not be stored safely. Connect again after repairing the operator credential store."); }
    return this.status();
  }
  async poll(): Promise<FigmaConnectionStatus> { return this.complete(); }
  private async markReconnect(): Promise<void> {
    await this.vault.delete(this.slot);
    await this.transient.delete(`${this.slot}-pending`);
    await this.transient.set(`${this.slot}-reconnect`, "true");
  }
  private async access(): Promise<FigmaTokens> {
    if (!this.broker) throw new FigmaConnectionError("Connect Figma before importing a design.");
    const generation = this.generation;
    const saved = await this.saved();
    if (!this.broker || !saved) throw new FigmaConnectionError("Connect Figma before importing a design.");
    if (saved.tokens.expiresAt > this.now() + 60_000) return saved.tokens;
    const result = await requestJson(this.transport, `${this.broker}/v1/refresh`, { refreshToken: saved.tokens.refreshToken });
    if (generation !== this.generation) throw new FigmaConnectionError("Figma was disconnected or changed during renewal. Connect again.");
    if (result.status === 429 || result.status >= 500) throw new FigmaConnectionError("Figma connection renewal is temporarily unavailable. Try again later; the saved connection has been retained.");
    if (result.status !== 200 || !validTokens(result.body.tokens)) {
      await this.markReconnect(); throw new FigmaConnectionError("Figma access has expired or been revoked. Connect Figma again.");
    }
    await this.vault.set(this.slot, JSON.stringify({ broker: this.broker, tokens: result.body.tokens } satisfies StoredConnection));
    return result.body.tokens;
  }
  async withAccessToken<T>(callback: (accessToken: string) => Promise<T>): Promise<T> {
    const generation = this.generation;
    this.inFlight ??= this.exclusive(() => this.access());
    let tokens: FigmaTokens;
    try { tokens = await this.inFlight; } finally { this.inFlight = undefined; }
    if (generation !== this.generation) throw new FigmaConnectionError("Figma connection changed before import. Try the import again after reconnecting.");
    // The callback must be a trusted bounded Figma REST importer, never an arbitrary model-supplied endpoint.
    return callback(tokens.accessToken);
  }
  /** Call only for a measured Figma authentication refusal (401), not a network or permission error. */
  async requireReconnect(): Promise<FigmaConnectionStatus> {
    if (!this.broker) return this.status();
    ++this.generation;
    return this.exclusive(async () => { await this.markReconnect(); return this.status(); });
  }
  async disconnect(): Promise<FigmaConnectionStatus> {
    if (!this.broker) return this.status();
    ++this.generation;
    return this.exclusive(async () => {
      await this.vault.delete(this.slot);
      await this.transient.delete(`${this.slot}-pending`); await this.transient.delete(`${this.slot}-reconnect`);
      // Local removal is not a claim that the OAuth grant was revoked at Figma.
      return this.status();
    });
  }
}
