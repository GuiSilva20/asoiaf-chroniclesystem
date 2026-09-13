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
        // Tabela 9-6 line 5 ("Quebra"): a broken weapon deals no damage
        // regardless of its formula, and can't be repaired back to a value.
        if (this.getCSData().broken) {
            this.damageValue = 0;
            return;
        }

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

        // Tabela 9-6 line 4 ("Dano Menor"): a permanent, cumulative penalty
        // from past fumbles, floored so a badly damaged weapon still works
        // (0 damage) rather than going negative.
        value = Math.max(0, value + parseInt(this.getCSData().damageModifierDelta || 0));
        this.damageValue = value;

        let adaptableQuality = Object.values(this.getCSData().qualities).filter((quality) => quality.name.toLowerCase() === "adaptable");
        if(adaptableQuality.length > 0 && this.getCSData().equipped === ChronicleSystem.equippedConstants.BOTH_HANDS) {
            this.damageValue += 1;
        }
    }

    /** Case-insensitive check against this weapon's qualities array. */
    hasQuality(name) {
        const qualities = Object.values(this.getCSData().qualities);
        return qualities.some((quality) => quality.name.toLowerCase() === name.toLowerCase());
    }

    /**
     * Tabela 9-6 line 4 ("Dano Menor"): permanently reduces the weapon's
     * damage. `delta` is expected to be negative (e.g. -1 per fumble).
     */
    async applyPermanentDamageReduction(delta) {
        const current = parseInt(this.getCSData().damageModifierDelta || 0);
        await this.update({"system.damageModifierDelta": current + delta});
    }

    /**
     * Tabela 9-6 line 5 ("Quebra"): the weapon shatters and can no longer be
     * wielded or repaired.
     */
    async markBroken() {
        await this.update({
            "system.broken": true,
            "system.equipped": ChronicleSystem.equippedConstants.IS_NOT_EQUIPPED
        });
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