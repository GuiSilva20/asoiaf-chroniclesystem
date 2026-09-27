/** Localised text shared by the chat cards, dialogs and the board viewer. */

import SystemUtils from "../../utils/systemUtils.js";
import {BOARD_RADIUS} from "../cyvasse-data.js";
import {hexLabel} from "../cyvasse-hex.js";

/** Localise `CS.cyvasse.<key>`, formatting when placeholders are supplied. */
export function t(key, data) {
    const path = `CS.cyvasse.${key}`;
    return data ? SystemUtils.format(path, data) : SystemUtils.localize(path);
}

/** An ability's name in the active language (`key` as in csAbilities.js, e.g. "deception"). */
export const abilityName = (key) => SystemUtils.localize(`CS.constants.abilities.${key}`);

/** Font Awesome glyph per minor action. */
export const MINOR_ICONS = {
    bluff: "fa-masks-theater", taunt: "fa-bullhorn", intimidate: "fa-hand-fist",
    trick: "fa-wand-magic-sparkles", think: "fa-lightbulb", cheat: "fa-user-secret"
};

export const pieceName = (type) => t(`pieces.${type}`);

/** "f6" style label for a stored [q, r] pair. */
export const pairLabel = (pair) => hexLabel(pair[0], pair[1], BOARD_RADIUS);

/** One-line description of a stored move. */
export function moveText(move) {
    return t(`move.${move.kind}`, {
        piece: pieceName(move.type),
        from: pairLabel(move.from),
        to: pairLabel(move.to),
        target: move.target ? pieceName(move.target.type) : ""
    });
}

/** The line that closes a match, worded for how it ended. */
export function resultText(record) {
    const {winner, reason, rounds} = record.result;
    const name = winner ? record.names[winner] : null;
    switch (reason) {
        case "king":
        case "noMoves":
        case "caught":
            return t(`result.${reason}`, {winner: name});
        case "roundLimit":
        case "repetition":
            return t(`result.${reason}`, {
                rounds,
                winner: name ? t("result.byMaterial", {winner: name}) : t("result.draw")
            });
        default:
            return t("result.aborted");
    }
}
