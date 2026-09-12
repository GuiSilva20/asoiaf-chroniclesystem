import {CSItemSheet} from "./csItemSheet.js";
import {getSuggestedSpecialties} from "../../system/csAbilities.js";
import SystemUtils from "../../utils/systemUtils.js";

export class CSAbilityItemSheet extends CSItemSheet {

    /** @override */
    getData(options) {
        const data = super.getData(options);
        // the specialties the book lists for this ability, offered as
        // suggestions on the name field — the table stays free to add its own
        data.suggestedSpecialties = getSuggestedSpecialties(this.item.name);
        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);

        html.find('.specialty-create').on("click", this._onClickSpecialtyCreate.bind(this));
        html.find(".specialties-list").on("click", ".specialty-control", this._onclickSpecialtyControl.bind(this));
    }

    /**
     * "Especialidades começam em 0. Ou seja, em princípio os personagens não
     * têm nenhuma especialidade." (Livro Básico p. 73)
     */
    async _onClickSpecialtyCreate(ev) {
        const item = this.item;
        let specialty = {
            name: "",
            rating: 0,
            modifier: 0
        };
        let newSpec = Object.values(item.getCSData().specialties);
        newSpec.push(specialty);
        return item.update({"system.specialties": newSpec});
    }

    async _onclickSpecialtyControl(event) {
        event.preventDefault();
        const a = event.currentTarget;
        const index = parseInt(a.dataset.id);
        const action = a.dataset.action;

        // Remove existing specialty
        if ( action === "delete" ) {
            const item = this.item;
            let newSpec = Object.values(item.getCSData().specialties);
            newSpec.splice(index,1);
            return item.update({"system.specialties": newSpec});
        }
    }

    /**
     * "Lembre-se de que suas graduações em uma especialidade não podem exceder
     * suas graduações na habilidade relacionada." (Livro Básico p. 73)
     *
     * Clamped on the way out of the form so the cap holds no matter how the
     * value was entered.
     */
    async _updateObject(event, formData) {
        const expanded = foundry.utils.expandObject(formData);
        const abilityRating = Math.max(
            0,
            parseInt(expanded.system?.rating ?? this.item.getCSData().rating, 10) || 0
        );

        const specialties = expanded.system?.specialties ?? {};
        let capped = false;

        for (const key of Object.keys(specialties)) {
            const raw = specialties[key]?.rating;
            if (raw === undefined) continue;

            const requested = parseInt(raw, 10) || 0;
            const allowed = Math.min(Math.max(0, requested), abilityRating);
            if (allowed !== requested) capped = true;

            formData[`system.specialties.${key}.rating`] = allowed;
        }

        if (capped) {
            ui.notifications.warn(
                SystemUtils.format("CS.notifications.specialtyCapped", {rating: abilityRating})
            );
        }

        return super._updateObject(event, formData);
    }
}
