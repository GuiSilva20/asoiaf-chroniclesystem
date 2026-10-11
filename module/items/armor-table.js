/**
 * Tabela 9-2: Armaduras (A Guerra dos Tronos RPG, cap. 9).
 *
 * Single source of truth for the armor presets offered on the character sheet.
 * `penalty` is stored as a magnitude (the book prints it as "-3"); every
 * consumer must go through armorPenaltyMagnitude() so a value typed with
 * either sign behaves the same.
 */
export const ARMOR_TABLE = Object.freeze([
    {key: "clothes",     rating: 0,  penalty: 0, bulk: 0},
    {key: "robes",       rating: 1,  penalty: 0, bulk: 1},
    {key: "padded",      rating: 1,  penalty: 0, bulk: 0},
    {key: "softLeather", rating: 2,  penalty: 1, bulk: 0},
    {key: "hardLeather", rating: 3,  penalty: 2, bulk: 0},
    {key: "boneOrWood",  rating: 4,  penalty: 3, bulk: 1},
    {key: "ringmail",    rating: 4,  penalty: 2, bulk: 1},
    {key: "hides",       rating: 5,  penalty: 3, bulk: 3},
    {key: "mail",        rating: 5,  penalty: 3, bulk: 2},
    {key: "breastplate", rating: 5,  penalty: 2, bulk: 3},
    {key: "scale",       rating: 6,  penalty: 3, bulk: 2},
    {key: "splint",      rating: 7,  penalty: 3, bulk: 3},
    {key: "brigandine",  rating: 8,  penalty: 4, bulk: 3},
    {key: "halfPlate",   rating: 9,  penalty: 5, bulk: 3},
    {key: "plate",       rating: 10, penalty: 6, bulk: 3}
]);

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** Armor penalty as a non-negative number, whatever sign the user typed. */
export function armorPenaltyMagnitude(penalty) {
    return Math.abs(toInt(penalty));
}

/** Armor value (rating) as a non-negative number. */
export function armorRating(rating) {
    return Math.max(toInt(rating), 0);
}

/** Armor bulk as a non-negative number. */
export function armorBulk(bulk) {
    return Math.max(toInt(bulk), 0);
}

/**
 * Totals for the armors currently worn. The sheet allows a single worn armor,
 * but summing keeps the helper correct if that ever changes.
 */
export function summarizeWornArmor(armors) {
    return armors.reduce((total, armor) => ({
        rating: total.rating + armorRating(armor.system?.rating),
        penalty: total.penalty + armorPenaltyMagnitude(armor.system?.penalty),
        bulk: total.bulk + armorBulk(armor.system?.bulk)
    }), {rating: 0, penalty: 0, bulk: 0});
}
