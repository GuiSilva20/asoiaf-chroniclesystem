# ASOIAF Chronicle System (patched)

A standalone republish of the "Chronicle System (Unofficial)" FoundryVTT
system, originally created by Kirlian "3darkman" Silvestre for Green Ronin's
Chronicle System (used by *A Song of Ice and Fire Roleplaying* / *Sword
Chronicles*): https://github.com/3darkman/foundryvtt-chroniclesystem

## Why this fork exists

This copy includes a bug fix not yet merged upstream: on a House's Event
item sheet, the **Lands** resource modifier field was missing its
`dataType="Number"` attribute (it had a `systemType="Number"` typo instead),
so the value was saved as a string. Adding modifiers from multiple events
then concatenated digits instead of summing them, making House Lands totals
grow spurious trailing zeros (e.g. `33` becoming `33000`).

Fixed in `templates/items/event.hbs`, plus a data migration
(`module/migrations/task061.js`) that repairs any Lands modifier values on
existing worlds that were already corrupted by the bug.

## Installing in Foundry VTT

Use the manifest URL when installing a system in Foundry's "Install System"
dialog:

```
https://raw.githubusercontent.com/GuiSilva20/asoiaf-chroniclesystem/main/system.json
```

## License

ISC — see [LICENSE](LICENSE). All credit for the original system goes to
Kirlian "3darkman" Silvestre.
