export async function task061() {
    // A template typo (`systemType` instead of `dataType` on the Event item's
    // Lands modifier field) meant `system.modifiers.lands` was saved as a
    // string instead of a Number. String `+`/`+=` then turned House Lands
    // totals into concatenated digits (e.g. 33 -> 33000) instead of sums.
    // Coerce any already-corrupted values back to Number, then recompute
    // every House's resource totals from the repaired data.
    const houses = new Set();

    const fixEventItem = async (item) => {
        if (item.type !== 'event') return;
        const lands = item.getCSData().modifiers?.lands;
        if (typeof lands === 'string') {
            await item.update({ 'system.modifiers.lands': Number(lands) || 0 });
            if (item.isOwned && item.actor?.type === 'house') {
                houses.add(item.actor);
            }
        }
    };

    for (const item of Array.from(game.items?.values() || [])) {
        await fixEventItem(item);
    }

    for (const actor of Array.from(game.actors?.values() || [])) {
        for (const item of Array.from(actor.items?.values() || [])) {
            await fixEventItem(item);
        }
    }

    for (const house of houses) {
        house._updateAllResourcesTotal();
    }
}
