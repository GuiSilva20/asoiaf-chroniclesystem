/**
 * Shared spec helpers: a dice-free game driver that forces each side's tier,
 * so the move-quality ladder can be measured on its own.
 */
import {DECISIVE_MATERIAL, MAX_ROUNDS, otherSide} from "../../module/cyvasse/cyvasse-data.js";
import {applyMove, createBoard, deploySide, legalMoves, winnerByKing} from "../../module/cyvasse/cyvasse-board.js";
import {deepSettings, materialBalance, refineDeep, scoreMoves} from "../../module/cyvasse/cyvasse-eval.js";
import {pickMove} from "../../module/cyvasse/cyvasse-tiers.js";
import {createRng} from "../../module/cyvasse/cyvasse-rng.js";

/** @returns {{winner: "A"|"B"|null, rounds: number, reason: string}} */
export function playForcedTiers(tierA, tierB, seed, maxRounds = MAX_ROUNDS) {
    const rng = createRng(seed);
    const tiers = {A: tierA, B: tierB};
    const a = deploySide({side: "A", tier: tierA, rng});
    const b = deploySide({side: "B", tier: tierB, rng});
    let board = createBoard([...a.pieces, ...b.pieces], [...a.terrain, ...b.terrain]);
    const first = seed % 2 === 0 ? "A" : "B";

    for (let round = 1; round <= maxRounds; round++) {
        for (const side of [first, otherSide(first)]) {
            const moves = legalMoves(board, side);
            if (moves.length === 0) return {winner: otherSide(side), rounds: round, reason: "noMoves"};
            const ladder = scoreMoves(board, side, moves);
            const deep = deepSettings(tiers[side]);
            if (deep) refineDeep(board, side, ladder, deep);
            board = applyMove(board, pickMove(ladder, tiers[side], rng));
            const winner = winnerByKing(board);
            if (winner) return {winner, rounds: round, reason: "king"};
        }
    }
    const balance = materialBalance(board, "A");
    const winner = balance >= DECISIVE_MATERIAL ? "A" : balance <= -DECISIVE_MATERIAL ? "B" : null;
    return {winner, rounds: maxRounds, reason: "roundLimit"};
}

export function tally(tierA, tierB, games, seedBase = 1000) {
    const out = {A: 0, B: 0, draw: 0, rounds: 0, kingEnds: 0};
    for (let i = 0; i < games; i++) {
        const result = playForcedTiers(tierA, tierB, seedBase + i);
        if (result.winner) out[result.winner] += 1; else out.draw += 1;
        out.rounds += result.rounds;
        if (result.reason === "king") out.kingEnds += 1;
    }
    out.avgRounds = out.rounds / games;
    return out;
}
