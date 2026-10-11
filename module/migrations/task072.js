import {ChronicleSystem} from "../system/ChronicleSystem.js";

export async function task072() {
    // Before 0.7.2 armor applied its penalty with the sign typed by the user
    // (so "3" became a bonus), added its Bulk to the character for as long as
    // it was merely carried, and left its modifiers behind when deleted with
    // 0 Bulk. Rebuild every armor's modifiers from scratch: strip them all,
    // then re-apply only those of the armor currently worn.
    for (const actor of Array.from(game.actors?.values() || [])) {
        if (actor.type !== "character") continue;
        const armors = Array.from(actor.items?.values() || []).filter((item) => item.type === "armor");
        if (armors.length === 0) continue;

        actor.updateTempModifiers();
        for (const armor of armors) {
            armor.onEquippedChanged(actor, false);
            if (armor.getCSData().equipped === ChronicleSystem.equippedConstants.WEARING) {
                armor.onEquippedChanged(actor, true);
            }
        }
        actor.saveModifiers();
    }
}
