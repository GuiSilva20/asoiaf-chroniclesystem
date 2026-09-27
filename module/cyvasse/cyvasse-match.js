/**
 * Runs a whole Cyvasse match between two characters and returns a replayable
 * record. Foundry-free: the dice come from an injected `roller`, so tests use
 * a stub and the game is fully deterministic for a given seed.
 *
 * roller({side, phase: "deploy"|"round", round, modifiers?: {pool, bonus, flat}})
 *   -> Promise<{total, fumble?, detail?}> | {total, fumble?, detail?}
 * options.chooseOrders({round, orders, balance}) -> Promise<{A, B} | null> (optional)
 *   asked before every round; each value is "attack" | "retreat" | "auto".
 *   Returning null aborts the match (result.reason "aborted").
 * options.roundModifiers({round, orders}) -> Promise<{A, B} | undefined> (optional)
 *   called after the orders and before the round's rolls; each side's {pool, bonus, flat} is
 *   handed to the roller and kept on the round entry (`entry.modifiers`, only when non-zero).
 * options.onDeploy(record), onRound(record, entry), onPly(record, entry, move): awaited
 *   live-play hooks called as the match unfolds, with the record still being built.
 *   A hook that returns `false` stops the match. The decisive move calls onPly with
 *   `record.result` already set, so a watcher sees the ending with the last move.
 *   Orders stand until changed, so a table can play whole stretches on one order.
 * profiles[side] = {name, passive, courage, cunning, strategy}
 *   passive   Warfare passive value (rating x4 + modifier)
 *   courage   Courage specialty rating, cunning: Cunning ability rating
 *   strategy  Strategy specialty rating (deeper genius search)
 */

import {DECISIVE_MATERIAL, MAX_ROUNDS, REPETITION_LIMIT, SIDES, otherSide} from "./cyvasse-data.js";
import {
    applyMove, createBoard, deploySide, kingThreatened, legalMoves, positionKey, restrictByOrder, winnerByKing
} from "./cyvasse-board.js";
import {deepSettings, materialBalance, refineDeep, scoreMoves} from "./cyvasse-eval.js";
import {pickMove, pressureModifier, resolveTier} from "./cyvasse-tiers.js";
import {createRng} from "./cyvasse-rng.js";

export const RECORD_VERSION = 1;

const hasModifiers = (mods) => Boolean(mods && (mods.pool || mods.bonus || mods.flat));

const slim = (move) => ({
    side: move.side, id: move.id, kind: move.kind, type: move.type,
    from: [move.from.q, move.from.r], to: [move.to.q, move.to.r],
    target: move.target ? {id: move.target.id, type: move.target.type} : null
});

function sideInput(profile, roll, extra = {}) {
    return {
        total: roll.total + (extra.pressure ?? 0),
        fumble: Boolean(roll.fumble),
        passive: profile.passive ?? 0,
        courage: profile.courage ?? 0,
        cunning: profile.cunning ?? 0,
        materialBalance: extra.materialBalance ?? 0,
        order: extra.order ?? "auto"
    };
}

async function deployPhase({profiles, roller, rng, options}) {
    const rolls = {};
    for (const side of SIDES) rolls[side] = await roller({side, phase: "deploy", round: 0});
    const tiers = {};
    const pieces = [];
    const terrain = [];
    for (const side of SIDES) {
        const me = sideInput(profiles[side], rolls[side]);
        const them = sideInput(profiles[otherSide(side)], rolls[otherSide(side)]);
        tiers[side] = resolveTier(me, them);
        const placed = deploySide({
            side, tier: tiers[side].tier, rng, radius: options.radius,
            noise: tiers[side].tier === "smart" ? 1.5 : 0
        });
        pieces.push(...placed.pieces);
        terrain.push(...placed.terrain);
    }
    return {rolls, tiers, pieces, terrain};
}

/** A stalled game goes to whoever is ahead on material; level material is a draw. */
function endByScore(board) {
    const balance = materialBalance(board, "A");
    if (balance >= DECISIVE_MATERIAL) return "A";
    if (balance <= -DECISIVE_MATERIAL) return "B";
    return null;
}

/**
 * @param options {seed, maxRounds, dumbCanHangKing, radius}
 * @returns the match record (see RECORD_VERSION)
 */
export async function playMatch({profiles, roller, options = {}}) {
    const seed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
    const maxRounds = options.maxRounds ?? MAX_ROUNDS;
    const rng = createRng(seed);

    const setup = await deployPhase({profiles, roller, rng, options});
    let board = createBoard(setup.pieces, setup.terrain, options.radius);

    const record = {
        version: RECORD_VERSION,
        seed,
        names: {A: profiles.A.name, B: profiles.B.name},
        deployment: {
            pieces: setup.pieces.map((p) => ({id: p.id, side: p.side, type: p.type, q: p.q, r: p.r})),
            terrain: setup.terrain,
            rolls: setup.rolls,
            tiers: {A: setup.tiers.A, B: setup.tiers.B}
        },
        rounds: [],
        result: null
    };

    const seen = new Map();
    let lastFirst = "B";
    let orders = {A: "auto", B: "auto"};

    /** Awaits a live-play hook; a hook that answers `false` stops the match. */
    const stopped = async (hook, ...args) => (await options[hook]?.(record, ...args)) === false;
    const abort = (rounds) => {
        record.result = {winner: null, reason: "aborted", rounds};
        return record;
    };

    if (await stopped("onDeploy")) return abort(0);

    for (let round = 1; round <= maxRounds; round++) {
        if (options.chooseOrders) {
            const balance = materialBalance(board, "A");
            const chosen = await options.chooseOrders({round, orders, balance});
            if (chosen === null) return abort(round - 1);
            orders = {...orders, ...chosen};
        }
        const pressure = {};
        const rolls = {};
        const inputs = {};
        const modifiers = (await options.roundModifiers?.({round, orders})) ?? {};
        for (const side of SIDES) {
            const balance = materialBalance(board, side);
            pressure[side] = pressureModifier(balance, kingThreatened(board, side));
            rolls[side] = await roller({side, phase: "round", round, modifiers: modifiers[side]});
            inputs[side] = sideInput(profiles[side], rolls[side], {pressure: pressure[side], materialBalance: balance, order: orders[side]});
        }

        const resolved = {};
        for (const side of SIDES) resolved[side] = resolveTier(inputs[side], inputs[otherSide(side)]);

        let first;
        if (inputs.A.total !== inputs.B.total) first = inputs.A.total > inputs.B.total ? "A" : "B";
        else first = otherSide(lastFirst);
        lastFirst = first;

        const entry = {
            n: round,
            first,
            orders: {...orders},
            ...(SIDES.some((side) => hasModifiers(modifiers[side])) ? {modifiers: {A: hasModifiers(modifiers.A) ? modifiers.A : null, B: hasModifiers(modifiers.B) ? modifiers.B : null}} : {}),
            rolls: {A: {...rolls.A, pressure: pressure.A}, B: {...rolls.B, pressure: pressure.B}},
            sides: resolved,
            moves: []
        };
        record.rounds.push(entry);
        if (await stopped("onRound", entry)) return abort(round - 1);

        for (const side of [first, otherSide(first)]) {
            const moves = legalMoves(board, side);
            if (moves.length === 0) {
                record.result = {winner: otherSide(side), reason: "noMoves", rounds: round};
                return record;
            }
            // The round's order limits what the side may do: an Attack does not fall back, a Retreat does not advance.
            const ladder = scoreMoves(board, side, restrictByOrder(board, moves, side, orders[side]));
            const {tier} = resolved[side];
            const deep = deepSettings(tier, profiles[side].strategy ?? 0);
            if (deep) refineDeep(board, side, ladder, deep);
            const chosen = pickMove(ladder, tier, rng, {dumbCanHangKing: options.dumbCanHangKing});
            board = applyMove(board, chosen);
            const played = {...slim(chosen), tier, brilliant: Boolean(chosen.score.brilliant)};
            entry.moves.push(played);

            const winner = winnerByKing(board);
            if (winner) {
                record.result = {winner, reason: "king", rounds: round};
                await options.onPly?.(record, entry, played);
                return record;
            }
            if (await stopped("onPly", entry, played)) return abort(round);
        }

        const key = positionKey(board, first);
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        if (count >= REPETITION_LIMIT) {
            record.result = {winner: endByScore(board), reason: "repetition", rounds: round};
            return record;
        }
    }

    record.result = {winner: endByScore(board), reason: "roundLimit", rounds: maxRounds};
    return record;
}
