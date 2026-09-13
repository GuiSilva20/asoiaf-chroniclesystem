/**
 * Tabela 9-5 line 8 ("Morte Horrenda") manual-trigger exception: instead of
 * the system trying to enumerate and auto-roll Vontade for every witness in
 * the scene (fragile - many NPCs have no logged-in owner to click for them),
 * the result card carries a button each connected player/GM clicks for
 * their own character(s).
 */

import {ChronicleSystem} from "../system/ChronicleSystem.js";
import SystemUtils from "../utils/systemUtils.js";
import {CSRoll} from "../rolls/cs-roll.js";
import {applyTemporaryEffect} from "./cs-temporary-effects.js";

const CHALLENGING_DIFFICULTY = 9;

/** Rolls Vontade at a fixed Desafiador(9) difficulty for the clicking user's own character. */
export async function promptWillpowerTest() {
    const actor = game.user.character;
    if (!actor) {
        ui.notifications.warn(SystemUtils.localize("CS.notifications.noControlledActor"));
        return;
    }

    const formula = ChronicleSystem.getActorAbilityFormula(actor, SystemUtils.localize(ChronicleSystem.keyConstants.WILL));
    const title = SystemUtils.format("CS.chat.results.witnessTestFlavor", {name: actor.name});
    const csRoll = new CSRoll(title, formula);
    const resultRoll = await csRoll.doRoll(actor, true);
    if (!resultRoll) return;

    if (resultRoll.total < CHALLENGING_DIFFICULTY) {
        await applyTemporaryEffect(actor, {
            kind: "penaltyBucket",
            bucket: ChronicleSystem.modifiersConstants.ALL,
            amount: 1,
            expiry: "endOfNextTurn",
            ownerTurnActorId: actor.id
        });
        ui.notifications.info(SystemUtils.format("CS.notifications.witnessTestFailed", {name: actor.name}));
    }
}
