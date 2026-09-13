/**
 * Tabela 9-5: Criticos. Row is the count of active "6"s rolled (1-8),
 * looked up via cs-damage-calculator.js#clampRow. Follows the same
 * plain-array-of-objects convention as ChronicleSystem.lawModifiers /
 * populationModifiers, rather than a switch statement.
 *
 * Each row's apply(ctx) receives:
 *   {attackerActor, attackerToken, targetActor, targetToken, weapon,
 *    rollTotal, defense}
 * and returns {extraDamage?, needsWitnessPrompt?}. Every actor mutation is
 * skipped when the relevant actor is null (manual/no-target mode).
 */

import {killActor} from "./cs-kill.js";
import {getAdjacentFriendlies, getAllies} from "./cs-adjacency.js";
import {applyTemporaryEffect} from "./cs-temporary-effects.js";
import {ChronicleSystem} from "../system/ChronicleSystem.js";

async function grantBonusDiceUntilEndOfCombat(token) {
    if (!token || !game.combat) return;
    await applyTemporaryEffect(token.actor, {
        kind: "modifierBucket",
        bucket: ChronicleSystem.modifiersConstants.BONUS_DICE,
        amount: 1,
        expiry: "endOfCombat"
    });
}

async function grantBonusDiceToAllies(attackerToken) {
    if (!attackerToken) return;
    const allies = getAllies(attackerToken);
    for (const ally of allies) {
        await grantBonusDiceUntilEndOfCombat(ally);
    }
}

export const CriticalTable = [
    {
        row: 1,
        labelKey: "CS.combat.critical.rows.1.label",
        descKey: "CS.combat.critical.rows.1.desc",
        async apply() {
            return {extraDamage: 2};
        }
    },
    {
        row: 2,
        labelKey: "CS.combat.critical.rows.2.label",
        descKey: "CS.combat.critical.rows.2.desc",
        async apply() {
            return {extraDamage: 4};
        }
    },
    {
        row: 3,
        labelKey: "CS.combat.critical.rows.3.label",
        descKey: "CS.combat.critical.rows.3.desc",
        async apply(ctx) {
            if (ctx.targetActor) await ctx.targetActor.addWound();
            return {};
        }
    },
    {
        row: 4,
        labelKey: "CS.combat.critical.rows.4.label",
        descKey: "CS.combat.critical.rows.4.desc",
        async apply(ctx) {
            if (ctx.targetActor) {
                const result = await ctx.targetActor.addInjury();
                if (result.added === "death") await killActor(ctx.targetActor);
            }
            return {};
        }
    },
    {
        row: 5,
        labelKey: "CS.combat.critical.rows.5.label",
        descKey: "CS.combat.critical.rows.5.desc",
        async apply(ctx) {
            if (ctx.targetActor) await killActor(ctx.targetActor);
            return {};
        }
    },
    {
        row: 6,
        labelKey: "CS.combat.critical.rows.6.label",
        descKey: "CS.combat.critical.rows.6.desc",
        async apply(ctx) {
            if (ctx.targetActor) await killActor(ctx.targetActor);

            // "todos os oponentes adjacentes a vitima": tokens sharing the
            // victim's own disposition, i.e. the attacker's other opponents.
            if (ctx.targetToken) {
                const opponents = getAdjacentFriendlies(ctx.targetToken);
                for (const opponentToken of opponents) {
                    const opponentActor = opponentToken.actor;
                    if (!opponentActor) continue;
                    const soak = opponentActor.getModifier(ChronicleSystem.modifiersConstants.DAMAGE_TAKEN)?.total ?? 0;
                    const current = parseInt(opponentActor.getCSData().derivedStats.health.current || 0);
                    const damage = Math.max(0, (ctx.weapon?.damageValue ?? 0) - soak);
                    await opponentActor.update({"system.derivedStats.health.current": Math.max(0, current - damage)});
                }
            }
            return {};
        }
    },
    {
        row: 7,
        labelKey: "CS.combat.critical.rows.7.label",
        descKey: "CS.combat.critical.rows.7.desc",
        async apply(ctx) {
            if (ctx.targetActor) await killActor(ctx.targetActor);
            await grantBonusDiceToAllies(ctx.attackerToken);
            return {};
        }
    },
    {
        row: 8,
        labelKey: "CS.combat.critical.rows.8.label",
        descKey: "CS.combat.critical.rows.8.desc",
        async apply(ctx) {
            if (ctx.targetActor) await killActor(ctx.targetActor);
            await grantBonusDiceUntilEndOfCombat(ctx.attackerToken);
            return {needsWitnessPrompt: true};
        }
    }
];
