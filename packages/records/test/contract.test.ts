/**
 * The port's contract, proved.
 *
 * Two halves, and both matter. The CORPUS half runs these readers over
 * records the Python engine really wrote — not fixtures written here, which
 * would only prove this file agrees with itself. The REFUSAL half proves
 * every way a read can fail says which way it was, because a port that
 * reads happy paths and shrugs at broken ones would pass this suite and
 * lose the property the whole product rests on.
 */

import { describe, expect, test } from "bun:test";
import { openReader } from "../src/read";
import { SCHEMA_BY_VERSION, SCHEMA_VERSIONS } from "../src/generated";

const REPO = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const SCHEMA_DIR = `${REPO}/schema`;
// Compatibility is checked against committed historical bytes, never a hidden
// machine-local corpus or a Python interpreter.
const CORPUS = process.env.WRINGER_TEST_CORPUS ?? new URL("./corpus.json", import.meta.url).pathname;

interface CorpusEntry {
  path: string;
  line?: number;
  schema: string;
  version: string;
}
interface Corpus {
  schema_count: number;
  versionless_schemas: string[];
  records: CorpusEntry[];
  skipped: { path: string; line?: number; why: string }[];
  mismatched: { path: string; line?: number; version: string; why: string }[];
}

const corpus: Corpus = await Bun.file(CORPUS).json();
const reader = await openReader(SCHEMA_DIR);

describe("the schema set", () => {
  test("every schema in the tree has a generated type", () => {
    const files = [...new Bun.Glob("*.schema.json").scanSync(SCHEMA_DIR)].sort();
    expect(files.length).toBeGreaterThan(0);
    expect(Object.keys(SCHEMA_VERSIONS).sort()).toEqual(files);
  });

  test("no two schemas claim one version", () => {
    // A version that names two shapes cannot be matched to one schema by any
    // reader in any language. The exporter refuses to build a corpus over
    // one; this holds the same rule on the generated map.
    const seen = new Map<string, string>();
    for (const [file, version] of Object.entries(SCHEMA_VERSIONS)) {
      if (version === null) continue;
      const already = seen.get(version);
      expect(already, `${version} is claimed by ${already} and ${file}`).toBeUndefined();
      seen.set(version, file);
    }
    expect(Object.keys(SCHEMA_BY_VERSION).sort()).toEqual([...seen.keys()].sort());
  });

  test("the versionless schemas are the ones the corpus names, and no others", () => {
    // Nine schemas describe event lines and sub-objects that carry no
    // version of their own. They are matched by the file they live in, not
    // by declaration, and until that is built they are OUT of this contract
    // — said here rather than left as a gap a reader has to notice.
    const versionless = Object.entries(SCHEMA_VERSIONS)
      .filter(([, version]) => version === null)
      .map(([file]) => file)
      .sort();
    expect(versionless).toEqual([...corpus.versionless_schemas].sort());
  });
});

describe("the corpus, written by the engine itself", () => {
  test("it is not empty, or this suite proves nothing", () => {
    expect(corpus.records.length).toBeGreaterThan(0);
  });

  test("every record the engine wrote reads here, and to the same schema", async () => {
    const wrong: string[] = [];
    for (const entry of corpus.records) {
      const path = `${REPO}/${entry.path}`;
      if (entry.line === undefined) {
        const read = await reader.read(path);
        if (!read.ok) {
          wrong.push(`${entry.path}: ${read.reason} — ${read.said}`);
          continue;
        }
        if (read.schema !== entry.schema) {
          wrong.push(
            `${entry.path}: python matched ${entry.schema}, this matched ${read.schema}`,
          );
        }
        continue;
      }
      const { values, refused } = await reader.readLines(path);
      const failed = refused.find((one) => one.line === entry.line);
      if (failed) wrong.push(`${entry.path}:${entry.line}: ${failed.said}`);
      else if (values.length === 0) wrong.push(`${entry.path}: read no lines at all`);
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  test("a record python refused is refused here too, for the same reason", async () => {
    // The exporter found three: `graph.resolved.json` declares
    // `wringer.graph.v1` and is not a `wringer.graph.v1` manifest, because
    // `graph.py` writes two shapes under one version string. Both languages
    // must refuse it. A port that accepted it would be reading a record of
    // one shape as another and would be confident about it.
    for (const bad of corpus.mismatched) {
      const read = await reader.read(`${REPO}/${bad.path}`);
      expect(read.ok, `${bad.path} was accepted here and refused by python`).toBe(false);
      if (!read.ok) expect(read.reason).toBe("does-not-satisfy-what-it-declares");
    }
  });
});

describe("every refusal says which one it is", () => {
  const scratch = `${REPO}/.wringer/record-tests`;

  test("absent is not the same answer as unreadable", async () => {
    const read = await reader.read(`${scratch}/nothing-here.json`);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toBe("absent");
      expect(read.said).toContain("nothing-here.json");
    }
  });

  test("a file that is not JSON says so, and names itself", async () => {
    const path = `${scratch}/not-json.json`;
    await Bun.write(path, "{ this is not json");
    const read = await reader.read(path);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toBe("not-json");
      expect(read.said).toContain("not-json.json");
    }
  });

  test("a record with no version is refused, not guessed at from its name", async () => {
    const path = `${scratch}/journey.json`;
    await Bun.write(path, JSON.stringify({ journey_id: "20260906-000000-aaaa" }));
    const read = await reader.read(path);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("declares-no-version");
  });

  test("a version no schema claims is named, never accepted", async () => {
    const path = `${scratch}/future.json`;
    await Bun.write(path, JSON.stringify({ schema_version: "wringer.journey.v99" }));
    const read = await reader.read(path);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toBe("declares-an-unknown-version");
      expect(read.said).toContain("wringer.journey.v99");
    }
  });

  test("a record that declares a shape it does not have is refused", async () => {
    const path = `${scratch}/shapeless.json`;
    await Bun.write(path, JSON.stringify({ schema_version: "wringer.stop.v1" }));
    const read = await reader.read(path);
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toBe("does-not-satisfy-what-it-declares");
      expect(read.said).toContain("stop.schema.json");
    }
  });

  test("asking for one version and getting another is its own refusal", async () => {
    const entry = corpus.records.find((one) => one.line === undefined);
    expect(entry).toBeDefined();
    const read = await reader.read(`${REPO}/${entry!.path}`, "wringer.stop.v1");
    expect(read.ok).toBe(false);
    if (!read.ok) {
      expect(read.reason).toBe("wrong-version");
      expect(read.said).toContain(entry!.version);
    }
  });

  test("a broken line is counted and named, never skipped", async () => {
    const path = `${scratch}/lines.jsonl`;
    await Bun.write(
      path,
      [
        JSON.stringify({ schema_version: "wringer.journey.v99" }),
        "{ not json",
        "",
      ].join("\n"),
    );
    const { values, refused } = await reader.readLines(path);
    expect(values).toEqual([]);
    expect(refused.map((one) => one.line)).toEqual([1, 2]);
    expect(refused[0]!.reason).toBe("declares-an-unknown-version");
    expect(refused[1]!.reason).toBe("not-json");
  });
});
