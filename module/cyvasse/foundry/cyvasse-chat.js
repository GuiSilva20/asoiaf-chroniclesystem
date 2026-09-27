/**
 * Chat output of a match: a deployment card, one card for EVERY round with the
 * roll results, and a closing card that carries the full record so the board
 * can be replayed later. A live match posts these as it goes, not at the end.
 */

import {CSConstants} from "../../system/csConstants.js";
import {MINOR, SIDES, otherSide} from "../cyvasse-data.js";
import {validateRecord} from "../cyvasse-record.js";
import {CyvasseBoardViewer, openLiveViewer} from "./cyvasse-board-viewer.js";
import SystemUtils from "../../utils/systemUtils.js";
import {MINOR_ICONS, moveText, resultText, t} from "./cyvasse-text.js";

const FLAG_SCOPE = "chroniclesystem";
const FLAG_KEY = "cyvasse";

const signed = (value) => (value > 0 ? `+${value}` : `${value}`);

/** What was rolled: the test's name, the dice pool and every die. Older records carry none of it. */
export function describeTest(test) {
    if (!test || typeof test !== "object") return null;
    const dice = Array.isArray(test.dice) ? test.dice.slice(0, 24) : [];
    const modifier = Number(test.modifier) || 0;
    return {
        name: t("chat.testName", {ability: String(test.ability ?? "").slice(0, 60), specialty: String(test.specialty ?? "").slice(0, 60)}),
        pool: t("chat.pool", {rolled: Number(test.rolled) || dice.length, kept: Number(test.kept) || 0}),
        bonus: Number(test.bonus) > 0 ? t("chat.bonusDice", {value: Number(test.bonus)}) : "",
        modifier: modifier ? t("chat.modifier", {value: signed(modifier)}) : "",
        dice: dice.map((die) => ({
            value: Number(die.value) || 0,
            kept: Boolean(die.kept),
            title: die.kept ? t("chat.dieKept") : t("chat.dieDiscarded")
        }))
    };
}

function sideRow(record, side, {roll, verdict, order}) {
    const pressure = roll.pressure ?? 0;
    return {
        test: describeTest(roll.test),
        side,
        name: record.names[side],
        total: roll.total + pressure,
        detail: roll.detail ?? "",
        pressure: pressure ? t("chat.pressure", {value: signed(pressure)}) : "",
        fumble: Boolean(roll.fumble),
        tier: verdict.tier,
        tierLabel: t(`tiers.${verdict.tier}`),
        bandLabel: t(`bands.${verdict.band}`),
        orderLabel: order ? t(`orders.${order}`) : ""
    };
}

function deploymentCard(record) {
    const {rolls, tiers} = record.deployment;
    return {
        title: t("chat.deployment"),
        sides: SIDES.map((side) => sideRow(record, side, {roll: rolls[side], verdict: tiers[side]})),
        moves: []
    };
}

function roundCard(record, round) {
    const order = [round.first, otherSide(round.first)];
    return {
        title: `${t("chat.round")} ${round.n}`,
        sides: order.map((side, index) => ({
            ...sideRow(record, side, {roll: round.rolls[side], verdict: round.sides[side], order: round.orders?.[side]}),
            first: index === 0
        })),
        firstLabel: t("chat.first"),
        moves: round.moves.map((move) => ({
            side: move.side,
            name: record.names[move.side],
            text: moveText(move),
            flavor: t(`flavor.${move.tier}`),
            brilliant: move.brilliant ? t("flavor.brilliant") : ""
        }))
    };
}

/** What each successful action does, worded with the numbers from the rules data. */
function effectText(event, names) {
    const rule = MINOR.actions[event.action].effect;
    const values = {
        name: names[event.side], target: names[event.target],
        value: Math.abs(rule.flat ?? rule.bonusDice ?? 0), pool: rule.poolDice ?? 0, bonus: rule.bonusDice ?? 0
    };
    return t(`minor.effects.${event.action}`, values);
}

/** The card for a minor action. Think's own result is not here: it is whispered (see thinkCard). */
function minorCard(record, event) {
    const name = record.names[event.side];
    const base = {
        title: t("minor.title"),
        icon: MINOR_ICONS[event.action] ?? "fa-dice",
        side: event.side,
        summary: t("minor.used", {name, action: t(`minor.actions.${event.action}`)}),
        test: null, versus: "", outcome: "", outcomeKind: ""
    };

    if (event.note) {
        return {...base, outcome: t(`minor.wasted.${event.note}`, {name}), outcomeKind: "failure"};
    }
    if (event.action === "think") {
        return {...base, outcome: t("minor.thinking", {name}), outcomeKind: "neutral"};
    }

    const attr = SystemUtils.localize(`CS.constants.abilities.${event.attr}`);
    const card = {
        ...base,
        test: describeTest(event.test),
        versus: t("minor.versus", {total: event.total, attr, passive: event.passive})
    };
    if (event.caught) {
        return {...card, outcome: t("minor.caught", {name, winner: record.names[event.target]}), outcomeKind: "caught"};
    }
    if (event.success) {
        const notice = event.action === "cheat" ? ` ${t("minor.unseen")}` : "";
        return {...card, outcome: `${t("minor.success")} ${effectText(event, record.names)}${notice}`, outcomeKind: "success"};
    }
    return {...card, outcome: t("minor.failure"), outcomeKind: "failure"};
}

/** The whispered card with what only the thinker (and the GM) learns from Think. */
function thinkCard(record, side, secret) {
    const name = record.names[side];
    const attr = SystemUtils.localize("CS.constants.abilities.cunning");
    const order = t(`orders.${secret.hint}`);
    return {
        title: t("minor.title"),
        icon: MINOR_ICONS.think,
        side,
        summary: t("minor.used", {name, action: t("minor.actions.think")}),
        test: describeTest(secret.test),
        versus: t("minor.versus", {total: secret.total, attr, passive: secret.passive}),
        outcome: secret.forced ? t("minor.hintForced", {order}) : t("minor.hint", {order}),
        outcomeKind: secret.forced ? "failure" : "success"
    };
}

function summaryCard(record) {
    const lost = {A: 0, B: 0};
    let brilliant = 0;
    for (const round of record.rounds) {
        for (const move of round.moves) {
            if (move.target) lost[otherSide(move.side)] += 1;
            if (move.brilliant) brilliant += 1;
        }
    }
    const {winner} = record.result;
    return {
        title: t("chat.summary"),
        winnerLabel: t("chat.winner"),
        winner: winner ? record.names[winner] : "",
        resultText: resultText(record),
        stats: [
            {label: t("chat.rounds"), value: record.result.rounds},
            {label: `${t("chat.captured")} (${record.names.A})`, value: lost.A},
            {label: `${t("chat.captured")} (${record.names.B})`, value: lost.B},
            {label: t("chat.brilliant"), value: brilliant}
        ],
        openLabel: t("chat.openBoard")
    };
}

async function post(template, data, flags = {}, whisper = null) {
    const content = await renderTemplate(template, data);
    return ChatMessage.create({
        content,
        speaker: {alias: t("title")},
        ...(whisper ? {whisper} : {}),
        flags: {[FLAG_SCOPE]: flags}
    });
}

/** A minor action, as it happened. Everyone sees it, except the result of Think. */
export const postMinor = (record, event) => post(CSConstants.Templates.Cyvasse.MINOR_CARD, minorCard(record, event));

/** Think's result, whispered to the given users only. */
export const whisperThink = (record, side, secret, recipients) =>
    post(CSConstants.Templates.Cyvasse.MINOR_CARD, thinkCard(record, side, secret), {}, recipients);

/** The deployment: how each side rolled and how well it set up. */
export const postDeployment = (record) => post(CSConstants.Templates.Cyvasse.ROUND_CARD, deploymentCard(record));

/** One finished round: both Warfare rolls, the verdicts, the orders and the moves. Every round gets a card. */
export const postRound = (record, entry) => post(CSConstants.Templates.Cyvasse.ROUND_CARD, roundCard(record, entry));

/** The closing card. It carries the full record, so it is the one the board viewer opens from. */
export const postSummary = (record) =>
    post(CSConstants.Templates.Cyvasse.SUMMARY_CARD, summaryCard(record), {[FLAG_KEY]: {record}});

/** Post a whole finished match at once (a match played with `instant: true`). */
export async function postMatch(record) {
    await postDeployment(record);
    for (const round of record.rounds) await postRound(record, round);
    await postSummary(record);
}

/** Opens the board viewer for a stored record, refusing damaged ones. */
export function openViewer(record, messageId = "match") {
    const check = validateRecord(record);
    if (!check.ok) {
        ui.notifications.warn(t("chat.invalidRecord"));
        return null;
    }
    const viewer = new CyvasseBoardViewer({id: `cs-cyvasse-viewer-${messageId}`, record});
    viewer.render({force: true});
    return viewer;
}

/** Announce a live match, with the button anyone (including a late joiner) can use to watch it. */
export async function postLiveCard(names) {
    return post(CSConstants.Templates.Cyvasse.LIVE_CARD, {
        title: t("live.chatTitle"),
        body: t("live.chatBody", {a: names.A, b: names.B}),
        watchLabel: t("live.watch")
    });
}

export function registerCyvasseChatListeners() {
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const element = html instanceof HTMLElement ? html : html[0];

        element.querySelector(".cs-cyvasse-open")?.addEventListener("click", () => {
            const stored = message.getFlag(FLAG_SCOPE, FLAG_KEY);
            openViewer(stored?.record, message.id);
        });
        element.querySelector(".cs-cyvasse-watch")?.addEventListener("click", () => openLiveViewer());
    });
}
