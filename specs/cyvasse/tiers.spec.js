import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {
    passiveShift, pickMove, pressureModifier, resolveTier, skillBand, stanceOf
} from "../../module/cyvasse/cyvasse-tiers.js";

/** Passive 12 sits between the floor (20) and the ceiling (8), so it changes nothing. */
const side = (extra = {}) => ({total: 0, passive: 12, fumble: false, courage: 0, cunning: 0, materialBalance: 0, ...extra});
const versus = (margin, extra = {}) => resolveTier(side({total: margin, ...extra}), side({total: 0}));

describe("cyvasse skill bands", () => {
    it("cuts the margin at every band boundary", () => {
        const cases = [[15, "masterful"], [12, "masterful"], [11, "sharp"], [6, "sharp"], [5, "solid"],
            [0, "solid"], [-1, "weak"], [-7, "weak"], [-8, "blunder"], [-30, "blunder"]];
        for (const [margin, band] of cases) assert.equal(skillBand(margin), band, `margin ${margin}`);
    });
});

describe("cyvasse tier table (band x stance, when the character decides)", () => {
    const expected = {
        blunder: {measured: "dumb", bold: "dumb"},
        weak: {measured: "contained", bold: "bold"},
        solid: {measured: "smart", bold: "smart"},
        sharp: {measured: "smart", bold: "bold"},
        masterful: {measured: "genius", bold: "genius"}
    };
    const marginFor = {blunder: -10, weak: -3, solid: 2, sharp: 8, masterful: 15};
    // On auto the stance comes from temperament: Courage over Cunning is bold.
    const temperament = {measured: {cunning: 2}, bold: {courage: 2}};

    for (const [band, byStance] of Object.entries(expected)) {
        for (const [stance, tier] of Object.entries(byStance)) {
            it(`${band} + ${stance} gives ${tier}`, () => {
                const result = versus(marginFor[band], {order: "auto", ...temperament[stance]});
                assert.equal(result.band, band);
                assert.equal(result.tier, tier);
            });
        }
    }
});

describe("cyvasse orders (attack and retreat change what the margin is worth)", () => {
    it("leaves the margin alone on auto", () => {
        assert.equal(versus(8, {order: "auto"}).margin, 8);
        assert.equal(versus(-8, {order: "auto"}).margin, -8);
    });

    it("lets an attack double an advantage but never make a bad round worse", () => {
        assert.equal(versus(4, {order: "attack"}).margin, 8);
        assert.equal(versus(-4, {order: "attack"}).margin, -4);
    });

    it("lets a retreat halve a loss and trim an advantage", () => {
        assert.equal(versus(-8, {order: "retreat"}).margin, -4);
        assert.equal(versus(8, {order: "retreat"}).margin, 6);
    });

    it("turns the same roll into different tiers: attack rewards winning, retreat protects losing", () => {
        assert.equal(versus(7, {order: "attack"}).tier, "genius", "a good win pressed home");
        assert.equal(versus(7, {order: "retreat"}).tier, "smart", "the same win, held back");
        assert.equal(versus(-9, {order: "attack"}).tier, "dumb", "a bad round attacking is a blunder");
        assert.equal(versus(-9, {order: "retreat"}).tier, "contained", "a bad round retreating is only cautious");
    });

    it("makes an explicit order override temperament", () => {
        const brave = versus(-3, {courage: 2, order: "retreat"});
        assert.equal(brave.tier, "contained");
        const careful = versus(-3, {cunning: 2, order: "attack"});
        assert.equal(careful.tier, "contained", "an order is measured play; only auto is bold");
    });

    it("falls back to the inferred stance on auto", () => {
        assert.equal(versus(-3, {courage: 2, order: "auto"}).tier, "bold");
        assert.equal(versus(-3, {cunning: 2, order: "auto"}).tier, "contained");
    });
});

describe("cyvasse passive values and fumbles", () => {
    it("shifts the margin by the passive gap, clamped", () => {
        assert.equal(passiveShift(8, 8), 0);
        assert.equal(passiveShift(12, 8), 1);
        assert.equal(passiveShift(28, 8), 4);
        assert.equal(passiveShift(0, 40), -4);
    });

    it("lets a big passive gap lift an equal roll", () => {
        const strong = resolveTier(side({total: 3, passive: 28}), side({total: 0, passive: 8}));
        assert.equal(strong.margin, 7);
        assert.equal(strong.band, "sharp");
    });

    it("stops an expert blundering unless the roll was a natural fumble", () => {
        const expert = {passive: 20};
        const other = side({total: 0, passive: 20});
        assert.equal(resolveTier(side({total: -10, ...expert}), other).band, "weak");
        assert.equal(resolveTier(side({total: -10, fumble: true, ...expert}), other).band, "blunder");
    });

    it("keeps a novice from reaching masterful on a lucky roll", () => {
        const result = resolveTier(side({total: 15, passive: 8}), side({total: 0, passive: 8}));
        assert.equal(result.band, "sharp");
    });

    it("turns a natural fumble into a blunder whatever the totals", () => {
        assert.equal(versus(15, {fumble: true}).tier, "dumb");
    });
});

describe("cyvasse pressure and stance", () => {
    it("adds material lead as a clamped roll modifier and penalises a threatened king", () => {
        assert.equal(pressureModifier(0, false), 0);
        assert.equal(pressureModifier(4, false), 2);
        assert.equal(pressureModifier(30, false), 3);
        assert.equal(pressureModifier(-30, true), -5);
    });

    it("infers bold from Courage over Cunning and from being behind", () => {
        assert.equal(stanceOf({courage: 2, cunning: 0}), "bold");
        assert.equal(stanceOf({courage: 0, cunning: 2}), "measured");
        assert.equal(stanceOf({courage: 1, cunning: 1, materialBalance: -4}), "bold");
        assert.equal(stanceOf({courage: 1, cunning: 0, materialBalance: 4}), "measured");
    });
});

describe("cyvasse pickMove", () => {
    const move = (id, score) => ({id, score: {gain: 0, risk: 0, value: 0, aggr: 0, guard: 0, ...score}});
    const rng = {weighted: () => 0, pick: (list) => list[0], next: () => 0};
    const ladder = () => [
        move("best", {value: 3, risk: 6, aggr: 4, deep: 1}),
        move("steady", {value: 2, risk: 0, guard: 2, aggr: 0, deep: 2.9}),
        move("greedy", {value: 1, risk: 3, aggr: 9, gain: 3, deep: 0}),
        move("meh", {value: 0, risk: 0, guard: 5}),
        move("worst", {value: -4, risk: 9}),
        move("suicide", {value: -10000, risk: 100})
    ];

    it("returns null for an empty ladder", () => {
        assert.equal(pickMove([], "smart", rng), null);
    });

    it("genius takes the highest deep score, not the highest shallow one", () => {
        assert.equal(pickMove(ladder(), "genius", rng).id, "steady");
    });

    it("smart only chooses among moves near its best deep score", () => {
        // "steady" is far ahead on deep score, so it is the only near-best move.
        const picked = pickMove(ladder(), "smart", {...rng, weighted: (weights) => weights.length - 1});
        assert.equal(picked.id, "steady");
    });

    it("contained picks among the lowest-risk moves, favouring a pull back", () => {
        const picked = pickMove(ladder(), "contained", rng);
        assert.equal(picked.score.risk, 0);
        assert.equal(picked.id, "meh");
    });

    it("bold takes the most aggressive move inside the risk cap", () => {
        assert.equal(pickMove(ladder(), "bold", rng).id, "greedy");
    });

    it("dumb picks from the worst quartile and does not hang the king unless allowed", () => {
        const l = ladder();
        const pickLast = {...rng, pick: (list) => list.at(-1)};
        assert.equal(pickMove(l, "dumb", pickLast).id, "worst");
        assert.equal(pickMove(l, "dumb", pickLast, {dumbCanHangKing: true}).id, "suicide");
    });

    describe("obvious captures", () => {
        const ladder = (extra = {}) => [
            move("take", {gain: 9, risk: 0, value: 4, aggr: 6, guard: 0, ...extra.take}),
            move("safe", {gain: 0, risk: 0, value: 5, aggr: 0, guard: 9}),
            move("trade", {gain: 9, risk: 12, value: -3, aggr: 9, guard: 0})     // a losing trade
        ];

        it("makes the cautious tier take a Dragon in sight rather than tidy up", () => {
            assert.equal(pickMove(ladder(), "contained", rng).id, "take");
        });

        it("makes the bold tier take it too", () => {
            assert.equal(pickMove(ladder(), "bold", rng).id, "take");
        });

        it("takes a Dragon even at the price of a Dragon of one's own", () => {
            const evenTrade = [move("trade", {gain: 12, risk: 12, value: 0, guard: 0}), move("safe", {gain: 0, risk: 0, value: 5, guard: 9})];
            for (const tier of ["contained", "bold", "smart"]) assert.equal(pickMove(evenTrade, tier, rng).id, "trade", tier);
        });

        it("does not call a losing trade obvious, nor a small gain", () => {
            const losing = [move("bad", {gain: 9, risk: 12, value: -3, guard: 0}), move("safe", {gain: 0, risk: 0, value: 5, guard: 9})];
            assert.equal(pickMove(losing, "contained", rng).id, "safe");
            const small = ladder({take: {gain: 3}});
            assert.equal(pickMove(small, "contained", rng).id, "safe");
        });

        it("makes even a deep searcher take the Dragon unless another line is clearly better", () => {
            const close = [move("take", {gain: 12, risk: 12, value: 0, deep: 2}), move("quiet", {gain: 0, risk: 0, value: 4, deep: 4})];
            assert.equal(pickMove(close, "genius", rng).id, "take", "worth 2 less than the best is no reason to pass");
            const clearly = [move("take", {gain: 12, risk: 12, value: 0, deep: 2}), move("quiet", {gain: 0, risk: 0, value: 4, deep: 9})];
            assert.equal(pickMove(clearly, "genius", rng).id, "quiet", "a line worth much more is chosen");
        });

        it("applies to the smart tier as well", () => {
            const smart = [move("take", {gain: 12, risk: 12, value: 1, deep: 1}), move("quiet", {gain: 0, risk: 0, value: 4, deep: 4})];
            assert.equal(pickMove(smart, "smart", rng).id, "take");
        });

        it("lets only a blunder miss it", () => {
            const pickLast = {...rng, pick: (list) => list.at(-1)};
            assert.notEqual(pickMove(ladder(), "dumb", pickLast).id, "take");
        });
    });

    it("rejects an unknown tier", () => {
        assert.throws(() => pickMove(ladder(), "clever", rng));
    });
});
