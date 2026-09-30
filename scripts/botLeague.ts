// Bot league — plays full headless rounds between bot profiles on every
// built-in map and prints a table. How the Extreme profile was picked
// (SPEC §10.3): candidate profiles are registered next to the real ones,
// each pair plays every map from both sides, and the table ranks them by
// rounds won.
//
//   npx tsx scripts/botLeague.ts [seeds=4] [--ff]
//
// `--ff` turns friendly fire on, and the table also counts teamkills.

import { parseMap } from "../src/world/maps/mapFormat";
import { MAP_SOURCES } from "../src/world/maps/mapSources";
import { BOT_PROFILE, type BotProfile } from "../src/game/constants";
import type { TeamId } from "../src/game/config";
import { playRound } from "../tests/helpers";

// Every candidate is built on the shipped profile's numbers (timings, aim),
// with the behaviour flags set per candidate.
const extreme = BOT_PROFILE.extreme;
const teamwork: Partial<BotProfile> = {
  sharesIntel: true, keepsSpacing: true, reactsToApproach: true, firingPositions: true,
};
const off: Partial<BotProfile> = {
  sharesIntel: false, keepsSpacing: false, groupPush: "off", reactsToApproach: false,
  firingPositions: false, ambushesFromForest: false, probesForest: "off",
};

/** The candidates. Each is a full profile; the shipped `extreme` is `core`,
 *  which won the final (SPEC §10.3 has the numbers). */
const VARIANTS: Record<string, BotProfile> = {
  reflex: { ...extreme, ...off },
  team: { ...extreme, ...off, ...teamwork },
  pincer: { ...extreme, ...off, ...teamwork, groupPush: "pincer" },
  column: { ...extreme, ...off, ...teamwork, groupPush: "column" },
  bush: { ...extreme, ...off, ...teamwork, groupPush: "pincer", ambushesFromForest: true, probesForest: "suspects" },
  columnBush: { ...extreme, ...off, ...teamwork, groupPush: "column", ambushesFromForest: true, probesForest: "suspects" },
  // Round two: the ideas that held their own, then each doubtful one on top.
  core: { ...extreme, ...off, sharesIntel: true, keepsSpacing: true, ambushesFromForest: true, probesForest: "suspects" },
  "core+column": { ...extreme, ...off, sharesIntel: true, keepsSpacing: true, ambushesFromForest: true, probesForest: "suspects", groupPush: "column" },
  "core+pincer": { ...extreme, ...off, sharesIntel: true, keepsSpacing: true, ambushesFromForest: true, probesForest: "suspects", groupPush: "pincer" },
  "core+react": { ...extreme, ...off, sharesIntel: true, keepsSpacing: true, ambushesFromForest: true, probesForest: "suspects", reactsToApproach: true, firingPositions: true },
  // Ablation: reflex plus one idea at a time, for a gauntlet against reflex.
  "+intel": { ...extreme, ...off, sharesIntel: true },
  "+spacing": { ...extreme, ...off, keepsSpacing: true },
  "+approach": { ...extreme, ...off, reactsToApproach: true },
  "+firePos": { ...extreme, ...off, firingPositions: true },
  "+pincer": { ...extreme, ...off, groupPush: "pincer" },
  "+column": { ...extreme, ...off, groupPush: "column" },
  "+ambush": { ...extreme, ...off, ambushesFromForest: true },
  "+probe": { ...extreme, ...off, probesForest: "suspects" },
};
for (const [id, p] of Object.entries(VARIANTS)) (BOT_PROFILE as Record<string, BotProfile>)[id] = p;

const args = process.argv.slice(2);
const SEEDS = Number(args.find((a, i) => /^\d+$/.test(a) && !args[i - 1]?.startsWith("--")) ?? 4);
const FF = args.includes("--ff");
// `--only a,b,c` picks the entrants (default: Hard and the full-featured
// candidates); `--vs x` plays each of them against x only — a gauntlet
// rather than a round robin.
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ENTRANTS = opt("--only")?.split(",") ?? ["hard", "reflex", "core", "core+column", "core+pincer", "core+react"];
const VS = opt("--vs");
if (VS && !ENTRANTS.includes(VS)) ENTRANTS.unshift(VS);

function round(mapIdx: number, blue: string, red: string, seed: number) {
  const src = MAP_SOURCES[mapIdx];
  return playRound(parseMap(src.id, src.name, src.template), blue, red, seed, FF);
}

type Row = { wins: number; rounds: number; frags: number; against: number; teamkills: number; flags: number };
const table = new Map<string, Row>(ENTRANTS.map((e) => [e, { wins: 0, rounds: 0, frags: 0, against: 0, teamkills: 0, flags: 0 }]));
const h2h = new Map<string, number>();

const t0 = Date.now();
for (let a = 0; a < ENTRANTS.length; a++) {
  for (let b = a + 1; b < ENTRANTS.length; b++) {
    if (VS && ENTRANTS[a] !== VS && ENTRANTS[b] !== VS) continue;
    for (let m = 0; m < MAP_SOURCES.length; m++) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        for (const [blue, red] of [[ENTRANTS[a], ENTRANTS[b]], [ENTRANTS[b], ENTRANTS[a]]]) {
          const r = round(m, blue, red, seed * 101 + m);
          for (const [team, who, other] of [["blue", blue, red], ["red", red, blue]] as [TeamId, string, string][]) {
            const row = table.get(who)!;
            const opp: TeamId = team === "blue" ? "red" : "blue";
            row.rounds++;
            row.frags += r.frags[team];
            row.against += r.frags[opp];
            row.teamkills += r.teamkills[team];
            if (r.winner === team) {
              row.wins++;
              if (r.how === "flag") row.flags++;
              h2h.set(`${who}>${other}`, (h2h.get(`${who}>${other}`) ?? 0) + 1);
            }
          }
        }
      }
    }
  }
}

const perPair = MAP_SOURCES.length * SEEDS * 2;
console.log(`${SEEDS} seeds x ${MAP_SOURCES.length} maps x 2 sides = ${perPair} rounds per pairing, FF ${FF ? "on" : "off"}, ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
console.log("entrant   win%   rounds  flagWins  K/D    teamkills");
for (const [id, r] of [...table].sort((x, y) => y[1].wins / y[1].rounds - x[1].wins / x[1].rounds)) {
  console.log(
    `${id.padEnd(9)} ${((100 * r.wins) / r.rounds).toFixed(1).padStart(5)}  ${String(r.rounds).padStart(6)}  ${String(r.flags).padStart(8)}  ${(r.frags / Math.max(1, r.against)).toFixed(2).padStart(5)}  ${String(r.teamkills).padStart(9)}`,
  );
}
console.log("\nhead to head (row's wins out of " + perPair + "):");
console.log("          " + ENTRANTS.map((e) => e.slice(0, 6).padStart(7)).join(""));
for (const a of ENTRANTS) {
  console.log(a.padEnd(10) + ENTRANTS.map((b) => (a === b ? "     -" : String(h2h.get(`${a}>${b}`) ?? 0).padStart(6)).padStart(7)).join(""));
}
