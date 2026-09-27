/**
 * Match records outlive the match: they sit in chat-message flags and are read
 * back by the board viewer. That is persisted data crossing a trust boundary,
 * so it is validated at runtime before anything renders it, and replayed
 * through the same board rules that produced it.
 */

import {BOARD_RADIUS, MAX_ROUNDS, PIECE_TYPES, SIDES} from "./cyvasse-data.js";
import {applyMove, createBoard} from "./cyvasse-board.js";
import {inBoard} from "./cyvasse-hex.js";
import {isMinorKey} from "./cyvasse-minor.js";
import {RECORD_VERSION} from "./cyvasse-match.js";

const MOVE_KINDS = ["move", "capture", "shoot", "raze"];
const TERRAIN_KINDS = ["mountain", "fortress"];
const MAX_PIECES = 100;
const MAX_MINOR_EVENTS = 300;
const MINOR_ATTRS = ["cunning", "will", "awareness"];
const MINOR_NOTES = ["needsAttack", "needsOrder"];

const isInt = (value) => Number.isInteger(value);
const isHex = (q, r) => isInt(q) && isInt(r) && inBoard(q, r, BOARD_RADIUS);
const isSide = (value) => SIDES.includes(value);
const isHexPair = (pair) => Array.isArray(pair) && pair.length === 2 && isHex(pair[0], pair[1]);

function validPiece(piece) {
    return piece && typeof piece.id === "string" && isSide(piece.side)
        && Object.hasOwn(PIECE_TYPES, piece.type) && isHex(piece.q, piece.r);
}

function validTerrain(tile) {
    return tile && TERRAIN_KINDS.includes(tile.kind) && isHex(tile.q, tile.r)
        && (tile.side === undefined || isSide(tile.side));
}

function validMove(move) {
    return move && isSide(move.side) && typeof move.id === "string" && MOVE_KINDS.includes(move.kind)
        && Object.hasOwn(PIECE_TYPES, move.type) && isHexPair(move.from) && isHexPair(move.to)
        && (move.target === null || (typeof move.target?.id === "string" && Object.hasOwn(PIECE_TYPES, move.target.type)));
}

const isText = (value, max) => typeof value === "string" && value.length <= max;
const isNum = (value) => Number.isFinite(value);

/** What was rolled for a minor action, as kept on its event. Optional, but strictly checked when present. */
function validMinorTest(test) {
    if (test === null || test === undefined) return true;
    return typeof test === "object" && isText(test.ability, 60) && isText(test.specialty, 60)
        && isNum(test.rolled) && isNum(test.kept) && isNum(test.bonus) && isNum(test.modifier)
        && Array.isArray(test.dice) && test.dice.length <= 24
        && test.dice.every((die) => die && isInt(die.value) && typeof die.kept === "boolean");
}

function validMinorEvent(event) {
    return event && isInt(event.round) && event.round >= 0 && isSide(event.side) && isSide(event.target)
        && isMinorKey(event.action) && MINOR_ATTRS.includes(event.attr)
        && isNum(event.passive) && isNum(event.total) && typeof event.success === "boolean"
        && (event.fumble === undefined || typeof event.fumble === "boolean")
        && (event.caught === undefined || typeof event.caught === "boolean")
        && (event.note === undefined || MINOR_NOTES.includes(event.note))
        && validMinorTest(event.test);
}

/**
 * @param options.open accept a match still in progress (`result` is null), as
 *                     received while watching a live match
 * @returns {{ok: boolean, error?: string}}
 */
export function validateRecord(record, {open = false} = {}) {
    if (!record || typeof record !== "object") return {ok: false, error: "not an object"};
    if (record.version !== RECORD_VERSION) return {ok: false, error: "unsupported version"};
    if (!Number.isFinite(record.seed)) return {ok: false, error: "bad seed"};
    if (typeof record.names?.A !== "string" || typeof record.names?.B !== "string") return {ok: false, error: "bad names"};

    const {pieces, terrain} = record.deployment ?? {};
    if (!Array.isArray(pieces) || pieces.length > MAX_PIECES || !pieces.every(validPiece)) return {ok: false, error: "bad pieces"};
    if (!Array.isArray(terrain) || terrain.length > MAX_PIECES || !terrain.every(validTerrain)) return {ok: false, error: "bad terrain"};

    if (!Array.isArray(record.rounds) || record.rounds.length > MAX_ROUNDS) return {ok: false, error: "bad rounds"};
    for (const round of record.rounds) {
        if (!isInt(round?.n) || !Array.isArray(round.moves) || round.moves.length > SIDES.length) return {ok: false, error: "bad round"};
        if (!round.moves.every(validMove)) return {ok: false, error: "bad move"};
    }

    if (record.minor !== undefined
        && !(Array.isArray(record.minor) && record.minor.length <= MAX_MINOR_EVENTS && record.minor.every(validMinorEvent))) {
        return {ok: false, error: "bad minor actions"};
    }

    const result = record.result;
    if (open && result === null) return {ok: true};
    if (!result || (result.winner !== null && !isSide(result.winner)) || typeof result.reason !== "string") {
        return {ok: false, error: "bad result"};
    }
    return {ok: true};
}

/** A stored move back into the {q, r} shape the board rules use. */
export function toBoardMove(move) {
    return {
        kind: move.kind,
        id: move.id,
        type: move.type,
        side: move.side,
        from: {q: move.from[0], r: move.from[1]},
        to: {q: move.to[0], r: move.to[1]},
        target: move.target
    };
}

/**
 * Every position of the match, from the deployment through each move.
 * @returns [{board, round, move}] where frame 0 is the deployment (move null)
 */
export function replay(record) {
    const start = createBoard(
        record.deployment.pieces.map((p) => ({...p, moved: false})),
        record.deployment.terrain
    );
    const frames = [{board: start, round: 0, move: null}];
    let board = start;
    for (const round of record.rounds) {
        for (const move of round.moves) {
            board = applyMove(board, toBoardMove(move));
            frames.push({board, round: round.n, move});
        }
    }
    return frames;
}
