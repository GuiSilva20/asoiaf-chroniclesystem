import {describe, it} from "node:test";
import assert from "node:assert/strict";
import {LIVE_STATUS, LiveMatch, PACE_LIMITS, parseMessage, parseSnapshot} from "../../module/cyvasse/cyvasse-live.js";

const profiles = {
    A: {name: "Alys", passive: 12, courage: 0, cunning: 0, strategy: 0},
    B: {name: "Brand", passive: 12, courage: 0, cunning: 0, strategy: 0}
};

/** A fake table: user "gm" steers, "pa" owns side A, "pb" owns side B, "obs" only watches. */
function fakeIo({autoPlay = false} = {}) {
    let clock = 0;
    const sent = [];
    const pending = [];
    const paced = [];
    let holdPacing = false;
    const owners = {pa: "A", pb: "B"};
    return {
        sent,
        syncs: () => sent.filter((m) => m.type === "sync").map((m) => m.state),
        broadcast: (message) => sent.push(message),
        // Pacing pauses (short) pass instantly; the orders-window timer (long) only fires when a test says so.
        sleep: (ms) => {
            if (ms > 1000) return new Promise((resolve) => pending.push(resolve));
            if (holdPacing) return new Promise((resolve) => paced.push(resolve));
            clock += ms;
            return Promise.resolve();
        },
        /** While held, the short pauses between moves wait, so a test can act mid-round. */
        hold: () => { holdPacing = true; },
        release: () => { holdPacing = false; paced.splice(0).forEach((resolve) => resolve()); },
        fireTimers: () => pending.splice(0).forEach((resolve) => resolve()),
        now: () => clock,
        advance: (ms) => { clock += ms; },
        isGM: (userId) => userId === "gm",
        canControl: (userId, side) => userId === "gm" || owners[userId] === side,
        autoPlay
    };
}

/** `fakeIo({autoPlay: true})` makes the match play itself; otherwise every round waits for a decision. */
const live = (io, {settings = {}, ...extra} = {}) => new LiveMatch({
    id: "m1", profiles, io,
    roller: ({side}) => ({total: side === "A" ? 12 : 9}),
    settings: {orderSeconds: 0, paceMs: 100, ...settings, autoPlay: io.autoPlay},
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

describe("cyvasse socket messages", () => {
    it("accepts well-formed messages and keeps only the fields each type needs", () => {
        assert.deepEqual(parseMessage({type: "hello", junk: 1}), {type: "hello"});
        assert.deepEqual(parseMessage({type: "order", id: "m1", side: "A", order: "attack", extra: "x"}),
            {type: "order", id: "m1", side: "A", order: "attack"});
        assert.deepEqual(parseMessage({type: "ready", id: "m1", side: "B"}), {type: "ready", id: "m1", side: "B"});
        assert.deepEqual(parseMessage({type: "control", id: "m1", action: "pause"}), {type: "control", id: "m1", action: "pause"});
    });

    it("rejects malformed or hostile messages", () => {
        const bad = [null, "order", 5, {}, {type: "sync"}, {type: "order", id: "m1", side: "C", order: "attack"},
            {type: "order", id: "m1", side: "A", order: "nuke"}, {type: "order", id: "", side: "A", order: "auto"},
            {type: "order", id: "x".repeat(200), side: "A", order: "auto"}, {type: "order", side: "A", order: "auto"},
            {type: "control", id: "m1", action: "deleteEverything"}, {type: "control", id: "m1", action: "setPace"},
            {type: "control", id: "m1", action: "setPace", ms: "fast"}];
        for (const message of bad) assert.equal(parseMessage(message), null, JSON.stringify(message));
    });

    it("clamps the pace to a sane range", () => {
        assert.equal(parseMessage({type: "control", id: "m1", action: "setPace", ms: 1}).ms, PACE_LIMITS.min);
        assert.equal(parseMessage({type: "control", id: "m1", action: "setPace", ms: 10 ** 9}).ms, PACE_LIMITS.max);
    });
});

describe("cyvasse match snapshots", {timeout: 20000}, () => {
    const snapshotOf = async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io, {actorIds: {A: "actorA", B: "actorB"}, matchOptions: {seed: 6, maxRounds: 2}});
        await match.run();
        return JSON.parse(JSON.stringify(match.snapshot()));
    };

    it("accepts a snapshot the driver produced, after a JSON round trip", async () => {
        const raw = await snapshotOf();
        const parsed = parseSnapshot(raw);
        assert.ok(parsed);
        assert.equal(parsed.status, LIVE_STATUS.ENDED);
        assert.deepEqual(parsed.actorIds, {A: "actorA", B: "actorB"});
        assert.ok(parsed.record.result);
    });

    it("accepts a snapshot of a match still being played", async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io);
        const running = match.run();
        await until(() => io.syncs().length > 1, "first moves");
        assert.ok(parseSnapshot(JSON.parse(JSON.stringify(io.syncs().at(-1)))));
        match.stop();
        await running;
    });

    it("drops fields it does not know", async () => {
        const raw = await snapshotOf();
        raw.evil = "<script>";
        assert.equal("evil" in parseSnapshot(raw), false);
    });

    it("rejects garbage, wrong types and tampered records", async () => {
        const base = await snapshotOf();
        const mutate = (change) => { const copy = structuredClone(base); change(copy); return copy; };
        const bad = [
            null, "sync", 4,
            mutate((s) => { s.status = "cheating"; }),
            mutate((s) => { s.round = -1; }),
            mutate((s) => { s.round = 10 ** 6; }),
            mutate((s) => { s.orders.A = "nuke"; }),
            mutate((s) => { delete s.orders; }),
            mutate((s) => { s.names.A = 42; }),
            mutate((s) => { s.names.B = "x".repeat(500); }),
            mutate((s) => { s.paused = "yes"; }),
            mutate((s) => { s.remainingMs = -5; }),
            mutate((s) => { s.record.deployment.pieces[0].type = "__proto__"; })
        ];
        for (const [index, snapshot] of bad.entries()) assert.equal(parseSnapshot(snapshot), null, `case ${index}`);
    });

    it("tolerates a missing actor id list, and a match with no record yet", async () => {
        const base = await snapshotOf();
        const noActors = structuredClone(base);
        noActors.actorIds = null;
        assert.equal(parseSnapshot(noActors).actorIds, null);
        const early = structuredClone(base);
        early.record = null;
        assert.equal(parseSnapshot(early).record, null);
    });
});

describe("cyvasse live match reporting", {timeout: 20000}, () => {
    const reporterLog = () => {
        const log = {deployed: 0, rounds: []};
        return {
            log,
            reporter: {
                deployed: () => { log.deployed += 1; },
                round: (record, entry) => { log.rounds.push({n: entry.n, moves: entry.moves.length, open: record.result === null}); }
            }
        };
    };

    it("reports the deployment once and every round exactly once, in order", async () => {
        const {log, reporter} = reporterLog();
        const record = await live(fakeIo({autoPlay: true}), {reporter, matchOptions: {seed: 6, maxRounds: 4}}).run();
        assert.equal(log.deployed, 1);
        assert.deepEqual(log.rounds.map((r) => r.n), record.rounds.map((r) => r.n));
    });

    it("reports a round only once it is finished, with its moves and rolls", async () => {
        const {log, reporter} = reporterLog();
        const record = await live(fakeIo({autoPlay: true}), {reporter, matchOptions: {seed: 6, maxRounds: 3}}).run();
        for (const reported of log.rounds) {
            const entry = record.rounds.find((r) => r.n === reported.n);
            assert.equal(reported.moves, entry.moves.length, `round ${reported.n} was reported complete`);
            assert.ok(entry.rolls.A && entry.rolls.B, "the roll results are there");
        }
    });

    it("reports every round even when the match is decided or stopped early", async () => {
        const decided = reporterLog();
        const record = await live(fakeIo({autoPlay: true}), {
            reporter: decided.reporter,
            roller: ({side}) => ({total: side === "A" ? 30 : 1}),
            matchOptions: {seed: 21, maxRounds: 60}
        }).run();
        assert.equal(record.result.reason, "king");
        assert.deepEqual(decided.log.rounds.map((r) => r.n), record.rounds.map((r) => r.n));

        const stopped = reporterLog();
        const io = fakeIo();
        const match = live(io, {reporter: stopped.reporter});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        match.stop();
        const partial = await running;
        assert.deepEqual(stopped.log.rounds.map((r) => r.n), partial.rounds.map((r) => r.n));
    });
});

describe("cyvasse live match", {timeout: 20000}, () => {
    it("never moves on its own: the first round waits for a decision, even with only the GM at the table", async () => {
        const io = fakeIo();
        const match = live(io);
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS, "the first orders window");
        for (let i = 0; i < 50; i++) await tick();
        io.fireTimers();
        for (let i = 0; i < 50; i++) await tick();
        assert.equal(match.status, LIVE_STATUS.ORDERS, "still waiting");
        const plies = io.syncs().at(-1).record.rounds.reduce((n, r) => n + r.moves.length, 0);
        assert.equal(plies, 0, "no piece has moved");
        match.stop();
        await running;
    });

    it("moves on once the GM decides for both sides, with no player connected", async () => {
        const io = fakeIo();
        const match = live(io, {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        match.handle({type: "order", id: "m1", side: "A", order: "auto"}, "gm");
        await tick();
        assert.equal(match.status, LIVE_STATUS.ORDERS, "one side decided is not enough");
        match.handle({type: "order", id: "m1", side: "B", order: "auto"}, "gm");
        const record = await running;
        assert.equal(record.rounds.length, 1);
    });

    it("plays to the end on its own only when autoPlay is on", async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io);
        const record = await match.run();
        assert.ok(record.result);
        assert.equal(match.status, LIVE_STATUS.ENDED);
        assert.ok(!io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS), "no orders window without players");
    });

    it("broadcasts the board as it grows, ply by ply, and ends with the result", async () => {
        const io = fakeIo({autoPlay: true});
        await live(io).run();
        const counts = io.syncs().map((s) => s.record?.rounds.reduce((n, r) => n + r.moves.length, 0) ?? 0);
        assert.ok(counts.some((n, i) => i > 0 && n === counts[i - 1] + 1), "moves arrive one at a time");
        assert.equal(io.syncs().at(-1).status, LIVE_STATUS.ENDED);
        assert.ok(io.syncs().at(-1).record.result);
        assert.equal(io.syncs()[0].record.rounds.length, 0, "the deployment is shown before any round");
    });

    it("gives the table relative times, since clocks differ", async () => {
        const io = fakeIo();
        const match = live(io, {settings: {orderSeconds: 20, paceMs: 100}});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS, "orders window");
        const window = io.syncs().findLast((s) => s.status === LIVE_STATUS.ORDERS);
        assert.equal(window.remainingMs, 20000);
        assert.equal(window.round, 1);
        match.stop();
        await running;
    });

    it("waits in the orders window until every owner is ready", async () => {
        const io = fakeIo();
        const match = live(io);
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS, "orders window");

        match.handle({type: "order", id: "m1", side: "A", order: "attack"}, "pa");
        await tick();
        assert.equal(match.status, LIVE_STATUS.ORDERS, "still waiting for side B");
        match.handle({type: "ready", id: "m1", side: "B"}, "pb");
        await until(
            () => io.syncs().some((s) => s.status === LIVE_STATUS.PLAYING && s.round === 1 && s.record.rounds.length === 1),
            "round 1 to start"
        );

        match.stop();
        await running;
    });

    it("starts every window empty: no order chosen, nothing paused", async () => {
        const io = fakeIo();
        const match = live(io);
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS, "orders window");
        const opening = io.syncs().findLast((s) => s.status === LIVE_STATUS.ORDERS);
        assert.deepEqual(opening.orders, {A: null, B: null});
        assert.equal(opening.active, null, "no round has been played yet");
        assert.equal(opening.paused, false);
        assert.deepEqual(opening.ready, {A: false, B: false});
        match.stop();
        await running;
    });

    it("uses an owner's order for that round only, then starts empty again", async () => {
        const io = fakeIo();
        const match = live(io, {matchOptions: {seed: 6, maxRounds: 2}});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        match.handle({type: "order", id: "m1", side: "A", order: "retreat"}, "pa");
        match.handle({type: "ready", id: "m1", side: "B"}, "pb");
        await until(() => io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS && s.round === 2), "round 2 window");
        const second = io.syncs().findLast((s) => s.status === LIVE_STATUS.ORDERS && s.round === 2);
        assert.deepEqual(second.orders, {A: null, B: null}, "the order did not carry over");
        assert.deepEqual(second.active, {A: "retreat", B: "auto"}, "the round just played used it");
        match.resolveNow();
        const record = await running;
        assert.equal(record.rounds[0].orders.A, "retreat");
        assert.equal(record.rounds[1].orders.A, "auto");
        assert.equal(record.rounds[0].orders.B, "auto");
    });

    it("lets a player choose for the next round while the current one is still being played", async () => {
        const io = fakeIo();
        const match = live(io, {matchOptions: {seed: 6, maxRounds: 2}});
        io.hold();
        const running = match.run();
        // the deployment is shown first; let it through to reach round 1's window
        await until(() => io.syncs().length > 0);
        io.release();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        io.hold();
        match.handle({type: "ready", id: "m1", side: "A"}, "pa");
        match.handle({type: "ready", id: "m1", side: "B"}, "pb");
        await until(() => match.status === LIVE_STATUS.PLAYING && io.syncs().some((s) => s.round === 1 && s.record.rounds.length === 1));

        // round 1 is mid-play (held): choose for round 2 now
        match.handle({type: "order", id: "m1", side: "A", order: "attack"}, "pa");
        match.handle({type: "order", id: "m1", side: "B", order: "retreat"}, "pb");
        io.release();
        await until(() => io.syncs().some((s) => s.status === LIVE_STATUS.ORDERS && s.round === 2), "round 2 window");
        const window = io.syncs().find((s) => s.status === LIVE_STATUS.ORDERS && s.round === 2);
        assert.deepEqual(window.ready, {A: true, B: true}, "both were already decided, so nobody is waited for");
        const record = await running;
        assert.deepEqual(record.rounds[1].orders, {A: "attack", B: "retreat"});
    });

    it("waits for the players however long they take when there is no timer", async () => {
        const io = fakeIo();
        const match = live(io, {settings: {orderSeconds: 0, paceMs: 100}});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        io.fireTimers();
        for (let i = 0; i < 30; i++) await tick();
        assert.equal(match.status, LIVE_STATUS.ORDERS, "still waiting");
        assert.equal(io.syncs().findLast((s) => s.status === LIVE_STATUS.ORDERS).remainingMs, null, "and no countdown is shown");
        match.stop();
        await running;
    });

    it("closes the window on the timer, keeping standing orders for whoever did not answer", async () => {
        const io = fakeIo();
        const match = live(io, {settings: {orderSeconds: 5, paceMs: 100}, matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS, "orders window");
        io.fireTimers();
        const record = await running;
        assert.equal(record.rounds[0].orders.A, "auto");
        assert.ok(record.result);
    });

    it("ignores orders from people who do not own that side", async () => {
        const io = fakeIo();
        const match = live(io);
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        match.handle({type: "order", id: "m1", side: "B", order: "attack"}, "pa");
        match.handle({type: "order", id: "m1", side: "A", order: "attack"}, "obs");
        match.handle({type: "order", id: "other", side: "A", order: "attack"}, "pa");
        assert.deepEqual(match.orders, {A: null, B: null});
        match.stop();
        await running;
    });

    it("lets the GM steer either side and end the window", async () => {
        const io = fakeIo();
        const match = live(io, {matchOptions: {seed: 6, maxRounds: 1}});
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        match.handle({type: "order", id: "m1", side: "A", order: "attack"}, "gm");
        match.handle({type: "order", id: "m1", side: "B", order: "retreat"}, "gm");
        match.handle({type: "control", id: "m1", action: "resolveNow"}, "gm");
        const record = await running;
        assert.deepEqual(record.rounds[0].orders, {A: "attack", B: "retreat"});
    });

    it("refuses control messages from anyone but a GM", async () => {
        const io = fakeIo();
        const match = live(io);
        const running = match.run();
        await until(() => match.status === LIVE_STATUS.ORDERS);
        match.handle({type: "control", id: "m1", action: "stop"}, "pa");
        match.handle({type: "control", id: "m1", action: "resolveNow"}, "pb");
        await tick();
        assert.equal(match.status, LIVE_STATUS.ORDERS, "a player cannot stop or skip the window");
        match.handle({type: "control", id: "m1", action: "stop"}, "gm");
        const record = await running;
        assert.equal(record.result.reason, "aborted");
    });

    it("holds the match while paused and carries on when resumed", async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io, {matchOptions: {seed: 6, maxRounds: 5}});
        match.pause();
        const running = match.run();
        await tick();
        await tick();
        const before = io.syncs().length;
        for (let i = 0; i < 20; i++) await tick();
        assert.equal(io.syncs().length, before, "nothing advances while paused");
        assert.ok(io.syncs().at(-1).paused);

        match.resume();
        const record = await running;
        assert.ok(record.result);
    });

    it("stops promptly even while paused", async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io);
        match.pause();
        const running = match.run();
        await tick();
        match.stop();
        const record = await running;
        assert.equal(record.result.reason, "aborted");
    });

    it("answers a late joiner's hello with the current state, throttled", async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io);
        const running = match.run();
        await running;
        const before = io.syncs().length;
        match.handle({type: "hello"}, "obs");
        assert.equal(io.syncs().length, before + 1);
        match.handle({type: "hello"}, "obs");
        assert.equal(io.syncs().length, before + 1, "a second hello within a second is ignored");
        io.advance(1500);
        match.handle({type: "hello"}, "obs");
        assert.equal(io.syncs().length, before + 2);
    });

    it("changes the pace on the GM's say-so, within limits", async () => {
        const io = fakeIo({autoPlay: true});
        const match = live(io);
        match.handle({type: "control", id: "m1", action: "setPace", ms: 250}, "gm");
        assert.equal(match.snapshot().paceMs, 250);
        match.handle({type: "control", id: "m1", action: "setPace", ms: 1}, "gm");
        assert.equal(match.snapshot().paceMs, PACE_LIMITS.min);
        match.handle({type: "control", id: "m1", action: "setPace", ms: 250}, "pa");
        assert.equal(match.snapshot().paceMs, PACE_LIMITS.min, "players cannot change the pace");
    });
});
