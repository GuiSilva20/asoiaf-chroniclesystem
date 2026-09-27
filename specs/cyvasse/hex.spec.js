import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {allHexes, distance, hexLabel, inBoard, line, mirror, neighbors} from "../../module/cyvasse/cyvasse-hex.js";

describe("cyvasse hex geometry", () => {
    it("has 91 hexes on a radius 5 board", () => {
        assert.equal(allHexes(5).length, 91);
    });

    it("measures distance in hex steps", () => {
        assert.equal(distance({q: 0, r: 0}, {q: 0, r: 0}), 0);
        assert.equal(distance({q: 0, r: 0}, {q: 1, r: 0}), 1);
        assert.equal(distance({q: 0, r: 0}, {q: 2, r: -1}), 2);
        assert.equal(distance({q: -5, r: 0}, {q: 5, r: 0}), 10);
    });

    it("gives 6 neighbours in the middle and 3 in a corner", () => {
        assert.equal(neighbors(0, 0, 5).length, 6);
        assert.equal(neighbors(5, 0, 5).length, 3);
    });

    it("rejects hexes outside the board", () => {
        assert.equal(inBoard(5, 0, 5), true);
        assert.equal(inBoard(5, 1, 5), false);
        assert.equal(inBoard(0, 6, 5), false);
    });

    it("draws a line whose steps are adjacent and ends on the target", () => {
        const from = {q: -3, r: 0};
        const to = {q: 2, r: 1};
        const hexes = line(from, to);
        assert.equal(hexes.length, distance(from, to));
        assert.deepEqual(hexes.at(-1), to);
        let previous = from;
        for (const hex of hexes) {
            assert.equal(distance(previous, hex), 1);
            previous = hex;
        }
    });

    it("names hexes in column-letter, row-number notation", () => {
        assert.equal(hexLabel(0, 0, 5), "f6");
        assert.equal(hexLabel(-5, 0, 5), "a6");
        assert.equal(hexLabel(5, -5, 5), "k1");
    });

    it("mirrors through the centre", () => {
        assert.deepEqual(mirror({q: 2, r: -3}), {q: -2, r: 3});
    });
});
