import {CSItem} from "./csItem.js";
import {ChronicleSystem} from "../system/ChronicleSystem.js";
import LOGGER from "../utils/logger.js";
import {parseDamageFormula} from "../system/csAbilities.js";

export class CSWeaponItem extends CSItem {
    onEquippedChanged(actor, isEquipped) {
        LOGGER.trace(`Weapon ${this._id} ${isEquipped? "equipped" : "unequipped" } by the actor ${actor.name} | csWeaponItem.js`);
        super.onEquippedChanged(actor, isEquipped);
        //TODO: implement the onEquippedChanged from CSWeaponItem
    }

    /**
     * Damage is an ability rating, optionally shifted by an operator and a
     * number ("@athletics+2"). The ability is resolved through its canonical
     * key, so the formula survives a language change; getAbilityValue() would
     * otherwise fall through to its silent default of 2.
     */
    updateDamageValue(actor) {
        const {abilityKey, operator, modifier} = parseDamageFormula(this.getCSData().damage);
        if (!abilityKey) return;

        const rating = actor.getAbilityValue(abilityKey);
        const amount = parseInt(modifier);

        // Plain arithmetic instead of eval(): these operands come from item
        // data that a player can edit.
        let value = rating;
        if (operator && !isNaN(amount)) {
            switch (operator) {
                case "+": value = rating + amount; break;
                case "-": value = rating - amount; break;
                case "*": value = rating * amount; break;
                case "/": value = amount === 0 ? rating : Math.floor(rating / amount); break;
            }
        }
        this.damageValue = value;

        let adaptableQuality = Object.values(this.getCSData().qualities).filter((quality) => quality.name.toLowerCase() === "adaptable");
        if(adaptableQuality.length > 0 && this.getCSData().equipped === ChronicleSystem.equippedConstants.BOTH_HANDS) {
            this.damageValue += 1;
        }
    }

    onObtained(actor) {
        LOGGER.trace(`Weapon ${this._id} obtained by the actor ${actor.name} | csWeaponItem.js`);
        super.onObtained(actor);
        let qualities = this.getCSData().qualities;
        Object.values(qualities).forEach(quality => {
            switch (quality.name.toLowerCase())
            {
                case ChronicleSystem.modifiersConstants.BULK:
                    actor.addModifier(ChronicleSystem.modifiersConstants.BULK, this._id, parseInt(quality.parameter));
                    break;
            }
        });
    }

    onDiscardedFromActor(actor, oldId) {
        LOGGER.trace(`Weapon ${oldId} Discarded from actor | csWeaponItem.js`);
        super.onDiscardedFromActor(actor, oldId);
        let qualities = this.getCSData().qualities;
        console.log(qualities);
        Object.values(qualities).forEach(quality => {
            switch (quality.name.toLowerCase())
            {
                case ChronicleSystem.modifiersConstants.BULK:
                    actor.removeModifier(ChronicleSystem.modifiersConstants.BULK, oldId);
                    break;
            }
        });
    }
}