import {CSConstants} from "../system/csConstants.js";
import {task030} from "./task030.js";
import {task061} from "./task061.js";
import {task072} from "./task072.js";

export async function migrateData() {
    if (!game.user?.isGM) {
        // players can't do this stuff anyhow.
        return;
    }
    const latest = game.system.version;
    const recentVersion = (game.settings.get(CSConstants.Settings.SYSTEM_NAME, CSConstants.Settings.CURRENT_VERSION) || "0.0.0");
    await game.settings.set(CSConstants.Settings.SYSTEM_NAME, CSConstants.Settings.CURRENT_VERSION, latest);
    const patchVersions = Object.keys(migrationRoutines);
    for (const version of patchVersions) {
        if (foundry.utils.isNewerVersion(version, recentVersion)) {
            // we need to do some updates.
            ui.notifications?.notify(`Beginning ${version} data migration.`, 'info');
            await migrationRoutines[version]();
            ui.notifications?.notify(`Applied ${version} data migration.`, 'info');
        }
    }
}
let migrationRoutines;
export function registerTask(version, task) {
    if (!migrationRoutines) {
        migrationRoutines = {};
    }
    migrationRoutines[version] = task;
}

registerTask("0.3.0", task030);
registerTask("0.6.1", task061);
registerTask("0.7.2", task072);

