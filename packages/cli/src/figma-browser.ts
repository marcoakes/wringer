/** Only the trusted operator Connect action can call this launcher. It opens
 * the OS browser, not an embedded coding-app WebView, with no shell expansion. */
export async function openFigmaAuthorizationInBrowser(url: string, options: { platform?: string; run?: (argv: string[]) => Promise<number> } = {}): Promise<void> {
    let target: URL; try { target = new URL(url); } catch { throw new Error("Figma returned an invalid sign-in address."); }
    const allowed = ["client_id", "redirect_uri", "scope", "state", "response_type", "code_challenge", "code_challenge_method"];
    if (target.origin !== "https://www.figma.com" || target.pathname !== "/oauth" || target.username || target.password || target.hash || [...target.searchParams.keys()].length !== 7 || new Set(target.searchParams.keys()).size !== 7 || [...target.searchParams.keys()].some(key => !allowed.includes(key)) || target.searchParams.get("scope") !== "file_content:read" || target.searchParams.get("response_type") !== "code" || target.searchParams.get("code_challenge_method") !== "S256") throw new Error("Figma sign-in was not the supported read-only OAuth route.");
    const platform = options.platform ?? process.platform;
    const executable = platform === "darwin" ? "/usr/bin/open" : platform === "linux" ? "/usr/bin/xdg-open" : null;
    if (!executable) throw new Error("This operating system has no supported regular-browser launcher. Connect Figma from a supported macOS or Linux operator workspace; an embedded browser is not a fallback.");
    const run = options.run ?? (async (argv: string[]) => { const child = Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 5000 }); return child.exited; });
    let code: number; try { code = await run([executable, target.href]); } catch { throw new Error("The regular browser could not be opened. Check this computer's default browser, then choose Connect Figma again. No token needs copying."); }
    if (code !== 0) throw new Error("The regular browser could not be opened. Check this computer's default browser, then choose Connect Figma again. No token needs copying.");
}
