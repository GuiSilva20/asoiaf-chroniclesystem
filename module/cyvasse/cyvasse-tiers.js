/**
 * From rolls and context to a move quality tier, and from a tier to a move.
 * Pure functions: the Foundry side only supplies the numbers.
 *
 * Pipeline per round (both sides symmetrical):
 *   effective totals -> margin -> passive shift -> skill band
 *   band + stance (bold/measured) -> tier -> pickMove on the scored ladder
 */

import {
    PASSIVE, PRESSURE, SELECTION, SKILL_BANDS, STANCE, STANCE_MARGIN_SCALE, TIER_BY_BAND
} from "./cyvasse-data.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Roll modifier from the state of the board: material lead and a threatened king. */
export function pressureModifier(materialBalance, kingThreatened) {
    const material = clamp(Math.round(materialBalance / 2), -PRESSURE.maxMaterial, PRESSURE.maxMaterial);
    return material + (kingThreatened ? PRESSURE.kingThreatened : 0);
}

/** Shift applied to the margin from the two Warfare passive values. */
export function passiveShift(myPassive, theirPassive) {
    const gap = (myPassive ?? 0) - (theirPassive ?? 0);
    return clamp(Math.round(gap / PASSIVE.step), -PASSIVE.maxShift, PASSIVE.maxShift);
}

export function skillBand(margin) {
    return SKILL_BANDS.find((entry) => margin >= entry.min).band;
}

/**
 * Bold or measured. Temperament is Courage against Cunning; the board pushes
 * a side that is behind towards boldness and one that is ahead towards care.
 */
export function stanceOf({courage = 0, cunning = 0, materialBalance = 0}) {
    const temperament = clamp(courage - cunning, -STANCE.maxTemperament, STANCE.maxTemperament);
    let situation = 0;
    if (materialBalance <= -STANCE.materialPull) situation = 1;
    else if (materialBalance >= STANCE.materialPull) situation = -1;
    return temperament + situation >= STANCE.boldThreshold ? "bold" : "measured";
}

/** Apply the passive floor (experts do not blunder) and ceiling (novices are never masterful). */
function bandWithPassive(band, passive, fumble) {
    if (band === "blunder" && passive >= PASSIVE.floor && !fumble) return "weak";
    if (band === "masterful" && passive <= PASSIVE.ceiling) return "sharp";
    return band;
}

/**
 * @param side   {total, passive, fumble, order, courage, cunning, materialBalance}
 *               `order` is the player's attack/retreat choice; without one
 *               ("auto") the stance is inferred from temperament and the board
 * @param other  the opponent's {total, passive}
 * @returns {margin, band, stance, tier}
 */
export function resolveTier(side, other) {
    const rollMargin = side.total - other.total;
    const raw = rollMargin + passiveShift(side.passive, other.passive);
    const scale = STANCE_MARGIN_SCALE[side.order];
    const margin = scale ? Math.round(raw * (raw >= 0 ? scale.gain : scale.loss)) : raw;
    let band = bandWithPassive(skillBand(margin), side.passive ?? 0, side.fumble);
    // A natural fumble is a blunder whatever the totals say.
    if (side.fumble) band = "blunder";
    // An explicit order already shaped the margin; only "auto" leaves the style to temperament.
    const stance = scale ? "measured" : stanceOf(side);
    return {margin, band, stance, tier: TIER_BY_BAND[band][stance]};
}

/* -------------------------------------------- */
/*  Tier -> move                                */
/* -------------------------------------------- */

const containedScore = (move) => move.score.guard + move.score.gain * SELECTION.containedGreed;

const isKingLoss = (move) => move.score.value <= -1000;

/**
 * Choose a move from a ladder sorted best-first (see scoreMoves).
 * @returns the chosen move, marked `brilliant` when a genius sacrifice pays off
 */
export function pickMove(ladder, tier, rng, options = {}) {
    if (ladder.length === 0) return null;

    // Taking a Dragon in sight is not a matter of style, even when it costs a Dragon of one's own: one left
    // free reaches the King from almost anywhere. Only a blunder lets it pass. Genius sees it in its search.
    if (tier === "contained" || tier === "bold" || tier === "smart") {
        const obvious = ladder.filter((m) => m.score.gain >= SELECTION.obviousGain && m.score.risk <= m.score.gain);
        if (obvious.length > 0) return [...obvious].sort((a, b) => b.score.value - a.score.value)[0];
    }

    switch (tier) {
        case "genius": {
            const candidates = ladder.filter((m) => m.score.deep !== undefined);
            const pool = candidates.length ? candidates : ladder;
            const ranked = [...pool].sort((a, b) => (b.score.deep ?? b.score.value) - (a.score.deep ?? a.score.value)
                || b.score.value - a.score.value);
            // It searches, so it may know better than to take a Dragon; but only for a line that is clearly better.
            const bestDeep = ranked[0].score.deep ?? ranked[0].score.value;
            const obvious = ranked.find((m) => m.score.gain >= SELECTION.obviousGain && m.score.risk <= m.score.gain
                && (m.score.deep ?? m.score.value) >= bestDeep - SELECTION.obviousTolerance);
            return obvious ?? ranked[0];
        }
        case "smart": {
            // Varies between moves it judges equally good, never a clearly worse one.
            const searched = ladder.filter((m) => m.score.deep !== undefined);
            const pool = searched.length ? searched : ladder;
            const ranked = [...pool].sort((a, b) => (b.score.deep ?? b.score.value) - (a.score.deep ?? a.score.value));
            const best = ranked[0].score.deep ?? ranked[0].score.value;
            const near = ranked
                .filter((m) => best - (m.score.deep ?? m.score.value) <= SELECTION.smartTolerance)
                .slice(0, SELECTION.smartWeights.length);
            return near[rng.weighted(SELECTION.smartWeights.slice(0, near.length))];
        }
        case "contained": {
            // Safe but passive: it favours pulling back to its king over winning
            // material, so it seldom loses pieces and seldom makes progress.
            const lowest = Math.min(...ladder.map((m) => m.score.risk));
            const safe = ladder.filter((m) => m.score.risk === lowest);
            const ranked = [...safe]
                .sort((a, b) => containedScore(b) - containedScore(a))
                .slice(0, SELECTION.containedWeights.length);
            return ranked[rng.weighted(SELECTION.containedWeights.slice(0, ranked.length))];
        }
        case "bold": {
            let pool = ladder.filter((m) => m.score.risk <= SELECTION.boldRiskCap && !isKingLoss(m));
            if (pool.length === 0) pool = ladder;
            const ranked = [...pool].sort((a, b) => b.score.aggr - a.score.aggr).slice(0, SELECTION.boldWeights.length);
            return ranked[rng.weighted(SELECTION.boldWeights.slice(0, ranked.length))];
        }
        case "dumb": {
            const canHang = options.dumbCanHangKing ?? SELECTION.dumbCanHangKing;
            let pool = canHang ? ladder : ladder.filter((m) => !isKingLoss(m));
            if (pool.length === 0) pool = ladder;
            const size = Math.max(1, Math.ceil(pool.length * SELECTION.dumbQuartile));
            return rng.pick(pool.slice(-size));
        }
        default:
            throw new Error(`Unknown Cyvasse tier: ${tier}`);
    }
}
