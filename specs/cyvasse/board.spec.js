import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {BOARD_RADIUS, DEPLOY_ROWS, ROSTER, TERRAIN_ROSTER} from "../../module/cyvasse/cyvasse-data.js";
import {
    applyMove, canCapture, captureMoves, createBoard, deploySide, kingThreatened, legalMoves, pieceAt, progressOf,
    restrictByOrder, winnerByKing
} from "../../module/cyvasse/cyvasse-board.js";
import {createRng} from "../../module/cyvasse/cyvasse-rng.js";

const piece = (id, side, type, q, r, moved = false) => ({id, side, type, q, r, moved});
const mountain = (q, r) => ({kind: "mountain", q, r});
const fortress = (side, q, r) => ({kind: "fortress", side, q, r});
const kings = () => [piece("A-k", "A", "king", -5, 0), piece("B-k", "B", "king", 5, 0)];
const board = (pieces, terrain = []) => createBoard([...kings(), ...pieces], terrain);
const movesOf = (b, side, id) => legalMoves(b, side).filter((m) => m.id === id);
const targets = (moves) => moves.map((m) => `${m.to.q},${m.to.r}`).sort();

describe("cyvasse movement", () => {
    it("lets a rabble step to any free neighbour", () => {
        const b = board([piece("A-r", "A", "rabble", 0, 0)]);
        assert.equal(movesOf(b, "A", "A-r").length, 6);
    });

    it("stops walkers at mountains but lets a dragon fly over and land on one", () => {
        const b = board(
            [piece("A-r", "A", "rabble", 0, 0), piece("A-d", "A", "dragon", 0, 1)],
            [mountain(1, 0)]
        );
        assert.ok(!targets(movesOf(b, "A", "A-r")).includes("1,0"));
        assert.ok(targets(movesOf(b, "A", "A-d")).includes("1,0"));
    });

    it("stops line movers at the first blocker", () => {
        const b = board([piece("A-h", "A", "lightHorse", 0, 0), piece("A-r", "A", "rabble", 2, 0)]);
        const eastward = movesOf(b, "A", "A-h").filter((m) => m.to.r === 0 && m.to.q > 0);
        assert.deepEqual(targets(eastward), ["1,0"]);
    });

    it("lets a dragon fly six hexes but not seven", () => {
        const b = board([piece("A-d", "A", "dragon", -3, 0)]);
        const distances = movesOf(b, "A", "A-d").map((m) => {
            const dq = m.to.q - m.from.q;
            const dr = m.to.r - m.from.r;
            return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        });
        assert.equal(Math.max(...distances), 6);
    });
});

describe("cyvasse capture rules (the counter table)", () => {
    const base = (attackerType, defenderType, steps = 1) => {
        const b = board([piece("A-x", "A", attackerType, 0, 0), piece("B-x", "B", defenderType, 1, 0)]);
        return canCapture(b, pieceAt(b, 0, 0), pieceAt(b, 1, 0), steps);
    };

    it("lets spearmen kill horses and elephants but a rabble cannot kill a king", () => {
        assert.equal(base("spearmen", "heavyHorse"), true);
        assert.equal(base("spearmen", "elephant"), true);
        assert.equal(base("rabble", "king"), false);
        assert.equal(base("spearmen", "king"), true);
    });

    it("protects elephants: only spearmen, dragons and trebuchets can take them", () => {
        assert.equal(base("lightHorse", "elephant"), false);
        assert.equal(base("heavyHorse", "elephant"), false);
        assert.equal(base("crossbowmen", "elephant"), false);
        assert.equal(base("dragon", "elephant"), true);
        assert.equal(base("trebuchet", "elephant"), true);
    });

    it("lets only crossbowmen and dragons take a dragon", () => {
        assert.equal(base("dragon", "dragon"), true);
        assert.equal(base("crossbowmen", "dragon"), true);
        assert.equal(base("catapult", "dragon"), false);
        assert.equal(base("elephant", "dragon"), false);
    });

    it("gives a heavy horse the run-up bonus only when it travels far enough", () => {
        assert.equal(base("heavyHorse", "heavyHorse", 1), false);
        assert.equal(base("heavyHorse", "heavyHorse", 2), true);
    });

    it("never captures a friendly piece", () => {
        const b = board([piece("A-x", "A", "dragon", 0, 0), piece("A-y", "A", "rabble", 1, 0)]);
        assert.equal(canCapture(b, pieceAt(b, 0, 0), pieceAt(b, 1, 0)), false);
    });
});

describe("cyvasse ranged pieces", () => {
    it("blocks crossbow bolts with a mountain but lets a catapult arc over it", () => {
        const pieces = [piece("A-c", "A", "crossbowmen", 0, 0), piece("B-r", "B", "rabble", 2, 0)];
        assert.equal(captureMoves(board(pieces, [mountain(1, 0)]), "A").length, 0);
        assert.equal(captureMoves(board(pieces), "A").length, 1);

        const cat = board([piece("A-c", "A", "catapult", 0, 0), piece("B-r", "B", "rabble", 3, 0)], [mountain(1, 0)]);
        assert.equal(captureMoves(cat, "A").length, 1);
    });

    it("shoots without moving the shooter", () => {
        const b = board([piece("A-c", "A", "crossbowmen", 0, 0), piece("B-r", "B", "rabble", 2, 0)]);
        const shot = captureMoves(b, "A")[0];
        const after = applyMove(b, shot);
        assert.equal(shot.kind, "shoot");
        assert.equal(pieceAt(after, 0, 0).id, "A-c");
        assert.equal(pieceAt(after, 2, 0), undefined);
    });

    it("cannot fire a trebuchet the turn after it moved", () => {
        const fresh = board([piece("A-t", "A", "trebuchet", 0, 0, true), piece("B-r", "B", "rabble", 3, 0)]);
        assert.equal(captureMoves(fresh, "A").length, 0);
        const ready = board([piece("A-t", "A", "trebuchet", 0, 0, false), piece("B-r", "B", "rabble", 3, 0)]);
        assert.equal(captureMoves(ready, "A").length, 1);
    });
});

describe("cyvasse fortress", () => {
    it("shields the occupant from everything except a trebuchet", () => {
        const b = board(
            [piece("B-e", "B", "rabble", 1, 0), piece("A-d", "A", "dragon", 0, 0), piece("A-t", "A", "trebuchet", -2, 0)],
            [fortress("B", 1, 0)]
        );
        assert.equal(canCapture(b, pieceAt(b, 0, 0), pieceAt(b, 1, 0), 1), false);
        assert.equal(canCapture(b, pieceAt(b, -2, 0), pieceAt(b, 1, 0), 3), true);
    });

    it("cannot be entered by the enemy, and can be razed by a trebuchet", () => {
        const b = board([piece("A-r", "A", "rabble", 0, 0), piece("A-t", "A", "trebuchet", -2, 0)], [fortress("B", 1, 0)]);
        assert.ok(!targets(movesOf(b, "A", "A-r")).includes("1,0"));
        const raze = movesOf(b, "A", "A-t").find((m) => m.kind === "raze");
        assert.ok(raze);
        assert.equal(applyMove(b, raze).terrain.length, 0);
    });
});

describe("cyvasse applying moves", () => {
    it("removes the captured piece and marks the mover as moved", () => {
        const b = board([piece("A-s", "A", "spearmen", 0, 0), piece("B-h", "B", "heavyHorse", 1, 0)]);
        const move = legalMoves(b, "A").find((m) => m.kind === "capture");
        const after = applyMove(b, move);
        assert.equal(pieceAt(after, 1, 0).id, "A-s");
        assert.equal(pieceAt(after, 1, 0).moved, true);
        assert.equal(after.pieces.some((p) => p.id === "B-h"), false);
        assert.equal(b.pieces.some((p) => p.id === "B-h"), true, "original board is untouched");
    });

    it("declares the winner when a king falls", () => {
        const b = createBoard([piece("A-k", "A", "king", 0, 0), piece("B-k", "B", "king", 1, 0)]);
        assert.equal(winnerByKing(b), null);
        const take = legalMoves(b, "A").find((m) => m.kind === "capture");
        assert.equal(winnerByKing(applyMove(b, take)), "A");
    });

    it("detects a threatened king", () => {
        const b = createBoard([piece("A-k", "A", "king", 0, 0), piece("B-k", "B", "king", 5, 0), piece("B-d", "B", "dragon", 3, 0)]);
        assert.equal(kingThreatened(b, "A"), true);
        assert.equal(kingThreatened(b, "B"), false);
    });
});

describe("cyvasse orders shape the moves", () => {
    // A advances towards +r and B towards -r. A dragon in the middle has moves in every direction.
    const quiet = (moves) => moves.filter((m) => m.kind === "move");

    it("measures progress towards the enemy for each side", () => {
        const step = {from: {q: 0, r: 0}, to: {q: 0, r: 2}};
        assert.equal(progressOf(step, "A"), 2);
        assert.equal(progressOf(step, "B"), -2);
    });

    it("stops an Attack from falling back, but not from capturing or shooting backwards", () => {
        const b = board([piece("A-d", "A", "dragon", 0, 0), piece("B-r", "B", "rabble", 0, -2), piece("B-s", "B", "rabble", 1, 1)]);
        const all = legalMoves(b, "A");
        const attack = restrictByOrder(b, all, "A", "attack");
        assert.ok(quiet(all).some((m) => progressOf(m, "A") < 0), "there are backward moves to remove");
        assert.ok(quiet(attack).every((m) => progressOf(m, "A") >= 0), "an Attack never falls back");
        assert.ok(attack.some((m) => m.kind === "capture" && m.target.id === "B-r"), "a capture behind is still open");
        assert.ok(attack.length < all.length);
    });

    it("stops a Retreat from advancing, quietly or by capture", () => {
        const b = board([piece("A-d", "A", "dragon", 0, -1), piece("B-r", "B", "rabble", 0, 2)]);
        const retreat = restrictByOrder(b, legalMoves(b, "A"), "A", "retreat");
        assert.ok(quiet(retreat).every((m) => progressOf(m, "A") <= 0), "a Retreat never advances");
        assert.equal(retreat.some((m) => m.kind === "capture"), false, "the rabble stands ahead: taking it would advance");
    });

    it("lets a Retreat defend home: capturing an intruder in its own zone is not advancing", () => {
        // A's zone is r <= -2. The intruder stands at r = -3; A's dragon waits on the back row (r = -5).
        const b = board([piece("A-d", "A", "dragon", 0, -5), piece("B-r", "B", "rabble", 1, -3)]);
        const retreat = restrictByOrder(b, legalMoves(b, "A"), "A", "retreat");
        assert.ok(retreat.some((m) => m.kind === "capture" && m.target.id === "B-r"));
    });

    it("lets a Retreat take a threat in sight, but not chase a harmless piece", () => {
        // B's dragon at (0,1) can reach A's King at (-5,0): a threat, though taking it means advancing.
        // B's rabble at (2,-1) threatens nothing.
        const b = board([piece("A-d", "A", "dragon", 0, -4), piece("B-d", "B", "dragon", 0, 1), piece("B-r", "B", "rabble", 2, -1)]);
        const retreat = restrictByOrder(b, legalMoves(b, "A"), "A", "retreat");
        const takes = retreat.filter((m) => m.kind === "capture" && m.id === "A-d").map((m) => m.target.id);
        assert.ok(takes.includes("B-d"), "the Dragon in sight can be taken");
        assert.equal(takes.includes("B-r"), false, "a harmless piece ahead is not worth advancing for");
    });

    it("keeps shots open under either order", () => {
        const b = board([piece("A-c", "A", "crossbowmen", 0, 0), piece("B-r", "B", "rabble", 0, 2)]);
        for (const order of ["attack", "retreat"]) {
            assert.ok(restrictByOrder(b, legalMoves(b, "A"), "A", order).some((m) => m.kind === "shoot"), order);
        }
    });

    it("leaves everything open on auto, and never leaves a side with nothing to play", () => {
        const b = board([piece("A-d", "A", "dragon", 0, 0)]);
        const all = legalMoves(b, "A");
        assert.equal(restrictByOrder(b, all, "A", "auto"), all);
        assert.equal(restrictByOrder(b, all, "A", undefined), all);
        // a lone King on the last row can only step sideways or back: an Attack would leave nothing, so all is allowed
        const cornered = createBoard([piece("A-k", "A", "king", 0, 5), piece("B-k", "B", "king", 5, -5)]);
        const kingMoves = legalMoves(cornered, "A");
        assert.ok(restrictByOrder(cornered, kingMoves, "A", "attack").length > 0);
    });

    it("mirrors for side B", () => {
        const b = board([piece("B-d", "B", "dragon", 0, 0)]);
        const retreat = restrictByOrder(b, legalMoves(b, "B"), "B", "retreat");
        assert.ok(quiet(retreat).every((m) => m.to.r >= m.from.r), "B falls back towards +r");
    });
});

describe("cyvasse deployment", () => {
    const deploy = (side, tier, seed = 1) => deploySide({side, tier, rng: createRng(seed)});

    it("places the whole roster inside the side's own rows without overlaps", () => {
        for (const tier of ["genius", "smart", "contained", "bold", "dumb"]) {
            for (const side of ["A", "B"]) {
                const {pieces, terrain} = deploy(side, tier);
                assert.equal(pieces.length, Object.values(ROSTER).reduce((a, b) => a + b, 0));
                assert.equal(terrain.length, Object.values(TERRAIN_ROSTER).reduce((a, b) => a + b, 0));
                const hexes = [...pieces, ...terrain].map((h) => `${h.q},${h.r}`);
                assert.equal(new Set(hexes).size, hexes.length, "no two things share a hex");
                for (const h of [...pieces, ...terrain]) {
                    const depth = side === "A" ? h.r + BOARD_RADIUS : BOARD_RADIUS - h.r;
                    assert.ok(depth >= 0 && depth < DEPLOY_ROWS, `${tier}/${side} ${h.q},${h.r} in zone`);
                }
            }
        }
    });

    it("is deterministic for a seed and varies across seeds", () => {
        assert.deepEqual(deploy("A", "smart", 5), deploy("A", "smart", 5));
        assert.notDeepEqual(deploy("A", "dumb", 5), deploy("A", "dumb", 6));
    });

    it("always starts the King on the back row, even in a random set-up", () => {
        for (const tier of ["genius", "smart", "contained", "bold", "dumb"]) {
            for (let seed = 1; seed <= 30; seed++) {
                for (const side of ["A", "B"]) {
                    const king = deploy(side, tier, seed).pieces.find((p) => p.type === "king");
                    const depth = side === "A" ? king.r + BOARD_RADIUS : BOARD_RADIUS - king.r;
                    assert.equal(depth, 0, `${tier} seed ${seed} side ${side}`);
                }
            }
        }
    });

    it("never lets a King be captured on the very first move, whatever the two set-ups are", () => {
        const tiers = ["genius", "smart", "contained", "bold", "dumb"];
        for (const tierA of tiers) {
            for (const tierB of tiers) {
                for (let seed = 1; seed <= 12; seed++) {
                    const rng = createRng(seed);
                    const a = deploySide({side: "A", tier: tierA, rng});
                    const b = deploySide({side: "B", tier: tierB, rng});
                    const board = createBoard([...a.pieces, ...b.pieces], [...a.terrain, ...b.terrain]);
                    for (const side of ["A", "B"]) {
                        const takesAKing = captureMoves(board, side).some((move) => move.target?.type === "king");
                        assert.equal(takesAKing, false, `${tierA} vs ${tierB} seed ${seed}: side ${side} could take a King at once`);
                    }
                }
            }
        }
    });

    it("mirrors side B and keeps the king at the back under a defensive setup", () => {
        const a = deploy("A", "contained").pieces.find((p) => p.type === "king");
        const b = deploy("B", "contained").pieces.find((p) => p.type === "king");
        assert.equal(a.r + b.r, 0);
        assert.ok(a.r <= -4);
    });
});
