import {ChronicleSystem} from "../system/ChronicleSystem.js";
import {CSActor} from "./csActor.js";
import SystemUtils from "../utils/systemUtils.js";
import LOGGER from "../utils/logger.js";
import {CSConstants} from "../system/csConstants.js";
import {
    buildDefaultAbilityItems,
    abilityKeyFromName,
    specialtySlugFromName
} from "../system/csAbilities.js";

/**
 * Extend the base Actor entity by defining a custom roll data structure which is ideal for the Simple system.
 * @extends {CSActor}
 */
export class CSCharacterActor extends CSActor {
    modifiers;
    penalties;

    /**
     * A new character owns every ability in the book at 2 ranks
     * (Livro Básico p. 73: habilidades "começam com 2 graduações").
     * Actors that arrive carrying items already — a duplicate, an import, a
     * copy out of a compendium — are left exactly as they are.
     */
    async _preCreate(data, options, user) {
        await super._preCreate(data, options, user);

        if (Array.isArray(data.items) && data.items.length > 0) return;

        LOGGER.trace("seeding the standard abilities | csCharacterActor.js");
        this.updateSource({items: buildDefaultAbilityItems()});
    }

    prepareData() {
        super.prepareData();
        this.calculateMovementData();
    }

    prepareEmbeddedDocuments() {
        super.prepareEmbeddedDocuments();
    }

    prepareDerivedData() {
        super.prepareDerivedData()
        this.calculateDerivedValues()

    }

    /** @override */
    getRollData() {
        return super.getRollData();
    }


    calculateDerivedValues() {
        let data = this.getCSData();
        data.derivedStats.intrigueDefense.value = this.calcIntrigueDefense();
        data.derivedStats.intrigueDefense.total = data.derivedStats.intrigueDefense.value + parseInt(data.derivedStats.intrigueDefense.modifier);
        data.derivedStats.composure.value = this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.WILL)) * 3;
        data.derivedStats.composure.total = data.derivedStats.composure.value + parseInt(data.derivedStats.composure.modifier);
        data.derivedStats.combatDefense.value = this.calcCombatDefense();


        data.derivedStats.combatDefense.total = data.derivedStats.combatDefense.value + parseInt(data.derivedStats.combatDefense.modifier);
        data.derivedStats.health.value = this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.ENDURANCE)) * 3;
        data.derivedStats.health.total = data.derivedStats.health.value + parseInt(data.derivedStats.health.modifier);
        data.derivedStats.frustration.value = this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.WILL));
        data.derivedStats.frustration.total = data.derivedStats.frustration.value + parseInt(data.derivedStats.frustration.modifier);
        data.derivedStats.fatigue.value = this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.ENDURANCE));
        data.derivedStats.fatigue.total = data.derivedStats.fatigue.value + parseInt(data.derivedStats.fatigue.modifier);
    }

    getAbilities() {
        let items = this.getEmbeddedCollection("Item");
        return items.filter((item) => item.type === 'ability');
    }

    /**
     * Matches on the canonical ability key so a lookup written in one language
     * still finds an item stored in another — a weapon whose `specialty` field
     * says "Fighting:Long Blades" keeps working after the world is translated
     * to "Luta". Falls back to the raw name for non-standard abilities.
     */
    getAbility(abilityName) {
        let items = this.getEmbeddedCollection("Item");
        const wanted = abilityName.toString().trim().toLowerCase();
        const wantedKey = abilityKeyFromName(abilityName);

        const ability = items.find((item) => {
            if (item.type !== 'ability') return false;
            if (item.name.trim().toLowerCase() === wanted) return true;
            return wantedKey !== null && abilityKeyFromName(item.name) === wantedKey;
        });
        return [ability, undefined];
    }

    /**
     * Same language-independent matching as getAbility(), applied to the
     * specialty too: the slug is resolved within the owning ability, because
     * "Charm" is "Encantar" under Animal Handling and "Charme" under Persuasion.
     */
    getAbilityBySpecialty(abilityName, specialtyName) {
        let items = this.getEmbeddedCollection("Item");
        let specialty = null;

        const wantedAbility = abilityName.toString().trim().toLowerCase();
        const wantedAbilityKey = abilityKeyFromName(abilityName);
        const wantedSpecialty = specialtyName.toString().trim().toLowerCase();
        const wantedSpecialtySlug = specialtySlugFromName(wantedAbilityKey, specialtyName);

        const candidates = items.filter((item) => {
            if (item.type !== 'ability') return false;
            if (item.name.trim().toLowerCase() === wantedAbility) return true;
            return wantedAbilityKey !== null && abilityKeyFromName(item.name) === wantedAbilityKey;
        });

        const ability = candidates.find(function (ability) {
            let data = ability.getCSData();
            if (data.specialties === undefined)
                return false;

            // convert specialties list to array
            let specialties = data.specialties;
            let specialtiesArray = Object.keys(specialties).map((key) => specialties[key]);

            specialty = specialtiesArray.find((entry) => {
                if (!entry || typeof entry.name !== "string") return false;
                if (entry.name.trim().toLowerCase() === wantedSpecialty) return true;
                return (
                    wantedSpecialtySlug !== null &&
                    specialtySlugFromName(wantedAbilityKey, entry.name) === wantedSpecialtySlug
                );
            });
            if (specialty !== null && specialty !== undefined) {
                return true;
            }
        });

        return [ability, specialty];
    }

    getModifier(type, includeDetail = false, includeModifierGlobal = false) {
        this.updateTempModifiers();

        let total = 0;
        let detail = [];

        if (this.modifiers[type]) {
            this.modifiers[type].forEach((modifier) => {
                total += modifier.mod;
                if (includeDetail) {
                    let tempItem = modifier._id;
                    if (modifier.isDocument) {
                        tempItem = this.getEmbeddedDocument('Item', modifier._id);
                    }
                    if (tempItem) {
                        detail.push({docName: tempItem.name, mod: modifier.mod});
                    }
                }
            });
        }

        if (includeModifierGlobal && this.modifiers[ChronicleSystem.modifiersConstants.ALL]) {
            this.modifiers[ChronicleSystem.modifiersConstants.ALL].forEach((modifier) => {
                total += modifier.mod;
                if (includeDetail) {
                    let tempItem = modifier._id;
                    if (modifier.isDocument) {
                        tempItem = this.getEmbeddedDocument('Item', modifier._id);
                    }
                    if (tempItem)
                        detail.push({docName: tempItem.name, mod: modifier.mod});
                }
            });
        }

        return { total: total, detail: detail};
    }

    getPenalty(type, includeDetail = false, includeModifierGlobal = false) {
        this.updateTempPenalties();

        let total = 0;
        let detail = [];

        if (this.penalties[type]) {
            this.penalties[type].forEach((penalty) => {
                total += penalty.mod;
                if (includeDetail) {
                    let tempItem = penalty._id;
                    if (penalty.isDocument) {
                        tempItem = this.getEmbeddedDocument('Item', penalty._id);
                    }
                    if (tempItem) {
                        detail.push({docName: tempItem.name, mod: penalty.mod});
                    }
                }
            });
        }

        if (includeModifierGlobal && this.penalties[ChronicleSystem.modifiersConstants.ALL]) {
            this.penalties[ChronicleSystem.modifiersConstants.ALL].forEach((penalty) => {
                total += penalty.mod;
                if (includeDetail) {
                    let tempItem = penalty._id;
                    if (penalty.isDocument) {
                        tempItem = this.getEmbeddedDocument('Item', penalty._id);
                    }
                    if (tempItem)
                        detail.push({docName: tempItem.name, mod: penalty.mod});
                }
            });
        }

        return { total: total, detail: detail};
    }

    addModifier(type, documentId, value, isDocument = true, save = false) {
        LOGGER.trace(`add ${documentId} modifier to ${type} | csCharacterActor.js`);

        console.assert(this.modifiers, "call actor.updateTempModifiers before adding a modifier!");

        if (!this.modifiers[type]) {
            this.modifiers[type] = [];
        }

        let index = this.modifiers[type].findIndex((mod) => {
            return mod._id === documentId
        });
        if (index >= 0) {
            this.modifiers[type][index].mod = value;
        } else {
            this.modifiers[type].push({_id: documentId, mod: value, isDocument: isDocument});
        }

        if (save) {
            this.update({"system.modifiers": this.modifiers});
        }
    }

    addPenalty(type, documentId, value, isDocument = true, save = false) {
        LOGGER.trace(`add ${documentId} penalty to ${type} | csCharacterActor.js`);

        console.assert(this.penalties, "call actor.updateTempPenalties before adding a penalty!");

        if (!this.penalties[type]) {
            this.penalties[type] = [];
        }

        let index = this.penalties[type].findIndex((mod) => {
            return mod._id === documentId
        });

        if (index >= 0) {
            this.penalties[type][index].mod = value;
        } else {
            this.penalties[type].push({
                _id: documentId,
                mod: value,
                isDocument: isDocument
            });
        }

        if (save) {
            this.update({"system.penalties": this.penalties});
        }
    }

    removeModifier(type, documentId, save = false) {
        LOGGER.trace(`remove ${documentId} modifier to ${type} | csCharacterActor.js`);

        console.assert(this.modifiers, "call actor.updateTempModifiers before removing a modifier!");

        if (this.modifiers[type]) {
            // indexOf() does not take a predicate - passing one here always
            // returned -1, so splice(-1, 1) silently dropped the *last*
            // entry in the bucket instead of the one asked for.
            let index = this.modifiers[type].findIndex((mod) => mod._id === documentId);
            if (index >= 0) this.modifiers[type].splice(index, 1);
        }
        if (save)
            this.update({"system.modifiers" : this.modifiers});
    }

    removePenalty(type, documentId, save = false) {
        LOGGER.trace(`remove ${documentId} penalty to ${type} | csCharacterActor.js`);

        console.assert(this.penalties, "call actor.updateTempPenalties before removing a penalty!");

        if (this.penalties[type]) {
            // See removeModifier() above - same indexOf(predicate) bug.
            let index = this.penalties[type].findIndex((mod) => mod._id === documentId);
            if (index >= 0) this.penalties[type].splice(index, 1);
        }
        if (save)
            this.update({"system.penalties" : this.penalties});
    }

    /**
     * Adds a wound, mirroring the sheet's own "+ Wound" button
     * (csCharacterActorSheet.js#_onClickWoundCreate) so automated damage
     * (Tabela 9-5 crits) shares the exact same bookkeeping rule instead of
     * a second copy of it. Falls through to an injury when wounds are full,
     * per Tabela 9-5 line 3 ("Ferida Sangrenta").
     */
    async addWound() {
        const data = this.getCSData();
        const wounds = Object.values(data.wounds);
        if (wounds.length >= this.getMaxWounds()) {
            return this.addInjury();
        }
        wounds.push("");
        this.updateTempPenalties();
        this.addPenalty(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.WOUNDS, wounds.length, false);
        await this.update({"system.wounds": wounds, "system.penalties": this.penalties});
        return {added: "wound"};
    }

    /**
     * Adds an injury, mirroring csCharacterActorSheet.js#_onClickInjuryCreate.
     * Reports back when injuries are already full so the caller can trigger
     * the death fallback (Tabela 9-5 line 4 - "Ferimento Incapacitante").
     */
    async addInjury() {
        const data = this.getCSData();
        const injuries = Object.values(data.injuries);
        if (injuries.length >= this.getMaxInjuries()) {
            return {added: "death"};
        }
        injuries.push("");
        this.updateTempModifiers();
        this.addModifier(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.INJURY, -injuries.length, false);
        await this.update({"system.injuries": injuries, "system.modifiers": this.modifiers});
        return {added: "injury"};
    }

    getMaxInjuries() {
        return this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.ENDURANCE));
    }

    getMaxWounds() {
        return this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.ENDURANCE));
    }

    getMaxStress() {
        return ChronicleSystem.maxStress;
    }

    saveModifiers() {
        console.assert(this.modifiers, "call actor.updateTempModifiers before saving the modifiers!");
        this.update({"system.modifiers" : this.modifiers}, {diff:false});
    }

    savePenalties() {
        console.assert(this.penalties, "call actor.updateTempPenalties before saving the penalties!");
        this.update({"system.penalties" : this.penalties}, {diff:false});
    }

    getAbilityValue(abilityName) {
        const [ability,] = this.getAbility(abilityName);
        return ability !== undefined? ability.getCSData().rating : 2;
    }

    calcIntrigueDefense() {
        return this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.AWARENESS)) +
            this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.CUNNING)) +
            this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.STATUS));
    }

    calcCombatDefense() {
        let value = this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.AWARENESS)) +
            this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.AGILITY)) +
            this.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.ATHLETICS));

        if (game.settings.get(CSConstants.Settings.SYSTEM_NAME, CSConstants.Settings.ASOIAF_DEFENSE_STYLE)){
            let mod = this.getModifier(ChronicleSystem.modifiersConstants.COMBAT_DEFENSE);
            value += mod.total;
        }

        return value;
    }

    calculateMovementData() {
        const data = this.getCSData();

        // A single NaN anywhere in this sum makes the whole total NaN, which
        // the sheet renders as an empty box. Coerce every input first.
        const int = (value, fallback = 0) => {
            const parsed = parseInt(value, 10);
            return Number.isFinite(parsed) ? parsed : fallback;
        };

        const runFormula = ChronicleSystem.getActorAbilityFormula(this,
            SystemUtils.localize(ChronicleSystem.keyConstants.ATHLETICS),
            SystemUtils.localize(ChronicleSystem.keyConstants.RUN));
        const bulkMod = this.getModifier(SystemUtils.localize(ChronicleSystem.modifiersConstants.BULK));

        data.movement.base = ChronicleSystem.defaultMovement;
        data.movement.runBonus = Math.floor(int(runFormula?.bonusDice) / 2);
        data.movement.bulk = Math.floor(int(bulkMod?.total) / 2);
        data.movement.modifier = int(data.movement.modifier);
        data.movement.sprintMultiplier = int(data.movement.sprintMultiplier, 4);

        data.movement.total = Math.max(
            data.movement.base + data.movement.runBonus - data.movement.bulk + data.movement.modifier, 1);
        data.movement.sprintTotal = Math.max(
            data.movement.total * data.movement.sprintMultiplier - data.movement.bulk, 1);
    }

    _onDeleteEmbeddedDocuments(embeddedName, documents, result, options, userId) {
        super._onDeleteEmbeddedDocuments(embeddedName, documents, result, options, userId);
        this.updateTempModifiers();
        for (let i = 0; i < documents.length; i++) {
            documents[i].onDiscardedFromActor(this, result[0]);
        }
        this.saveModifiers();
    }

    _onCreateEmbeddedDocuments(embeddedName, documents, result, options, userId) {
        super._onCreateEmbeddedDocuments(embeddedName, documents, result, options, userId);
        this.updateTempModifiers();
        for (let i = 0; i < documents.length; i++) {
            documents[i].onObtained(this);
        }

        this.saveModifiers();
    }

    _onUpdateDescendantDocuments(embeddedName, documents, result, options, userId) {
        super._onUpdateDescendantDocuments(embeddedName, documents, result, options, userId);
        this.updateTempModifiers();
        result.forEach((doc) => {
            let item = this.items.find((item) => item._id === doc._id);
            if (item) {
                item.onObtained(this);
                item.onEquippedChanged(this, item.getCSData().equipped > 0);
            }
        })
        this.saveModifiers();
    }

    updateTempModifiers() {
        let data = this.getCSData()
        this.modifiers = data.modifiers;
    }

    updateTempPenalties() {
        let data = this.getCSData()
        this.penalties = data.penalties;
    }
}
