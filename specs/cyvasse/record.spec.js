import {describe, it, before} from "node:test";
import assert from "node:assert/strict";
import {playMatch} from "../../module/cyvasse/cyvasse-match.js";
import {replay, validateRecord} from "../../module/cyvasse/cyvasse-record.js";

const profiles = {
    A: {name: "Alys", passive: 12, courage: 0, cunning: 0, strategy: 0},
    B: {name: "Brand", passive: 12, courage: 0, cunning: 0, strategy: 0}
};

describe("cyvasse match record", () => {
    let record;
    before(async () => {
        record = await playMatch({
            profiles, roller: ({side}) => ({total: side === "A" ? 20 : 4}), options: {seed: 9, maxRounds: 8}
        });
    });

    it("validates a record the engine produced, including after a JSON round trip", () => {
        assert.deepEqual(validateRecord(record), {ok: true});
        assert.deepEqual(validateRecord(JSON.parse(JSON.stringify(record))), {ok: true});
    });

    it("rejects malformed or hostile records", () => {
        const clone = () => JSON.parse(JSON.stringify(record));
        const cases = {
            "not an object": null,
            "old version": {...clone(), version: 0},
            "unknown piece type": (() => { const r = clone(); r.deployment.pieces[0].type = "__proto__"; return r; })(),
            "off-board piece": (() => { const r = clone(); r.deployment.pieces[0].q = 99; return r; })(),
            "fractional coordinate": (() => { const r = clone(); r.deployment.pieces[0].r = 0.5; return r; })(),
            "bad move kind": (() => { const r = clone(); r.rounds[0].moves[0].kind = "teleport"; return r; })(),
            "three moves in a round": (() => { const r = clone(); r.rounds[0].moves.push(r.rounds[0].moves[0]); return r; })(),
            "missing result": (() => { const r = clone(); delete r.result; return r; })()
        };
        for (const [label, bad] of Object.entries(cases)) {
            assert.equal(validateRecord(bad).ok, false, label);
        }
    });

    it("accepts an unfinished record only when asked to watch a live match", () => {
        const live = JSON.parse(JSON.stringify(record));
        live.result = null;
        assert.equal(validateRecord(live).ok, false);
        assert.deepEqual(validateRecord(live, {open: true}), {ok: true});
        live.deployment.pieces[0].type = "nope";
        assert.equal(validateRecord(live, {open: true}).ok, false, "open records are still checked");
    });

    it("replays one frame per move plus the deployment", () => {
        const frames = replay(record);
        const moves = record.rounds.reduce((sum, round) => sum + round.moves.length, 0);
        assert.equal(frames.length, moves + 1);
        assert.equal(frames[0].move, null);
        assert.equal(frames[0].board.pieces.length, 38);
    });

    it("replays to the same positions the match played", () => {
        const frames = replay(record);
        const last = frames.at(-1);
        const captures = record.rounds.flatMap((r) => r.moves).filter((m) => m.target).length;
        assert.equal(last.board.pieces.length, 38 - captures);
    });
});
