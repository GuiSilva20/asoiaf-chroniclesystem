/**
 * Shows a Cyvasse match on a hex board: replaying a finished match one move at
 * a time, or following a live one as it is played. The record is replayed
 * through the engine's own board rules (cyvasse-record.js), so what the viewer
 * draws is exactly what the match played.
 *
 * In live mode the viewer also carries the orders panel: the owner of a
 * character (and the GM, for every character) picks Attack / Retreat / Auto,
 * and the GM can pause, skip the orders window, stop or change the pace.
 */

import {CSConstants} from "../../system/csConstants.js";
import {BOARD_RADIUS, MINOR, ORDERS, SIDES} from "../cyvasse-data.js";
import {allHexes, hexKey} from "../cyvasse-hex.js";
import {LIVE_STATUS, PACE_LIMITS} from "../cyvasse-live.js";
import {replay} from "../cyvasse-record.js";
import {
    attachViewer, detachViewer, getHint, getLatest, sendControl, sendMinor, sendOrder, setOpenHandler
} from "./cyvasse-live-client.js";
import {MINOR_ICONS, abilityName, moveText, pairLabel, pieceName, resultText, t} from "./cyvasse-text.js";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

/** Font Awesome (bundled with Foundry) glyph per piece and terrain. */
const ICONS = {
    king: "fa-chess-king", dragon: "fa-dragon", elephant: "fa-hippo", heavyHorse: "fa-chess-knight",
    lightHorse: "fa-horse", crossbowmen: "fa-crosshairs", spearmen: "fa-shield-halved",
    catapult: "fa-meteor", trebuchet: "fa-bullseye", rabble: "fa-chess-pawn",
    mountain: "fa-mountain", fortress: "fa-chess-rook"
};

const HEX_SIZE = 24; // centre-to-corner, in px
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = 2 * HEX_SIZE;
const PIECE_PX = 26;
const PLAY_INTERVAL_MS = 900;
/** Why a minor action is blocked, as a glyph next to the text (so it does not read as free text). */
const REASON_ICONS = {used: "fa-check", cooldown: "fa-hourglass-half", requires: "fa-lock", window: "fa-lock"};
const BOARD_MAX_SCALE = 2;
const BOARD_MIN_SCALE = 0.35;
const BOARD_PADDING_PX = 8;
const MOVE_ANIMATION_MS = 500;
const COUNTDOWN_TICK_MS = 250;
const PACES = [{key: "slow", ms: 1600}, {key: "normal", ms: 900}, {key: "fast", ms: 400}];

export class CyvasseBoardViewer extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        classes: ["chroniclesystem", "cs-cyvasse"],
        window: {title: "CS.cyvasse.title", icon: "fa-solid fa-chess-board", resizable: true},
        position: {width: 1200, height: 800},
        actions: {
            first: CyvasseBoardViewer.onFirst,
            back: CyvasseBoardViewer.onBack,
            next: CyvasseBoardViewer.onNext,
            last: CyvasseBoardViewer.onLast,
            toggle: CyvasseBoardViewer.onToggle,
            goto: CyvasseBoardViewer.onGoto,
            follow: CyvasseBoardViewer.onLast,
            order: CyvasseBoardViewer.onOrder,
            minor: CyvasseBoardViewer.onMinor,
            pause: CyvasseBoardViewer.onControl,
            resume: CyvasseBoardViewer.onControl,
            resolveNow: CyvasseBoardViewer.onControl,
            stop: CyvasseBoardViewer.onControl,
            pace: CyvasseBoardViewer.onPace
        }
    };

    static PARTS = {
        main: {template: CSConstants.Templates.Cyvasse.BOARD_VIEWER}
    };

    /**
     * @param options.record a record that has passed validateRecord (a finished match), or
     * @param options.live   true to follow the live match the table is playing
     */
    constructor(options = {}) {
        super(options);
        this.live = Boolean(options.live);
        this.snapshot = null;
        this.record = null;
        this.frames = [];
        this.cursor = 0;
        this.following = this.live;
        this.timer = null;
        this.countdownTimer = null;
        this.deadlineAt = null;
        this.previous = new Map();
        this.previousCursor = null;
        this.resizeObserver = null;
        this.hint = null;
        if (this.live) {
            this.setState(getLatest());
            this.hint = getHint();
        }
        else this.setRecord(options.record);
    }

    get title() {
        const names = this.record?.names ?? this.snapshot?.names;
        return names ? t("viewer.title", {a: names.A, b: names.B}) : t("title");
    }

    /* -------------------------------------------- */
    /*  State                                       */
    /* -------------------------------------------- */

    setRecord(record) {
        this.record = record;
        this.frames = record ? replay(record) : [];
        if (this.following || this.cursor >= this.frames.length) this.cursor = Math.max(0, this.frames.length - 1);
    }

    setState(state) {
        this.snapshot = state;
        this.deadlineAt = state?.remainingMs == null ? null : performance.now() + state.remainingMs;
        this.setRecord(state?.record ?? null);
    }

    /** Think's answer arrived (privately): show it for the round it was asked in. */
    showHint(hint) {
        this.hint = hint;
        if (this.rendered) this.render();
    }

    /** A new snapshot of the live match arrived. */
    applyState(state) {
        this.setState(state);
        if (this.rendered) this.render();
    }

    /** Whether this user may give orders for a side (the GM's client checks again before acting). */
    canControl(side) {
        const actor = game.actors.get(this.snapshot?.actorIds?.[side]);
        return Boolean(game.user.isGM || actor?.testUserPermission(game.user, "OWNER"));
    }

    /* -------------------------------------------- */
    /*  View model                                  */
    /* -------------------------------------------- */

    boardContext() {
        const frame = this.frames[this.cursor];
        const board = frame?.board;
        const pieces = new Map((board?.pieces ?? []).map((p) => [hexKey(p.q, p.r), p]));
        const terrain = new Map((board?.terrain ?? []).map((tile) => [hexKey(tile.q, tile.r), tile]));
        const from = frame?.move ? hexKey(...frame.move.from) : null;
        const to = frame?.move ? hexKey(...frame.move.to) : null;

        const cells = allHexes(BOARD_RADIUS);
        const xs = cells.map((h) => HEX_W * (h.q + h.r / 2));
        const ys = cells.map((h) => HEX_SIZE * 1.5 * h.r);
        const originX = -Math.min(...xs);
        const originY = -Math.min(...ys);
        const owners = this.record?.names ?? {A: "", B: ""};

        // Hexes are clipped to their shape, so pieces live in a separate layer above
        // them: that is what lets a piece slide across several hexes when it moves.
        const tokens = [];
        const hexes = cells.map((h, i) => {
            const key = hexKey(h.q, h.r);
            const piece = pieces.get(key);
            const tile = terrain.get(key);
            const x = Math.round(xs[i] + originX);
            const y = Math.round(ys[i] + originY);
            if (piece) {
                tokens.push({
                    id: piece.id,
                    side: piece.side,
                    icon: ICONS[piece.type],
                    x,
                    y,
                    left: Math.round(x + HEX_W / 2 - PIECE_PX / 2),
                    top: Math.round(y + HEX_H / 2 - PIECE_PX / 2),
                    title: `${pairLabel([h.q, h.r])}: ${pieceName(piece.type)} (${owners[piece.side]})`
                });
            }
            return {
                x,
                y,
                label: pairLabel([h.q, h.r]),
                lastFrom: key === from,
                lastTo: key === to,
                terrain: tile ? {kind: tile.kind, icon: ICONS[tile.kind]} : null
            };
        });

        return {
            width: Math.round(Math.max(...xs) + originX + HEX_W),
            height: Math.round(Math.max(...ys) + originY + HEX_H),
            hexes,
            tokens,
            caption: frame?.move
                ? `${t("viewer.roundFrame", {round: frame.round})}: ${moveText(frame.move)}`
                : (frame ? t("viewer.deploymentFrame") : t("live.starting"))
        };
    }

    liveContext() {
        const state = this.snapshot;
        if (!this.live || !state) return null;

        const isGM = game.user.isGM;
        const ended = state.status === LIVE_STATUS.ENDED;
        const seconds = this.deadlineAt === null ? null : Math.max(0, Math.ceil((this.deadlineAt - performance.now()) / 1000));

        let statusText;
        if (ended) statusText = state.record?.result ? resultText(state.record) : t("live.ended");
        else if (state.paused) statusText = t("live.paused");
        else if (state.status === LIVE_STATUS.ORDERS) statusText = t("live.orders", {round: state.round});
        else if (state.status === LIVE_STATUS.PLAYING) statusText = t("live.playing", {round: state.round});
        else statusText = t("live.starting");

        return {
            isGM,
            ended,
            paused: state.paused,
            statusText,
            hasCountdown: state.status === LIVE_STATUS.ORDERS && seconds !== null,
            seconds,
            waiting: state.status === LIVE_STATUS.ORDERS && seconds === null,
            waitingText: t("live.waiting"),
            autoText: t("live.autoIn"),
            sides: SIDES.map((side) => ({
                side,
                name: state.names[side],
                canControl: !ended && this.canControl(side),
                // An order lasts one round. Empty until someone chooses; the order that
                // was used for the round now being played is shown apart from it.
                orderLabel: state.orders[side] ? t(`orders.${state.orders[side]}`) : t("live.noOrder"),
                activeLabel: state.active && state.status !== LIVE_STATUS.ORDERS
                    ? t("live.thisRound", {order: t(`orders.${state.active[side]}`)})
                    : "",
                ready: state.status === LIVE_STATUS.ORDERS && state.ready[side],
                readyLabel: t("live.ready"),
                choices: ORDERS.map((value) => ({
                    value,
                    label: t(value === "auto" ? "live.auto" : `orders.${value}`),
                    active: state.orders[side] === value
                }))
            })),
            labels: {
                pause: t("live.pause"), resume: t("live.resume"), resolveNow: t("live.resolveNow"),
                stop: t("live.stop"), pace: t("live.pace"), follow: t("live.follow"), gmControls: t("live.gmControls"),
                yourOrders: t("live.yourOrders")
            },
            paces: PACES.map(({key, ms}) => ({
                key, ms, label: t(`live.pace_${key}`), active: state.paceMs === ms
            })),
            showFollow: !this.following
        };
    }

    /** The minor-action menu: what each side may do now, and why not when it may not. */
    minorContext() {
        const state = this.snapshot;
        if (!this.live || !state?.minor) return null;
        const ended = state.status === LIVE_STATUS.ENDED;
        const describe = (key) => {
            const rule = MINOR.actions[key];
            return t(`minor.descriptions.${key}`, {
                value: Math.abs(rule.effect.flat ?? rule.effect.bonusDice ?? 0),
                bonus: rule.effect.bonusDice ?? 0,
                pool: rule.effect.poolDice ?? 0,
                min: rule.minRating,
                cap: MINOR.caps.bonusDice,
                catchFloor: Math.round(MINOR.catchFloor * 100),
                passive: t(`minor.attrs.${rule.vs}`)
            });
        };
        // What is rolled and what it must beat, e.g. "Deception (Bluff) vs Cunning passive".
        const testLine = (key) => {
            const rule = MINOR.actions[key];
            return t("minor.testLine", {
                ability: abilityName(rule.ability),
                specialty: t(`minor.specialties.${key}`),
                passive: t(`minor.attrs.${rule.vs}`)
            });
        };
        const why = (side, option) => {
            if (option.reason === "used") return t("minor.reasons.used");
            if (option.reason === "cooldown") return t("minor.reasons.cooldown", {n: state.minor.cooldown[side]});
            if (option.reason === "requires") {
                const rule = MINOR.actions[option.key];
                return t("minor.reasons.requires", {min: rule.minRating, specialty: t(`minor.specialties.${option.key}`)});
            }
            return option.reason === "window" ? t("minor.reasons.window") : "";
        };
        const hint = this.hint && this.hint.round === state.round && this.canControl(this.hint.side)
            ? {
                name: state.names[this.hint.side],
                text: t(this.hint.forced ? "minor.hintForced" : "minor.hint", {order: t(`orders.${this.hint.order}`)}),
                forced: this.hint.forced
            }
            : null;
        return {
            hint,
            sides: SIDES.map((side) => ({
                side,
                name: state.names[side],
                canControl: !ended && this.canControl(side),
                status: state.minor.cooldown[side] > 0
                    ? t("minor.reasons.cooldown", {n: state.minor.cooldown[side]})
                    : (state.minor.used[side] ? t("minor.reasons.used") : t("minor.ready")),
                actions: state.minor.options[side].map((option) => ({
                    key: option.key,
                    icon: MINOR_ICONS[option.key],
                    label: t(`minor.actions.${option.key}`),
                    testLine: testLine(option.key),
                    available: option.available,
                    reason: why(side, option),
                    reasonIcon: REASON_ICONS[option.reason] ?? "fa-lock",
                    description: describe(option.key)
                }))
            })),
            labels: {title: t("minor.menuTitle")}
        };
    }

    async _prepareContext() {
        const board = this.boardContext();
        const atEnd = this.cursor === this.frames.length - 1;
        return {
            ...board,
            boardLabel: t("viewer.board"),
            players: SIDES.map((side) => ({side, name: this.record?.names[side] ?? this.snapshot?.names[side] ?? side})),
            live: this.liveContext(),
            minorMenu: this.minorContext(),
            playing: this.timer !== null,
            atStart: this.cursor === 0,
            atEnd,
            log: this.frames.slice(1).map((f, i) => ({
                index: i + 1,
                side: f.move.side,
                round: f.round,
                text: moveText(f.move),
                active: i + 1 === this.cursor
            })),
            labels: {
                first: t("viewer.first"), back: t("viewer.back"), next: t("viewer.next"), last: t("viewer.last"),
                toggle: t(this.timer !== null ? "viewer.pause" : "viewer.play"), moves: t("viewer.moveLog")
            }
        };
    }

    /* -------------------------------------------- */
    /*  Rendering hooks                             */
    /* -------------------------------------------- */

    async _onFirstRender() {
        if (this.live) attachViewer(this);
    }

    async _onRender() {
        this.element.querySelector(".cs-cyvasse-viewer__log .is-active")?.scrollIntoView({block: "nearest"});
        this.watchBoardSize();
        this.fitBoard();
        this.animatePieces();
        this.startCountdown();
    }

    /**
     * Scale the board to the space the window gives it, so it is never cropped and
     * players never have to resize the window to see all of it. Re-runs whenever
     * the window (or the panel above the board) changes size.
     */
    fitBoard() {
        const area = this.element?.querySelector(".cs-cyvasse-viewer__scroll");
        const frame = area?.querySelector(".cs-cyvasse-board__frame");
        const board = frame?.querySelector(".cs-cyvasse-board");
        if (!area || !frame || !board) return;

        const width = board.offsetWidth;
        const height = board.offsetHeight;
        if (!width || !height) return;
        const fit = Math.min(
            (area.clientWidth - BOARD_PADDING_PX * 2) / width,
            (area.clientHeight - BOARD_PADDING_PX * 2) / height
        );
        const scale = Math.min(BOARD_MAX_SCALE, Math.max(BOARD_MIN_SCALE, Number.isFinite(fit) ? fit : 1));
        board.style.transform = `scale(${scale})`;
        frame.style.width = `${Math.round(width * scale)}px`;
        frame.style.height = `${Math.round(height * scale)}px`;
    }

    watchBoardSize() {
        this.resizeObserver?.disconnect();
        const area = this.element?.querySelector(".cs-cyvasse-viewer__scroll");
        if (!area || typeof ResizeObserver === "undefined") return;
        this.resizeObserver = new ResizeObserver(() => this.fitBoard());
        this.resizeObserver.observe(area);
    }

    async _onClose() {
        this.stop();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        if (this.countdownTimer !== null) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        detachViewer(this);
    }

    /**
     * Slide each piece that moved from its old hex to its new one, and let a
     * captured piece fade out where it stood. Only one step at a time, so
     * jumping around the log does not fling pieces across the board.
     */
    animatePieces() {
        const board = this.element.querySelector(".cs-cyvasse-board");
        const current = new Map();
        for (const el of this.element.querySelectorAll("[data-piece-id]")) {
            current.set(el.dataset.pieceId, {
                x: Number(el.dataset.x), y: Number(el.dataset.y), side: el.dataset.side, icon: el.dataset.icon
            });
        }

        const step = this.previousCursor !== null && Math.abs(this.cursor - this.previousCursor) === 1;
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (step && !reduce && board) {
            for (const el of this.element.querySelectorAll("[data-piece-id]")) {
                const before = this.previous.get(el.dataset.pieceId);
                const after = current.get(el.dataset.pieceId);
                if (!before || (before.x === after.x && before.y === after.y)) continue;
                el.animate(
                    [{transform: `translate(${before.x - after.x}px, ${before.y - after.y}px)`, zIndex: 5},
                        {transform: "translate(0, 0)", zIndex: 5}],
                    {duration: MOVE_ANIMATION_MS, easing: "ease-in-out"}
                );
            }
            for (const [id, gone] of this.previous) {
                if (current.has(id) || !ICONS_BY_CLASS.has(gone.icon)) continue;
                board.append(this.ghostPiece(gone));
            }
        }
        this.previous = current;
        this.previousCursor = this.cursor;
    }

    ghostPiece({x, y, side, icon}) {
        const ghost = document.createElement("span");
        ghost.className = `cs-piece cs-piece--${side} cs-piece--ghost`;
        ghost.style.left = `${x + HEX_W / 2 - PIECE_PX / 2}px`;
        ghost.style.top = `${y + HEX_H / 2 - PIECE_PX / 2}px`;
        const glyph = document.createElement("i");
        glyph.className = `fa-solid ${icon}`;
        ghost.append(glyph);
        ghost.animate([{opacity: 1, transform: "scale(1)"}, {opacity: 0, transform: "scale(1.6)"}],
            {duration: MOVE_ANIMATION_MS, easing: "ease-out"}).finished.then(() => ghost.remove(), () => ghost.remove());
        return ghost;
    }

    /** Counts the orders window down without re-rendering the whole viewer. */
    startCountdown() {
        if (this.countdownTimer !== null) return;
        this.countdownTimer = setInterval(() => {
            const el = this.element?.querySelector("[data-countdown]");
            if (el && this.deadlineAt !== null) {
                el.textContent = Math.max(0, Math.ceil((this.deadlineAt - performance.now()) / 1000));
            }
        }, COUNTDOWN_TICK_MS);
    }

    /* -------------------------------------------- */
    /*  Playback                                    */
    /* -------------------------------------------- */

    move(delta) {
        this.cursor = Math.min(this.frames.length - 1, Math.max(0, this.cursor + delta));
        if (this.cursor === this.frames.length - 1) this.stop();
        this.render();
    }

    stop() {
        if (this.timer !== null) clearInterval(this.timer);
        this.timer = null;
    }

    play() {
        if (this.cursor === this.frames.length - 1) this.cursor = 0;
        this.timer = setInterval(() => this.move(1), PLAY_INTERVAL_MS);
        this.render();
    }

    /** Looking at an earlier move stops the viewer following the live match. */
    scrub(cursor) {
        this.stop();
        this.following = false;
        this.cursor = cursor;
        this.render();
    }

    static onFirst() {
        this.scrub(0);
    }

    static onBack() {
        this.stop();
        this.following = false;
        this.move(-1);
    }

    static onNext() {
        this.stop();
        this.move(1);
    }

    static onLast() {
        this.stop();
        this.following = this.live;
        this.cursor = this.frames.length - 1;
        this.render();
    }

    static onToggle() {
        if (this.timer !== null) {
            this.stop();
            this.render();
        } else {
            this.play();
        }
    }

    static onGoto(event, target) {
        const index = Number.parseInt(target.dataset.index, 10);
        if (!Number.isInteger(index) || index < 0 || index >= this.frames.length) return;
        this.scrub(index);
    }

    /* -------------------------------------------- */
    /*  Live orders and GM controls                 */
    /* -------------------------------------------- */

    static onOrder(event, target) {
        const {side, order} = target.dataset;
        if (!this.snapshot || !SIDES.includes(side) || !ORDERS.includes(order)) return;
        sendOrder(this.snapshot.id, side, order);
    }

    static onMinor(event, target) {
        const {side, minor} = target.dataset;
        if (this.snapshot && SIDES.includes(side) && Object.hasOwn(MINOR.actions, minor)) sendMinor(this.snapshot.id, side, minor);
    }

    /** pause / resume / resolveNow / stop: the button's own data-action names the control. */
    static onControl(event, target) {
        if (this.snapshot && game.user.isGM) sendControl(this.snapshot.id, target.dataset.action);
    }

    static onPace(event, target) {
        const ms = Number(target.dataset.ms);
        if (!this.snapshot || !game.user.isGM || !Number.isFinite(ms)) return;
        sendControl(this.snapshot.id, "setPace", {ms: Math.min(PACE_LIMITS.max, Math.max(PACE_LIMITS.min, ms))});
    }
}

const ICONS_BY_CLASS = new Set(Object.values(ICONS));

/** Open the viewer on the live match, or on nothing if none is running. */
export function openLiveViewer() {
    if (!getLatest()) {
        ui.notifications.warn(t("live.none"));
        return null;
    }
    const existing = foundry.applications.instances.get("cs-cyvasse-live");
    if (existing) {
        existing.bringToFront();
        return existing;
    }
    const viewer = new CyvasseBoardViewer({id: "cs-cyvasse-live", live: true});
    viewer.render({force: true});
    return viewer;
}

setOpenHandler(openLiveViewer);
