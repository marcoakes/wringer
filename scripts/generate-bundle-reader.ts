/** Preserve the independent Node reader verbatim for native Bun embedding.
 * A distinct text asset avoids compiling one .mjs URL under two loaders. */
import { resolve } from "node:path";
const root = resolve(import.meta.dir, ".."), source = await Bun.file(resolve(root, "examples/evidence/read-bundle.mjs")).text();
const destination = resolve(root, "integrations/bundle-reader.txt");
if (process.argv.includes("--check")) {
    if (await Bun.file(destination).text() !== source) throw new Error("Regenerate the independent bundle reader before building");
} else await Bun.write(destination, source);
