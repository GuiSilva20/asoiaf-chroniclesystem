/**
 * The rules of the minor actions (Bluff, Taunt, Intimidate, Trick, Think, Cheat), kept
 * apart from any dice or Foundry code. The numbers live in MINOR (cyvasse-data.js).
 *
 * Shape of the round, as this module sees it:
 *   - during the orders window a player may use ONE minor action; it is rolled at once against
 *     a passive attribute of the opponent, and a success is remembered as {key, success, rating}
 *   - when the window closes, resolveModifiers() turns the successes and the final orders into
 *     dice modifiers for that round's Warfare rolls
 */

import {MINOR, SIDES, otherSide} from "./cyvasse-data.js";
import {createRng} from "./cyvasse-rng.js";
import {passiveShift, pressureModifier} from "./cyvasse-tiers.js";

export const MINOR_KEYS = Object.keys(MINOR.actions);
export const isMinorKey = (key) => typeof key === "string" && Object.hasOwn(MINOR.actions, key);

export const noMods = () => ({pool: 0, bonus: 0, flat: 0});

function addMods(total, extra = {}) {
    total.pool += extra.pool ?? 0;
    total.bonus += extra.bonus ?? 0;
    total.flat += extra.flat ?? 0;
}

/** The most any roll may gain or lose from minor actions. */
function capMods(mods) {
    return {
        pool: Math.min(mods.pool, MINOR.caps.poolDice),
        bonus: Math.min(mods.bonus, MINOR.caps.bonusDice),
        flat: Math.max(mods.flat, MINOR.caps.flatPenalty)
    };
}

/**
 * What a SUCCESSFUL action does.
 * @param order   the order its player gave this round ("attack" | "retreat" | "auto")
 * @param rating  the player's rating in the specialty rolled (Trick's bonus follows it)
 * @returns {self?, target?, wasted?}: modifiers for the player and for the opponent, or why the
 *          success was wasted (Taunt needs an Attack order, Trick needs any explicit order)
 */
export function effectOf(key, {order = "auto", rating = 0} = {}) {
    const {effect} = MINOR.actions[key];
    if (effect.kind === "debuff") return {target: {flat: effect.flat}};
    if (effect.kind !== "bonus") return {};

    if (effect.needs === "attack" && order !== "attack") return {wasted: "needsAttack"};
    if (effect.needs === "order" && order === "auto") return {wasted: "needsOrder"};
    const bonus = effect.fromRating ? Math.min(rating, MINOR.caps.bonusDice) : (effect.bonusDice ?? 0);
    return {self: {pool: effect.poolDice ?? 0, bonus, flat: 0}};
}

/**
 * Turn the round's successful actions and final orders into roll modifiers.
 * @param actions {A: {key, success, rating} | null, B: ...}
 * @param orders  {A, B}
 * @returns {mods: {A, B}, wasted: [{side, key, reason}]}
 */
export function resolveModifiers(actions, orders) {
    const mods = {A: noMods(), B: noMods()};
    const wasted = [];
    for (const side of SIDES) {
        const used = actions[side];
        if (!used?.success) continue;
        const effect = effectOf(used.key, {order: orders[side], rating: used.rating});
        if (effect.wasted) wasted.push({side, key: used.key, reason: effect.wasted});
        addMods(mods[side], effect.self);
        addMods(mods[otherSide(side)], effect.target);
    }
    return {mods: {A: capMods(mods.A), B: capMods(mods.B)}, wasted};
}

/** The flat penalty the opponent's successful action has already put on `side` this round. */
export function debuffFor(side, actions) {
    const used = actions[otherSide(side)];
    if (!used?.success) return 0;
    return effectOf(used.key).target?.flat ?? 0;
}

/** A test succeeds by reaching the passive value; a natural fumble always fails. */
export const testSucceeds = ({total, fumble = false}, passive) => !fumble && total >= passive;

/** A cheater is caught when the test fails, or by the floor chance even when it succeeds. */
export function cheatCaught({success, random}) {
    return !success || random < MINOR.catchFloor;
}

/**
 * The average of a Chronicle test: roll pool + bonus d6, keep the best (pool - penalty), add the
 * modifier. Estimated by sampling with a fixed seed, so the same formula always gives the same number.
 */
export function expectedTotal({pool = 2, bonus = 0, penalty = 0, modifier = 0}, samples = 3000) {
    const kept = pool - penalty;
    if (kept <= 0) return modifier;
    const rng = createRng(pool * 1009 + bonus * 131 + penalty * 17 + 7);
    let sum = 0;
    for (let i = 0; i < samples; i++) {
        const dice = Array.from({length: Math.max(pool, 1) + bonus}, () => 1 + rng.int(6)).sort((a, b) => b - a);
        sum += dice.slice(0, kept).reduce((total, die) => total + die, 0);
    }
    return sum / samples + modifier;
}

export const otherOrder = (order) => (order === "attack" ? "retreat" : "attack");

/**
 * Which order looks better for a side, from what is known before any dice are rolled: the
 * expected Warfare totals, the passive values and the material on the board. A side that expects
 * to win the round is pulled to Attack (which presses an advantage); one that expects to lose,
 * to Retreat (which limits the damage).
 * @param me,opp   {expected, passive}
 * @param balance  the side's material lead (negative when behind)
 */
export function recommendOrder({me, opp, balance = 0}) {
    const expectedMargin = (me.expected + pressureModifier(balance, false))
        - (opp.expected + pressureModifier(-balance, false))
        + passiveShift(me.passive, opp.passive);
    return {order: expectedMargin > 0 ? "attack" : "retreat", expectedMargin};
}
