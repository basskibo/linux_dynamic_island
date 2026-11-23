import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { initI18n, destroyI18n } from './i18n.js';
import { buildCoverGroup, buildFeaturesGroup, buildVisualizerGroup } from './prefs/appearanceGroups.js';
import { buildGeneralGroup, buildIdlePanelGroup } from './prefs/generalGroups.js';
import { buildPositionGroup, buildResetGroup } from './prefs/layoutGroups.js';

export default class DynamicIslandPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        initI18n(settings);
        window.set_default_size(680, 760);

        let currentPage = null;
        let pageSignalIds = [];
        let rebuildIdleId = 0;

        const clearPageSignals = () => {
            for (const id of pageSignalIds)
                settings.disconnect(id);
            pageSignalIds = [];
        };

        const scheduleRebuild = () => {
            if (rebuildIdleId)
                return;
            rebuildIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                rebuildIdleId = 0;
                render();
                return GLib.SOURCE_REMOVE;
            });
        };

        const render = () => {
            clearPageSignals();
            if (currentPage)
                window.remove(currentPage);
            currentPage = this._buildPage(window, settings, pageSignalIds, scheduleRebuild);
            window.add(currentPage);
        };

        render();

        // Rebuild on idle so the Language ComboRow's dropdown finishes closing cleanly before removal
        const langSignalId = settings.connect('changed::language', scheduleRebuild);

        window.connect('close-request', () => {
            if (rebuildIdleId) {
                GLib.source_remove(rebuildIdleId);
                rebuildIdleId = 0;
            }
            settings.disconnect(langSignalId);
            clearPageSignals();
            if (settings.get_boolean('positioning-active'))
                settings.set_boolean('positioning-active', false);
            destroyI18n();
            return false;
        });
    }

    _buildPage(window, settings, pageSignalIds, scheduleRebuild) {
        const page = new Adw.PreferencesPage();
        page.add(buildGeneralGroup(window, settings, pageSignalIds));
        page.add(buildIdlePanelGroup(settings));
        page.add(buildPositionGroup(settings, pageSignalIds));
        page.add(buildCoverGroup(settings));
        page.add(buildVisualizerGroup(settings, pageSignalIds));
        page.add(buildFeaturesGroup(settings));
        page.add(buildResetGroup(window, settings, scheduleRebuild));
        return page;
    }
}
