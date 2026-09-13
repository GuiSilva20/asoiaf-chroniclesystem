/**
 * Orchestrates the "Aplicar Dano" flow: takes an already-completed weapon
 * roll plus a confirmed Defense value, resolves hit/miss, critical
 * (Tabela 9-5) or fumble (Tabela 9-6, opt-in), mutates actors/items, and
 * posts the result chat card. Calculation itself stays in
 * cs-damage-calculator.js (pure); this module is where documents get
 * mutated and chat messages get posted.
 */

import {CSConstants} from "../system/csConstants.js";
import {ChronicleSystem} from "../system/ChronicleSystem.js";
import SystemUtils from "../utils/systemUtils.js";
import {
    computeNumeroDeVezes,
    computeDamage,
    isCritical,
    isFumble,
    countFaceAmongActive,
    clampRow
} from "./cs-damage-calculator.js";
import {CriticalTable} from "./cs-critical-table.js";
import {FumbleTable} from "./cs-fumble-table.js";

export function armorSoakOf(actor) {
    return actor?.getModifier?.(ChronicleSystem.modifiersConstants.DAMAGE_TAKEN)?.total ?? 0;
}

function activeDieResultsOf(roll) {
    const dieTerm = roll.terms.find((term) => term instanceof foundry.dice.terms.Die);
    if (!dieTerm) return [];
    return dieTerm.results.filter((result) => result.active !== false).map((result) => result.result);
}

async function dealDamageToTarget(targetActor, finalDamage) {
    if (!targetActor || finalDamage <= 0) return;
    const current = parseInt(targetActor.getCSData().derivedStats.health.current || 0);
    await targetActor.update({"system.derivedStats.health.current": Math.max(0, current - finalDamage)});
}

async function postResultCard({attackerActor, flavor, flags = {}, ...data}) {
    const content = await renderTemplate(CSConstants.Templates.Chat.DAMAGE_RESULT, data);
    return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({actor: attackerActor}),
        flavor,
        content,
        flags
    });
}

/**
 * @returns the created result ChatMessage, so callers can wire up any
 *          follow-up button listeners (Destiny Point spend, witness test).
 */
export async function resolveWeaponAttack({attackerActor, attackerToken, weapon, roll, defense, targetActor, targetToken}) {
    await weapon?.updateDamageValue?.(attackerActor);
    const activeResults = activeDieResultsOf(roll);
    const fumbleOn = game.settings.get(CSConstants.Settings.SYSTEM_NAME, CSConstants.Settings.FUMBLE_RULES_ENABLED);

    const ctx = {
        attackerActor, attackerToken, targetActor, targetToken, weapon,
        rollTotal: roll.total, defense
    };

    if (fumbleOn && isFumble(activeResults)) {
        const row = clampRow(countFaceAmongActive(activeResults, 1));
        const tableRow = FumbleTable[row - 1];
        const result = await tableRow.apply(ctx);
        const canSpendDestiny = row > 1 && (attackerActor?.getCSData().derivedStats.destinyPoints.current ?? 0) > 0;

        return postResultCard({
            attackerActor,
            flavor: SystemUtils.localize("CS.chat.results.fumbleTitle"),
            outcome: "fumble",
            row,
            label: SystemUtils.localize(tableRow.labelKey),
            description: SystemUtils.localize(tableRow.descKey),
            weaponName: weapon?.name,
            attackerName: attackerActor?.name,
            canSpendDestiny,
            flags: {
                chroniclesystem: {
                    fumbleResolution: {
                        row,
                        result: result ?? {},
                        attackerActorId: attackerActor?.id ?? null,
                        attackerTokenId: attackerToken?.id ?? null,
                        weaponId: weapon?.id ?? null,
                        spent: false
                    }
                }
            }
        });
    }

    const targetName = targetActor?.name ?? SystemUtils.localize("CS.chat.results.unnamedTarget");

    const numeroDeVezes = computeNumeroDeVezes(roll.total, defense);
    if (numeroDeVezes <= 0) {
        return postResultCard({
            attackerActor,
            flavor: SystemUtils.localize("CS.chat.results.missTitle"),
            outcome: "miss",
            attackerName: attackerActor?.name,
            targetName,
            rollTotal: roll.total,
            defense
        });
    }

    const baseDamage = weapon?.damageValue ?? 0;
    const critical = isCritical(roll.total, defense);
    let extraDamage = 0;
    let criticalRowData = null;
    let needsWitnessPrompt = false;

    if (critical) {
        const row = clampRow(countFaceAmongActive(activeResults, 6));
        const tableRow = CriticalTable[row - 1];
        const result = await tableRow.apply(ctx);
        extraDamage = result?.extraDamage ?? 0;
        needsWitnessPrompt = !!result?.needsWitnessPrompt;
        criticalRowData = {
            row,
            label: SystemUtils.localize(tableRow.labelKey),
            description: SystemUtils.localize(tableRow.descKey)
        };
    }

    const soak = armorSoakOf(targetActor);
    const damage = computeDamage(baseDamage, numeroDeVezes, soak, extraDamage);
    await dealDamageToTarget(targetActor, damage.final);

    return postResultCard({
        attackerActor,
        flavor: SystemUtils.localize(critical ? "CS.chat.results.criticalTitle" : "CS.chat.results.hitTitle"),
        outcome: critical ? "critical" : "hit",
        attackerName: attackerActor?.name,
        targetName,
        rollTotal: roll.total,
        defense,
        numeroDeVezes,
        baseDamage,
        extraDamage,
        armorSoak: soak,
        finalDamage: damage.final,
        critical: criticalRowData,
        needsWitnessPrompt,
        attackerActorId: attackerActor?.id
    });
}
