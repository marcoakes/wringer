/**
 * `@wringer/records` — the contract the port stands on.
 *
 * Wringer's frozen records are the seam between its engine and its
 * surfaces: the board reads `.wringer/` and makes four calls into the
 * engine, and the drive reaches the engine as `wring <verb> --json`. So a
 * TypeScript surface needs exactly one thing from the Python to be safe —
 * to read what it writes, under the same schemas, with the same refusals.
 *
 * That is this package. Nothing here is a port of engine behaviour; it is
 * the reader half of the contract, proved against records the engine really
 * wrote (`ts/corpus.json`, built by `scripts/export-records.py`).
 */

export * from "./generated";
export * from "./read";
