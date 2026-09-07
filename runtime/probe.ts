/** Runs only inside the smoke image as the same unprivileged identity as agents. */
import { readFile, writeFile, rename, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
const [mode, first, second] = process.argv.slice(2);
const root = "/workspace/repo";
async function expectDenied(operation: () => Promise<unknown>, label: string) {
  try { await operation(); throw Error(`UNEXPECTED_ALLOWED: ${label}`); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && ["EACCES", "EPERM", "EROFS"].includes(String(error.code)))) throw error;
    return label;
  }
}
if (mode === "worker") {
  if (process.getuid?.() !== 1000) throw Error("Wrong execution identity");
  await writeFile(join(root, "src/allowed.txt"), "worker scoped edit\n");
  await writeFile(join(root, "node_modules/allowed-output.txt"), "declared output\n");
  const checks = [];
  for (const path of ["outside.txt", "tests/protected.txt", ".git/config"]) {
    checks.push(await expectDenied(() => writeFile(join(root, path), "unapproved\n"), `write denied: ${path}`));
    checks.push(await expectDenied(() => rename(join(root, path), join(root, path + ".moved")), `rename denied: ${path}`));
  }
  checks.push(await expectDenied(() => writeFile(join(root, "new-root-file"), "unapproved"), "locked parent denies new sibling"));
  await writeFile(`/home/agent/${first}`, "peer private sentinel\n");
  console.log(JSON.stringify({ checks, allowedScopedWrite: true, allowedDeclaredOutput: true }));
} else if (mode === "reader") {
  const checks = [];
  for (const path of ["src/allowed.txt", "outside.txt", "tests/protected.txt", ".git/config"]) checks.push(await expectDenied(() => writeFile(join(root, path), "unapproved"), `read-only source: ${path}`));
  if (await readFile(join(root, "src/allowed.txt"), "utf8") !== "baseline source\n") throw Error("Peer source changed across role instances");
  try { await stat(`/home/agent/${first}`); throw Error("Peer private storage visible"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  console.log(JSON.stringify({ checks, freshSource: true, peerPrivateStorageAbsent: true }));
} else if (mode === "host") {
  if (!first || !second) throw Error("Missing sentinel");
  try { if (await readFile(first, "utf8") === second) throw Error("Host sentinel visible"); } catch (error) { if (!(error instanceof Error && "code" in error && ["ENOENT", "EACCES", "EPERM"].includes(String(error.code)))) throw error; }
  // If the same absolute path can be created inside, prove it does not mutate host bytes afterwards.
  let write = "denied";
  try { await mkdir(first.slice(0, first.lastIndexOf("/")), { recursive: true }); await writeFile(first, "contained path only\n"); write = "isolated-copy-created"; }
  catch (error) { if (!(error instanceof Error && "code" in error && ["EACCES", "EPERM", "EROFS"].includes(String(error.code)))) throw error; }
  console.log(JSON.stringify({ hostSentinelNotReadable: true, samePathWrite: write }));
} else if (mode === "resources") {
  const read = async (path: string) => readFile(path, "utf8").catch(() => "unavailable");
  console.log(JSON.stringify({ status: await read("/proc/self/status"), cpuMax: await read("/sys/fs/cgroup/cpu.max"), memoryMax: await read("/sys/fs/cgroup/memory.max"), memoryInfo: await read("/proc/meminfo"), cpuInfo: await read("/proc/cpuinfo") }));
} else throw Error("Unknown smoke probe");
