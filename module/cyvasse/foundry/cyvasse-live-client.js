/**
 * The Foundry end of a live match: the system socket, the latest state every
 * client has seen, and the GM's running session.
 *
 * Trust model. The GM's client runs the match and is the only voice the others
 * believe: a `sync` or `open` counts only when it comes from a GM user, and
 * carries a snapshot that passes parseSnapshot. Going the other way, orders
 * from players reach the GM's LiveMatch, which checks the sender's ownership
 * of the character before acting on them.
 */

import {ORDERS, SIDES} from "../cyvasse-data.js";
import {parseHint, parseSnapshot} from "../cyvasse-live.js";
import {isMinorKey} from "../cyvasse-minor.js";

export const SOCKET = "system.chroniclesystem";

let session = null;
let latest = null;
/** What Think last told this user's side, for the round it was asked in. */
let latestHint = null;
let viewer = null;
let openHandler = null;
/** The GM asked this client to open the board, but the match's state has not arrived yet. */
let wantsViewer = false;

export const getLatest = () => latest;
export const getHint = () => latestHint;
export const hasSession = () => session !== null;

/** The viewer that wants live updates (one at a time). */
export function attachViewer(instance) { viewer = instance; }
export function detachViewer(instance) { if (viewer === instance) viewer = null; }
/** How to open the live viewer, supplied by the viewer module (avoids a circular import). */
export function setOpenHandler(handler) { openHandler = handler; }

const senderIsGM = (userId) => game.users.get(userId)?.isGM === true;

/** Apply a message that arrived over the socket, or that the GM's own client echoed to itself. */
export function receive(message, userId) {
    if (!message || typeof message !== "object") return;

    if (message.type === "sync") {
        if (!senderIsGM(userId)) return;
        const state = parseSnapshot(message.state);
        if (!state) return;
        latest = state;
        viewer?.applyState(state);
        // The board was asked for before the state existed here: open it now that there is something to show.
        if (wantsViewer) {
            wantsViewer = false;
            openHandler?.();
        }
    } else if (message.type === "hint") {
        if (!senderIsGM(userId)) return;
        const hint = parseHint(message);
        if (!hint) return;
        latestHint = {...hint, round: latest?.round ?? 0};
        viewer?.showHint(latestHint);
    } else if (message.type === "open") {
        // Whoever runs the match already opened the board itself. Everyone else does, GM or not.
        if (!senderIsGM(userId) || hasSession()) return;
        if (latest) {
            openHandler?.();
        } else {
            // The state may still be on its way (or was lost): ask for it and open the board when it arrives.
            wantsViewer = true;
            game.socket.emit(SOCKET, {type: "hello"});
        }
    } else if (session) {
        session.handle(message, userId);
    }
}

/** Send to the table. The socket does not echo to the sender, so the GM applies its own messages locally. */
export function broadcast(message) {
    game.socket.emit(SOCKET, message);
    if (hasSession()) receive(message, game.user.id);
}

/** A message for the GM's LiveMatch (an order, a control, a hello). */
export function sendToGM(message) {
    if (session) session.handle(message, game.user.id);
    else game.socket.emit(SOCKET, message);
}

export const sendOrder = (id, side, order) => {
    if (SIDES.includes(side) && ORDERS.includes(order)) sendToGM({type: "order", id, side, order});
};
export const sendMinor = (id, side, action) => {
    if (SIDES.includes(side) && isMinorKey(action)) sendToGM({type: "minor", id, side, action});
};
export const sendControl = (id, action, extra = {}) => sendToGM({type: "control", id, action, ...extra});

/** The GM's running LiveMatch, so socket traffic can be routed to it. */
export function startSession(liveMatch) { session = liveMatch; }
export function endSession() { session = null; }

/**
 * The server only relays a system's socket messages when the manifest says `"socket": true` AND it was read
 * when the world started. After that flag is added, reloading the browser is not enough: the world has to be
 * launched again. `game.system.socket` is what the server loaded, so it tells the two cases apart.
 * @returns whether the socket is usable
 */
export function socketIsOn() {
    return game.system?.socket === true;
}

function warnIfSocketOff() {
    if (socketIsOn() || !game.user.isGM) return;
    ui.notifications.error(game.i18n.localize("CS.cyvasse.live.socketOff"), {permanent: true});
}

/** Connect the socket. Late joiners ask the GM for the current state. */
export function registerLiveSocket() {
    Hooks.once("ready", () => {
        warnIfSocketOff();
        game.socket.on(SOCKET, (message, userId) => receive(message, userId));
        game.socket.emit(SOCKET, {type: "hello"});
    });
}

/**
 * The environment a LiveMatch needs, backed by Foundry: users, actor ownership
 * and the socket. `onFirstRecord` runs once, when the deployment first reaches
 * the table, and is where the GM opens everyone's viewer.
 */
export function createLiveIo(actorIds, {onFirstRecord}) {
    let announced = false;
    const actorOf = (side) => game.actors.get(actorIds[side]);
    const owns = (user, side) => Boolean(user && actorOf(side)?.testUserPermission(user, "OWNER"));

    return {
        broadcast(message) {
            broadcast(message);
            if (!announced && message.type === "sync" && message.state.record) {
                announced = true;
                onFirstRecord();
            }
        },
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        isGM: senderIsGM,
        canControl: (userId, side) => {
            const user = game.users.get(userId);
            return Boolean(user && (user.isGM || owns(user, side)));
        },
        random: () => (CONFIG.Dice?.randomUniform ?? Math.random)(),
        // Only that side's owners and the GMs are told: the socket delivers to `recipients` alone.
        sendPrivate(side, message) {
            const recipients = game.users
                .filter((user) => user.active && (user.isGM || owns(user, side)))
                .map((user) => user.id);
            game.socket.emit(SOCKET, message, {recipients});
            // The socket does not echo to the sender, so a recipient that is this very client hears it here.
            if (recipients.includes(game.user.id)) receive(message, game.user.id);
        }
    };
}
