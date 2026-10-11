import {CSItem} from "./csItem.js";
import {ChronicleSystem} from "../system/ChronicleSystem.js";
import LOGGER from "../utils/logger.js";
import {armorBulk, armorPenaltyMagnitude, armorRating} from "./armor-table.js";

// A function, not a constant: ChronicleSystem may still be loading when this
// module is evaluated.
const armorModifierTypes = () => [
    ChronicleSystem.modifiersConstants.AGILITY,
    ChronicleSystem.modifiersConstants.COMBAT_DEFENSE,
    ChronicleSystem.modifiersConstants.DAMAGE_TAKEN,
    ChronicleSystem.modifiersConstants.BULK
];

export class CSArmorItem extends CSItem {
    onEquippedChanged(actor, isEquipped) {
        LOGGER.trace(`Armor ${this._id} ${isEquipped? "equipped" : "unequipped" } by the actor ${actor.name} | csArmorItem.js`);
        super.onEquippedChanged(actor, isEquipped);
        if (isEquipped) {
            // The armor penalty hurts Agility tests and Combat Defense, and the
            // book prints it as "-N": apply the magnitude as a negative number.
            const penalty = -armorPenaltyMagnitude(this.getCSData().penalty);
            actor.addModifier(ChronicleSystem.modifiersConstants.AGILITY, this._id, penalty);
            actor.addModifier(ChronicleSystem.modifiersConstants.COMBAT_DEFENSE, this._id, penalty);
            actor.addModifier(ChronicleSystem.modifiersConstants.DAMAGE_TAKEN, this._id, armorRating(this.getCSData().rating));
            // Only worn armor weighs the character down (Capitulo 9, Volume).
            actor.addModifier(ChronicleSystem.modifiersConstants.BULK, this._id, armorBulk(this.getCSData().bulk));
        } else {
            this._removeArmorModifiers(actor, this._id);
        }
    }

    onDiscardedFromActor(actor, oldId) {
        LOGGER.trace(`Armor ${oldId} Discarded from actor | csArmorItem.js`);
        super.onDiscardedFromActor(actor, oldId);
        this._removeArmorModifiers(actor, oldId);
    }

    _removeArmorModifiers(actor, id) {
        armorModifierTypes().forEach((type) => actor.removeModifier(type, id));
    }
}
