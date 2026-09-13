/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
import { ChronicleSystem } from "../../system/ChronicleSystem.js";
import { Technique } from "../../technique.js";
import {CSActorSheet} from "./csActorSheet.js";
import LOGGER from "../../utils/logger.js";
import SystemUtils from "../../utils/systemUtils.js";
import {CSConstants} from "../../system/csConstants.js";
import {buildMissingAbilityItems} from "../../system/csAbilities.js";


export class CSCharacterActorSheet extends CSActorSheet {
  itemTypesPermitted = [
      "ability",
      "weapon",
      "armor",
      "equipment",
      "benefit",
      "drawback",
      "technique"
  ]

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["chroniclesystem", "character", "sheet", "actor"],
      template: "systems/chroniclesystem/templates/actors/characters/character-sheet.hbs",
      width: 700,
      height: 900,
      tabs: [
        {
          navSelector: ".tabs",
          contentSelector: ".sheet-body",
          initial: "abilities"
        }
      ],
      dragDrop: [{dragSelector: ".item-list .item", dropSelector: null}]
    });
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    const data = super.getData();
    data.dtypes = ["String", "Number", "Boolean"];
    this.splitItemsByType(data);

    let character = data.actor.getCSData();
    this.isOwner = this.actor.isOwner;

    character.owned.equipments = this._checkNull(data.itemsByType['equipment']);
    character.owned.weapons = this._checkNull(data.itemsByType['weapon']);
    character.owned.armors = this._checkNull(data.itemsByType['armor']);
    character.owned.benefits = this._checkNull(data.itemsByType['benefit']);
    character.owned.drawbacks = this._checkNull(data.itemsByType['drawback']);

    // TextEditor.enrichHTML is async-only since v13; the old {{enrich}}
    // Handlebars helper called it synchronously and rendered "[object
    // Promise]" instead of the description. Enrich here, ahead of render,
    // and have the template output the resolved HTML directly.
    for (const item of [...character.owned.benefits, ...character.owned.drawbacks]) {
      item.enrichedDescription = await TextEditor.enrichHTML(item.system.description);
    }
    character.owned.abilities = this._checkNull(data.itemsByType['ability']).sort((a, b) => a.name.localeCompare(b.name));
    character.owned.techniques = this._checkNull(data.itemsByType['technique']).sort((a, b) => a.name.localeCompare(b.name));

    data.dispositions = ChronicleSystem.dispositions;

    data.notEquipped = ChronicleSystem.equippedConstants.IS_NOT_EQUIPPED;

    data.techniquesTypes = CSConstants.TechniqueType;
    data.techniquesCosts = CSConstants.TechniqueCost;

    character.owned.weapons.forEach((weapon) => {
      let weaponData = weapon.system;
      let info = weaponData.specialty.split(':');
      if (info.length < 2)
        return "";
      let formula = ChronicleSystem.getActorAbilityFormula(data.actor, info[0], info[1]);
      formula = ChronicleSystem.adjustFormulaByWeapon(data.actor, formula, weapon);
      weapon.updateDamageValue(this.actor);
      weapon.formula = formula;
    });

    for (const technique of character.owned.techniques) {
      let techniqueData = technique.system;
      let works = Object.values(techniqueData.works);
      for (const work of works) {
        if (work.type === "SPELL") {
          work.test.spellcastingFormula = ChronicleSystem.getActorAbilityFormula(data.actor, work.test.spellcasting, null);
        } else {
          work.test.alignmentFormula = ChronicleSystem.getActorAbilityFormula(data.actor, work.test.alignment, null);
          work.test.invocationFormula = ChronicleSystem.getActorAbilityFormula(data.actor, work.test.invocation, null);
          work.test.unleashingFormula = ChronicleSystem.getActorAbilityFormula(data.actor, work.test.unleashing, null);
        }
        work.enrichedDescription = await TextEditor.enrichHTML(work.description);
      }
    }

    this._calculateIntrigueTechniques(data);

    data.currentInjuries = Object.values(character.injuries).length;
    data.currentWounds = Object.values(character.wounds).length;
    data.maxInjuries = this.actor.getMaxInjuries();
    data.maxWounds = this.actor.getMaxWounds();
    data.maxStress = this.actor.getMaxStress();
    data.currentStress = character.currentStress;
    data.character = character;
    return data;
  }

  _calculateIntrigueTechniques(data) {
    let cunningValue = data.actor.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.CUNNING));
    let willValue = data.actor.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.WILL));
    let persuasionValue = data.actor.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION));
    let awarenessValue = data.actor.getAbilityValue(SystemUtils.localize(ChronicleSystem.keyConstants.AWARENESS));

    let bluffFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.DECEPTION), SystemUtils.localize(ChronicleSystem.keyConstants.BLUFF));
    let actFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.DECEPTION), SystemUtils.localize(ChronicleSystem.keyConstants.ACT));
    let bargainFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.BARGAIN));
    let charmFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.CHARM));
    let convinceFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.CONVINCE));
    let inciteFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.INCITE));
    let intimidateFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.INTIMIDATE));
    let seduceFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.SEDUCE));
    let tauntFormula = ChronicleSystem.getActorAbilityFormula(data.actor, SystemUtils.localize(ChronicleSystem.keyConstants.PERSUASION), SystemUtils.localize(ChronicleSystem.keyConstants.TAUNT));

    let intimidateDeceptionFormula = actFormula.bonusDice + actFormula.modifier > bluffFormula.bonusDice + bluffFormula.modifier ? actFormula : bluffFormula;

    data.techniques = {
      bargain: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.BARGAIN), cunningValue, bargainFormula, bluffFormula),
      charm: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.CHARM), persuasionValue, charmFormula, actFormula),
      convince: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.CONVINCE), willValue, convinceFormula, actFormula),
      incite: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.INCITE), cunningValue, inciteFormula, bluffFormula),
      intimidate: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.INTIMIDATE), willValue, intimidateFormula, intimidateDeceptionFormula),
      seduce: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.SEDUCE), persuasionValue, seduceFormula, bluffFormula),
      taunt: new Technique(SystemUtils.localize(ChronicleSystem.keyConstants.TAUNT), awarenessValue, tauntFormula, bluffFormula)
    };
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Everything below here is only needed if the sheet is editable
    if (!this.options.editable) return;

    html.find('.item .item-name').on('click', (ev) => {
      $(ev.currentTarget).parents('.item').find('.description').slideToggle();
    });

    html.find('.disposition.option').click(this._onDispositionChanged.bind(this));

    html.find('.equipped').click(this._onEquippedStateChanged.bind(this));

    html.find('.injury-create').on("click", this._onClickInjuryCreate.bind(this));
    html.find(".injuries-list").on("click", ".injury-control", this._onclickInjuryControl.bind(this));

    html.find('.wound-create').on("click", this._onClickWoundCreate.bind(this));
    html.find(".wounds-list").on("click", ".wound-control", this._onclickWoundControl.bind(this));

    html.find(".square").on("click", this._onClickSquare.bind(this));

    html.find('.ability-field').change(this._onAbilityFieldChanged.bind(this));
    html.find('.abilities-restore').click(this._onRestoreAbilities.bind(this));
  }

  /**
   * Writes a rank or modifier straight onto the embedded ability item. These
   * inputs deliberately carry no name attribute, so the actor's own form
   * submission never sees them.
   */
  async _onAbilityFieldChanged(event) {
    event.preventDefault();

    const input = event.currentTarget;
    const item = this.actor.items.get(input.dataset.itemId);
    if (!item) {
      LOGGER.warn("the ability being edited could not be found | csCharacterActorSheet.js");
      return;
    }

    // the passive-value operator is a +/-/* choice, not a number
    if (input.dataset.field === "system.passiveModifierOperator") {
      return item.update({[input.dataset.field]: input.value});
    }

    let value = parseInt(input.value, 10);
    if (isNaN(value)) value = 0;

    // a rank is never negative; a modifier may be
    if (input.dataset.field === "system.rating") value = Math.max(0, value);

    input.value = value;
    return item.update({[input.dataset.field]: value});
  }

  /**
   * Abilities are a closed list — "O narrador não é encorajado a expandir a
   * lista de habilidades" (Livro Básico p. 73) — so rather than letting the
   * user invent one, the sheet restores whichever of the 19 standard abilities
   * the character is missing, each at the rank the rules start it on.
   * Abilities the character already has keep their ranks and specialties.
   */
  async _onRestoreAbilities(event) {
    event.preventDefault();
    event.stopPropagation();

    const missing = buildMissingAbilityItems(this.actor);
    if (missing.length === 0) {
      return SystemUtils.displayMessage("notify", "CS.dialogs.restoreAbilities.nothingMissing");
    }

    const confirmed = await this._confirmDialog(
      SystemUtils.localize("CS.dialogs.restoreAbilities.title"),
      SystemUtils.format("CS.dialogs.restoreAbilities.content", {count: missing.length})
    );
    if (!confirmed) return;

    await this.actor.createEmbeddedDocuments("Item", missing);
    ui.notifications.info(
      SystemUtils.format("CS.dialogs.restoreAbilities.done", {count: missing.length})
    );
  }

  async setFrustrationValue(newValue) {
    let value = Math.max(Math.min(parseInt(newValue), this.actor.getCSData().derivedStats.frustration.total), 0);

    this.actor.updateTempPenalties();

    if (value > 0) {
      this.actor.addPenalty(ChronicleSystem.modifiersConstants.DECEPTION, ChronicleSystem.keyConstants.FRUSTRATION, value, false);
      this.actor.addPenalty(ChronicleSystem.modifiersConstants.PERSUASION, ChronicleSystem.keyConstants.FRUSTRATION, value, false);
    } else {
      this.actor.removePenalty(ChronicleSystem.modifiersConstants.DECEPTION, ChronicleSystem.keyConstants.FRUSTRATION);
      this.actor.removePenalty(ChronicleSystem.modifiersConstants.PERSUASION, ChronicleSystem.keyConstants.FRUSTRATION);
    }

    return this.actor.update({
      "system.derivedStats.frustration.current" : value,
      "system.penalties": this.actor.penalties
    });
  }

  async setFatigueValue(newValue) {
    let value = Math.max(Math.min(parseInt(newValue), this.actor.getCSData().derivedStats.fatigue.total), 0);

    this.actor.updateTempModifiers();

    if (value > 0) {
      this.actor.addModifier(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.FATIGUE, -value, false);
    } else {
      this.actor.removeModifier(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.FATIGUE);
    }

    return this.actor.update({
      "system.derivedStats.fatigue.current" : value,
      "system.modifiers": this.actor.modifiers
    });
  }

  /**
   * "Stress" is not a mechanic of this edition, so the track was removed from
   * the sheet. This handler is kept only to CLEAR it: any stress penalty an
   * actor still carries would otherwise sit on Awareness, Cunning and Status
   * forever, with no UI left to switch it off. It never adds a penalty again.
   */
  async setStressValue(newValue) {
    this.actor.updateTempPenalties();

    this.actor.removePenalty(ChronicleSystem.modifiersConstants.AWARENESS, ChronicleSystem.keyConstants.STRESS);
    this.actor.removePenalty(ChronicleSystem.modifiersConstants.CUNNING, ChronicleSystem.keyConstants.STRESS);
    this.actor.removePenalty(ChronicleSystem.modifiersConstants.STATUS, ChronicleSystem.keyConstants.STRESS);

    return this.actor.update({
      "system.currentStress" : 0,
      "system.penalties": this.actor.penalties
    });
  }

  async _onClickSquare(ev) {
    ev.preventDefault();
    let method = `set${ev.currentTarget.dataset.type}Value`;
    await this[method](ev.currentTarget.id);
  }

  async _onClickWoundCreate(ev) {
    ev.preventDefault();
    const data = this.actor.getCSData();
    let wound = "";
    let wounds = Object.values(data.wounds);
    if (wounds.length >= this.actor.getMaxWounds())
      return;
    wounds.push(wound);
    this.actor.updateTempPenalties();
    this.actor.addPenalty(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.WOUNDS, wounds.length, false);
    return this.actor.update({
      "system.wounds" : wounds,
      "system.penalties" : this.actor.penalties
    });
  }

  async _onclickWoundControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const index = parseInt(a.dataset.id);
    const action = a.dataset.action;

    if ( action === "delete" ) {
      const data = this.actor.getCSData();
      let wounds = Object.values(data.wounds);
      wounds.splice(index,1);

      this.actor.updateTempPenalties();
      if (wounds.length === 0) {
        this.actor.removePenalty(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.WOUNDS);
      } else {
        this.actor.addPenalty(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.WOUNDS, wounds.length, false);
      }
      return this.actor.update({
        "system.wounds" : wounds,
        "system.penalties" : this.actor.penalties
      });
    }
  }

  async _onClickInjuryCreate(ev) {
    ev.preventDefault();
    const data = this.actor.getCSData();
    let injury = "";
    let injuries = Object.values(data.injuries);
    if (injuries.length >= this.actor.getMaxInjuries())
      return;

    injuries.push(injury);

    this.actor.updateTempModifiers();
    this.actor.addModifier(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.INJURY, -injuries.length, false);

    return this.actor.update({
      "system.injuries" : injuries,
      "system.modifiers" : this.actor.modifiers
    });
  }

  async _onclickInjuryControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const index = parseInt(a.dataset.id);
    const action = a.dataset.action;

    if ( action === "delete" ) {
      const data = this.actor.getCSData();
      let injuries = Object.values(data.injuries);
      injuries.splice(index,1);

      this.actor.updateTempModifiers();
      if (injuries.length === 0) {
        this.actor.removeModifier(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.INJURY);
      } else {
        this.actor.addModifier(ChronicleSystem.modifiersConstants.ALL, ChronicleSystem.keyConstants.INJURY, -injuries.length, false);
      }

      return this.actor.update({
        "system.injuries" : injuries,
        "system.modifiers" : this.actor.modifiers
      });
    }
  }

  async _onEquippedStateChanged(event) {
    event.preventDefault();
    const eventData = event.currentTarget.dataset;
    let currentItem = this.actor.getEmbeddedDocument('Item', eventData.itemId);
    let collection = [];
    let tempCollection = [];

    let isArmor = parseInt(eventData.hand) === ChronicleSystem.equippedConstants.WEARING;
    let isUnequipping = parseInt(eventData.hand) === 0;

    this.actor.updateTempModifiers();

    if (isUnequipping) {
      let adaptableQuality = Object.values(currentItem.getCSData().qualities).filter((quality) => quality.name.toLowerCase() === "adaptable");
      if (adaptableQuality.length > 0 && parseInt(eventData.hand) === ChronicleSystem.equippedConstants.IS_NOT_EQUIPPED && currentItem.getCSData().equipped !== ChronicleSystem.equippedConstants.BOTH_HANDS) {
        collection = this.UnequipsAllItemsInTheSlots([ ChronicleSystem.equippedConstants.MAIN_HAND, ChronicleSystem.equippedConstants.OFFHAND, ChronicleSystem.equippedConstants.BOTH_HANDS], collection);
        collection = this.ChangeItemEquippedStatus(collection, currentItem, ChronicleSystem.equippedConstants.BOTH_HANDS);
      } else {
        collection = this.ChangeItemEquippedStatus(collection, currentItem);
      }
    } else {
      if (isArmor) {
        collection = this.UnequipsAllItemsInTheSlots([ ChronicleSystem.equippedConstants.WEARING], collection);
        collection = this.ChangeItemEquippedStatus(collection, currentItem, ChronicleSystem.equippedConstants.WEARING);
      } else {
        let twoHandedQuality = Object.values(currentItem.getCSData().qualities).filter((quality) => quality.name.toLowerCase() === "two-handed");
        if (twoHandedQuality.length > 0) {
          collection = this.UnequipsAllItemsInTheSlots([ ChronicleSystem.equippedConstants.MAIN_HAND, ChronicleSystem.equippedConstants.OFFHAND, ChronicleSystem.equippedConstants.BOTH_HANDS], collection);
          collection = this.ChangeItemEquippedStatus(collection, currentItem, ChronicleSystem.equippedConstants.BOTH_HANDS);
        } else {
          collection = this.UnequipsAllItemsInTheSlots([ parseInt(eventData.hand), ChronicleSystem.equippedConstants.BOTH_HANDS], collection);
          collection = this.ChangeItemEquippedStatus(collection, currentItem, parseInt(eventData.hand));
        }
      }
    }

    this.actor.saveModifiers();

    this.actor.updateEmbeddedDocuments('Item', collection);
  }

  UnequipsAllItemsInTheSlots(slots = [], collection = []) {
    let tempCollection = this.actor.getEmbeddedCollection('Item').filter((item) => slots.includes(item.getCSData().equipped));

    tempCollection.forEach((item) => {
      collection.push({_id: item._id, "system.equipped": ChronicleSystem.equippedConstants.IS_NOT_EQUIPPED});
      item.onEquippedChanged(this.actor, false);
    });

    return collection;
  }

  ChangeItemEquippedStatus(collection = [], item, equippedStatus = ChronicleSystem.equippedConstants.IS_NOT_EQUIPPED) {
    item.getCSData().equipped = equippedStatus;

    collection.push({_id: item._id, "system.equipped": item.getCSData().equipped});

    item.onEquippedChanged(this.actor, equippedStatus > 0);

    return collection;
  }

  async _onDispositionChanged(event, targets) {
    event.preventDefault();

    // currentTarget is the row the handler was bound to; target could be a
    // child node if the row ever gains inner markup.
    const rating = parseInt(event.currentTarget.dataset.id, 10);
    if (!ChronicleSystem.dispositions.find((disposition) => disposition.rating === rating)) {
      LOGGER.warn("the informed disposition does not exist.");
      return;
    }
    return this.actor.update({"system.currentDisposition": rating});
  }

  /* -------------------------------------------- */

  async _onDrop(event) {
    event.preventDefault();
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData('text/plain'));

    }
    catch (err) {
      return;
    }
    return super._onDrop(event);
  }

  isItemPermitted(type) {
    return this.itemTypesPermitted.includes(type);
  }

}
