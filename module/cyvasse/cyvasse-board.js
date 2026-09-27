/**
 * Cyvasse board state, deployment, move generation and move application.
 * Boards are immutable: applyMove returns a new board. No Foundry globals.
 */

import {
    BOARD_RADIUS, DEPLOY_ORDER, DEPLOY_PROFILES, DEPLOY_PROFILE_BY_TIER, DEPLOY_ROWS, KING_DEPLOY_ROW,
    FORTRESS_CAPTURABLE_BY, PIECE_TYPES, ROSTER, TERRAIN_ROSTER, otherSide
} from "./cyvasse-data.js";
import {allHexes, distance, hexKey, line, mirror, neighbors} from "./cyvasse-hex.js";

/**
 * @param pieces  [{id, side, type, q, r, moved}]
 * @param terrain [{kind: "mountain"|"fortress", side?, q, r}]
 */
export function createBoard(pieces, terrain = [], radius = BOARD_RADIUS) {
    const byHex = new Map();
    for (const piece of pieces) byHex.set(hexKey(piece.q, piece.r), piece);
    const terrainByHex = new Map();
    for (const tile of terrain) terrainByHex.set(hexKey(tile.q, tile.r), tile);
    return {radius, pieces, terrain, byHex, terrainByHex};
}

export const pieceAt = (board, q, r) => board.byHex.get(hexKey(q, r));
export const terrainAt = (board, q, r) => board.terrainByHex.get(hexKey(q, r));
export const piecesOf = (board, side) => board.pieces.filter((piece) => piece.side === side);
export const kingOf = (board, side) => board.pieces.find((p) => p.side === side && p.type === "king");

/** The side whose king is still standing, or null while both live. */
export function winnerByKing(board) {
    const a = kingOf(board, "A");
    const b = kingOf(board, "B");
    if (a && b) return null;
    if (!a && !b) return null;
    return a ? "A" : "B";
}

/* -------------------------------------------- */
/*  Capture rules                               */
/* -------------------------------------------- */

function attackPower(attacker, defender, steps) {
    const spec = PIECE_TYPES[attacker.type];
    let power = spec.power;
    power += spec.bonusVs?.[defender.type] ?? 0;
    if (spec.charge && steps >= spec.charge.minDistance) power += spec.charge.bonus;
    return power;
}

/** Whether `attacker` may capture `defender` after travelling `steps` hexes. */
export function canCapture(board, attacker, defender, steps = 1) {
    if (attacker.side === defender.side) return false;
    const tile = terrainAt(board, defender.q, defender.r);
    if (tile?.kind === "fortress" && tile.side === defender.side) {
        return FORTRESS_CAPTURABLE_BY.includes(attacker.type);
    }
    const spec = PIECE_TYPES[defender.type];
    if (spec.capturableBy) return spec.capturableBy.includes(attacker.type);
    return attackPower(attacker, defender, steps) >= spec.rank;
}

/* -------------------------------------------- */
/*  Move generation                             */
/* -------------------------------------------- */

const hexCache = new Map();
/** allHexes() is hot in move generation, so it is built once per radius. */
function hexesOf(radius) {
    if (!hexCache.has(radius)) hexCache.set(radius, allHexes(radius));
    return hexCache.get(radius);
}

/** An empty hex the piece may stop on. */
function canEnter(board, hex, side, fly) {
    if (pieceAt(board, hex.q, hex.r)) return false;
    const tile = terrainAt(board, hex.q, hex.r);
    if (!tile) return true;
    if (tile.kind === "mountain") return fly;
    return tile.side === side; // an enemy Fortress cannot be entered
}

const makeMove = (kind, piece, to, target = null) => ({
    kind,
    id: piece.id,
    type: piece.type,
    side: piece.side,
    from: {q: piece.q, r: piece.r},
    to: {q: to.q, r: to.r},
    target: target ? {id: target.id, type: target.type} : null
});

function walkMoves(board, piece, spec, out, capturesOnly) {
    const seen = new Set([hexKey(piece.q, piece.r)]);
    let frontier = [piece];
    for (let step = 1; step <= spec.move.range; step++) {
        const next = [];
        for (const from of frontier) {
            for (const hex of neighbors(from.q, from.r, board.radius)) {
                const k = hexKey(hex.q, hex.r);
                if (seen.has(k)) continue;
                seen.add(k);
                const occupant = pieceAt(board, hex.q, hex.r);
                if (occupant) {
                    if (spec.melee && canCapture(board, piece, occupant, step)) {
                        out.push(makeMove("capture", piece, hex, occupant));
                    }
                } else if (canEnter(board, hex, piece.side, false)) {
                    if (!capturesOnly) out.push(makeMove("move", piece, hex));
                    next.push(hex);
                }
            }
        }
        frontier = next;
    }
}

function lineMoves(board, piece, spec, out, capturesOnly) {
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
        for (let step = 1; step <= spec.move.range; step++) {
            const hex = {q: piece.q + dq * step, r: piece.r + dr * step};
            if (distance({q: 0, r: 0}, hex) > board.radius || Math.abs(hex.q) > board.radius
                || Math.abs(hex.r) > board.radius) break;
            const occupant = pieceAt(board, hex.q, hex.r);
            if (occupant) {
                if (spec.melee && canCapture(board, piece, occupant, step)) {
                    out.push(makeMove("capture", piece, hex, occupant));
                }
                break;
            }
            if (!canEnter(board, hex, piece.side, false)) break;
            if (!capturesOnly) out.push(makeMove("move", piece, hex));
        }
    }
}

function flyCaptures(board, piece, spec, out) {
    for (const target of board.pieces) {
        if (target.side === piece.side) continue;
        const d = distance(piece, target);
        if (d >= 1 && d <= spec.move.range && spec.melee && canCapture(board, piece, target, d)) {
            out.push(makeMove("capture", piece, target, target));
        }
    }
}

function flyMoves(board, piece, spec, out, capturesOnly) {
    if (capturesOnly) return flyCaptures(board, piece, spec, out);
    for (const hex of hexesOf(board.radius)) {
        const d = distance(piece, hex);
        if (d < 1 || d > spec.move.range) continue;
        const occupant = pieceAt(board, hex.q, hex.r);
        if (occupant) {
            if (spec.melee && canCapture(board, piece, occupant, d)) {
                out.push(makeMove("capture", piece, hex, occupant));
            }
        } else if (!capturesOnly && canEnter(board, hex, piece.side, true)) {
            out.push(makeMove("move", piece, hex));
        }
    }
}

function lineOfFireClear(board, from, to) {
    return line(from, to).slice(0, -1)
        .every((hex) => terrainAt(board, hex.q, hex.r)?.kind !== "mountain");
}

function rangedMoves(board, piece, spec, out) {
    const {range, arc, setup} = spec.ranged;
    if (setup && piece.moved) return;
    for (const target of board.pieces) {
        if (target.side === piece.side) continue;
        const d = distance(piece, target);
        if (d < 1 || d > range) continue;
        if (!canCapture(board, piece, target, d)) continue;
        if (!arc && !lineOfFireClear(board, piece, target)) continue;
        out.push(makeMove("shoot", piece, target, target));
    }
    if (piece.type === "trebuchet") {
        for (const tile of board.terrain) {
            if (tile.kind !== "fortress" || tile.side === piece.side) continue;
            const d = distance(piece, tile);
            if (d >= 1 && d <= range) out.push(makeMove("raze", piece, tile));
        }
    }
}

function generate(board, side, capturesOnly) {
    const out = [];
    for (const piece of board.pieces) {
        if (piece.side !== side) continue;
        const spec = PIECE_TYPES[piece.type];
        if (spec.move.mode === "walk") walkMoves(board, piece, spec, out, capturesOnly);
        else if (spec.move.mode === "line") lineMoves(board, piece, spec, out, capturesOnly);
        else flyMoves(board, piece, spec, out, capturesOnly);
        if (spec.ranged) rangedMoves(board, piece, spec, out);
    }
    return out;
}

export const legalMoves = (board, side) => generate(board, side, false);
/** Captures, shots and razings only: what the evaluator's tactical search needs. */
export const captureMoves = (board, side) => generate(board, side, true);

/** Whether `side` has a capture that takes the other side's king. */
export function kingThreatened(board, side) {
    return captureMoves(board, otherSide(side)).some((move) => move.target?.type === "king");
}

/* -------------------------------------------- */
/*  Applying a move                             */
/* -------------------------------------------- */

export function applyMove(board, move) {
    const captured = move.target?.id ?? null;
    const moves = move.kind === "move" || move.kind === "capture";
    const pieces = [];
    for (const piece of board.pieces) {
        if (piece.id === captured) continue;
        if (piece.id === move.id) {
            pieces.push(moves ? {...piece, q: move.to.q, r: move.to.r, moved: true} : piece);
        } else if (piece.side === move.side && piece.moved) {
            pieces.push({...piece, moved: false});
        } else {
            pieces.push(piece);
        }
    }
    const terrain = move.kind === "raze"
        ? board.terrain.filter((tile) => !(tile.kind === "fortress" && tile.q === move.to.q && tile.r === move.to.r))
        : board.terrain;
    return createBoard(pieces, terrain, board.radius);
}

/* -------------------------------------------- */
/*  Orders shape the moves                      */
/* -------------------------------------------- */

const forwardOf = (side, hex) => (side === "A" ? hex.r : -hex.r);

/** How many rows a move goes towards the enemy: positive is an advance, negative a fall back. */
export function progressOf(move, side) {
    return forwardOf(side, move.to) - forwardOf(side, move.from);
}

/**
 * The moves a side may choose from under its order for the round.
 *  - Attack: no quiet move backwards. Pieces press forward or hold their row; captures and shots are always open.
 *  - Retreat: no quiet move forwards, and no capture that advances, EXCEPT capturing a threat: a piece
 *    standing in the side's own deployment zone, or any enemy piece that could capture one of its pieces
 *    right now (a Dragon in sight). Falling back is not a reason to leave a threat alone. Shots are always open.
 *  - auto (or no order): everything.
 * If an order would leave nothing to play, the side is not stuck: it may play any legal move.
 */
export function restrictByOrder(board, moves, side, order) {
    if (order !== "attack" && order !== "retreat") return moves;
    const homeLimit = -board.radius + DEPLOY_ROWS - 1;
    const inOwnZone = (hex) => forwardOf(side, hex) <= homeLimit;
    const threats = order === "retreat"
        ? new Set(captureMoves(board, otherSide(side)).map((capture) => capture.id))
        : null;

    const allowed = moves.filter((move) => {
        if (move.kind === "shoot" || move.kind === "raze") return true;
        const progress = progressOf(move, side);
        if (order === "attack") return move.kind === "capture" || progress >= 0;
        if (move.kind === "capture") return progress <= 0 || inOwnZone(move.to) || threats.has(move.target.id);
        return progress <= 0;
    });
    return allowed.length > 0 ? allowed : moves;
}

/** Stable text key of a position, for repetition detection. */
export function positionKey(board, sideToMove) {
    const parts = board.pieces.map((p) => `${p.id}@${p.q},${p.r}`).sort();
    return `${sideToMove}|${parts.join(";")}|${board.terrain.length}`;
}

/* -------------------------------------------- */
/*  Deployment                                  */
/* -------------------------------------------- */

/** Hexes side A may deploy in; side B uses their reflection. */
function deployZone(radius) {
    return allHexes(radius).filter((hex) => hex.r + radius < DEPLOY_ROWS);
}

const lateralOf = (hex) => Math.abs(hex.q + hex.r / 2);

function placementCost(hex, pref, maxLateral, radius) {
    const rowCost = Math.abs(hex.r + radius - pref.row) * 10;
    if (pref.lateral === "center") return rowCost + lateralOf(hex);
    if (pref.lateral === "flank") return rowCost + (maxLateral - lateralOf(hex));
    return rowCost;
}

/**
 * Place one side's army.
 * @param tier   deployment tier: genius/smart/contained/bold pick a profile,
 *               dumb shuffles inside the zone
 * @param noise  extra randomness added to every placement cost (smart plays
 *               the balanced profile with a little slop)
 * @returns {{pieces, terrain}} in board coordinates for `side`
 */
export function deploySide({side, tier, rng, radius = BOARD_RADIUS, noise = 0}) {
    const zone = deployZone(radius);
    const maxLateral = Math.max(...zone.map(lateralOf));
    const profile = DEPLOY_PROFILES[DEPLOY_PROFILE_BY_TIER[tier] ?? "balanced"];
    const free = new Set(zone.map((hex) => hexKey(hex.q, hex.r)));
    const orient = side === "A" ? (hex) => hex : mirror;

    const placeOne = (name) => {
        let best = null;
        let bestCost = Infinity;
        for (const hex of zone) {
            if (!free.has(hexKey(hex.q, hex.r))) continue;
            // Whatever the tier (even a random set-up), the King starts on the back row.
            if (name === "king" && hex.r + radius !== KING_DEPLOY_ROW) continue;
            const base = tier === "dumb" ? 0 : placementCost(hex, profile[name], maxLateral, radius);
            const cost = tier === "dumb" ? rng.next() : base + rng.next() * (noise || 0.4);
            if (cost < bestCost) {
                bestCost = cost;
                best = hex;
            }
        }
        free.delete(hexKey(best.q, best.r));
        return orient(best);
    };

    const pieces = [];
    const terrain = [];
    for (const name of DEPLOY_ORDER) {
        const roster = ROSTER[name] ?? TERRAIN_ROSTER[name] ?? 0;
        for (let n = 1; n <= roster; n++) {
            const hex = placeOne(name);
            if (name in TERRAIN_ROSTER) terrain.push({kind: name, side, q: hex.q, r: hex.r});
            else pieces.push({id: `${side}-${name}-${n}`, side, type: name, q: hex.q, r: hex.r, moved: false});
        }
    }
    return {pieces, terrain};
}
