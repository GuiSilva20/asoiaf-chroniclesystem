/**
 * Starting a match: the launcher dialog and the public API
 * (`ChronicleSystem.cyvasse.play`). A match is live by default: the GM's client
 * runs it, every connected player can watch the board, and the owners of the
 * two characters give attack/retreat orders in real time. `instant: true` runs
 * the whole match at once with no one watching, for macros.
 */

import {CSConstants} from "../../system/csConstants.js";
import SystemUtils from "../../utils/systemUtils.js";
import {LiveMatch, DEFAULT_LIVE_SETTINGS, PACE_LIMITS} from "../cyvasse-live.js";
import {playMatch} from "../cyvasse-match.js";
import {
    postDeployment, postLiveCard, postMatch, postMinor, postRound, postSummary, whisperThink
} from "./cyvasse-chat.js";
import {openLiveViewer} from "./cyvasse-board-viewer.js";
import {broadcast, createLiveIo, endSession, socketIsOn, startSession} from "./cyvasse-live-client.js";
import {buildProfile, createMinorProvider, createRoller} from "./cyvasse-profile.js";
import {t} from "./cyvasse-text.js";

const PACE_MS = {slow: 1600, normal: 900, fast: 400};
const MAX_ORDER_SECONDS = 120;

let matchRunning = false;

const toElement = (root) => (root instanceof HTMLElement ? root : root[0]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/* -------------------------------------------- */
/*  Public API                                  */
/* -------------------------------------------- */

/**
 * Play a match between two characters.
 * @param options {orderSeconds = 0, paceMs = 900, openForAll = true, autoPlay = false, seed, instant = false}
 *   By default every round WAITS until both sides are decided, by their owner or the GM;
 *   nothing moves on its own. `autoPlay: true` skips that and lets the characters decide.
 *   orderSeconds is how long a side nobody has chosen for waits before the
 *   character decides on its own; 0 waits for the players however long it takes.
 *   The roll results of every round always go to chat.
 * @returns the finished match record, or null when it could not start
 */
export async function playCyvasse(actorA, actorB, options = {}) {
    if (!game.user.isGM) {
        ui.notifications.warn(t("launcher.gmOnly"));
        return null;
    }
    if (!actorA || !actorB || actorA === actorB || actorA.type !== "character" || actorB.type !== "character") {
        ui.notifications.warn(t("launcher.needTwo"));
        return null;
    }
    if (matchRunning) {
        ui.notifications.warn(t("launcher.running"));
        return null;
    }

    // Without the socket the players never see the board or send orders: say so before the match begins.
    if (!options.instant && !socketIsOn()) ui.notifications.warn(t("live.socketOff"), {permanent: true});

    matchRunning = true;
    try {
        const profiles = {A: buildProfile(actorA), B: buildProfile(actorB)};
        const roller = createRoller({A: actorA, B: actorB});
        ui.notifications.info(t("launcher.started", {a: actorA.name, b: actorB.name}));

        let record;
        if (options.instant) {
            record = await playMatch({profiles, roller, options: {seed: options.seed}});
            await postMatch(record);
        } else {
            // The rounds were posted to chat as they were played; only the closing card is left.
            record = await runLive({actorA, actorB, profiles, roller, options});
            await postSummary(record);
        }
        return record;
    } finally {
        matchRunning = false;
    }
}

async function runLive({actorA, actorB, profiles, roller, options}) {
    const id = foundry.utils.randomID();
    const actorIds = {A: actorA.id, B: actorB.id};
    const io = createLiveIo(actorIds, {
        // Once the deployment exists there is something to look at: open the board here and,
        // if asked, on every other connected client.
        onFirstRecord: () => {
            openLiveViewer();
            if (options.openForAll !== false) broadcast({type: "open", id});
        }
    });
    const live = new LiveMatch({
        id, profiles, roller, io, actorIds,
        minor: createMinorProvider({A: actorA, B: actorB}),
        reporter: {
            deployed: postDeployment,
            round: postRound,
            // Everyone sees a minor action; only the thinker and the GM see what Think answered.
            minor: async (record, event, secret) => {
                await postMinor(record, event);
                if (!secret) return;
                const actor = event.side === "A" ? actorA : actorB;
                const recipients = game.users
                    .filter((user) => user.isGM || actor.testUserPermission(user, "OWNER"))
                    .map((user) => user.id);
                await whisperThink(record, event.side, secret, recipients);
            }
        },
        settings: {
            orderSeconds: clamp(Number(options.orderSeconds ?? DEFAULT_LIVE_SETTINGS.orderSeconds) || 0, 0, MAX_ORDER_SECONDS),
            paceMs: clamp(Number(options.paceMs ?? DEFAULT_LIVE_SETTINGS.paceMs), PACE_LIMITS.min, PACE_LIMITS.max),
            autoPlay: options.autoPlay === true
        },
        matchOptions: {seed: options.seed}
    });

    startSession(live);
    try {
        await postLiveCard({A: actorA.name, B: actorB.name});
        return await live.run();
    } finally {
        endSession();
    }
}

/* -------------------------------------------- */
/*  Launcher dialog                             */
/* -------------------------------------------- */

export async function openLauncher() {
    if (!game.user.isGM) {
        ui.notifications.warn(t("launcher.gmOnly"));
        return;
    }
    const characters = game.actors.filter((actor) => actor.type === "character");
    if (characters.length < 2) {
        ui.notifications.warn(t("launcher.noCharacters"));
        return;
    }

    const content = await renderTemplate(CSConstants.Templates.Cyvasse.LAUNCHER, {
        characters: characters.map((actor, index) => ({id: actor.id, name: actor.name, selectedB: index === 1})),
        orderSeconds: DEFAULT_LIVE_SETTINGS.orderSeconds,
        maxOrderSeconds: MAX_ORDER_SECONDS,
        paces: Object.keys(PACE_MS).map((key) => ({
            key, label: t(`launcher.pace${key[0].toUpperCase()}${key.slice(1)}`), selected: key === "normal"
        })),
        labels: {
            a: t("launcher.sideA"),
            b: t("launcher.sideB"),
            orderSeconds: t("launcher.orderSeconds"),
            pace: t("launcher.pace"),
            openForAll: t("launcher.openForAll"),
            autoPlay: t("launcher.autoPlay")
        }
    });

    new Dialog({
        title: t("launcher.title"),
        content,
        buttons: {
            play: {
                icon: '<i class="fa-solid fa-chess"></i>',
                label: t("launcher.play"),
                callback: (root) => {
                    const form = toElement(root);
                    const field = (name) => form.querySelector(`[name="${name}"]`);
                    playCyvasse(game.actors.get(field("actorA")?.value), game.actors.get(field("actorB")?.value), {
                        orderSeconds: Number(field("orderSeconds")?.value),
                        paceMs: PACE_MS[field("pace")?.value] ?? PACE_MS.normal,
                        openForAll: Boolean(field("openForAll")?.checked),
                        autoPlay: Boolean(field("autoPlay")?.checked)
                    });
                }
            },
            cancel: {label: SystemUtils.localize("CS.dialogs.actions.cancel")}
        },
        default: "play"
    }).render(true);
}

function directoryButton(icon, label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cs-cyvasse-launch";
    button.innerHTML = `<i class="fa-solid ${icon}" aria-hidden="true"></i> ${label}`;
    button.addEventListener("click", onClick);
    return button;
}

/**
 * Adds Cyvasse buttons to the Actors directory: "Play Cyvasse" for the Game Master, and "Watch live" for
 * everyone, so the board can be opened without depending on the chat card.
 */
export function registerCyvasseLauncher() {
    Hooks.on("renderActorDirectory", (app, html) => {
        const root = toElement(html);
        const header = root.querySelector(".directory-header .header-actions") ?? root.querySelector(".directory-header");
        if (!header || root.querySelector(".cs-cyvasse-launch")) return;
        if (game.user.isGM) header.append(directoryButton("fa-chess", t("actorsButton"), openLauncher));
        header.append(directoryButton("fa-tower-broadcast", t("live.watch"), () => openLiveViewer()));
    });
}
