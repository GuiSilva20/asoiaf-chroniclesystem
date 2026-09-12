import {
    buildAbilitySpecialtyOptions,
    canonicalTestValue,
    parseDamageFormula,
    formatDamageFormula,
    CS_ABILITIES,
    CS_DAMAGE_OPERATORS,
    localizedAbilityName
} from "../../system/csAbilities.js";

/**
 * Extend the basic ItemSheet with some very simple modifications
 * @extends {ItemSheet}
 */
export class CSItemSheet extends ItemSheet {
    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["worldbuilding","chroniclesystem", "sheet", "item"],
            width: 650,
            height: 560,
        });
    }

    get template() {
        const path = 'systems/chroniclesystem/templates/items';
        return `${path}/${this.item.type}.hbs`;
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find('.item-delete').click((ev) => {
            if (this.item.actor) {
                this.item.actor.deleteEmbeddedDocuments("Item", [this.item._id,]);
            }
        });

        html.find(".item-qualities-control").on("click", this._onClickItemQualityControl.bind(this));
        html.find('.item-quality-create').on("click", this._onClickItemQualityCreate.bind(this));
    }

    async _onClickItemQualityCreate(ev) {
        const item = this.item;
        let quality = {
            name: "",
            parameter: ""
        };
        let newQuality = Object.values(item.getCSData().qualities);
        newQuality.push(quality);
        item.update({"system.qualities" : newQuality});
    }

    async _onClickItemQualityControl(event) {
        event.preventDefault();
        const a = event.currentTarget;
        const index = parseInt(a.dataset.id);
        const action = a.dataset.action;

        // Remove existing specialty
        if ( action === "delete" ) {
            const item = this.item;
            let qualities = Object.values(item.getCSData().qualities);
            qualities.splice(index,1);
            item.update({"system.qualities" : qualities});
        }
    }


    /* -------------------------------------------- */

    /** @override */
    getData() {
        const data = super.getData();
        data.dtypes = ["String", "Number", "Boolean"];

        // A weapon's test is picked from the closed ability/specialty list
        // instead of being typed by hand: free text was what silently broke
        // the dice pool whenever the stored spelling stopped matching.
        if (this.item.type === "weapon") {
            data.abilitySpecialtyOptions = buildAbilitySpecialtyOptions();
            data.currentTestValue = canonicalTestValue(this.item.system?.specialty);

            // Damage is edited as three controls (ability / operator / number)
            // and stored as one canonical string by _updateObject().
            data.abilityOptions = CS_ABILITIES.map((ability) => ({
                value: ability.key,
                label: localizedAbilityName(ability)
            }));
            data.damageOperators = CS_DAMAGE_OPERATORS;
            data.damage = parseDamageFormula(this.item.system?.damage);
        }

        return data;
    }

    /* -------------------------------------------- */

    /**
     * Recomposes system.damage from the three damage controls. They are named
     * outside the system.* namespace so Foundry does not persist them, and the
     * canonical string ("@athletics+2") is written in their place.
     */
    async _updateObject(event, formData) {
        if (this.item.type === "weapon") {
            const abilityKey = formData["damage.abilityKey"];
            const operator = formData["damage.operator"];
            const modifier = formData["damage.modifier"];

            if (abilityKey !== undefined) {
                formData["system.damage"] = formatDamageFormula({abilityKey, operator, modifier});
            }

            delete formData["damage.abilityKey"];
            delete formData["damage.operator"];
            delete formData["damage.modifier"];
        }

        return super._updateObject(event, formData);
    }

    /* -------------------------------------------- */

    /** @override */
    setPosition(options={}) {
        const position = super.setPosition(options);
        const sheetBody = this.element.find(".sheet-body");
        const bodyHeight = position.height - 142;
        sheetBody.css("height", bodyHeight);
        return position;
    }
}
