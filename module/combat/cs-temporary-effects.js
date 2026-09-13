/**
 * "Ate o fim do combate" / "ate o fim do proximo turno" duration handling
 * for Tabela 9-5/9-6 effects (+1B to allies, -1D penalties, -5 Combat
 * Defense). Nothing like this existed before this feature: the system's
 * modifier/penalty buckets (csCharacterActor.js) are permanent until
 * explicitly removed, and no combat round/turn hook was registered anywhere.
 *
 * Effects are tracked in a plain array on the actor
 * (`system.temporaryEffects`) rather than via Foundry's ActiveEffect, to
 * stay consistent with this codebase's existing bespoke modifier/penalty
 * store (ActiveEffect is unused anywhere else in the system).
 */

function getEffects(actor) {
    return Object.values(actor.getCSData().temporaryEffects || []);
}

/**
 * @param actor
 * @param kind      "modifierBucket" | "penaltyBucket" | "combatDefenseFlat"
 * @param bucket    modifier/penalty bucket key (ignored for combatDefenseFlat)
 * @param amount    signed delta
 * @param expiry    "endOfCombat" | "endOfNextTurn"
 * @param ownerTurnActorId  actor whose turn boundary controls "endOfNextTurn"
 *                          (required for that expiry, ignored otherwise)
 */
export async function applyTemporaryEffect(actor, {kind, bucket = null, amount, expiry, ownerTurnActorId = null}) {
    const id = foundry.utils.randomID();
    const combat = game.combat ?? null;

    const record = {
        id,
        kind,
        bucket,
        amount,
        combatId: combat?.id ?? null,
        expiry,
        createdRound: combat?.round ?? 0,
        createdTurn: combat?.turn ?? 0,
        ownerTurnActorId,
        passedOwnerTurn: false
    };

    const updateData = {};

    if (kind === "modifierBucket") {
        actor.updateTempModifiers();
        actor.addModifier(bucket, id, amount);
        updateData["system.modifiers"] = actor.modifiers;
    } else if (kind === "penaltyBucket") {
        actor.updateTempPenalties();
        actor.addPenalty(bucket, id, amount);
        updateData["system.penalties"] = actor.penalties;
    } else if (kind === "combatDefenseFlat") {
        const current = parseInt(actor.getCSData().derivedStats.combatDefense.modifier || 0);
        updateData["system.derivedStats.combatDefense.modifier"] = current + amount;
    }

    const effects = getEffects(actor);
    effects.push(record);
    updateData["system.temporaryEffects"] = effects;

    await actor.update(updateData);
    return id;
}

export async function revertTemporaryEffect(actor, effectId) {
    const effects = getEffects(actor);
    const index = effects.findIndex((effect) => effect.id === effectId);
    if (index < 0) return;

    const record = effects[index];
    effects.splice(index, 1);
    const updateData = {"system.temporaryEffects": effects};

    if (record.kind === "modifierBucket") {
        actor.updateTempModifiers();
        actor.removeModifier(record.bucket, effectId);
        updateData["system.modifiers"] = actor.modifiers;
    } else if (record.kind === "penaltyBucket") {
        actor.updateTempPenalties();
        actor.removePenalty(record.bucket, effectId);
        updateData["system.penalties"] = actor.penalties;
    } else if (record.kind === "combatDefenseFlat") {
        const current = parseInt(actor.getCSData().derivedStats.combatDefense.modifier || 0);
        updateData["system.derivedStats.combatDefense.modifier"] = current - record.amount;
    }

    await actor.update(updateData);
}

async function markPassedOwnerTurn(actor, effectId) {
    const effects = getEffects(actor);
    const record = effects.find((effect) => effect.id === effectId);
    if (!record || record.passedOwnerTurn) return;
    record.passedOwnerTurn = true;
    await actor.update({"system.temporaryEffects": effects});
}

/** Every actor (world-owned or an unlinked combat-only token) with any temporary effect recorded. */
function actorsWithEffects(combat) {
    const fromWorld = game.actors.contents;
    const fromCombat = (combat?.combatants?.contents ?? []).map((c) => c.actor).filter(Boolean);
    const seen = new Map();
    [...fromWorld, ...fromCombat].forEach((actor) => seen.set(actor.uuid, actor));
    return [...seen.values()].filter((actor) => getEffects(actor).length > 0);
}

/**
 * "Until the end of the owner's next turn" is tracked in two steps because a
 * single updateCombat call only sees one transition: first we notice combat
 * has *reached* the owner's next turn (created round/turn already passed)
 * and flag it; the following transition *away* from that turn is what
 * actually expires the effect.
 */
async function processNextTurnExpiry(combat) {
    for (const actor of actorsWithEffects(combat)) {
        for (const effect of getEffects(actor)) {
            if (effect.expiry !== "endOfNextTurn" || effect.combatId !== combat.id) continue;

            const ownerCombatant = combat.combatants.find((c) => c.actor?.id === effect.ownerTurnActorId);
            if (!ownerCombatant) {
                // Owner left the combat entirely - nothing left to wait on.
                await revertTemporaryEffect(actor, effect.id);
                continue;
            }

            const isOwnerCurrentTurn = combat.combatant?.id === ownerCombatant.id;
            const hasAdvancedPastCreation =
                combat.round > effect.createdRound ||
                (combat.round === effect.createdRound && combat.turn > effect.createdTurn);

            if (effect.passedOwnerTurn && !isOwnerCurrentTurn) {
                await revertTemporaryEffect(actor, effect.id);
            } else if (!effect.passedOwnerTurn && isOwnerCurrentTurn && hasAdvancedPastCreation) {
                await markPassedOwnerTurn(actor, effect.id);
            }
        }
    }
}

async function processEndOfCombat(combat) {
    for (const actor of actorsWithEffects(combat)) {
        for (const effect of getEffects(actor)) {
            if (effect.expiry === "endOfCombat" && effect.combatId === combat.id) {
                await revertTemporaryEffect(actor, effect.id);
            }
        }
    }
}

/**
 * Registered once from config.js. Only the GM's client runs cleanup, so
 * concurrent players don't race to update the same actor.
 */
export function registerTemporaryEffectHooks() {
    Hooks.on("updateCombat", (combat, changed) => {
        if (!game.user.isGM) return;
        if (changed.turn === undefined && changed.round === undefined) return;
        processNextTurnExpiry(combat);
    });

    Hooks.on("deleteCombat", (combat) => {
        if (!game.user.isGM) return;
        processEndOfCombat(combat);
    });
}
