/**
 * The lint gate, with no dependencies at all.
 *
 * Every JavaScript file the cabinet ships is parsed, and a few rules that have
 * actually bitten this codebase are checked. It is deliberately small: a gate
 * nobody can run is worse than a modest one, and adding a linter would mean an
 * `npm install` before anybody can see anything work.
 *
 * The vendored games under `games/` are other projects' source and are not
 * held to this repository's rules.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOOK_IN = ["src", "tests", "acceptance", "scripts"];
const MAX_LINE = 100;

function walk(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...walk(path));
    else if (name.endsWith(".js") || name.endsWith(".mjs")) found.push(path);
  }
  return found;
}

const problems = [];
for (const dir of LOOK_IN) {
  for (const path of walk(join(ROOT, dir))) {
    const where = relative(ROOT, path);
    const body = readFileSync(path, "utf8");

    // **`node --check`, in a real process.** An earlier version of this tried
    // to parse the source with `new Function` after stripping the imports,
    // which cannot work: it reported every module in this repository as a
    // syntax error. Ask the engine that will actually run the file.
    const checked = spawnSync(process.execPath, ["--check", path], {
      encoding: "utf8",
    });
    if (checked.status !== 0) {
      problems.push(`${where}: does not parse — ${checked.stderr.trim().split("\n")[0]}`);
      continue;
    }

    body.split("\n").forEach((line, index) => {
      if (line.length > MAX_LINE) {
        problems.push(`${where}:${index + 1}: line is ${line.length} > ${MAX_LINE}`);
      }
      if (/\s+$/.test(line)) {
        problems.push(`${where}:${index + 1}: trailing whitespace`);
      }
      if (/\bconsole\.log\(/.test(line)) {
        problems.push(`${where}:${index + 1}: console.log left behind`);
      }
      if (/\bvar\s/.test(line)) {
        problems.push(`${where}:${index + 1}: 'var' — use const or let`);
      }
    });
  }
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
process.stdout.write("lint: clean\n");
