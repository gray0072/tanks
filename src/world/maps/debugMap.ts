// The debug map (SPEC §3.5) — a tiny 1v1 sandbox for fast local iteration
// under config.DEBUG. Deliberately not in the room-creation picker; loader.ts
// keeps it out of listMaps() but resolves it by id through getMap().

export const DEBUG_MAP_ID = "debug";

export const DEBUG_MAP_TEMPLATE = `
r......*
.##..##.
.R#..#B.
.##..##.
*......b
`;
