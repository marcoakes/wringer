/**
 * Reading a Wringer record, in TypeScript, under the same rules the engine
 * reads it under.
 *
 * **This is the port's contract.** Wringer's surfaces — the board, the drive
 * — read `.wringer/` and almost nothing else, so a second implementation is
 * safe exactly to the degree that it reads what the first one writes. Every
 * reader here validates against the same frozen schema file the Python
 * validates against, and the corpus test runs both over the same bytes.
 *
 * Three house laws are load-bearing in this file and are not negotiable in
 * a port:
 *
 *   FAIL CLOSED. A record that is present and cannot be read is a refusal
 *   that NAMES what was found. It is never an empty object, never a
 *   default, and never `null` standing in for "fine". Absent and unreadable
 *   are different answers and callers must be able to tell them apart.
 *
 *   THE VERSION IS THE SHAPE. A record says which shape it is. A reader
 *   that guesses from a filename will one day read a record of another
 *   shape and be confident about it — measured on this very corpus, where
 *   `graph.resolved.json` declares `wringer.graph.v1` and is not one.
 *
 *   NO SILENT NARROWING. A line this version cannot read is counted and
 *   named, never skipped.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { SCHEMA_BY_VERSION } from "./generated";

/** What a read returned, or exactly why it did not. Never a bare null. */
export type Read<T> =
  | { readonly ok: true; readonly value: T; readonly schema: string }
  | { readonly ok: false; readonly reason: ReadRefusal; readonly said: string };

/**
 * Named `ReadRefusal` rather than `Refusal`: the schema set already has a
 * `Refusal` — `refusal.schema.json`, the delivery's own record of which no
 * it said — and one name for two things is how a reader comes to import the
 * wrong one and be confident about it.
 */
export type ReadRefusal =
  | "absent"
  | "unreadable"
  | "not-json"
  | "declares-no-version"
  | "declares-an-unknown-version"
  | "does-not-satisfy-what-it-declares"
  | "wrong-version";

export interface Reader {
  /** One record, by the version it declares. */
  read<T = unknown>(path: string, expect?: string): Promise<Read<T>>;
  /** Every line of a `.jsonl`, and the numbers of the lines that failed. */
  readLines<T = unknown>(
    path: string,
    expect?: string,
  ): Promise<{ readonly values: T[]; readonly refused: LineRefusal[] }>;
  /** Validate an already-parsed value against a named schema file. */
  check(value: unknown, schemaFile: string): Read<unknown>;
}

export interface LineRefusal {
  readonly line: number;
  readonly reason: ReadRefusal;
  readonly said: string;
}

function saidOf(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "it did not say why";
  return errors
    .slice(0, 3)
    .map((one) => `${one.instancePath || "/"} ${one.message ?? ""}`.trim())
    .join("; ");
}

/**
 * A reader over one `schema/` directory.
 *
 * The schemas are read from disk rather than bundled, because the frozen
 * files are the source of truth and a bundled copy would be a second one.
 */
export async function openReader(schemaDir: string): Promise<Reader> {
  // **Formats are CHECKED, on both sides.** Ajv ignores `format` unless it
  // is taught, and Python's `jsonschema` skips it unless given a
  // `FormatChecker` — so by default neither checked `date-time` and the two
  // agreed by both looking away. `scripts/export-records.py` passes a
  // format checker for the same reason: two validators that disagree about
  // what a record IS would make every later differential meaningless.
  const ajv = addFormats(new Ajv2020({ allErrors: true, strict: false }));
  const compiled = new Map<string, ValidateFunction>();

  async function validatorFor(file: string): Promise<ValidateFunction> {
    const found = compiled.get(file);
    if (found) return found;
    const schema = await Bun.file(`${schemaDir}/${file}`).json();
    const made = ajv.compile(schema);
    compiled.set(file, made);
    return made;
  }

  function versionOf(value: unknown): string | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const found = (value as Record<string, unknown>)["schema_version"];
      return typeof found === "string" ? found : null;
    }
    return null;
  }

  async function checkParsed<T>(value: unknown, expect?: string): Promise<Read<T>> {
    const version = versionOf(value);
    if (version === null) {
      return {
        ok: false,
        reason: "declares-no-version",
        said:
          "the record carries no `schema_version`, so nothing can say which " +
          "shape it is meant to be",
      };
    }
    if (expect !== undefined && version !== expect) {
      return {
        ok: false,
        reason: "wrong-version",
        said: `it declares ${version}; ${expect} was asked for`,
      };
    }
    const file = SCHEMA_BY_VERSION[version];
    if (!file) {
      return {
        ok: false,
        reason: "declares-an-unknown-version",
        said: `it declares ${version}, which no schema in this set claims`,
      };
    }
    const validate = await validatorFor(file);
    if (!validate(value)) {
      return {
        ok: false,
        reason: "does-not-satisfy-what-it-declares",
        said: `it declares ${version} and does not satisfy ${file}: ${saidOf(validate.errors)}`,
      };
    }
    return { ok: true, value: value as T, schema: file };
  }

  return {
    async read<T = unknown>(path: string, expect?: string): Promise<Read<T>> {
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return { ok: false, reason: "absent", said: `${path} is not there` };
      }
      let text: string;
      try {
        text = await file.text();
      } catch (error) {
        return { ok: false, reason: "unreadable", said: `${path}: ${String(error)}` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        return { ok: false, reason: "not-json", said: `${path}: ${String(error)}` };
      }
      return checkParsed<T>(parsed, expect);
    },

    async readLines<T = unknown>(path: string, expect?: string) {
      const values: T[] = [];
      const refused: LineRefusal[] = [];
      const file = Bun.file(path);
      if (!(await file.exists())) return { values, refused };
      const text = await file.text();
      let number = 0;
      for (const line of text.split("\n")) {
        number += 1;
        if (line.trim() === "") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (error) {
          refused.push({ line: number, reason: "not-json", said: String(error) });
          continue;
        }
        const read = await checkParsed<T>(parsed, expect);
        if (read.ok) values.push(read.value);
        else refused.push({ line: number, reason: read.reason, said: read.said });
      }
      return { values, refused };
    },

    check(value: unknown, schemaFile: string): Read<unknown> {
      const validate = compiled.get(schemaFile);
      if (!validate) {
        return {
          ok: false,
          reason: "unreadable",
          said: `${schemaFile} has not been compiled; read a record first`,
        };
      }
      if (!validate(value)) {
        return {
          ok: false,
          reason: "does-not-satisfy-what-it-declares",
          said: saidOf(validate.errors),
        };
      }
      return { ok: true, value, schema: schemaFile };
    },
  };
}
