import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {MINOR} from "../../module/cyvasse/cyvasse-data.js";
import {
    MINOR_KEYS, cheatCaught, debuffFor, effectOf, expectedTotal, isMinorKey, otherOrder, recommendOrder,
    resolveModifiers, testSucceeds
} from "../../module/cyvasse/cyvasse-minor.js";

const used = (key, extra = {}) => ({key, success: true, rating: 1, ...extra});

describe("cyvasse minor actions: the list", () => {
    it("has the six actions, each with a test, a passive to beat and a minimum", () => {
        assert.deepEqual([...MINOR_KEYS].sort(), ["bluff", "cheat", "intimidate", "taunt", "think", "trick"]);
        for (const key of MINOR_KEYS) {
            const action = MINOR.actions[key];
            assert.ok(action.ability && action.specialty && action.vs, key);
            assert.ok(["cunning", "will", "awareness"].includes(action.vs), key);
        }
    });

    it("keeps Bluff against Cunning, Taunt and Intimidate against Will, Trick and Cheat against Awareness", () => {
        assert.equal(MINOR.actions.bluff.vs, "cunning");
        assert.equal(MINOR.actions.taunt.vs, "will");
        assert.equal(MINOR.actions.intimidate.vs, "will");
        assert.equal(MINOR.actions.trick.vs, "awareness");
        assert.equal(MINOR.actions.cheat.vs, "awareness");
    });

    it("recognises only real keys", () => {
        assert.equal(isMinorKey("bluff"), true);
        assert.equal(isMinorKey("__proto__"), false);
        assert.equal(isMinorKey("hack"), false);
        assert.equal(isMinorKey(3), false);
    });
});

describe("cyvasse minor actions: what a success does", () => {
    it("Bluff and Intimidate put a penalty on the opponent's roll", () => {
        assert.deepEqual(effectOf("bluff").target, {flat: -4});
        assert.deepEqual(effectOf("intimidate").target, {flat: -4});
    });

    it("Taunt gives bonus dice, but only to an Attack", () => {
        assert.deepEqual(effectOf("taunt", {order: "attack"}).self, {pool: 0, bonus: 2, flat: 0});
        assert.equal(effectOf("taunt", {order: "retreat"}).wasted, "needsAttack");
        assert.equal(effectOf("taunt", {order: "auto"}).wasted, "needsAttack");
    });

    it("Trick gives as many bonus dice as the Sleight of Hand rating, capped, and needs an explicit order", () => {
        assert.equal(effectOf("trick", {order: "attack", rating: 1}).self.bonus, 1);
        assert.equal(effectOf("trick", {order: "retreat", rating: 2}).self.bonus, 2);
        assert.equal(effectOf("trick", {order: "attack", rating: 5}).self.bonus, MINOR.caps.bonusDice);
        assert.equal(effectOf("trick", {order: "auto", rating: 2}).wasted, "needsOrder");
    });

    it("Cheat adds a test die and bonus dice", () => {
        assert.deepEqual(effectOf("cheat", {order: "auto"}).self, {pool: 1, bonus: 2, flat: 0});
    });

    it("Think changes no roll", () => {
        assert.deepEqual(effectOf("think"), {});
    });
});

describe("cyvasse minor actions: the round's modifiers", () => {
    it("applies an opponent's penalty to the target, and a bonus to the actor", () => {
        const {mods} = resolveModifiers({A: used("bluff"), B: used("taunt")}, {A: "auto", B: "attack"});
        assert.deepEqual(mods.B, {pool: 0, bonus: 2, flat: -4}, "B is bluffed and taunted well");
        assert.deepEqual(mods.A, {pool: 0, bonus: 0, flat: 0});
    });

    it("ignores failed actions and reports wasted successes", () => {
        const failed = resolveModifiers({A: used("bluff", {success: false}), B: null}, {A: "auto", B: "auto"});
        assert.deepEqual(failed.mods.B, {pool: 0, bonus: 0, flat: 0});
        const wasted = resolveModifiers({A: used("taunt"), B: null}, {A: "retreat", B: "auto"});
        assert.deepEqual(wasted.wasted, [{side: "A", key: "taunt", reason: "needsAttack"}]);
        assert.deepEqual(wasted.mods.A, {pool: 0, bonus: 0, flat: 0});
    });

    it("never lets minor actions stack past the caps", () => {
        // Two debuffs on one roll (not possible with recharges, but the cap must hold anyway)
        const both = resolveModifiers({A: used("bluff"), B: null}, {A: "auto", B: "auto"});
        assert.ok(both.mods.B.flat >= MINOR.caps.flatPenalty);
        const cheat = resolveModifiers({A: used("cheat"), B: null}, {A: "attack", B: "auto"});
        assert.ok(cheat.mods.A.bonus <= MINOR.caps.bonusDice && cheat.mods.A.pool <= MINOR.caps.poolDice);
    });

    it("reports the penalty already on a side, for a Think roll", () => {
        assert.equal(debuffFor("B", {A: used("bluff"), B: null}), -4);
        assert.equal(debuffFor("B", {A: used("taunt"), B: null}), 0);
        assert.equal(debuffFor("A", {A: used("bluff"), B: null}), 0);
        assert.equal(debuffFor("B", {A: used("bluff", {success: false}), B: null}), 0);
    });
});

describe("cyvasse minor actions: tests and risk", () => {
    it("succeeds on reaching the passive value, and a natural fumble always fails", () => {
        assert.equal(testSucceeds({total: 12}, 12), true);
        assert.equal(testSucceeds({total: 11}, 12), false);
        assert.equal(testSucceeds({total: 30, fumble: true}, 12), false);
    });

    it("catches a cheater whose test failed, and sometimes one whose test succeeded", () => {
        assert.equal(cheatCaught({success: false, random: 0.99}), true);
        assert.equal(cheatCaught({success: true, random: 0.99}), false);
        assert.equal(cheatCaught({success: true, random: MINOR.catchFloor - 0.01}), true, "the floor is real");
    });
});

describe("cyvasse Think: recommending an order", () => {
    it("has a stable expected total that grows with dice and modifier", () => {
        const base = expectedTotal({pool: 4, bonus: 1});
        assert.equal(expectedTotal({pool: 4, bonus: 1}), base, "deterministic");
        assert.ok(expectedTotal({pool: 4, bonus: 2}) > base);
        assert.ok(expectedTotal({pool: 4, bonus: 1, modifier: 3}) > base + 2.9);
        assert.ok(expectedTotal({pool: 4, bonus: 1, penalty: 1}) < base);
        assert.ok(base > 14 && base < 17, `about 16 for a 4+1B test, got ${base}`);
    });

    it("recommends Attack to the side expected to win and Retreat to the other", () => {
        const strong = {expected: 20, passive: 20};
        const weak = {expected: 14, passive: 12};
        assert.equal(recommendOrder({me: strong, opp: weak}).order, "attack");
        assert.equal(recommendOrder({me: weak, opp: strong}).order, "retreat");
    });

    it("lets the board tip an even matchup, and picks Retreat when dead level", () => {
        const level = {expected: 16, passive: 16};
        assert.equal(recommendOrder({me: level, opp: level}).order, "retreat");
        assert.equal(recommendOrder({me: level, opp: level, balance: 6}).order, "attack", "well ahead in material");
        assert.equal(recommendOrder({me: level, opp: level, balance: -6}).order, "retreat");
    });

    it("has an opposite order to be wrong with", () => {
        assert.equal(otherOrder("attack"), "retreat");
        assert.equal(otherOrder("retreat"), "attack");
    });
});
