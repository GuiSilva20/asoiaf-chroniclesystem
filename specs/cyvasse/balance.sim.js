/**
 * Balance harness (run manually: `npm run balance`, optional N as argument).
 * Usage: node balance.sim.js [games] [tier-filter].
 * Plays forced tier against forced tier and prints win rates for A (row tier).
 * Targets: skill ladder orders results, equal tiers stay near 50%, dumb rarely wins.
 */
import {tally} from "./helpers.js";

const games = Number(process.argv[2]) || 60;
const only = process.argv[3]; // optional filter, e.g. "smart" keeps pairs mentioning smart
const pairs = [
    ["genius", "smart"], ["smart", "contained"], ["genius", "contained"],
    ["genius", "dumb"], ["smart", "dumb"], ["contained", "dumb"], ["bold", "dumb"],
    ["smart", "smart"], ["genius", "genius"], ["contained", "contained"],
    ["bold", "contained"], ["bold", "smart"], ["bold", "bold"]
];

for (const [a, b] of pairs.filter((pair) => !only || pair.includes(only))) {
    const r = tally(a, b, games);
    const pct = (n) => `${Math.round((100 * n) / games)}%`;
    console.log(`${a.padEnd(10)} vs ${b.padEnd(10)}  A ${pct(r.A).padStart(4)}  B ${pct(r.B).padStart(4)}  draw ${pct(r.draw).padStart(4)}  rounds ${r.avgRounds.toFixed(1).padStart(5)}  king-ends ${pct(r.kingEnds)}`);
}
