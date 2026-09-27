/**
 * Live, shared Cyvasse: one client (the GM's) runs the match as the authority
 * and everyone else watches it unfold. Owners of a character can change that
 * character's order while the round's orders window is open; the GM can steer
 * any side. Foundry-free: everything environmental (sockets, timers, who owns
 * which actor) comes in through `io`, so it is tested with a fake one.
 *
 * io = {
 *   broadcast(message)          send to every client (including this one)
 *   sleep(ms)                   resolves after ms
 *   now()                       current time in ms
 *   isGM(userId)                may this user steer the match?
 *   canControl(userId, side)    may this user give orders for that side?
 *   random()                    a number in [0, 1), for the cheater's floor chance of being caught
 *   sendPrivate(side, message)  (optional) tell only that side's owners and the GM, for Think's hint
 * }
 *
 * Messages that arrive over the socket are untrusted: they go through
 * parseMessage() and are then checked against io before they change anything.
 */

import {MAX_ROUNDS, MINOR, ORDERS, SIDES, otherSide} from "./cyvasse-data.js";
import {playMatch} from "./cyvasse-match.js";
import {
    MINOR_KEYS, cheatCaught, debuffFor, isMinorKey, otherOrder, recommendOrder, resolveModifiers, testSucceeds
} from "./cyvasse-minor.js";
import {validateRecord} from "./cyvasse-record.js";

export const LIVE_STATUS = {STARTING: "starting", ORDERS: "orders", PLAYING: "playing", ENDED: "ended"};

export const DEFAULT_LIVE_SETTINGS = {
    /**
     * Seconds before a side nobody has given an order for is left to the character to decide.
     * 0 (the default) never hands over: the round waits for the players, however long they take,
     * until everyone has chosen or the GM skips the wait.
     */
    orderSeconds: 0,
    /**
     * Play without ever asking for orders: every round goes ahead at once and the characters
     * decide for themselves. Off by default. A match otherwise WAITS at the start of each round
     * until both sides are decided (by their owner or the GM), and never moves on its own.
     */
    autoPlay: false,
    /** pause between moves so the table can follow the pieces */
    paceMs: 900
};

export const PACE_LIMITS = {min: 100, max: 5000};
const CONTROL_ACTIONS = ["pause", "resume", "resolveNow", "stop", "setPace"];
const MAX_ID_LENGTH = 64;
const HELLO_THROTTLE_MS = 1000;

const isSide = (value) => SIDES.includes(value);
const isId = (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;

/**
 * Validate a message from the socket. Returns a normalised copy, or null.
 * Only the fields each type needs are kept, so nothing else can ride along.
 */
export function parseMessage(raw) {
    if (!raw || typeof raw !== "object") return null;
    switch (raw.type) {
        case "hello":
            return {type: "hello"};
        case "order":
            return isId(raw.id) && isSide(raw.side) && ORDERS.includes(raw.order)
                ? {type: "order", id: raw.id, side: raw.side, order: raw.order}
                : null;
        case "ready":
            return isId(raw.id) && isSide(raw.side) ? {type: "ready", id: raw.id, side: raw.side} : null;
        case "minor":
            return isId(raw.id) && isSide(raw.side) && isMinorKey(raw.action)
                ? {type: "minor", id: raw.id, side: raw.side, action: raw.action}
                : null;
        case "control": {
            if (!isId(raw.id) || !CONTROL_ACTIONS.includes(raw.action)) return null;
            const message = {type: "control", id: raw.id, action: raw.action};
            if (raw.action === "setPace") {
                if (!Number.isFinite(raw.ms)) return null;
                message.ms = Math.min(PACE_LIMITS.max, Math.max(PACE_LIMITS.min, Math.round(raw.ms)));
            }
            return message;
        }
        default:
            return null;
    }
}

const isText = (value, max) => typeof value === "string" && value.length <= max;
const isBool = (value) => typeof value === "boolean";
/** An order, or null for "nobody has chosen yet". */
const isOrderOrEmpty = (value) => value === null || ORDERS.includes(value);
const MINOR_REASONS = ["", "used", "cooldown", "requires", "window"];

/** The minor-action part of a snapshot, or null (also for "no minor actions in this match"). */
function parseMinorState(raw) {
    if (raw === null || raw === undefined) return {ok: true, value: null};
    const ok = typeof raw === "object"
        && SIDES.every((side) => Number.isInteger(raw.cooldown?.[side]) && raw.cooldown[side] >= 0
            && raw.cooldown[side] <= MINOR.cooldownRounds
            && (raw.used?.[side] === null || isMinorKey(raw.used?.[side]))
            && (raw.forced?.[side] === null || ORDERS.includes(raw.forced?.[side]))
            && Array.isArray(raw.options?.[side]) && raw.options[side].length <= MINOR_KEYS.length
            && raw.options[side].every((o) => o && isMinorKey(o.key) && isBool(o.available) && MINOR_REASONS.includes(o.reason)));
    if (!ok) return {ok: false};
    const both = (pick) => ({A: pick("A"), B: pick("B")});
    return {
        ok: true,
        value: {
            cooldown: both((s) => raw.cooldown[s]),
            used: both((s) => raw.used[s]),
            forced: both((s) => raw.forced[s]),
            options: both((s) => raw.options[s].map((o) => ({key: o.key, available: o.available, reason: o.reason})))
        }
    };
}

/**
 * Validate a match snapshot received from the GM. Returns a normalised copy or
 * null. Anything that does not fit is rejected, and the record inside must
 * itself pass validateRecord (as an unfinished match).
 */
export function parseSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    const statuses = Object.values(LIVE_STATUS);
    const ok = isId(raw.id) && statuses.includes(raw.status)
        && Number.isInteger(raw.round) && raw.round >= 0 && raw.round <= MAX_ROUNDS
        && Number.isFinite(raw.balance) && isBool(raw.paused)
        && Number.isFinite(raw.paceMs) && Number.isFinite(raw.orderSeconds)
        && (raw.remainingMs === null || (Number.isFinite(raw.remainingMs) && raw.remainingMs >= 0))
        && SIDES.every((side) => isText(raw.names?.[side], 100)
            && isOrderOrEmpty(raw.orders?.[side]) && isBool(raw.ready?.[side]))
        && (raw.active === null || SIDES.every((side) => ORDERS.includes(raw.active?.[side])));
    if (!ok) return null;

    const minor = parseMinorState(raw.minor);
    if (!minor.ok) return null;

    let record = null;
    if (raw.record !== null && raw.record !== undefined) {
        if (!validateRecord(raw.record, {open: true}).ok) return null;
        record = raw.record;
    }
    const actorIds = SIDES.every((side) => isId(raw.actorIds?.[side]))
        ? {A: raw.actorIds.A, B: raw.actorIds.B}
        : null;

    return {
        id: raw.id,
        names: {A: raw.names.A, B: raw.names.B},
        actorIds,
        status: raw.status,
        round: raw.round,
        balance: raw.balance,
        orders: {A: raw.orders.A, B: raw.orders.B},
        active: raw.active === null ? null : {A: raw.active.A, B: raw.active.B},
        ready: {A: raw.ready.A, B: raw.ready.B},
        minor: minor.value,
        paused: raw.paused,
        paceMs: Math.min(PACE_LIMITS.max, Math.max(PACE_LIMITS.min, raw.paceMs)),
        orderSeconds: Math.max(0, raw.orderSeconds),
        remainingMs: raw.remainingMs,
        record
    };
}

/** A private message from the GM to one side's owners: what Think answered. */
export function parseHint(raw) {
    if (!raw || typeof raw !== "object" || raw.type !== "hint") return null;
    const ok = isId(raw.id) && isSide(raw.side) && ["attack", "retreat"].includes(raw.order) && isBool(raw.forced);
    return ok ? {id: raw.id, side: raw.side, order: raw.order, forced: raw.forced} : null;
}

export class LiveMatch {
    #io;
    #reporter;
    #reported = new Set();
    #actorIds;
    #settings;
    #profiles;
    #roller;
    #matchOptions;
    #record = null;
    #status = LIVE_STATUS.STARTING;
    #round = 0;
    #balance = 0;
    #deadline = null;
    /** Order chosen for the NEXT round: null until someone chooses. An order lasts one round. */
    #orders = {A: null, B: null};
    /** The orders in force for the round being played (null before the first round). */
    #active = null;
    /** Whether each side has been decided for the next round (an order, or a plain "ready"). */
    #chosen = {A: false, B: false};
    #ready = {A: false, B: false};
    #paused = false;
    #stopped = false;
    #resumeGate = null;
    #closeWindow = null;
    #checkWindow = null;
    #lastHello = null;
    /** Minor actions: the provider (dice and passives, from Foundry), and this match's state for them. */
    #minor;
    /** This round's action per side: {key, success, rating}. */
    #minorUsed = {A: null, B: null};
    /** Rounds each player still has to wait before their next minor action. */
    #cooldown = {A: 0, B: 0};
    /** An order Think forced on a side this round (its wrong answer). */
    #forced = {A: null, B: null};
    #minorLog = [];
    #minorQueue = Promise.resolve();
    #caught = null;

    /**
     * @param config.id        unique id of this match (also names its socket messages)
     * @param config.profiles  engine profiles per side ({name, passive, ...})
     * @param config.roller    engine roller
     * @param config.io        see the file header
     * @param config.actorIds  {A, B} ids of the two characters, so clients can tell which sides they control
     * @param config.reporter  {deployed(record), round(record, entry), minor(record, event, private)}:
     *                         awaited callbacks that let the caller show the table's results (chat) as
     *                         they happen. `round` runs once per round, when it is finished, with the
     *                         rolls, verdicts and moves; `minor` runs for each minor action.
     * @param config.minor     provider of the minor actions' dice and passives, or null for none:
     *                         {eligible(side, key), test(side, key, {flat}), passive(side, attr), expected(side)}
     */
    constructor({id, profiles, roller, io, actorIds = null, reporter = {}, minor = null, settings = {}, matchOptions = {}}) {
        this.id = id;
        this.#minor = minor;
        this.#reporter = reporter;
        this.#io = io;
        this.#actorIds = actorIds;
        this.#profiles = profiles;
        this.#roller = roller;
        this.#settings = {...DEFAULT_LIVE_SETTINGS, ...settings};
        this.#matchOptions = matchOptions;
    }

    get status() { return this.#status; }
    get orders() { return {...this.#orders}; }

    /* -------------------------------------------- */
    /*  What everybody sees                         */
    /* -------------------------------------------- */

    /** A JSON-safe picture of the match for the clients. Times are relative, since clocks differ. */
    snapshot() {
        return {
            id: this.id,
            names: {A: this.#profiles.A.name, B: this.#profiles.B.name},
            actorIds: this.#actorIds,
            status: this.#status,
            round: this.#round,
            balance: this.#balance,
            orders: {...this.#orders},
            active: this.#active ? {...this.#active} : null,
            ready: {...this.#ready},
            minor: this.#minor ? this.#minorSnapshot() : null,
            paused: this.#paused,
            paceMs: this.#settings.paceMs,
            orderSeconds: this.#settings.orderSeconds,
            remainingMs: this.#deadline === null ? null : Math.max(0, this.#deadline - this.#io.now()),
            record: this.#record ? structuredClone(this.#record) : null
        };
    }

    #broadcast() {
        this.#io.broadcast({type: "sync", state: this.snapshot()});
    }

    /** Why a side cannot use an action right now ("" when it can). */
    #minorReason(side, key) {
        if (this.#minorUsed[side]) return "used";
        if (this.#cooldown[side] > 0) return "cooldown";
        if (!this.#minor.eligible(side, key)) return "requires";
        if (this.#settings.autoPlay || this.#status !== LIVE_STATUS.ORDERS || this.#stopped) return "window";
        return "";
    }

    #minorSnapshot() {
        const options = (side) => MINOR_KEYS.map((key) => {
            const reason = this.#minorReason(side, key);
            return {key, available: reason === "", reason};
        });
        return {
            cooldown: {...this.#cooldown},
            used: {A: this.#minorUsed.A?.key ?? null, B: this.#minorUsed.B?.key ?? null},
            forced: {...this.#forced},
            options: {A: options("A"), B: options("B")}
        };
    }

    /* -------------------------------------------- */
    /*  Steering (GM calls these directly; sockets go through handle())    */
    /* -------------------------------------------- */

    /**
     * Give a side an order for the next round to be played. It can be given at any
     * time, even while the previous round is still being played out, and it is used
     * once: the round after that starts empty again.
     */
    setOrder(side, order, {gm = false} = {}) {
        if (!isSide(side) || !ORDERS.includes(order) || this.#status === LIVE_STATUS.ENDED) return;
        // A failed Think forces its wrong answer on a player; only the GM can override it.
        if (this.#forced[side] && !gm) return;
        this.#orders[side] = order;
        this.#markReady(side);
    }

    /** Decide a side without an order: the character will choose for itself this round. */
    markReady(side) {
        if (isSide(side) && this.#status !== LIVE_STATUS.ENDED) this.#markReady(side);
    }

    #markReady(side) {
        this.#chosen[side] = true;
        if (this.#status === LIVE_STATUS.ORDERS) this.#ready[side] = true;
        this.#broadcast();
        this.#checkWindow?.();
    }

    pause() {
        if (this.#paused || this.#status === LIVE_STATUS.ENDED) return;
        this.#paused = true;
        this.#broadcast();
    }

    resume() {
        if (!this.#paused) return;
        this.#paused = false;
        this.#resumeGate?.();
        this.#resumeGate = null;
        this.#broadcast();
    }

    /** End the current orders window now, keeping whatever is standing. */
    resolveNow() {
        this.#closeWindow?.();
    }

    setPace(ms) {
        this.#settings.paceMs = Math.min(PACE_LIMITS.max, Math.max(PACE_LIMITS.min, Math.round(ms)));
        this.#broadcast();
    }

    stop() {
        this.#stopped = true;
        this.#closeWindow?.();
        this.#resumeGate?.();
        this.#resumeGate = null;
    }

    /** A socket message from `userId`. Untrusted: validated, then checked against io. */
    handle(raw, userId) {
        const message = parseMessage(raw);
        if (!message) return;
        if (message.type === "hello") {
            // A late joiner asks for the state; answers are throttled so a noisy client cannot flood the table.
            const now = this.#io.now();
            if (this.#lastHello === null || now - this.#lastHello >= HELLO_THROTTLE_MS) {
                this.#lastHello = now;
                this.#broadcast();
            }
            return;
        }
        if (message.id !== this.id) return;

        switch (message.type) {
            case "order":
                if (this.#io.canControl(userId, message.side)) {
                    this.setOrder(message.side, message.order, {gm: this.#io.isGM(userId)});
                }
                break;
            case "minor":
                if (this.#io.canControl(userId, message.side)) this.useMinor(message.side, message.action);
                break;
            case "ready":
                if (this.#io.canControl(userId, message.side)) this.markReady(message.side);
                break;
            case "control":
                if (this.#io.isGM(userId)) this.#control(message);
                break;
        }
    }

    /* -------------------------------------------- */
    /*  Minor actions                               */
    /* -------------------------------------------- */

    /**
     * Use a minor action for a side: one per player per round, then a recharge of MINOR.cooldownRounds
     * rounds counted separately for each player. It is rolled at once against the opponent's passive
     * attribute; what a success does is applied to the round's Warfare rolls when the orders window closes.
     * Actions are queued, so two players acting together are resolved one after the other.
     * @returns a promise that settles when the action has been resolved
     */
    useMinor(side, key) {
        if (!this.#minor || !isSide(side) || !isMinorKey(key)) return Promise.resolve();
        this.#minorQueue = this.#minorQueue.then(() => this.#resolveMinor(side, key)).catch(() => {});
        return this.#minorQueue;
    }

    async #resolveMinor(side, key) {
        if (this.#minorReason(side, key) !== "") return;
        const action = MINOR.actions[key];
        const target = otherSide(side);

        // Claim the slot before rolling, so a second click cannot spend it twice.
        this.#minorUsed[side] = {key, success: false, rating: 0};
        this.#cooldown[side] = MINOR.cooldownRounds;
        this.#broadcast();

        // A Think roll carries the penalty the opponent's Bluff or Intimidation has already put on this side.
        const flat = key === "think" ? debuffFor(side, this.#minorUsed) : 0;
        const roll = await this.#minor.test(side, key, {flat});
        const passive = this.#minor.passive(target, action.vs);
        const success = testSucceeds(roll, passive);
        this.#minorUsed[side] = {key, success, rating: roll.rating ?? 0};

        const event = {
            round: this.#round, side, action: key, target, attr: action.vs, passive,
            success, total: roll.total, fumble: Boolean(roll.fumble), test: roll.test ?? null
        };
        let secret = null;
        if (action.risky) {
            event.caught = cheatCaught({success, random: this.#io.random()});
        } else if (key === "think") {
            // Everything about Think's result is private to its owner: the shared event says only that it happened.
            secret = {...this.#think(side, success), total: roll.total, passive, success, test: roll.test ?? null};
            Object.assign(event, {success: true, total: 0, passive: 0, fumble: false, test: null});
        }

        this.#minorLog.push(event);
        await this.#reporter.minor?.(this.#record, event, secret);
        if (secret) this.#io.sendPrivate?.(side, {type: "hint", id: this.id, side, order: secret.hint, forced: secret.forced});

        // A caught cheater ends the match at once: the opponent wins.
        if (event.caught) {
            this.#caught = {culprit: side, winner: target};
            this.stop();
        }
        this.#broadcast();
        this.#checkWindow?.();
    }

    /**
     * Think's answer: the order that looks better for this side (see recommendOrder), or the wrong
     * one when the test failed, in which case the side is bound to use it.
     */
    #think(side, success) {
        const other = otherSide(side);
        const {order} = recommendOrder({
            me: {expected: this.#minor.expected(side), passive: this.#profiles[side].passive},
            opp: {expected: this.#minor.expected(other), passive: this.#profiles[other].passive},
            balance: side === "A" ? this.#balance : -this.#balance
        });
        const hint = success ? order : otherOrder(order);
        if (!success) {
            this.#forced[side] = hint;
            this.#orders[side] = hint;
            this.#chosen[side] = true;
            if (this.#status === LIVE_STATUS.ORDERS) this.#ready[side] = true;
        }
        return {hint, forced: !success};
    }

    /** The engine's `roundModifiers`: what this round's successful actions do to the Warfare rolls. */
    async #roundModifiers({round, orders}) {
        const {mods, wasted} = resolveModifiers(this.#minorUsed, orders);
        // A success that its order made useless (Taunt without an Attack) is said out loud.
        for (const lost of wasted) {
            const action = MINOR.actions[lost.key];
            const event = {
                round, side: lost.side, action: lost.key, target: otherSide(lost.side), attr: action.vs,
                passive: 0, success: true, total: 0, fumble: false, test: null, note: lost.reason
            };
            this.#minorLog.push(event);
            await this.#reporter.minor?.(this.#record, event, null);
        }
        return mods;
    }

    #control({action, ms}) {
        if (action === "pause") this.pause();
        else if (action === "resume") this.resume();
        else if (action === "resolveNow") this.resolveNow();
        else if (action === "stop") this.stop();
        else if (action === "setPace") this.setPace(ms);
    }

    /* -------------------------------------------- */
    /*  Running the match                           */
    /* -------------------------------------------- */

    async #gate() {
        if (this.#paused && !this.#stopped) await new Promise((resolve) => { this.#resumeGate = resolve; });
    }

    async #linger(factor = 1) {
        await this.#io.sleep(this.#settings.paceMs * factor);
        await this.#gate();
    }

    /**
     * The sides a round waits for: both, unless the match plays itself. Someone can always decide
     * for a side (its owner, or the GM), so a round never starts without a decision.
     */
    #decidingSides() {
        return this.#settings.autoPlay ? [] : SIDES;
    }

    /** The engine's `chooseOrders`: the orders window of a round. */
    async #chooseOrders({round, balance}) {
        await this.#gate();
        if (this.#stopped) return null;

        this.#round = round;
        this.#balance = balance;
        // A new window: each player's recharge ticks down, and last round's action and forced order are gone.
        for (const side of SIDES) this.#cooldown[side] = Math.max(0, this.#cooldown[side] - 1);
        this.#minorUsed = {A: null, B: null};
        this.#forced = {A: null, B: null};
        const human = this.#decidingSides();
        // A side already decided (chosen ahead of time) or with no player to wait for is ready.
        this.#ready = {A: !human.includes("A") || this.#chosen.A, B: !human.includes("B") || this.#chosen.B};

        if (human.length > 0) {
            this.#status = LIVE_STATUS.ORDERS;
            const seconds = this.#settings.orderSeconds;
            this.#deadline = seconds > 0 ? this.#io.now() + seconds * 1000 : null;
            this.#broadcast();
            await this.#waitForOrders(human, seconds);
        }

        this.#status = LIVE_STATUS.PLAYING;
        this.#deadline = null;
        this.#closeWindow = null;
        this.#checkWindow = null;
        if (this.#stopped) return null;

        // Use the orders once. Anything nobody chose is left to the character.
        this.#active = {A: this.#orders.A ?? "auto", B: this.#orders.B ?? "auto"};
        this.#orders = {A: null, B: null};
        this.#chosen = {A: false, B: false};
        this.#ready = {A: false, B: false};
        return {...this.#active};
    }

    #waitForOrders(human, seconds) {
        return new Promise((resolve) => {
            this.#closeWindow = resolve;
            this.#checkWindow = () => {
                if (human.every((side) => this.#ready[side])) resolve();
            };
            if (seconds > 0) this.#io.sleep(seconds * 1000).then(resolve);
            // Sides decided ahead of time leave nothing to wait for.
            this.#checkWindow();
        });
    }

    async #onDeploy(record) {
        this.#record = record;
        record.minor = this.#minorLog;
        this.#status = LIVE_STATUS.PLAYING;
        this.#broadcast();
        await this.#reporter.deployed?.(record);
        await this.#linger(2);
        return !this.#stopped;
    }

    async #onRound() {
        this.#broadcast();
        await this.#linger();
        return !this.#stopped;
    }

    /** Report a round once, however it ended. */
    async #report(record, entry) {
        if (this.#reported.has(entry.n)) return;
        this.#reported.add(entry.n);
        await this.#reporter.round?.(record, entry);
    }

    async #onPly(record, entry) {
        this.#broadcast();
        // A round is over after its second move, or as soon as the match is decided.
        if (entry.moves.length >= SIDES.length || record.result) await this.#report(record, entry);
        await this.#linger();
        return !this.#stopped;
    }

    /** Run the match to its end. Resolves with the finished record. */
    async run() {
        const record = await playMatch({
            profiles: this.#profiles,
            roller: this.#roller,
            options: {
                ...this.#matchOptions,
                chooseOrders: (context) => this.#chooseOrders(context),
                ...(this.#minor ? {roundModifiers: (context) => this.#roundModifiers(context)} : {}),
                onDeploy: (rec) => this.#onDeploy(rec),
                onRound: (rec) => this.#onRound(rec),
                onPly: (rec, entry) => this.#onPly(rec, entry)
            }
        });
        // A cheater who was caught loses on the spot, whatever the board says.
        if (this.#caught) {
            record.result = {
                winner: this.#caught.winner, reason: "caught", rounds: record.rounds.length, culprit: this.#caught.culprit
            };
        }
        // A round can end without a second move (a stalled board, a stopped match): report it too.
        for (const entry of record.rounds) await this.#report(record, entry);
        this.#record = record;
        this.#status = LIVE_STATUS.ENDED;
        this.#paused = false;
        this.#deadline = null;
        this.#broadcast();
        return record;
    }
}
