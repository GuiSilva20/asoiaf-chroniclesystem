import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {PIECE_TYPES, WIN_SCORE} from "../../module/cyvasse/cyvasse-data.js";
import {applyMove, createBoard, legalMoves} from "../../module/cyvasse/cyvasse-board.js";
import {
    deepSettings, materialBalance, quiesce, refineDeep, scoreMoves, staticEval
} from "../../module/cyvasse/cyvasse-eval.js";

const piece = (id, side, type, q, r) => ({id, side, type, q, r, moved: false});
const kings = () => [piece("A-k", "A", "king", -5, 0), piece("B-k", "B", "king", 5, 0)];
const board = (pieces) => createBoard([...kings(), ...pieces]);

describe("cyvasse static evaluation", () => {
    it("prefers the side with more material and is symmetric", () => {
        const b = board([piece("A-d", "A", "dragon", -3, 0)]);
        assert.ok(staticEval(b, "A") > 0);
        assert.ok(Math.abs(staticEval(b, "A") + staticEval(b, "B")) < 1e-9);
        assert.equal(materialBalance(b, "A"), PIECE_TYPES.dragon.value);
        assert.equal(materialBalance(b, "B"), -PIECE_TYPES.dragon.value);
    });

    it("treats a missing king as decisive", () => {
        const noBKing = createBoard([piece("A-k", "A", "king", 0, 0)]);
        assert.equal(staticEval(noBKing, "A"), WIN_SCORE);
        assert.equal(staticEval(noBKing, "B"), -WIN_SCORE);
    });

    it("stops the tactical search at depth 0", () => {
        const b = board([piece("A-r", "A", "rabble", 0, 0), piece("B-r", "B", "rabble", 1, 0)]);
        assert.equal(quiesce(b, "A", 0, "A"), staticEval(b, "A"));
    });

    it("sees a capture and the recapture behind it", () => {
        // A rabble takes a rabble but a B spearman stands ready to take it back.
        const b = board([piece("A-r", "A", "rabble", 0, 0), piece("B-r", "B", "rabble", 1, 0), piece("B-s", "B", "spearmen", 2, 0)]);
        const stand = staticEval(b, "A");
        const shallow = quiesce(b, "A", 1, "A");
        const deeper = quiesce(b, "A", 2, "A");
        assert.ok(shallow > stand, "winning a rabble looks good one ply deep");
        assert.ok(deeper < shallow, "the recapture is priced in two plies deep");
    });
});

describe("cyvasse move ladder", () => {
    it("ranks moves best-first and puts a free capture on top", () => {
        // Dragon at (-3,1) reaches the spearmen but not the king at (5,0).
        const b = board([piece("A-d", "A", "dragon", -3, 1), piece("B-e", "B", "spearmen", 1, 0)]);
        const ladder = scoreMoves(b, "A");
        for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i - 1].score.value >= ladder[i].score.value);
        assert.equal(ladder[0].kind, "capture");
        assert.equal(ladder[0].score.gain, 2);
    });

    it("flags a move that leaves a piece hanging as risky", () => {
        const b = board([piece("A-r", "A", "spearmen", 0, 0), piece("B-d", "B", "dragon", 3, 0)]);
        const ladder = scoreMoves(b, "A", legalMoves(b, "A").filter((m) => m.id === "A-r"));
        assert.ok(ladder.every((m) => m.score.risk >= 2), "the dragon can reach the spearman wherever it goes");
    });

    it("counts a defended piece as less of a risk than a loose one", () => {
        const loose = board([piece("A-h", "A", "lightHorse", 0, 0), piece("B-s", "B", "spearmen", 3, 0)]);
        const defended = board([piece("A-h", "A", "lightHorse", 0, 0), piece("A-c", "A", "crossbowmen", -1, 0), piece("B-s", "B", "spearmen", 3, 0)]);
        const stay = (b) => scoreMoves(b, "A", legalMoves(b, "A").filter((m) => m.id === "A-h" && m.to.q === 1 && m.to.r === 0))[0];
        assert.ok(stay(defended).score.risk <= stay(loose).score.risk);
    });
});

describe("cyvasse deep search settings", () => {
    it("searches deeper for smart and genius, and not at all for the rest", () => {
        assert.ok(deepSettings("smart"));
        assert.ok(deepSettings("genius").depth >= deepSettings("smart").depth);
        for (const tier of ["dumb", "contained", "bold"]) assert.equal(deepSettings(tier), null);
    });

    it("gives a genius with high Strategy a deeper search", () => {
        assert.ok(deepSettings("genius", 4).depth > deepSettings("genius", 0).depth);
    });

    it("adds deep scores to the candidates it searched", () => {
        const b = board([piece("A-d", "A", "dragon", -1, 0), piece("B-e", "B", "spearmen", 2, 0)]);
        const ladder = scoreMoves(b, "A");
        refineDeep(b, "A", ladder, {candidates: 3, depth: 2});
        assert.equal(ladder.filter((m) => m.score.deep !== undefined).length, 3);
        assert.equal(applyMove(b, ladder[0]).pieces.length > 0, true);
    });
});
