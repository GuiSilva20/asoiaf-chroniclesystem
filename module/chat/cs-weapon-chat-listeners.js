/**
 * Chat-side wiring for the weapon-damage feature: injects the "Aplicar
 * Dano" button onto weapon-test roll messages, and handles every button
 * click that follows (apply damage, spend a Destiny Point on a fumble,
 * request a witness's Willpower test). No renderChatMessage(HTML) hook
 * existed anywhere in this codebase before this feature.
 */

import {CSConstants} from "../system/csConstants.js";
import SystemUtils from "../utils/systemUtils.js";
import {resolveWeaponAttack} from "../combat/cs-apply-damage.js";
import {FumbleTable} from "../combat/cs-fumble-table.js";
import {promptWillpowerTest} from "../combat/cs-witness-test.js";

function toElement(html) {
    return html instanceof HTMLElement ? html : html[0];
}

async function showApplyDamageDialog({attackerActor, weapon, rollTotal}) {
    let targetActor = null;
    let targetToken = null;
    let defaultDefense = "";

    if (game.user.targets.size === 1) {
        targetToken = [...game.user.targets][0];
        targetActor = targetToken.actor ?? null;
        if (targetActor) {
            defaultDefense = targetActor.getCSData().derivedStats.combatDefense.total;
        }
    }

    const content = await renderTemplate(CSConstants.Templates.Dialogs.APPLY_DAMAGE, {
        attackerName: attackerActor.name,
        weaponName: weapon?.name ?? "",
        rollTotal,
        defense: defaultDefense,
        targetName: targetActor?.name ?? null
    });

    return new Promise((resolve) => {
        new Dialog({
            title: SystemUtils.localize("CS.dialogs.applyDamage.title"),
            content,
            buttons: {
                confirm: {
                    label: SystemUtils.localize("CS.dialogs.actions.confirm"),
                    callback: (root) => {
                        const element = toElement(root);
                        const value = parseInt(element.querySelector('[name="defense"]')?.value, 10);
                        resolve({
                            defense: Number.isFinite(value) ? value : 0,
                            targetActor,
                            targetToken
                        });
                    }
                },
                cancel: {
                    label: SystemUtils.localize("CS.dialogs.actions.cancel"),
                    callback: () => resolve({cancelled: true})
                }
            },
            default: "confirm",
            close: () => resolve({cancelled: true})
        }).render(true);
    });
}

async function onApplyDamageClick(message, weaponTest) {
    const attackerActor = game.actors.get(weaponTest.actorId);
    if (!attackerActor) return;
    if (!(game.user.isGM || attackerActor.isOwner)) {
        ui.notifications.warn(SystemUtils.localize("CS.notifications.notOwner"));
        return;
    }

    const roll = message.rolls?.[0];
    if (!roll) return;

    const weapon = weaponTest.weaponId ? attackerActor.items.get(weaponTest.weaponId) : null;
    const dialogResult = await showApplyDamageDialog({attackerActor, weapon, rollTotal: roll.total});
    if (dialogResult.cancelled) return;

    const attackerToken = attackerActor.getActiveTokens()[0] ?? null;

    await resolveWeaponAttack({
        attackerActor,
        attackerToken,
        weapon,
        roll,
        defense: dialogResult.defense,
        targetActor: dialogResult.targetActor,
        targetToken: dialogResult.targetToken
    });

    await message.setFlag("chroniclesystem", "weaponTest", {...weaponTest, resolved: true});
}

async function injectApplyDamageButton(message, html, weaponTest) {
    const container = html.querySelector(".message-content") ?? html;
    container.querySelector(".cs-apply-damage-wrapper")?.remove();

    if (weaponTest.resolved) {
        const wrapper = document.createElement("div");
        wrapper.className = "cs-apply-damage-wrapper";
        const label = document.createElement("button");
        label.type = "button";
        label.disabled = true;
        label.textContent = SystemUtils.localize("CS.chat.applyDamage.resolved");
        wrapper.appendChild(label);
        container.appendChild(wrapper);
        return;
    }

    const buttonHtml = await renderTemplate(CSConstants.Templates.Chat.APPLY_DAMAGE_BUTTON, {
        messageId: message.id,
        actorId: weaponTest.actorId,
        weaponId: weaponTest.weaponId,
        weaponName: weaponTest.weaponName,
        rollTotal: message.rolls?.[0]?.total ?? 0
    });
    const temp = document.createElement("div");
    temp.innerHTML = buttonHtml;
    const wrapper = temp.firstElementChild;
    container.appendChild(wrapper);

    wrapper.querySelector(".cs-apply-damage-button")?.addEventListener("click", () => {
        onApplyDamageClick(message, weaponTest);
    });
}

async function onSpendDestinyClick(message, fumbleResolution) {
    const attackerActor = game.actors.get(fumbleResolution.attackerActorId);
    if (!attackerActor) return;
    if (!(game.user.isGM || attackerActor.isOwner)) {
        ui.notifications.warn(SystemUtils.localize("CS.notifications.notOwner"));
        return;
    }

    const currentDestiny = parseInt(attackerActor.getCSData().derivedStats.destinyPoints.current || 0);
    if (currentDestiny <= 0) {
        ui.notifications.warn(SystemUtils.localize("CS.notifications.noDestinyPoints"));
        return;
    }

    const attackerToken = attackerActor.getActiveTokens()[0] ?? null;
    const weapon = fumbleResolution.weaponId ? attackerActor.items.get(fumbleResolution.weaponId) : null;
    const ctx = {attackerActor, attackerToken, weapon, rollTotal: message.rolls?.[0]?.total ?? 0};

    // Rows 4/5 can delegate down to a milder row when the weapon has the
    // right quality (castle-forged/valyrian steel) - effectiveRow tracks
    // which row's mutation actually ran, so it (not the nominal row) is
    // what gets reverted here.
    const currentRow = fumbleResolution.row;
    const effectiveRow = fumbleResolution.result?.effectiveRow ?? currentRow;
    await FumbleTable[effectiveRow - 1].revert(ctx, fumbleResolution.result);

    const newRow = Math.max(1, currentRow - 1);
    const newTableRow = FumbleTable[newRow - 1];
    const newResult = await newTableRow.apply(ctx);

    const newContent = await renderTemplate(CSConstants.Templates.Chat.DAMAGE_RESULT, {
        outcome: "fumble",
        row: newRow,
        label: SystemUtils.localize(newTableRow.labelKey),
        description: SystemUtils.localize(newTableRow.descKey),
        // Single-use per fumble, regardless of whether the new row would
        // otherwise still qualify.
        canSpendDestiny: false
    });

    await attackerActor.update({"system.derivedStats.destinyPoints.current": currentDestiny - 1});
    await message.update({
        content: newContent,
        "flags.chroniclesystem.fumbleResolution": {...fumbleResolution, row: newRow, result: newResult, spent: true}
    });
}

function wireSpendDestinyButton(message, html, fumbleResolution) {
    if (fumbleResolution.spent) return;
    const button = html.querySelector(".cs-spend-destiny-button");
    if (!button) return;
    button.addEventListener("click", () => {
        button.disabled = true;
        onSpendDestinyClick(message, fumbleResolution);
    }, {once: true});
}

function wireWitnessTestButton(html) {
    html.querySelector(".cs-witness-test-button")?.addEventListener("click", () => {
        promptWillpowerTest();
    });
}

export function registerWeaponChatListeners() {
    Hooks.on("renderChatMessageHTML", (message, html) => {
        const element = toElement(html);

        const weaponTest = message.getFlag("chroniclesystem", "weaponTest");
        if (weaponTest) injectApplyDamageButton(message, element, weaponTest);

        const fumbleResolution = message.getFlag("chroniclesystem", "fumbleResolution");
        if (fumbleResolution) wireSpendDestinyButton(message, element, fumbleResolution);

        wireWitnessTestButton(element);
    });
}
