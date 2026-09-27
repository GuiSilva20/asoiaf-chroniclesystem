/**
 * Single source of truth for every Cyvasse number. Balance is tuned here and
 * nowhere else: the board, move and tier modules only read from this file.
 *
 * Geometry: pointy-top hexes in axial (q, r) coordinates. Side "A" deploys at
 * negative r and advances towards +r; side "B" is its point reflection.
 */

export const SIDES = ["A", "B"];
export const otherSide = (side) => (side === "A" ? "B" : "A");

export const BOARD_RADIUS = 5;
/** Own back rows a side may deploy in (r = -5..-2 for A). */
export const DEPLOY_ROWS = 4;
/**
 * The King always starts on the back row (row 0), whatever the deployment: as in chess, a game
 * does not open with the King in reach. A Dragon flies 6 hexes, so only the back row is safe from
 * an enemy Dragon standing on its own front row. Not a piece rule: it constrains the set-up only.
 */
export const KING_DEPLOY_ROW = 0;
export const MAX_ROUNDS = 120;
/** A position seen this many times ends the match on score. */
export const REPETITION_LIMIT = 3;
/** Material lead that decides a match nobody managed to finish. */
export const DECISIVE_MATERIAL = 3;
/** Score returned when a king is missing. */
export const WIN_SCORE = 10000;

/**
 * Piece stats.
 *  rank         defensive threshold: an attacker needs power >= rank to capture it
 *  power        attack strength (defaults to rank)
 *  value        material value used by the evaluator (king is handled as WIN_SCORE)
 *  move         walk: up to `range` steps through free hexes
 *               line: straight lines up to `range`, path must be clear
 *               fly:  any hex within `range`, ignores blockers
 *  melee        captures by moving onto the target hex
 *  ranged       captures by fire, shooter stays put. `arc` ignores Mountains on the
 *               line; `setup` means it cannot fire the turn after it moved
 *  bonusVs      extra power against a defender type (the counter table)
 *  charge       extra power when the piece travelled at least `minDistance`
 *  capturableBy if present, ONLY these attacker types can capture the piece,
 *               whatever their power
 */
export const PIECE_TYPES = {
    king: {
        rank: 2, power: 2, value: 0,
        move: {mode: "walk", range: 1}, melee: true
    },
    rabble: {
        rank: 1, power: 1, value: 1,
        move: {mode: "walk", range: 1}, melee: true
    },
    spearmen: {
        rank: 2, power: 2, value: 2,
        move: {mode: "walk", range: 1}, melee: true,
        bonusVs: {lightHorse: 4, heavyHorse: 4, elephant: 4}
    },
    crossbowmen: {
        rank: 2, power: 4, value: 3,
        move: {mode: "walk", range: 2}, melee: false,
        ranged: {range: 2, arc: false, setup: false}
    },
    lightHorse: {
        rank: 3, power: 3, value: 3,
        move: {mode: "line", range: 3}, melee: true
    },
    heavyHorse: {
        rank: 5, power: 4, value: 4,
        move: {mode: "line", range: 2}, melee: true,
        charge: {minDistance: 2, bonus: 2}
    },
    elephant: {
        rank: 6, power: 6, value: 6,
        move: {mode: "walk", range: 1}, melee: true,
        capturableBy: ["spearmen", "dragon", "trebuchet"]
    },
    catapult: {
        rank: 4, power: 6, value: 4,
        move: {mode: "walk", range: 1}, melee: false,
        ranged: {range: 3, arc: true, setup: false}
    },
    trebuchet: {
        rank: 5, power: 8, value: 5,
        move: {mode: "walk", range: 1}, melee: false,
        ranged: {range: 4, arc: true, setup: true}
    },
    dragon: {
        // The evaluator's value, not a rule: a Dragon that is not dealt with can reach the King from almost
        // anywhere, so removing one outweighs any other trade.
        rank: 8, power: 8, value: 12,
        move: {mode: "fly", range: 6}, melee: true,
        capturableBy: ["crossbowmen", "dragon"]
    }
};

/** Only the Trebuchet can hurt a piece standing on its own Fortress. */
export const FORTRESS_CAPTURABLE_BY = ["trebuchet"];

export const ROSTER = {
    king: 1, dragon: 2, elephant: 2, heavyHorse: 2, lightHorse: 2,
    crossbowmen: 2, spearmen: 2, catapult: 1, trebuchet: 1, rabble: 4
};
export const TERRAIN_ROSTER = {mountain: 2, fortress: 1};

/** Order in which deployment places things: scarce and important first. */
export const DEPLOY_ORDER = [
    "king", "fortress", "mountain", "dragon", "elephant", "trebuchet", "catapult",
    "heavyHorse", "lightHorse", "crossbowmen", "spearmen", "rabble"
];

/**
 * Deployment profiles. `row` is the preferred depth (0 = back row .. 3 = front
 * row), `lateral` says where along the row: "center", "flank" or "any".
 */
export const DEPLOY_PROFILES = {
    balanced: {
        king: {row: 0, lateral: "center"}, fortress: {row: 0, lateral: "center"},
        mountain: {row: 2, lateral: "flank"}, dragon: {row: 1, lateral: "flank"},
        elephant: {row: 3, lateral: "center"}, trebuchet: {row: 1, lateral: "center"},
        catapult: {row: 1, lateral: "any"}, heavyHorse: {row: 2, lateral: "flank"},
        lightHorse: {row: 2, lateral: "flank"}, crossbowmen: {row: 1, lateral: "any"},
        spearmen: {row: 3, lateral: "flank"}, rabble: {row: 3, lateral: "any"}
    },
    defensive: {
        king: {row: 0, lateral: "center"}, fortress: {row: 0, lateral: "center"},
        mountain: {row: 1, lateral: "center"}, dragon: {row: 0, lateral: "flank"},
        elephant: {row: 2, lateral: "center"}, trebuchet: {row: 0, lateral: "any"},
        catapult: {row: 0, lateral: "any"}, heavyHorse: {row: 1, lateral: "flank"},
        lightHorse: {row: 1, lateral: "flank"}, crossbowmen: {row: 1, lateral: "center"},
        spearmen: {row: 2, lateral: "any"}, rabble: {row: 2, lateral: "any"}
    },
    aggressive: {
        king: {row: 0, lateral: "center"}, fortress: {row: 0, lateral: "center"},
        mountain: {row: 3, lateral: "flank"}, dragon: {row: 3, lateral: "center"},
        elephant: {row: 3, lateral: "center"}, trebuchet: {row: 2, lateral: "center"},
        catapult: {row: 2, lateral: "any"}, heavyHorse: {row: 3, lateral: "flank"},
        lightHorse: {row: 3, lateral: "flank"}, crossbowmen: {row: 2, lateral: "any"},
        spearmen: {row: 3, lateral: "any"}, rabble: {row: 3, lateral: "any"}
    }
};

/** Deployment tier -> profile. Dumb ignores profiles and shuffles. */
export const DEPLOY_PROFILE_BY_TIER = {
    genius: "balanced", smart: "balanced", contained: "defensive", bold: "aggressive"
};

export const TIERS = ["dumb", "contained", "smart", "bold", "genius"];

/**
 * Skill band from the effective margin. Each entry is the LOWEST margin that
 * still belongs to the band; the list is read from the top.
 */
export const SKILL_BANDS = [
    {band: "masterful", min: 12},
    {band: "sharp", min: 6},
    {band: "solid", min: 0},
    {band: "weak", min: -7},
    {band: "blunder", min: -Infinity}
];

/** band -> tier, split by stance. See tiers spec for the full table. */
export const TIER_BY_BAND = {
    blunder: {measured: "dumb", bold: "dumb"},
    weak: {measured: "contained", bold: "bold"},
    solid: {measured: "smart", bold: "smart"},
    sharp: {measured: "smart", bold: "bold"},
    masterful: {measured: "genius", bold: "genius"}
};

export const PASSIVE = {
    /** effective margin shift = clamp(round(passiveGap / step), -maxShift, maxShift) */
    step: 4,
    maxShift: 4,
    /** a Warfare passive at or above this can only blunder on a natural fumble */
    floor: 20,
    /** a Warfare passive at or below this can never reach "masterful" */
    ceiling: 8
};

export const PRESSURE = {
    /** material balance is clamped to +-maxMaterial and added as a roll modifier */
    maxMaterial: 3,
    kingThreatened: -2
};

/** A player's order for a round. "auto" lets the character decide (stance inferred from temperament). */
export const ORDERS = ["attack", "retreat", "auto"];

/**
 * How far the round's margin counts for a side that gave an explicit order, depending on whether
 * it is ahead (gain) or behind (loss). Attack presses an advantage and never makes a bad round
 * worse; Retreat protects a losing side but wastes some of an advantage. So the stronger side is
 * pulled towards Attack and the weaker towards Retreat. Measured with the simulator (equal skill:
 * neither order dominates; a one-level gap: the weaker side does far better retreating).
 * Auto: 1 either way.
 */
export const STANCE_MARGIN_SCALE = {
    attack: {gain: 2, loss: 1},
    retreat: {gain: 0.75, loss: 0.5}
};

export const STANCE = {
    maxTemperament: 2,
    /** material deficit/surplus that pushes towards bold/measured */
    materialPull: 3,
    boldThreshold: 1
};

export const SELECTION = {
    smartWeights: [4, 3, 2],
    /** smart only chooses among moves within this much of its best deep score */
    smartTolerance: 0.5,
    boldWeights: [4, 3, 2],
    containedWeights: [4, 3, 2],
    /** how much a cautious player values winning material against staying home */
    containedGreed: 0.5,
    boldRiskCap: 6,
    dumbQuartile: 0.25,
    dumbCanHangKing: false,
    geniusCandidates: 6,
    /** captures explored per node of the deep search */
    deepBranching: 6,
    /** tactical re-ranking of the best ladder moves: how many, how many plies */
    deepSearch: {
        smart: {candidates: 10, depth: 3},
        genius: {candidates: 16, depth: 4}
    },
    /** depth a genius with enough Strategy searches to instead */
    geniusDepthStrategy: 5,
    /** Strategy specialty rating that unlocks the deeper search */
    strategyDeepRating: 3,
    /**
     * A capture worth at least this much that does not cost more than it wins is OBVIOUS (taking a Dragon
     * in sight, even for a Dragon of one's own). Every tier but the blunderer takes it, and the deep
     * searcher already does: leaving a Dragon free to roam is not a style, it is a mistake only a very
     * low test result explains.
     */
    obviousGain: 6,
    /** The deep searcher passes on an obvious capture only for a line worth more than this much extra. */
    obviousTolerance: 3,
    /** the deep search seeing this much more than the shallow one marks a move "brilliant" */
    brilliantMargin: 1.5
};

export const EVAL = {
    advance: {
        default: 0.04, king: 0, dragon: 0.02, elephant: 0.05, catapult: 0.02,
        trebuchet: 0.02, crossbowmen: 0.03
    },
    kingGuardRadius: 2,
    kingGuard: 0.2,
    kingThreat: 0.3,
    kingOnFortress: 1,
    /** per piece and per hex closer than huntRadius to the enemy king */
    hunt: 0.03,
    huntRadius: 8
};

/**
 * Minor actions: one per player, spent during a round's orders window. Each is a test rolled
 * against a passive attribute of the target (ability rating x4). The character's level and benefits
 * only decide whether the test succeeds; the EFFECT is fixed and capped, so a strong character
 * cannot turn a side action into something bigger than the main choice. Measured with the
 * simulator: a small bonus every round already swings a match, hence the recharge and the caps.
 *
 *  ability/specialty  what is rolled (specialty names as in csAbilities.js)
 *  vs                 the target's passive attribute the test must reach
 *  minRating          specialty bonus dice required to attempt it
 *  effect             what a success does (see cyvasse-minor.js)
 */
export const MINOR = {
    /** After using one, a player waits this many rounds; each player has their own counter. */
    cooldownRounds: 3,
    /** A cheater is caught with at least this chance even when the test succeeds. */
    catchFloor: 0.15,
    /** No roll gains more than this from minor actions, nor loses more than the penalty. */
    caps: {bonusDice: 2, poolDice: 1, flatPenalty: -4},
    actions: {
        bluff: {
            ability: "deception", specialty: "Bluff", vs: "cunning", minRating: 1,
            effect: {kind: "debuff", flat: -4}
        },
        taunt: {
            ability: "persuasion", specialty: "Taunt", vs: "will", minRating: 1,
            effect: {kind: "bonus", bonusDice: 2, needs: "attack"}
        },
        intimidate: {
            ability: "persuasion", specialty: "Intimidate", vs: "will", minRating: 1,
            effect: {kind: "debuff", flat: -4}
        },
        trick: {
            ability: "thievery", specialty: "Sleight of Hand", vs: "awareness", minRating: 1,
            effect: {kind: "bonus", fromRating: true, needs: "order"}
        },
        think: {
            ability: "cunning", specialty: "Logic", vs: "cunning", minRating: 0,
            effect: {kind: "hint"}
        },
        cheat: {
            ability: "thievery", specialty: "Sleight of Hand", vs: "awareness", minRating: 1,
            effect: {kind: "bonus", poolDice: 1, bonusDice: 2}, risky: true
        }
    }
};
