/** Mechanical formatting of the new native implementation; generated/frozen files are excluded. */
import ts from "typescript";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const root = resolve(import.meta.dir, ".."), printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: false });
let changed = 0;
async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
        if (["node_modules", "dist"].includes(entry.name))
            continue;
        const file = join(path, entry.name);
        if (entry.isDirectory())
            await walk(file);
        else if (entry.isFile() && entry.name.endsWith(".ts")) {
            const before = await readFile(file, "utf8"), source = ts.createSourceFile(file, before, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
            const after = printer.printFile(source);
            if (before !== after) {
                await writeFile(file, after);
                changed++;
            }
        }
    }
}
for (const name of ["acp", "runtime", "plan", "engine", "workflow", "board", "delivery", "scheduler", "cli"])
    await walk(join(root, "packages", name));
await walk(join(root, "scripts"));
console.log(`Formatted ${changed} native TypeScript source/test files; no frozen or legacy sources touched.`);
