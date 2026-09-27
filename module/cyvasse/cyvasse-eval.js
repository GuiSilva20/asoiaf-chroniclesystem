/**
 * Board evaluation and the best -> worst move ladder.
 *
 * Every legal move gets:
 *   gain   material it wins immediately
 *   risk   material the opponent's best capture wins afterwards, net of my recapture
 *   value  static eval after the move, the opponent's best capture and my recapture
 *   aggr   how aggressive it is (gain, advance, closing on the enemy king)
 *   guard  how defensive it is (staying close to the own king and fortress)
 * Sorting by `value` gives the ladder the tiers pick from.
 */

import {EVAL, PIECE_TYPES, SELECTION, WIN_SCORE, otherSide} from "./cyvasse-data.js";
import {applyMove, captureMoves, kingOf, legalMoves, terrainAt} from "./cyvasse-board.js";
import {distance} from "./cyvasse-hex.js";

const valueOf = (type) => (type === "king" ? WIN_SCORE : PIECE_TYPES[type].value);

/** Rows travelled towards the enemy home: positive is forward for `side`. */
const forward = (piece) => (piece.side === "A" ? piece.r : -piece.r);

function kingSafety(board, side) {
    const king = kingOf(board, side);
    if (!king) return 0;
    let score = 0;
    for (const piece of board.pieces) {
        if (piece === king || distance(piece, king) > EVAL.kingGuardRadius) continue;
        score += piece.side === side ? EVAL.kingGuard : -EVAL.kingThreat;
    }
    const tile = terrainAt(board, king.q, king.r);
    if (tile?.kind === "fortress" && tile.side === side) score += EVAL.kingOnFortress;
    return score;
}

/** Reward for having pieces close to the enemy king: the reason to make progress. */
function kingHunt(board, side) {
    const target = kingOf(board, otherSide(side));
    if (!target) return 0;
    let score = 0;
    for (const piece of board.pieces) {
        if (piece.side !== side || piece.type === "king") continue;
        score += Math.max(0, EVAL.huntRadius - distance(piece, target)) * EVAL.hunt;
    }
    return score;
}

function materialAndAdvance(board, side) {
    let score = 0;
    for (const piece of board.pieces) {
        if (piece.type === "king") continue;
        const sign = piece.side === side ? 1 : -1;
        const weight = EVAL.advance[piece.type] ?? EVAL.advance.default;
        score += sign * (PIECE_TYPES[piece.type].value + forward(piece) * weight);
    }
    return score;
}

/** Static score for `side`: positive is good. A missing king is decisive. */
export function staticEval(board, side) {
    if (!kingOf(board, side)) return -WIN_SCORE;
    if (!kingOf(board, otherSide(side))) return WIN_SCORE;
    return materialAndAdvance(board, side)
        + kingSafety(board, side) - kingSafety(board, otherSide(side))
        + kingHunt(board, side) - kingHunt(board, otherSide(side));
}

/** Material only (kings ignored): the "who is ahead" figure for pressure and stance. */
export function materialBalance(board, side) {
    let score = 0;
    for (const piece of board.pieces) {
        if (piece.type === "king") continue;
        score += (piece.side === side ? 1 : -1) * PIECE_TYPES[piece.type].value;
    }
    return score;
}

/**
 * Tactical search: from `toMove`, either side may keep capturing for `depth`
 * plies or stand pat. Returns the score for `forSide`. Alpha-beta with the
 * most valuable victims first, and only the best few captures per node, keeps
 * the deep search affordable in a browser.
 */
export function quiesce(board, toMove, depth, forSide, alpha = -Infinity, beta = Infinity) {
    const stand = staticEval(board, forSide);
    if (depth === 0 || Math.abs(stand) >= WIN_SCORE) return stand;
    const captures = captureMoves(board, toMove);
    if (captures.length === 0) return stand;
    captures.sort((a, b) => gainOf(b) - gainOf(a));
    const maximizing = toMove === forSide;
    let best = stand;
    if (maximizing) alpha = Math.max(alpha, best);
    else beta = Math.min(beta, best);
    if (alpha >= beta) return best;
    for (const capture of captures.slice(0, SELECTION.deepBranching)) {
        const score = quiesce(applyMove(board, capture), otherSide(toMove), depth - 1, forSide, alpha, beta);
        if (maximizing) {
            best = Math.max(best, score);
            alpha = Math.max(alpha, best);
        } else {
            best = Math.min(best, score);
            beta = Math.min(beta, best);
        }
        if (alpha >= beta) break;
    }
    return best;
}

function gainOf(move) {
    if (move.kind === "raze") return 1;
    return move.target ? valueOf(move.target.type) : 0;
}

function kingDistanceDelta(board, move, enemyKing) {
    if (!enemyKing) return 0;
    const before = distance(move.from, enemyKing);
    const after = distance(move.to, enemyKing);
    return before - after;
}

/**
 * Score every legal move for `side`.
 * @returns moves with a `score` object, sorted best-first by `value`
 */
export function scoreMoves(board, side, moves = legalMoves(board, side)) {
    const opponent = otherSide(side);
    const enemyKing = kingOf(board, opponent);
    const ownKing = kingOf(board, side);

    const scored = moves.map((move) => {
        const after = applyMove(board, move);
        let value = staticEval(after, side);
        let risk = 0;
        for (const reply of captureMoves(after, opponent)) {
            const victim = reply.target ? valueOf(reply.target.type) : 0;
            const afterReply = applyMove(after, reply);
            // What I get back: my best recapture, or nothing if I decline.
            let settled = staticEval(afterReply, side);
            let recovered = 0;
            for (const recapture of captureMoves(afterReply, side)) {
                settled = Math.max(settled, staticEval(applyMove(afterReply, recapture), side));
                recovered = Math.max(recovered, gainOf(recapture));
            }
            value = Math.min(value, settled);
            risk = Math.max(risk, victim - recovered);
        }
        const gain = gainOf(move);
        const aggr = gain * 2 + kingDistanceDelta(board, move, enemyKing) * 0.3
            + (move.kind === "move" || move.kind === "capture" ? 0.1 : 0);
        const guard = ownKing ? distance(move.from, ownKing) - distance(move.to, ownKing) : 0;
        return {...move, score: {gain, risk, value, aggr, guard}};
    });

    return scored.sort((a, b) => b.score.value - a.score.value);
}

/** Deep-search settings for a tier, or null when the tier plays from the ladder alone. */
export function deepSettings(tier, strategyRating = 0) {
    const base = SELECTION.deepSearch[tier];
    if (!base) return null;
    const deeper = tier === "genius" && strategyRating >= SELECTION.strategyDeepRating;
    return {candidates: base.candidates, depth: deeper ? SELECTION.geniusDepthStrategy : base.depth};
}

/**
 * Re-rank the best ladder moves with a deeper tactical search. Adds
 * `score.deep` and `score.brilliant` to those candidates.
 */
export function refineDeep(board, side, scored, {candidates, depth}) {
    const opponent = otherSide(side);
    for (const move of scored.slice(0, candidates)) {
        move.score.deep = quiesce(applyMove(board, move), opponent, depth, side);
        move.score.brilliant = move.score.risk > move.score.gain
            && move.score.deep - move.score.value >= SELECTION.brilliantMargin;
    }
    return scored;
}
