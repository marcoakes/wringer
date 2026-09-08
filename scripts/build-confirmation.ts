import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

/** Separate opt-in native OS adapter build. This never installs, enrolls keys,
 * prompts for biometrics, changes permissions or enables protected mode. */
const root = resolve(import.meta.dir, ".."), out = join(root, "dist", "native");
if (process.platform !== "darwin") {
    console.log("Native macOS confirmation build unavailable on this platform. Protected mode remains unavailable.");
    process.exit(2);
}
await mkdir(out, { recursive: true });
const output = join(out, "wringer-confirm"), cache = join(root, ".wringer", "swift-module-cache");
await mkdir(cache, { recursive: true });
for (const command of [
    ["/usr/bin/swiftc", "-O", "-module-cache-path", cache, "-framework", "AppKit", "-framework", "LocalAuthentication", "-framework", "Security", join(root, "runtime/macos/Confirmation.swift"), "-o", output],
    ["/usr/bin/codesign", "--force", "--sign", "-", "--options", "runtime", "--timestamp=none", output],
    ["/usr/bin/codesign", "--verify", "--strict", output],
]) {
    const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit", env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache } });
    if (await child.exited !== 0) throw new Error("Native confirmation build/verification failed; no installation or enrollment was attempted");
}
console.log(JSON.stringify({ schema_version: "wringer.native-confirmation-build.v1", output, signing: "local-ad-hoc-hardened-runtime", developerIdSigned: false, notarized: false, installed: false, protectedReady: false, note: "Build only. Live enrollment, protected deployment and actual-client adversarial proof remain separate gates." }, null, 2));
