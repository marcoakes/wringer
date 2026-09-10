import { expect, test } from "bun:test";
import { VALIDATION_GROUPS, stagesInGroup, validationGroup, validationStages } from "../../../scripts/validate";

test("every validation stage belongs to exactly one CI group, derived from its name, and the groups cover the table", () => {
    for (const platform of ["darwin", "linux"] as const) {
        const stages = validationStages(platform), names = stages.map(([name]) => name);
        expect(new Set(names).size, platform).toBe(names.length);
        const groups = VALIDATION_GROUPS.map(group => stagesInGroup(stages, group).map(([name]) => name));
        for (const name of names) expect(groups.filter(members => members.includes(name)), `${platform}: ${name}`).toHaveLength(1);
        expect(groups.flat().sort(), platform).toEqual([...names].sort());
        for (const members of groups) expect(members.length, platform).toBeGreaterThan(0);
        expect(groups[VALIDATION_GROUPS.indexOf("rehearsals")], platform).toEqual(names.filter(name => name.endsWith("-rehearsal")));
    }
});

test("a stage name that mentions a rehearsal any other way names no group", () => {
    for (const name of ["local-pm-rehearsals", "rehearsal-local-pm", "rehearse-design"]) expect(validationGroup(name), name).toBeNull();
    expect(validationGroup("local-design-rehearsal")).toBe("rehearsals");
    expect(validationGroup("native-check")).toBe("core");
});
