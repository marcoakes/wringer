import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FigmaConnectionError, secret } from "./shared";

export interface FigmaSecretVault {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
const validKey = (key: string) => {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(key)) throw new FigmaConnectionError("Invalid Figma credential slot.");
};
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
const vaultError = () => new FigmaConnectionError("Figma's private operator credential store is unavailable or unsafe. It must be outside repositories and readable only by this user.");

/** Portable fallback. Its private operator directory is never included in source/controller snapshots. */
export class PrivateFileFigmaVault implements FigmaSecretVault {
  readonly directory: string;
  constructor(directory = join(homedir(), ".local", "state", "wringer", "figma")) { this.directory = resolve(directory); }
  private async ready(): Promise<void> {
    try {
      // A repository-controlled path cannot become a credential sink.
      let ancestor = this.directory;
      while (true) {
        try { await lstat(join(ancestor, ".git")); throw vaultError(); } catch (error) { if (!missing(error)) throw error; }
        if (dirname(ancestor) === ancestor) break;
        ancestor = dirname(ancestor);
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw vaultError();
      // Resolve symlinked ancestors and check the real repository boundary too.
      ancestor = await realpath(this.directory);
      while (true) {
        try { await lstat(join(ancestor, ".git")); throw vaultError(); } catch (error) { if (!missing(error)) throw error; }
        if (dirname(ancestor) === ancestor) break;
        ancestor = dirname(ancestor);
      }
    } catch { throw vaultError(); }
  }
  async get(key: string): Promise<string | undefined> {
    validKey(key); await this.ready();
    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(join(this.directory, `${key}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32_768 || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw vaultError();
      return await file.readFile("utf8");
    } catch (error) { if (missing(error)) return undefined; throw vaultError(); }
    finally { await file?.close(); }
  }
  async set(key: string, value: string): Promise<void> {
    validKey(key); if (Buffer.byteLength(value) > 32_768) throw vaultError(); await this.ready();
    const temporary = join(this.directory, `${key}.${secret()}.tmp`);
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(value, "utf8"); await file.sync(); } finally { await file.close(); }
      await rename(temporary, join(this.directory, `${key}.json`));
    } catch { await unlink(temporary).catch(() => {}); throw vaultError(); }
  }
  async delete(key: string): Promise<void> {
    validKey(key); await this.ready();
    try { await unlink(join(this.directory, `${key}.json`)); } catch (error) { if (!missing(error)) throw vaultError(); }
  }
}

export type KeychainCommandRunner = (args: readonly string[], input?: string) => Promise<{ exitCode: number; stdout: string }>;
const keychainRunner: KeychainCommandRunner = async (args, input) => {
  const child = Bun.spawn(["/usr/bin/security", ...args], {
    stdin: input === undefined ? "ignore" : new Blob([input]), stdout: "pipe", stderr: "pipe",
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
  });
  const timeout = setTimeout(() => child.kill(), 30_000);
  try {
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout };
  } finally { clearTimeout(timeout); }
};

/** `security -i` reads a base64-only command over stdin: tokens never enter process arguments or logs. */
export class MacOSKeychainFigmaVault implements FigmaSecretVault {
  constructor(private readonly run: KeychainCommandRunner = keychainRunner) {}
  async get(key: string): Promise<string | undefined> {
    validKey(key);
    try {
      const result = await this.run(["find-generic-password", "-s", "wringer-figma-oauth", "-a", key, "-w"]);
      if (result.exitCode === 44) return undefined;
      const encoded = result.stdout.trim();
      if (result.exitCode !== 0 || encoded.length > 44_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error();
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch { throw new FigmaConnectionError("Figma's macOS Keychain item could not be read. Unlock your Keychain and reconnect if needed."); }
  }
  async set(key: string, value: string): Promise<void> {
    validKey(key);
    if (Buffer.byteLength(value) > 32_768) throw new FigmaConnectionError("Figma credential exceeded its storage limit.");
    try {
      const encoded = Buffer.from(value, "utf8").toString("base64");
      const result = await this.run(["-i"], `add-generic-password -U -s wringer-figma-oauth -a ${key} -w ${encoded}\n`);
      if (result.exitCode !== 0 || await this.get(key) !== value) throw new Error();
    } catch { throw new FigmaConnectionError("Figma's macOS Keychain item could not be saved. No credential was written to the repository."); }
  }
  async delete(key: string): Promise<void> {
    validKey(key);
    try {
      const result = await this.run(["delete-generic-password", "-s", "wringer-figma-oauth", "-a", key]);
      if (result.exitCode !== 0 && result.exitCode !== 44) throw new Error();
    } catch { throw new FigmaConnectionError("Figma's macOS Keychain item could not be removed."); }
  }
}
