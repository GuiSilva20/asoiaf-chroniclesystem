import {CSItem} from "./csItem.js";

export class CSAbilityItem extends CSItem {

    /**
     * Passive value house rule: rating x 4, adjusted by a manually chosen
     * +/-/* modifier. Computed here (not in the template) so both the
     * character sheet and any future consumer read the same number.
     */
    prepareDerivedData() {
        super.prepareDerivedData();

        const data = this.getCSData();
        const rating = Number(data.rating) || 0;
        const modifierValue = Number(data.passiveModifierValue) || 0;
        const operator = data.passiveModifierOperator || "+";

        data.passiveBase = rating * 4;

        switch (operator) {
            case "-":
                data.passiveTotal = data.passiveBase - modifierValue;
                break;
            case "*":
                data.passiveTotal = data.passiveBase * modifierValue;
                break;
            default:
                data.passiveTotal = data.passiveBase + modifierValue;
        }
    }
}