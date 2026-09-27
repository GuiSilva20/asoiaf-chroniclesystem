import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {RECORD_VERSION, playMatch} from "../../module/cyvasse/cyvasse-match.js";

const profiles = {
    A: {name: "Alys", passive: 12, courage: 0, cunning: 0, strategy: 0},
    B: {name: "Brand", passive: 12, courage: 0, cunning: 0, strategy: 0}
};
const fixedRoller = (totals) => ({side}) => ({total: totals[side]});

describe("cyvasse match", () => {
    it("produces a versioned, self-describing record", async () => {
        const record = await playMatch({
            profiles, roller: fixedRoller({A: 10, B: 10}), options: {seed: 3, maxRounds: 2}
        });
        assert.equal(record.version, RECORD_VERSION);
        assert.equal(record.seed, 3);
        assert.deepEqual(record.names, {A: "Alys", B: "Brand"});
        assert.equal(record.deployment.pieces.length, 38);
        assert.equal(record.deployment.terrain.length, 6);
        assert.ok(record.rounds.length >= 1);
        assert.ok(record.rounds[0].moves.length >= 1);
        assert.ok(record.result.reason);
    });

    it("is deterministic for a seed", async () => {
        const run = () => playMatch({profiles, roller: fixedRoller({A: 12, B: 9}), options: {seed: 11, maxRounds: 6}});
        assert.deepEqual(await run(), await run());
    });

    it("never runs past the round limit", async () => {
        const record = await playMatch({
            profiles, roller: fixedRoller({A: 10, B: 10}), options: {seed: 5, maxRounds: 4}
        });
        assert.ok(record.rounds.length <= 4);
        assert.ok(record.result.rounds <= 4);
    });

    it("lets a far better roller beat a far worse one by taking the king", async () => {
        const record = await playMatch({
            profiles, roller: fixedRoller({A: 30, B: 1}), options: {seed: 21, maxRounds: 60}
        });
        assert.equal(record.result.winner, "A");
        assert.equal(record.result.reason, "king");
        assert.equal(record.rounds[0].sides.A.tier, "genius");
        assert.equal(record.rounds[0].sides.B.tier, "dumb");
    });

    it("turns a natural fumble into a dumb move", async () => {
        const roller = ({side}) => ({total: 30, fumble: side === "B"});
        const record = await playMatch({profiles, roller, options: {seed: 2, maxRounds: 1}});
        assert.equal(record.rounds[0].sides.B.tier, "dumb");
    });

    it("gives the round winner the first move", async () => {
        const record = await playMatch({
            profiles, roller: fixedRoller({A: 5, B: 9}), options: {seed: 4, maxRounds: 1}
        });
        assert.equal(record.rounds[0].first, "B");
        assert.equal(record.rounds[0].moves[0].side, "B");
    });

    describe("live-play hooks", () => {
        const roller = fixedRoller({A: 10, B: 10});

        it("calls onDeploy once, onRound per round and onPly per move, in order", async () => {
            const calls = [];
            const record = await playMatch({
                profiles, roller,
                options: {
                    seed: 6, maxRounds: 3,
                    onDeploy: (rec) => calls.push(["deploy", rec.rounds.length]),
                    onRound: (rec, entry) => calls.push(["round", entry.n, entry.moves.length]),
                    onPly: (rec, entry, move) => calls.push(["ply", entry.n, entry.moves.length, move.side])
                }
            });
            assert.deepEqual(calls[0], ["deploy", 0]);
            assert.deepEqual(calls[1], ["round", 1, 0], "the verdict is announced before any move");
            assert.deepEqual(calls[2].slice(0, 3), ["ply", 1, 1]);
            const plies = record.rounds.reduce((sum, r) => sum + r.moves.length, 0);
            assert.equal(calls.filter((c) => c[0] === "ply").length, plies);
        });

        it("hands the hooks the record while it is still being built", async () => {
            const seen = [];
            await playMatch({
                profiles, roller,
                options: {seed: 6, maxRounds: 2, onPly: (rec) => seen.push(rec.result === null)}
            });
            assert.ok(seen.length > 0);
            assert.ok(seen.slice(0, -1).every(Boolean));
        });

        it("stops the match when a hook answers false", async () => {
            const record = await playMatch({
                profiles, roller,
                options: {seed: 6, maxRounds: 10, onPly: (rec, entry, move) => (entry.n === 2 ? false : undefined)}
            });
            assert.equal(record.result.reason, "aborted");
            assert.equal(record.rounds.length, 2);
        });

        it("waits for an async hook before moving on", async () => {
            const order = [];
            await playMatch({
                profiles, roller,
                options: {
                    seed: 6, maxRounds: 1,
                    onRound: async () => { await new Promise((r) => setTimeout(r, 5)); order.push("hook done"); },
                    onPly: () => { order.push("ply"); }
                }
            });
            assert.equal(order[0], "hook done");
        });

        it("reports the ending with the decisive move", async () => {
            let last = null;
            const record = await playMatch({
                profiles, roller: fixedRoller({A: 30, B: 1}),
                options: {seed: 21, maxRounds: 60, onPly: (rec) => { last = rec.result; }}
            });
            assert.equal(record.result.reason, "king");
            assert.equal(last?.reason, "king");
        });
    });

    describe("orders and the moves that are played", () => {
        const play = (orderA, orderB) => playMatch({
            profiles, roller: ({side}) => ({total: side === "A" ? 12 : 11}),
            options: {seed: 4, maxRounds: 6, chooseOrders: async () => ({A: orderA, B: orderB})}
        });
        const quietProgress = (record, side) => record.rounds.flatMap((r) => r.moves)
            .filter((m) => m.side === side && m.kind === "move")
            .map((m) => (side === "A" ? m.to[1] - m.from[1] : m.from[1] - m.to[1]));

        it("never advances a quiet piece while both sides retreat", async () => {
            const record = await play("retreat", "retreat");
            const progress = [...quietProgress(record, "A"), ...quietProgress(record, "B")];
            assert.ok(progress.length > 0);
            assert.ok(progress.every((p) => p <= 0), `moves went forward: ${progress}`);
        });

        it("never falls back with a quiet piece while both sides attack", async () => {
            const record = await play("attack", "attack");
            const progress = [...quietProgress(record, "A"), ...quietProgress(record, "B")];
            assert.ok(progress.length > 0);
            assert.ok(progress.every((p) => p >= 0), `moves went backward: ${progress}`);
        });
    });

    describe("round modifiers", () => {
        it("hands each side's modifiers to its roller and records them on the round", async () => {
            const seen = [];
            const record = await playMatch({
                profiles,
                roller: ({side, phase, modifiers}) => { seen.push({side, phase, modifiers}); return {total: 10}; },
                options: {
                    seed: 6, maxRounds: 1,
                    roundModifiers: async ({round}) => (round === 1 ? {A: {pool: 1, bonus: 2, flat: 0}, B: {pool: 0, bonus: 0, flat: -4}} : {})
                }
            });
            const round = seen.filter((s) => s.phase === "round");
            assert.deepEqual(round.find((s) => s.side === "A").modifiers, {pool: 1, bonus: 2, flat: 0});
            assert.deepEqual(round.find((s) => s.side === "B").modifiers, {pool: 0, bonus: 0, flat: -4});
            assert.deepEqual(seen.find((s) => s.phase === "deploy").modifiers, undefined, "not for the deployment");
            assert.deepEqual(record.rounds[0].modifiers.B, {pool: 0, bonus: 0, flat: -4});
        });

        it("leaves the round untouched when there is nothing to apply", async () => {
            const record = await playMatch({
                profiles, roller: () => ({total: 10}),
                options: {seed: 6, maxRounds: 1, roundModifiers: async () => ({A: {pool: 0, bonus: 0, flat: 0}, B: {pool: 0, bonus: 0, flat: 0}})}
            });
            assert.equal("modifiers" in record.rounds[0], false);
        });
    });

    describe("attack and retreat orders", () => {
        const play = (order, totals) => playMatch({
            profiles,
            roller: fixedRoller(totals),
            options: {seed: 8, maxRounds: 1, chooseOrders: async () => ({A: order, B: "auto"})}
        });

        it("lets an attack press a good roll home and a retreat hold it back", async () => {
            const totals = {A: 13, B: 5}; // margin +8
            assert.equal((await play("attack", totals)).rounds[0].sides.A.tier, "genius");
            assert.equal((await play("retreat", totals)).rounds[0].sides.A.tier, "smart");
        });

        it("keeps a weak roll cautious whichever way it is played, and never worse than blundering", async () => {
            const totals = {A: 5, B: 10}; // margin -5
            assert.equal((await play("attack", totals)).rounds[0].sides.A.tier, "contained");
            assert.equal((await play("retreat", totals)).rounds[0].sides.A.tier, "contained");
        });

        it("turns a bad round into a blunder only when attacking", async () => {
            const totals = {A: 3, B: 13}; // margin -10
            assert.equal((await play("attack", totals)).rounds[0].sides.A.tier, "dumb");
            assert.equal((await play("retreat", totals)).rounds[0].sides.A.tier, "contained");
        });

        it("aborts the match when the order prompt is cancelled", async () => {
            const record = await playMatch({
                profiles,
                roller: fixedRoller({A: 10, B: 10}),
                options: {seed: 6, maxRounds: 5, chooseOrders: async ({round}) => (round === 2 ? null : {})}
            });
            assert.equal(record.result.reason, "aborted");
            assert.equal(record.result.winner, null);
            assert.equal(record.rounds.length, 1);
        });

        it("asks before every round, keeps standing orders and records them", async () => {
            const asked = [];
            const record = await playMatch({
                profiles,
                roller: fixedRoller({A: 10, B: 10}),
                options: {
                    seed: 6,
                    maxRounds: 3,
                    chooseOrders: async ({round, orders}) => {
                        asked.push({round, orders});
                        return round === 1 ? {A: "attack"} : {};
                    }
                }
            });
            assert.deepEqual(asked.map((a) => a.round), record.rounds.map((r) => r.n));
            assert.equal(asked[1].orders.A, "attack", "the order stands until changed");
            assert.equal(record.rounds[0].orders.A, "attack");
            assert.equal(record.rounds[0].orders.B, "auto");
        });
    });
});
