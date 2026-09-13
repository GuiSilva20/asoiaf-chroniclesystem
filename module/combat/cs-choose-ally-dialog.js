import SystemUtils from "../utils/systemUtils.js";
import {CSConstants} from "../system/csConstants.js";

/**
 * Tabela 9-6 line 2 ("Atacar Aliado") when more than one ally is adjacent:
 * lets the attacker/GM pick which one gets hit instead of picking the first
 * match arbitrarily. Uses the same hand-rolled Dialog + Promise pattern as
 * ChronicleSystem.js#_showModifierDialog.
 *
 * @param allyTokens non-empty array of Token
 * @returns {Promise<Token|null>} null if cancelled
 */
export async function showChooseAllyDialog(allyTokens) {
    const html = await renderTemplate(CSConstants.Templates.Dialogs.CHOOSE_ALLY, {
        allies: allyTokens.map((token) => ({id: token.id, name: token.name}))
    });

    return new Promise((resolve) => {
        new Dialog({
            title: SystemUtils.localize("CS.dialogs.chooseAlly.title"),
            content: html,
            buttons: {
                confirm: {
                    label: SystemUtils.localize("CS.dialogs.actions.confirm"),
                    callback: (root) => {
                        const element = root instanceof HTMLElement ? root : root[0];
                        const selectedId = element.querySelector('[name="allyTokenId"]')?.value;
                        resolve(allyTokens.find((token) => token.id === selectedId) ?? null);
                    }
                },
                cancel: {
                    label: SystemUtils.localize("CS.dialogs.actions.cancel"),
                    callback: () => resolve(null)
                }
            },
            default: "confirm",
            close: () => resolve(null)
        }).render(true);
    });
}
