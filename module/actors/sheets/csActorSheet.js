import {ChronicleSystem} from "../../system/ChronicleSystem.js";
import LOGGER from "../../utils/logger.js";
import SystemUtils from "../../utils/systemUtils.js";

export class CSActorSheet extends ActorSheet {

    async _onDropActor(event, data) {
        LOGGER.trace("On Drop Actor | CSActorSheet | csActorSheet.js");
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Everything below here is only needed if the sheet is editable
        if (!this.options.editable) return;

        html.find('.item .item-controls').on('click', (ev) => {
            ev.preventDefault();
            $(ev.currentTarget).parents('.item').find('.description').slideToggle();
        });

        // Create Inventory Item
        html.find('.item-create').click(this._onItemCreate.bind(this));

        // Update Inventory Item
        html.find('.item-edit').click(this._showEmbeddedItemSheet.bind(this));

        // Delete Inventory Item
        html.find('.item-delete').click(this._onItemDelete.bind(this));

        html.find('.rollable').click(this._onClickRoll.bind(this));
    }

    async _onClickRoll(event, targets) {
        // This runs as a jQuery handler, so a rejection here would otherwise
        // surface only as an unhandled promise rejection in the console and
        // look exactly like "nothing happened".
        try {
            await ChronicleSystem.eventHandleRoll(event, this.actor, targets);
        } catch (err) {
            LOGGER.error(`the roll failed | csActorSheet.js | ${err}`);
            ui.notifications.error(`Chronicle System: the roll failed - ${err.message}`);
            throw err;
        }
    }

    _showEmbeddedItemSheet(event) {
        event.preventDefault();
        const li = $(event.currentTarget).parents('.item');
        const item = this.actor.items.get(li.data('itemId'));
        item.sheet.render(true);
    }

    /**
     * Creates a new embedded item of the type declared by the clicked control
     * (data-type) and opens its sheet so it can be filled in right away.
     */
    async _onItemCreate(event) {
        event.preventDefault();
        // the control lives inside .item-controls on some lists, stop the
        // description from being toggled at the same time.
        event.stopPropagation();

        const type = event.currentTarget.dataset.type;
        if (!type || !this.isItemPermitted(type)) {
            LOGGER.warn(`the item type '${type}' is not permitted on this sheet | csActorSheet.js`);
            return;
        }

        const name = SystemUtils.format("CS.sheets.generalLabels.newItem", {
            type: SystemUtils.localize(`CS.sheets.itemTypes.${type}`)
        });

        const documents = await this.actor.createEmbeddedDocuments("Item", [{name: name, type: type}]);
        if (documents.length > 0) {
            documents[0].sheet.render(true);
        }
        return documents;
    }

    /**
     * Removes an embedded item from the actor after asking for confirmation.
     * The actor's _onDeleteEmbeddedDocuments takes care of cleaning up the
     * modifiers the item was granting.
     */
    async _onItemDelete(event) {
        event.preventDefault();
        event.stopPropagation();

        const li = $(event.currentTarget).parents('.item');
        const item = this.actor.items.get(li.data('itemId'));
        if (!item) {
            LOGGER.warn("the item to be deleted could not be found | csActorSheet.js");
            return;
        }

        const confirmed = await this._confirmItemDeletion(item);
        if (!confirmed) return;

        return this.actor.deleteEmbeddedDocuments("Item", [item._id]);
    }

    async _confirmItemDeletion(item) {
        return this._confirmDialog(
            SystemUtils.localize("CS.dialogs.deleteItem.title"),
            SystemUtils.format("CS.dialogs.deleteItem.content", {name: item.name})
        );
    }

    /**
     * Yes/no prompt, preferring the V2 dialog when the Foundry version provides
     * it and falling back to the legacy one otherwise.
     */
    async _confirmDialog(title, message) {
        const content = `<p>${message}</p>`;

        const dialogV2 = foundry.applications?.api?.DialogV2;
        if (dialogV2) {
            return dialogV2.confirm({
                window: {title: title},
                content: content,
                modal: true,
                rejectClose: false
            });
        }

        return Dialog.confirm({title: title, content: content, defaultYes: false});
    }

    isItemPermitted(type) {
        return true;
    }

    splitItemsByType(data) {
        data.itemsByType = {};
        for (const item of this.actor.getEmbeddedCollection("Item")) {
            let list = data.itemsByType[item.type];
            if (!list) {
                list = [];
                data.itemsByType[item.type] = list;
            }
            list.push(item);
        }
    }

    setPosition(options={}) {
        const position = super.setPosition(options);
        const sheetBody = this.element.find(".sheet-body");
        const bodyHeight = position.height - 192;
        sheetBody.css("height", bodyHeight);
        return position;
    }

    _checkNull(items) {
        if (items && items.length) {
            return items;
        }
        return [];
    }
    
    async _onDropItemCreate(itemData) {
        let embeddedItem = [];
        let itemsToCreate = [];
        let data = [];
        data = data.concat(itemData);
        data.forEach((doc) => {
            const item = this.actor.items.find((i) => {
                return i.name === doc.name;
            });
            if (item && item.type !== "weapon") {
                embeddedItem.push(this.actor.getEmbeddedDocument("Item", item.data._id));
            } else {
                if (this.isItemPermitted(doc.type))
                    itemsToCreate.push(doc);
            }
        });

        if (itemsToCreate.length > 0) {
            this.actor.createEmbeddedDocuments("Item", itemsToCreate)
                .then(function(result) {
                    result.forEach((item) => {
                        item.onObtained(item.actor);
                    });
                    embeddedItem.concat(result);
                });
        }

        return embeddedItem;
    }
}
