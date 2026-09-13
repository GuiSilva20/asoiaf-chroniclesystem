/**
 * Pure math for weapon damage / critical / fumble resolution. No Foundry
 * documents are read or written here - everything takes plain numbers/arrays
 * in and returns plain values out, so it can be sanity-checked by hand.
 */

/**
 * Numero de Vezes = floor((RollTotal - Defesa) / 5) + 1.
 * Written as three separate statements (subtract, then divide+floor, then
 * +1) on purpose, matching the rulebook's literal step order rather than a
 * single "equivalent" expression a reader might rewrite differently.
 */
export function computeNumeroDeVezes(rollTotal, defense) {
    const difference = rollTotal - defense;
    const divided = Math.floor(difference / 5);
    return divided + 1;
}

/** True when the roll beats the target's Combat Defense by 2x or more. */
export function isCritical(rollTotal, defense) {
    return rollTotal >= 2 * defense;
}

/**
 * A fumble is "every die shows 1". An empty pool (kept <= 0, no dice
 * actually rolled) is never a fumble.
 */
export function isFumble(activeDieResults) {
    return activeDieResults.length > 0 && activeDieResults.every((result) => result === 1);
}

/** Counts active (kept) dice showing the given face. */
export function countFaceAmongActive(activeDieResults, face) {
    return activeDieResults.filter((result) => result === face).length;
}

/** Clamps a table row lookup to the 1-8 range both tables cover. */
export function clampRow(row) {
    return Math.min(8, Math.max(1, row));
}

/**
 * rawDamage: weapon damage x Numero de Vezes, before any bonus/mitigation.
 * mitigated: rawDamage + extraDamage (flat crit bonus) - armorSoak.
 * final: mitigated, floored at 0.
 */
export function computeDamage(weaponDamageValue, numeroDeVezes, armorSoak = 0, extraDamage = 0) {
    const rawDamage = weaponDamageValue * numeroDeVezes;
    const mitigated = rawDamage + extraDamage - armorSoak;
    const final = Math.max(0, mitigated);
    return {rawDamage, mitigated, final};
}
