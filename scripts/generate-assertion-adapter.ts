import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const build = await Bun.build({ entrypoints: [resolve(root, "runtime/assertion-adapter.ts")], target: "bun", minify: false, sourcemap: "none" });
if (!build.success || build.outputs.length !== 1) throw new Error("Could not bundle the shared assertion adapter");
const source = "// Generated from runtime/assertion-adapter.ts and the shared engine/record rules.\n" + await build.outputs[0]!.text(), destination = resolve(root, "integrations/assertion-adapter.txt");
if (process.argv.includes("--check")) { if (await Bun.file(destination).text() !== source) throw new Error("Regenerate the contained assertion adapter before building"); }
else await Bun.write(destination, source);
