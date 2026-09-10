import { expect, test } from "bun:test";
import { validateRepository } from "../src/policy";
import { prepareRepositorySource } from "../src/source";
import type { RuntimeDriver } from "../src/types";

// Policy only: a local-only source is never fetched by name, and a transported
// bundle never excuses an unnamed or garbage source identity.
const root = "d".repeat(40), commit = "e".repeat(40), local = `local://${root}`, bundlePath = "/controller/sources/source.bundle";
const untouched = (): { driver: RuntimeDriver; calls: string[][] } => {
    const calls: string[][] = [];
    return { calls, driver: { command: async (argv: string[]) => { calls.push(argv); throw new Error("No command may run for a refused source"); } } as unknown as RuntimeDriver };
};

test("a local-only source without its bundle is refused by sentence and never fetched", async () => {
    expect(() => validateRepository({ url: local, commit })).toThrow("This source is local-only (local://): it can only be read from its prepared bundle, and none was supplied. No fetch was attempted.");
    const probe = untouched();
    await expect(prepareRepositorySource({ url: local, commit }, { controllerDir: "/nonexistent/controller", driver: probe.driver })).rejects.toThrow("This source is local-only (local://)");
    expect(probe.calls).toEqual([]);
    expect(() => validateRepository({ url: local, commit, bundlePath })).not.toThrow();
});

test("a transported bundle no longer excuses a source identity outside HTTPS, SSH or local://", () => {
    for (const url of ["not a url", "", "file:///Users/operator/source", "/Users/operator/source", "local://short", `local://${root.toUpperCase()}`, "https://user:secret@example.com/source.git", "https://example.com/source.git?ref=main"])
        expect(() => validateRepository({ url, commit, bundlePath }), url).toThrow();
    for (const url of ["https://example.com/operator/source.git", "ssh://git@example.com/operator/source.git", local])
        expect(() => validateRepository({ url, commit, bundlePath }), url).not.toThrow();
    expect(() => validateRepository({ url: local, commit, bundlePath: "relative/source.bundle" })).toThrow("Git bundle transport path must be absolute");
});

test("source preparation has no second door for a local checkout", async () => {
    const probe = untouched();
    await expect(prepareRepositorySource({ url: "https://example.com/operator/source.git", commit }, { controllerDir: "/nonexistent/controller", driver: probe.driver, localRepo: "/Users/operator/source" } as never)).rejects.toThrow("Source preparation has no localRepo option");
    expect(probe.calls).toEqual([]);
});
