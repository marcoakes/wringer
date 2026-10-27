import type { PlaybookSurface } from "./types";

/** Where a playbook tree lives in the approved repository, and where each of its
 * files is materialised for the declared adapter surface. Pure path rules: the
 * inert compiler protects and validates a selection without reading a file. */
export const PLAYBOOK_SURFACES: readonly PlaybookSurface[] = ["claude-code", "codex", "generic"];
/** The one always-on file per surface: what the adapter reads at every turn. */
export const PLAYBOOK_ALWAYS_ON: Readonly<Record<PlaybookSurface, string>> = { "claude-code": "CLAUDE.md", codex: "AGENTS.md", generic: "PLAYBOOK.md" };
const SKILL_ROOT: Readonly<Record<PlaybookSurface, string>> = { "claude-code": ".claude/skills", codex: ".agents/skills", generic: ".playbook/skills" };
/** A tree is `wringer/playbooks/<id>/` with its manifest at `manifest.json`. */
export const PLAYBOOK_MANIFEST = /^wringer\/playbooks\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/manifest\.json$/;
export const PLAYBOOK_SCRIPT = /\.(?:sh|mjs|js|ts|py)$/;
export type PlaybookFileKind = "always-on" | "skill" | "script" | "subagent" | "notes";
export interface PlaybookTreeEntry { kind: PlaybookFileKind; /** Repository path once materialised; null when the file is never materialised. */ active: string | null; }
const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The kind a tree path declares and its active path, or null where the surface has no place for it. */
export function playbookTreeEntry(surface: PlaybookSurface, relative: string): PlaybookTreeEntry | null {
    const parts = relative.split("/");
    if (!PLAYBOOK_SURFACES.includes(surface) || parts.length > 6 || parts.some(part => !SEGMENT.test(part) || part === "." || part === "..")) return null;
    if (relative === PLAYBOOK_ALWAYS_ON[surface]) return { kind: "always-on", active: relative };
    if (relative === "NOTES.md" || parts[0] === "notes" && parts.length > 1 && /\.(?:md|txt|json)$/.test(relative)) return { kind: "notes", active: null };
    if (parts[0] === "skills" && parts.length >= 3 && SKILL_NAME.test(parts[1]!)) {
        const active = `${SKILL_ROOT[surface]}/${parts.slice(1).join("/")}`;
        if (parts.length === 3 && parts[2] === "SKILL.md") return { kind: "skill", active };
        if (parts[2] === "scripts" && parts.length >= 4 && PLAYBOOK_SCRIPT.test(relative)) return { kind: "script", active };
        if (parts[2] !== "scripts" && relative.endsWith(".md")) return { kind: "skill", active };
        return null;
    }
    if (parts[0] === "scripts" && parts.length >= 2 && PLAYBOOK_SCRIPT.test(relative)) return { kind: "script", active: `scripts/wringer/${parts.slice(1).join("/")}` };
    if (surface === "claude-code" && parts[0] === "agents" && parts.length === 2 && /^[a-z0-9][a-z0-9-]{0,63}\.md$/.test(parts[1]!)) return { kind: "subagent", active: `.claude/agents/${parts[1]}` };
    return null;
}
/** The tree directory of a manifest path, ending in "/". */
export const playbookTreeDirectory = (manifestPath: string) => manifestPath.slice(0, -"manifest.json".length);
