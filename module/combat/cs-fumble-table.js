/**
 * Tabela 9-6: Fracassos. Row is the count of active "1"s rolled (1-8, only
 * ever reached when every active die is a "1"). Same plain-array-of-rows
 * convention as cs-critical-table.js. Every row also exposes revert(ctx) so
 * the "gastar 1 Ponto de Destino" chat button can undo one row and re-apply
 * the row one step milder.
 */

import {CSConstants} from "../system/csConstants.js";
import {ChronicleSystem} from "../system/ChronicleSystem.js";
import {computeDamage} from "./cs-damage-calculator.js";
import {getAdjacentFriendlies} from "./cs-adjacency.js";
import {showChooseAllyDialog} from "./cs-choose-ally-dialog.js";
import {applyTemporaryEffect, revertTemporaryEffect} from "./cs-temporary-effects.js";

function armorSoak(actor) {
    return actor?.getModifier?.(ChronicleSystem.modifiersConstants.DAMAGE_TAKEN)?.total ?? 0;
}

async function dealDamage(actor, amount) {
    if (!actor || amount <= 0) return;
    const current = parseInt(actor.getCSData().derivedStats.health.current || 0);
    await actor.update({"system.derivedStats.health.current": Math.max(0, current - amount)});
}

export const FumbleTable = [
    {
        row: 1,
        labelKey: "CS.combat.fumble.rows.1.label",
        descKey: "CS.combat.fumble.rows.1.desc",
        async apply(ctx) {
            const damage = computeDamage(ctx.weapon?.damageValue ?? 0, 1, armorSoak(ctx.attackerActor)).final;
            await dealDamage(ctx.attackerActor, damage);
            return {selfDamage: damage, effectiveRow: 1};
        },
        async revert(ctx, result) {
            if (!ctx.attackerActor || !result?.selfDamage) return;
            const current = parseInt(ctx.attackerActor.getCSData().derivedStats.health.current || 0);
            await ctx.attackerActor.update({"system.derivedStats.health.current": current + result.selfDamage});
        }
    },
    {
        row: 2,
        labelKey: "CS.combat.fumble.rows.2.label",
        descKey: "CS.combat.fumble.rows.2.desc",
        async apply(ctx) {
            if (!ctx.attackerToken) return {hitAlly: null, effectiveRow: 2};

            const allies = getAdjacentFriendlies(ctx.attackerToken);
            let allyToken = null;
            if (allies.length === 1) {
                allyToken = allies[0];
            } else if (allies.length > 1) {
                allyToken = await showChooseAllyDialog(allies);
            }
            if (!allyToken?.actor) return {hitAlly: null, effectiveRow: 2};

            // Redirected hit uses the same roll total against the ally's own
            // Defense, but is resolved as a plain hit (no nested crit/fumble
            // re-check) to keep this self-contained rather than recursing
            // back into the full attack-resolution pipeline.
            const allyDefense = allyToken.actor.getCSData().derivedStats.combatDefense.total;
            const hit = ctx.rollTotal >= allyDefense;
            let damage = 0;
            if (hit) {
                const numeroDeVezes = Math.floor((ctx.rollTotal - allyDefense) / 5) + 1;
                damage = computeDamage(ctx.weapon?.damageValue ?? 0, Math.max(1, numeroDeVezes), armorSoak(allyToken.actor)).final;
                await dealDamage(allyToken.actor, damage);
            }
            return {hitAlly: allyToken.actor.name, allyHit: hit, allyDamage: damage, allyActorId: allyToken.actor.id, effectiveRow: 2};
        },
        async revert(ctx, result) {
            if (!result?.allyHit || !result.allyActorId) return;
            const allyActor = game.actors.get(result.allyActorId);
            if (!allyActor) return;
            const current = parseInt(allyActor.getCSData().derivedStats.health.current || 0);
            await allyActor.update({"system.derivedStats.health.current": current + result.allyDamage});
        }
    },
    {
        row: 3,
        labelKey: "CS.combat.fumble.rows.3.label",
        descKey: "CS.combat.fumble.rows.3.desc",
        async apply(ctx) {
            if (!ctx.weapon) return {effectiveRow: 3};
            const previousEquipped = ctx.weapon.getCSData().equipped;
            await ctx.weapon.update({"system.equipped": ChronicleSystem.equippedConstants.IS_NOT_EQUIPPED});
            return {previousEquipped, effectiveRow: 3};
        },
        async revert(ctx, result) {
            if (ctx.weapon && result?.previousEquipped !== undefined) {
                await ctx.weapon.update({"system.equipped": result.previousEquipped});
            }
        }
    },
    {
        row: 4,
        labelKey: "CS.combat.fumble.rows.4.label",
        descKey: "CS.combat.fumble.rows.4.desc",
        async apply(ctx) {
            // "Se a arma for forjada em castelo ou melhor, trate como 3."
            if (ctx.weapon?.hasQuality?.(CSConstants.WeaponQualities.CASTLE_FORGED) ||
                ctx.weapon?.hasQuality?.(CSConstants.WeaponQualities.VALYRIAN_STEEL)) {
                return FumbleTable[2].apply(ctx);
            }
            if (ctx.weapon) await ctx.weapon.applyPermanentDamageReduction(-1);
            return {effectiveRow: 4};
        },
        async revert(ctx) {
            if (ctx.weapon) await ctx.weapon.applyPermanentDamageReduction(1);
        }
    },
    {
        row: 5,
        labelKey: "CS.combat.fumble.rows.5.label",
        descKey: "CS.combat.fumble.rows.5.desc",
        async apply(ctx) {
            // "Se forjada em castelo, trate como 4; se aco valyriano, como 3."
            if (ctx.weapon?.hasQuality?.(CSConstants.WeaponQualities.VALYRIAN_STEEL)) {
                return FumbleTable[2].apply(ctx);
            }
            if (ctx.weapon?.hasQuality?.(CSConstants.WeaponQualities.CASTLE_FORGED)) {
                return FumbleTable[3].apply(ctx);
            }
            if (ctx.weapon) await ctx.weapon.markBroken();
            return {effectiveRow: 5};
        },
        async revert(ctx) {
            if (ctx.weapon) {
                await ctx.weapon.update({"system.broken": false});
            }
        }
    },
    {
        row: 6,
        labelKey: "CS.combat.fumble.rows.6.label",
        descKey: "CS.combat.fumble.rows.6.desc",
        async apply(ctx) {
            if (!ctx.attackerActor) return {effectiveRow: 6};
            const effectId = await applyTemporaryEffect(ctx.attackerActor, {
                kind: "penaltyBucket",
                bucket: ChronicleSystem.modifiersConstants.ALL,
                amount: 1,
                expiry: "endOfNextTurn",
                ownerTurnActorId: ctx.attackerActor.id
            });
            return {effectId, effectiveRow: 6};
        },
        async revert(ctx, result) {
            if (ctx.attackerActor && result?.effectId) {
                await revertTemporaryEffect(ctx.attackerActor, result.effectId);
            }
        }
    },
    {
        row: 7,
        labelKey: "CS.combat.fumble.rows.7.label",
        descKey: "CS.combat.fumble.rows.7.desc",
        async apply(ctx) {
            if (!ctx.attackerActor) return {effectiveRow: 7};
            const effectId = await applyTemporaryEffect(ctx.attackerActor, {
                kind: "penaltyBucket",
                bucket: ChronicleSystem.modifiersConstants.ALL,
                amount: 1,
                expiry: "endOfNextTurn",
                ownerTurnActorId: ctx.attackerActor.id
            });
            return {effectId, effectiveRow: 7};
        },
        async revert(ctx, result) {
            if (ctx.attackerActor && result?.effectId) {
                await revertTemporaryEffect(ctx.attackerActor, result.effectId);
            }
        }
    },
    {
        row: 8,
        labelKey: "CS.combat.fumble.rows.8.label",
        descKey: "CS.combat.fumble.rows.8.desc",
        async apply(ctx) {
            if (!ctx.attackerActor) return {effectiveRow: 8};
            const effectId = await applyTemporaryEffect(ctx.attackerActor, {
                kind: "combatDefenseFlat",
                amount: -5,
                expiry: "endOfNextTurn",
                ownerTurnActorId: ctx.attackerActor.id
            });
            return {effectId, effectiveRow: 8};
        },
        async revert(ctx, result) {
            if (ctx.attackerActor && result?.effectId) {
                await revertTemporaryEffect(ctx.attackerActor, result.effectId);
            }
        }
    }
];
