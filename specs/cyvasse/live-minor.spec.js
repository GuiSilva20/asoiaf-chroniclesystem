import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {MINOR} from "../../module/cyvasse/cyvasse-data.js";
import {LIVE_STATUS, LiveMatch, parseMessage, parseSnapshot} from "../../module/cyvasse/cyvasse-live.js";
import {validateRecord} from "../../module/cyvasse/cyvasse-record.js";

const profiles = {
    A: {name: "Alys", passive: 12, courage: 0, cunning: 0, strategy: 0},
    B: {name: "Brand", passive: 12, courage: 0, cunning: 0, strategy: 0}
};

/** A fake table: "gm" steers, "pa"/"pb" own sides A/B, "obs" only watches. */
function fakeIo({random = 0.99} = {}) {
    const sent = [];
    const priv = [];
    const owners = {pa: "A", pb: "B"};
    return {
        sent, priv,
        syncs: () => sent.filter((m) => m.type === "sync").map((m) => m.state),
        broadcast: (message) => sent.push(message),
        sleep: () => Promise.resolve(),
        now: () => 0,
        isGM: (userId) => userId === "gm",
        canControl: (userId, side) => userId === "gm" || owners[userId] === side,
        random: () => random,
        sendPrivate: (side, message) => priv.push({side, message})
    };
}

/**
 * A stand-in for the Foundry dice: `totals` says what each test rolls ("bluff", or "A:bluff" for one
 * side). Every test is recorded in `calls` with the flat modifier it was given.
 */
function fakeMinor({totals = {}, passives = {}, eligible = () => true, expected = {A: 16, B: 16}, rating = 1} = {}) {
    const calls = [];
    const pass = {cunning: 12, will: 12, awareness: 12, ...passives};
    return {
        calls,
        eligible: (side, key) => eligible(side, key),
        test: async (side, key, {flat = 0} = {}) => {
            calls.push({side, key, flat});
            const base = totals[`${side}:${key}`] ?? totals[key] ?? 20;
            return {total: base + flat, fumble: false, rating,
                test: {ability: "Ability", specialty: "Specialty", rolled: 4, kept: 3, bonus: 1, modifier: 0, dice: [{value: 6, kept: true}]}};
        },
        passive: (side, attr) => pass[attr],
        expected: (side) => expected[side]
    };
}

const build = (io, minor, extra = {}) => new LiveMatch({
    id: "m1", profiles, io, minor,
    roller: ({side}) => ({total: side === "A" ? 12 : 9}),
    settings: {orderSeconds: 0, paceMs: 100},
    matchOptions: {seed: 6, maxRounds: 3},
    ...extra
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(condition, label = "condition") {
    for (let i = 0; i < 400; i++) {
        if (condition()) return;
        await tick();
    }
    assert.fail(`timed out waiting for ${label}`);
}
const inWindow = (match) => until(() => match.status === LIVE_STATUS.ORDERS, "an orders window");
const lastMinor = (io) => io.syncs().findLast((s) => s.minor)?.minor;
const optionOf = (io, side, key) => lastMinor(io).options[side].find((o) => o.key === key);

/** Decide both sides so the window closes. */
const decide = (match, a = "auto", b = "auto") => {
    match.setOrder("A", a, {gm: true});
    match.setOrder("B", b, {gm: true});
};

describe("cyvasse minor actions in a live match", {timeout: 20000}, () => {
    it("has no minor actions without a provider", async () => {
        const io = fakeIo();
        const match = build(io, null);
        const running = match.run();
        await inWindow(match);
        assert.equal(io.syncs().at(-1).minor, null);
        assert.equal(match.useMinor("A", "bluff") instanceof Promise, true);
        match.stop();
        await running;
    });

    it("rolls the action at once against the opponent's passive and reports it", async () => {
        const io = fakeIo();
        const minor = fakeMinor({totals: {bluff: 14}, passives: {cunning: 12}});
        const reported = [];
        const match = build(io, minor, {reporter: {minor: (rec, event, secret) => { reported.push({event, secret}); }}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");

        assert.equal(minor.calls.length, 1);
        const event = reported[0].event;
        assert.deepEqual([event.side, event.target, event.action, event.attr, event.passive, event.total, event.success],
            ["A", "B", "bluff", "cunning", 12, 14, true]);
        assert.equal(reported[0].secret, null);
        assert.equal(optionOf(io, "A", "bluff").reason, "used");
        match.stop();
        await running;
    });

    it("fails a test that does not reach the passive value", async () => {
        const io = fakeIo();
        const minor = fakeMinor({totals: {bluff: 11}, passives: {cunning: 12}});
        const match = build(io, minor, {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");
        decide(match);
        const record = await running;
        assert.equal(record.minor[0].success, false);
        assert.equal("modifiers" in record.rounds[0], false, "a failed action changes nothing");
    });

    it("puts a successful Bluff's penalty on the opponent's roll that round", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor({totals: {bluff: 20}}), {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");
        decide(match);
        const record = await running;
        assert.deepEqual(record.rounds[0].modifiers.B, {pool: 0, bonus: 0, flat: -4});
        assert.equal(record.rounds[0].modifiers.A, null);
    });

    it("allows one minor action per player per round, but one for each player", async () => {
        const io = fakeIo();
        const minor = fakeMinor();
        const match = build(io, minor);
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");
        await match.useMinor("A", "intimidate");
        assert.equal(minor.calls.filter((c) => c.side === "A").length, 1, "A already acted this round");
        await match.useMinor("B", "intimidate");
        assert.equal(minor.calls.filter((c) => c.side === "B").length, 1, "B has their own action");
        match.stop();
        await running;
    });

    it("does not spend an action twice when two clicks arrive together", async () => {
        const io = fakeIo();
        const minor = fakeMinor();
        const match = build(io, minor);
        const running = match.run();
        await inWindow(match);
        await Promise.all([match.useMinor("A", "bluff"), match.useMinor("A", "bluff"), match.useMinor("A", "taunt")]);
        assert.equal(minor.calls.length, 1);
        match.stop();
        await running;
    });

    it("recharges each player on their own counter", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor(), {matchOptions: {seed: 6, maxRounds: 5}});
        const running = match.run();

        await inWindow(match);                                   // round 1: A acts
        await match.useMinor("A", "bluff");
        assert.equal(lastMinor(io).cooldown.A, MINOR.cooldownRounds);
        decide(match);

        await until(() => io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS && s.round === 2), "round 2");
        assert.equal(optionOf(io, "A", "bluff").reason, "cooldown");
        assert.equal(optionOf(io, "B", "bluff").available, true, "B never acted, so B is not waiting");
        await match.useMinor("B", "bluff");                      // round 2: B acts
        decide(match);

        await until(() => io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS && s.round === 3), "round 3");
        assert.equal(optionOf(io, "A", "bluff").reason, "cooldown", "A has waited one round");
        assert.equal(optionOf(io, "B", "bluff").reason, "cooldown");
        decide(match);

        await until(() => io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS && s.round === 4), "round 4");
        const four = io.syncs().findLast((s) => s.status === LIVE_STATUS.ORDERS && s.round === 4).minor;
        assert.equal(four.options.A.find((o) => o.key === "bluff").available, true, "A is back three rounds after acting");
        assert.equal(four.options.B.find((o) => o.key === "bluff").reason, "cooldown", "B still has a round to wait");
        match.stop();
        await running;
    });

    it("refuses an action the character cannot attempt", async () => {
        const io = fakeIo();
        const minor = fakeMinor({eligible: (side, key) => !(side === "A" && key === "trick")});
        const match = build(io, minor);
        const running = match.run();
        await inWindow(match);
        assert.equal(optionOf(io, "A", "trick").reason, "requires");
        await match.useMinor("A", "trick");
        assert.equal(minor.calls.length, 0);
        assert.equal(optionOf(io, "A", "bluff").available, true, "the others are still open");
        match.stop();
        await running;
    });

    it("refuses any action outside the orders window", async () => {
        const io = fakeIo();
        const minor = fakeMinor();
        const match = build(io, minor);
        await match.useMinor("A", "bluff");                       // the match has not started
        assert.equal(minor.calls.length, 0);
        const running = match.run();
        await inWindow(match);
        match.stop();
        const record = await running;
        assert.equal(record.result.reason, "aborted");
        await match.useMinor("B", "bluff");                       // the match is over
        assert.equal(minor.calls.length, 0);
    });

    it("does not offer minor actions when the match plays itself", async () => {
        const io = fakeIo();
        const minor = fakeMinor();
        const match = build(io, minor, {settings: {orderSeconds: 0, paceMs: 100, autoPlay: true}, matchOptions: {seed: 6, maxRounds: 2}});
        await match.run();
        await match.useMinor("A", "bluff");
        assert.equal(minor.calls.length, 0);
    });

    it("lets only an owner or the GM act for a side, over the socket", async () => {
        const io = fakeIo();
        const minor = fakeMinor();
        const match = build(io, minor);
        const running = match.run();
        await inWindow(match);
        match.handle({type: "minor", id: "m1", side: "A", action: "bluff"}, "obs");
        match.handle({type: "minor", id: "m1", side: "B", action: "bluff"}, "pa");
        match.handle({type: "minor", id: "other", side: "A", action: "bluff"}, "pa");
        await tick();
        assert.equal(minor.calls.length, 0);
        match.handle({type: "minor", id: "m1", side: "A", action: "bluff"}, "pa");
        await until(() => minor.calls.length === 1);
        match.stop();
        await running;
    });
});

describe("cyvasse minor actions: what each does", {timeout: 20000}, () => {
    const playOneRound = async (io, minor, act, orders = ["auto", "auto"]) => {
        const match = build(io, minor, {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await inWindow(match);
        await act(match);
        decide(match, ...orders);
        return running;
    };

    it("Taunt gives bonus dice to an Attack, and is wasted on anything else", async () => {
        const attack = await playOneRound(fakeIo(), fakeMinor(), (m) => m.useMinor("A", "taunt"), ["attack", "auto"]);
        assert.deepEqual(attack.rounds[0].modifiers.A, {pool: 0, bonus: 2, flat: 0});

        const wastedIo = fakeIo();
        const wasted = await playOneRound(wastedIo, fakeMinor(), (m) => m.useMinor("A", "taunt"), ["retreat", "auto"]);
        assert.equal("modifiers" in wasted.rounds[0], false);
        assert.equal(wasted.minor.at(-1).note, "needsAttack", "the table is told it was wasted");
    });

    it("Trick gives as many bonus dice as the Sleight of Hand rating, up to the cap, and needs an order", async () => {
        const some = await playOneRound(fakeIo(), fakeMinor({rating: 1}), (m) => m.useMinor("A", "trick"), ["retreat", "auto"]);
        assert.equal(some.rounds[0].modifiers.A.bonus, 1);
        const capped = await playOneRound(fakeIo(), fakeMinor({rating: 5}), (m) => m.useMinor("A", "trick"), ["attack", "auto"]);
        assert.equal(capped.rounds[0].modifiers.A.bonus, MINOR.caps.bonusDice);
        const none = await playOneRound(fakeIo(), fakeMinor({rating: 3}), (m) => m.useMinor("A", "trick"), ["auto", "auto"]);
        assert.equal(none.minor.at(-1).note, "needsOrder");
    });

    it("Intimidate hits the Will passive and penalises like Bluff", async () => {
        const minor = fakeMinor({totals: {intimidate: 13}, passives: {will: 13, cunning: 30}});
        const record = await playOneRound(fakeIo(), minor, (m) => m.useMinor("A", "intimidate"));
        assert.equal(record.minor[0].attr, "will");
        assert.deepEqual(record.rounds[0].modifiers.B, {pool: 0, bonus: 0, flat: -4});
    });

    it("Cheat adds a test die and bonus dice when it gets away with it", async () => {
        const record = await playOneRound(fakeIo({random: 0.99}), fakeMinor({totals: {cheat: 20}}), (m) => m.useMinor("A", "cheat"));
        assert.deepEqual(record.rounds[0].modifiers.A, {pool: 1, bonus: 2, flat: 0});
        assert.equal(record.minor[0].caught, false);
        assert.equal(record.result.reason !== "caught", true);
    });

    it("ends the match with the opponent winning when a cheater fails the test", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor({totals: {cheat: 5}}));
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "cheat");
        const record = await running;
        assert.equal(record.result.reason, "caught");
        assert.equal(record.result.winner, "B");
        assert.equal(record.result.culprit, "A");
        assert.equal(io.syncs().at(-1).status, LIVE_STATUS.ENDED);
        assert.deepEqual(validateRecord(record), {ok: true});
    });

    it("can still catch a cheater whose test succeeded: the risk is real", async () => {
        const caughtByFloor = fakeIo({random: MINOR.catchFloor - 0.01});
        const match = build(caughtByFloor, fakeMinor({totals: {cheat: 30}}));
        const running = match.run();
        await inWindow(match);
        await match.useMinor("B", "cheat");
        const record = await running;
        assert.equal(record.result.reason, "caught");
        assert.equal(record.result.winner, "A", "B cheated, so A wins");
    });
});

describe("cyvasse Think", {timeout: 20000}, () => {
    it("tells a side which order looks better, privately, and leaves it free to choose", async () => {
        const io = fakeIo();
        const minor = fakeMinor({totals: {think: 20}, expected: {A: 22, B: 14}});
        const reported = [];
        const match = build(io, minor, {reporter: {minor: (rec, event, secret) => { reported.push({event, secret}); }}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "think");

        assert.deepEqual(io.priv.map((p) => [p.side, p.message.type, p.message.order, p.message.forced]), [["A", "hint", "attack", false]]);
        assert.equal(reported[0].secret.hint, "attack");
        assert.equal(reported[0].secret.forced, false);
        assert.equal(reported[0].secret.success, true, "the owner gets the roll");
        assert.equal(reported[0].event.total, 0, "the shared event does not");
        assert.equal(reported[0].event.test, null);
        assert.equal(JSON.stringify(io.syncs().at(-1)).includes("hint"), false, "the hint is not in the shared state");
        match.setOrder("A", "retreat");
        assert.equal(match.orders.A, "retreat", "a correct hint does not bind the player");
        match.stop();
        await running;
    });

    it("recommends Retreat to the side expected to lose", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor({totals: {think: 20}, expected: {A: 22, B: 14}}));
        const running = match.run();
        await inWindow(match);
        await match.useMinor("B", "think");
        assert.equal(io.priv[0].message.order, "retreat");
        match.stop();
        await running;
    });

    it("gives the wrong answer on a failed roll and binds the player to it", async () => {
        const io = fakeIo();
        const minor = fakeMinor({totals: {think: 5}, expected: {A: 22, B: 14}});
        const match = build(io, minor, {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "think");

        assert.equal(io.priv[0].message.order, "retreat", "the right answer was attack");
        assert.equal(io.priv[0].message.forced, true);
        match.setOrder("A", "attack");
        assert.equal(match.orders.A, "retreat", "the player cannot change it");
        match.setOrder("A", "attack", {gm: true});
        assert.equal(match.orders.A, "attack", "the GM can");
        decide(match, "attack", "auto");
        const record = await running;
        assert.equal(record.rounds[0].orders.A, "attack");
    });

    it("rolls with the penalty the opponent has already put on the thinker", async () => {
        const io = fakeIo();
        const minor = fakeMinor({totals: {bluff: 20, think: 13}, passives: {cunning: 12}});
        const match = build(io, minor);
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");
        await match.useMinor("B", "think");
        assert.equal(minor.calls.find((c) => c.key === "think").flat, -4);
        assert.equal(io.priv[0].message.forced, true, "13 - 4 misses the Cunning passive of 12");
        match.stop();
        await running;
    });

    it("clears a forced order at the next round", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor({totals: {think: 5}, expected: {A: 22, B: 14}}), {matchOptions: {seed: 6, maxRounds: 2}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "think");
        decide(match, "retreat", "auto");
        await until(() => io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS && s.round === 2));
        assert.equal(io.syncs().findLast((s) => s.round === 2).minor.forced.A, null);
        match.stop();
        await running;
    });
});

describe("cyvasse minor actions: messages and state that cross the socket", () => {
    it("parses a well-formed minor message and rejects bad ones", () => {
        assert.deepEqual(parseMessage({type: "minor", id: "m1", side: "A", action: "bluff", junk: 1}),
            {type: "minor", id: "m1", side: "A", action: "bluff"});
        for (const bad of [
            {type: "minor", id: "m1", side: "A", action: "explode"}, {type: "minor", id: "m1", side: "A", action: "__proto__"},
            {type: "minor", id: "m1", side: "C", action: "bluff"}, {type: "minor", side: "A", action: "bluff"},
            {type: "minor", id: "m1", side: "A"}
        ]) assert.equal(parseMessage(bad), null, JSON.stringify(bad));
    });

    it("accepts the snapshot's minor state and rejects tampered ones", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor());
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");
        const base = JSON.parse(JSON.stringify(match.snapshot()));
        match.stop();
        await running;

        const parsed = parseSnapshot(base);
        assert.ok(parsed);
        assert.equal(parsed.minor.cooldown.A, MINOR.cooldownRounds);
        assert.equal(parsed.minor.used.A, "bluff");
        assert.equal(parsed.minor.options.A.length, 6);

        const mutate = (change) => { const copy = structuredClone(base); change(copy); return copy; };
        for (const bad of [
            mutate((s) => { s.minor.cooldown.A = 99; }),
            mutate((s) => { s.minor.cooldown.B = -1; }),
            mutate((s) => { s.minor.used.A = "hack"; }),
            mutate((s) => { s.minor.options.A[0].key = "hack"; }),
            mutate((s) => { s.minor.options.A[0].reason = "because"; }),
            mutate((s) => { s.minor.options.A = new Array(50).fill(s.minor.options.A[0]); }),
            mutate((s) => { delete s.minor.forced; })
        ]) assert.equal(parseSnapshot(bad), null);
    });

    it("keeps working for matches with no minor actions", async () => {
        const io = fakeIo();
        const match = build(io, null, {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await inWindow(match);
        const shot = JSON.parse(JSON.stringify(match.snapshot()));
        assert.equal(shot.minor, null);
        assert.equal(parseSnapshot(shot).minor, null);
        match.stop();
        await running;
    });

    it("validates a record that carries minor-action events, and rejects a tampered one", async () => {
        const io = fakeIo();
        const match = build(io, fakeMinor({totals: {bluff: 20}}), {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await inWindow(match);
        await match.useMinor("A", "bluff");
        decide(match);
        const record = await running;
        assert.deepEqual(validateRecord(JSON.parse(JSON.stringify(record))), {ok: true});

        const bad = (change) => { const copy = JSON.parse(JSON.stringify(record)); change(copy); return validateRecord(copy).ok; };
        assert.equal(bad((r) => { r.minor[0].action = "nuke"; }), false);
        assert.equal(bad((r) => { r.minor[0].attr = "luck"; }), false);
        assert.equal(bad((r) => { r.minor[0].test.dice = new Array(99).fill({value: 1, kept: true}); }), false);
        assert.equal(bad((r) => { r.minor = "x"; }), false);
        assert.equal(bad((r) => { r.minor = new Array(999).fill(r.minor[0]); }), false);
    });
});
