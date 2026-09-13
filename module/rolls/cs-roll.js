import SystemUtils from "../utils/systemUtils.js";

/** Falls back to 0 for anything that is not a usable number. */
function num(value, fallback = 0) {
    const parsed = typeof value === "number" ? value : parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export class CSRoll {
    constructor(title, formula) {
        this.formula = formula;
        this.title = title;
        this.entityData = undefined;
        this.rollCard  = "systems/chroniclesystem/templates/chat/cs-base-rollcard.hbs";
        this.results = [];
        // Set by ChronicleSystem.handleRollAsync for weapon-test rolls so the
        // chat message can carry {weaponId, weaponName} - the "Aplicar Dano"
        // button reads it back from the message's flags.
        this.weaponContext = null;
    }

    /**
     * @param actor   the actor making the test
     * @param async   kept for call compatibility; DiceTerm#evaluate has been
     *                async-only since Foundry v12, so this is always awaited.
     */
    async doRoll(actor, async = true) {
        const pool = num(this.formula.pool);
        const bonusDice = num(this.formula.bonusDice);
        const dicePenalty = num(this.formula.dicePenalty);
        const reRoll = num(this.formula.reRoll);
        const modifier = num(this.formula.modifier);

        const kept = pool - dicePenalty;
        if (kept <= 0) {
            ui.notifications.info(SystemUtils.localize("CS.notifications.dicePoolInvalid"));
            return null;
        }

        const dices = Math.max(pool, 1) + bonusDice;
        const dieRoll = new foundry.dice.terms.Die({faces: 6, number: dices});
        await dieRoll.evaluate();

        // Die#reroll became async in v12. Without awaiting it, keep() below runs
        // against results the reroll has not finished rewriting, and the kept
        // dice come out wrong.
        if (reRoll > 0) {
            await dieRoll.reroll(`r${reRoll}=1`);
        }

        dieRoll.keep(`kh${kept}`);

        // only meaningful once the modifiers above have been applied
        this.results = dieRoll.results;

        // OperatorTerm sets _evaluated = true in its own constructor from v12
        // onwards ("Operator terms are always evaluated"), so calling evaluate()
        // on it throws "The OperatorTerm has already been evaluated". Only the
        // numeric term still needs evaluating, and Roll.fromTerms below requires
        // every term to be evaluated before it will accept them.
        const plus = new foundry.dice.terms.OperatorTerm({operator: "+"});
        const bonus = new foundry.dice.terms.NumericTerm({number: modifier});
        bonus.evaluate();

        const resultRoll = Roll.fromTerms([dieRoll, plus, bonus]);
        const messageId = this.formula.isUserChanged ? "CS.chatMessages.customRoll" : "CS.chatMessages.simpleRoll";
        const flavor = SystemUtils.format(messageId, {name: actor.name, test: this.title});

        const flags = this.weaponContext
            ? {chroniclesystem: {weaponTest: {
                actorId: actor.id,
                weaponId: this.weaponContext.weaponId,
                weaponName: this.weaponContext.weaponName,
                resolved: false
            }}}
            : {};

        await resultRoll.toMessage({
            speaker: ChatMessage.getSpeaker({actor: actor}),
            flavor: flavor,
            flags: flags
        });
        return resultRoll;
    }
}
