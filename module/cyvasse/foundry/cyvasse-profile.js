/**
 * Bridge between a Chronicle System character and the Foundry-free engine:
 * reads the numbers the engine needs, rolls the character's tests, and answers
 * the minor actions' questions (can this character attempt it, what does the
 * test roll, what is the target's passive value).
 */

import {ChronicleSystem} from "../../system/ChronicleSystem.js";
import {CS_ABILITIES, CS_DEFAULT_ABILITY_RATING, localizedSpecialtyName} from "../../system/csAbilities.js";
import {CSRoll} from "../../rolls/cs-roll.js";
import SystemUtils from "../../utils/systemUtils.js";
import {MINOR} from "../cyvasse-data.js";
import {expectedTotal} from "../cyvasse-minor.js";

/** Ability key (csAbilities.js) -> name in ChronicleSystem.keyConstants. */
const ABILITY_CONSTANT = {
    warfare: "WARFARE", will: "WILL", cunning: "CUNNING", awareness: "AWARENESS",
    deception: "DECEPTION", persuasion: "PERSUASION", thievery: "THIEVERY"
};

const abilityLabel = (key) => SystemUtils.localize(ChronicleSystem.keyConstants[ABILITY_CONSTANT[key]]);
const abilityEntry = (key) => CS_ABILITIES.find((ability) => ability.key === key);

/** Specialties are matched by slug, so the English name works in any language. */
const DEPLOY_SPECIALTY = "Strategy";
const ROUND_SPECIALTY = "Tactics";

function specialtyRating(actor, abilityKey, specialty) {
    const [, found] = actor.getAbilityBySpecialty(abilityLabel(abilityKey), specialty);
    return Number(found?.rating) || 0;
}

/** The passive value of an ability: rating x4 plus the character's own modifier (see CSAbilityItem). */
export function passiveOf(actor, abilityKey) {
    const [ability] = actor.getAbility(abilityLabel(abilityKey));
    const passive = ability?.getCSData().passiveTotal ?? CS_DEFAULT_ABILITY_RATING * 4;
    return Number(passive) || 0;
}

/**
 * What the engine reads from a character: Warfare passive value, Courage
 * against Cunning for temperament, and Strategy for the depth of a genius's play.
 */
export function buildProfile(actor) {
    return {
        name: actor.name,
        passive: passiveOf(actor, "warfare"),
        courage: specialtyRating(actor, "will", "Courage"),
        cunning: actor.getAbilityValue(abilityLabel("cunning")),
        strategy: specialtyRating(actor, "warfare", DEPLOY_SPECIALTY)
    };
}

/** A natural fumble: every die that was kept came up 1. */
function isFumble(roll) {
    const kept = roll.dice[0].results.filter((result) => result.active);
    return kept.length > 0 && kept.every((result) => result.result === 1);
}

/** The test formula the system builds for an ability and specialty, plus any extra dice or flat modifier. */
function testFormula(actor, abilityKey, specialty, {pool = 0, bonus = 0, flat = 0} = {}) {
    const formula = ChronicleSystem.getActorAbilityFormula(actor, abilityLabel(abilityKey), specialty);
    formula.pool += pool;
    formula.bonusDice += bonus;
    formula.modifier += flat;
    return formula;
}

/**
 * Roll a character's test with the normal formula builder, so specialties, penalties, benefits and
 * temporary effects all apply, and say what was rolled. Nothing is posted to chat here.
 * @param mods {pool, bonus, flat}: extra test dice, bonus dice and a flat modifier (a minor action's effect)
 * @returns {total, fumble, detail, test}: `test` names the roll and lists every die, kept or not
 */
export async function rollTest(actor, abilityKey, specialty, mods = {}) {
    const formula = testFormula(actor, abilityKey, specialty, mods);
    const roll = await new CSRoll(specialty, formula).evaluate();

    const test = {
        ability: abilityLabel(abilityKey),
        specialty: localizedSpecialtyName(abilityEntry(abilityKey), specialty),
        rolled: Math.max(Number(formula.pool) || 0, 1) + (Number(formula.bonusDice) || 0),
        kept: Math.max((Number(formula.pool) || 0) - (Number(formula.dicePenalty) || 0), 0),
        bonus: Number(formula.bonusDice) || 0,
        modifier: Number(formula.modifier) || 0,
        dice: []
    };
    if (!roll) return {total: 0, fumble: false, detail: "", test};

    test.dice = roll.dice[0].results
        .map((result) => ({value: result.result, kept: Boolean(result.active)}))
        .sort((a, b) => b.value - a.value);
    const kept = test.dice.filter((die) => die.kept).map((die) => die.value);
    const modifier = roll.terms[2]?.number ?? 0;
    const detail = `${kept.join("+")}${modifier ? ` ${modifier > 0 ? "+" : "-"} ${Math.abs(modifier)}` : ""}`;
    return {total: roll.total, fumble: isFumble(roll), detail, test};
}

/**
 * The engine's roller for two characters. Rolls Warfare with Strategy for the
 * deployment and Tactics for every round; a round's roll also carries the
 * modifiers the minor actions earned (extra dice, a penalty).
 */
export function createRoller(actors) {
    return async ({side, phase, modifiers}) => {
        // Long matches would otherwise hold the browser's main thread.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const specialty = phase === "deploy" ? DEPLOY_SPECIALTY : ROUND_SPECIALTY;
        return rollTest(actors[side], "warfare", specialty, modifiers);
    };
}

/**
 * What LiveMatch needs to run the minor actions, backed by the two characters.
 * The character's level and benefits only decide whether a test succeeds: the
 * effect of a success is fixed (see MINOR in cyvasse-data.js).
 */
export function createMinorProvider(actors) {
    const rating = (side, key) => {
        const action = MINOR.actions[key];
        return specialtyRating(actors[side], action.ability, action.specialty);
    };
    return {
        eligible: (side, key) => rating(side, key) >= MINOR.actions[key].minRating,
        test: async (side, key, {flat = 0} = {}) => {
            const action = MINOR.actions[key];
            const roll = await rollTest(actors[side], action.ability, action.specialty, {flat});
            return {...roll, rating: rating(side, key)};
        },
        passive: (side, attribute) => passiveOf(actors[side], attribute),
        /** The average Warfare roll of the character, for Think's advice. */
        expected: (side) => {
            const formula = testFormula(actors[side], "warfare", ROUND_SPECIALTY);
            return expectedTotal({
                pool: formula.pool, bonus: formula.bonusDice, penalty: formula.dicePenalty, modifier: formula.modifier
            });
        }
    };
}
