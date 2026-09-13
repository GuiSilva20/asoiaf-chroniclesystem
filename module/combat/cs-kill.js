/**
 * Shared "kill" mechanic for Tabela 9-5 lines 5-8. No dead/defeated field
 * exists anywhere in this system's data model, so this reuses Foundry's own
 * native Combatant#defeated toggle when the actor is in the active combat
 * (matching the skull-icon convention every other Foundry system already
 * uses), and falls back to zeroing health + logging an injury outside of
 * combat, so there is still a visible trail on the sheet.
 */
export async function killActor(actor) {
    if (!actor) return;

    const combatant = game.combat?.combatants?.find((c) => c.actor?.id === actor.id);
    if (combatant) {
        await combatant.update({defeated: true});
    }

    await actor.update({"system.derivedStats.health.current": 0});

    if (!combatant) {
        await actor.addInjury();
    }
}
