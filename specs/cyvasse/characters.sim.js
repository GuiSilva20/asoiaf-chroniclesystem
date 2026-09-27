/**
 * Character-strength harness (run manually: `npm run balance:characters [games]`).
 * Plays full matches, with dice and passive values, between characters whose
 * Warfare ratings differ, and prints how often each wins. This is the
 * acceptance check for the whole pipeline: a stronger character should win
 * clearly more often than a weaker one, and equal ones should split evenly.
 */
import {playMatch} from "../../module/cyvasse/cyvasse-match.js";
import {createRng} from "../../module/cyvasse/cyvasse-rng.js";

const games = Number(process.argv[2]) || 24;
const maxRounds = 60;

/** Chronicle System test: roll `pool + bonus` d6, keep the best `pool`, add the modifier. */
function makeRoller(rng, {rating, specialty}) {
    return () => {
        const dice = Array.from({length: rating + specialty}, () => 1 + rng.int(6)).sort((a, b) => b - a);
        const kept = dice.slice(0, rating);
        return {total: kept.reduce((sum, d) => sum + d, 0), fumble: kept.every((d) => d === 1)};
    };
}

const profile = (name, {rating, specialty}) => ({
    name, passive: rating * 4, courage: 1, cunning: 1, strategy: specialty
});

async function versus(a, b, seedBase) {
    const tally = {A: 0, B: 0, draw: 0, king: 0, rounds: 0};
    for (let i = 0; i < games; i++) {
        const seed = seedBase + i;
        const diceRng = createRng(seed * 7 + 1);
        const rollers = {A: makeRoller(diceRng, a), B: makeRoller(diceRng, b)};
        const record = await playMatch({
            profiles: {A: profile("A", a), B: profile("B", b)},
            roller: ({side}) => rollers[side](),
            options: {seed, maxRounds}
        });
        const {winner, reason, rounds} = record.result;
        tally[winner ?? "draw"] += 1;
        if (reason === "king") tally.king += 1;
        tally.rounds += rounds;
    }
    return tally;
}

const cases = [
    [{rating: 4, specialty: 0}, {rating: 4, specialty: 0}],
    [{rating: 5, specialty: 1}, {rating: 3, specialty: 0}],
    [{rating: 6, specialty: 2}, {rating: 2, specialty: 0}],
    [{rating: 3, specialty: 0}, {rating: 5, specialty: 1}]
];

for (const [a, b] of cases) {
    const r = await versus(a, b, 500);
    const pct = (n) => `${Math.round((100 * n) / games)}%`;
    const label = (c) => `Warfare ${c.rating}+${c.specialty}`;
    console.log(`${label(a)} vs ${label(b)}   A ${pct(r.A).padStart(4)}  B ${pct(r.B).padStart(4)}  draw ${pct(r.draw).padStart(4)}  rounds ${(r.rounds / games).toFixed(1).padStart(5)}  king-ends ${pct(r.king)}`);
}
