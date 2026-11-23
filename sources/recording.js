import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {t, onLanguageChanged} from '../i18n.js';

const RED = '#ff453a';

const formatDuration = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

// Shows a red recording indicator with elapsed time; clicking it stops the screencast
export class RecordingSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._tickId = 0;
        this._start = 0;
        Main.screenshotUI.connectObject('notify::screencast-in-progress', () => this._sync(), this);
        settings.connectObject('changed::show-recording', () => this._sync(), this);
        this._unsubscribeI18n = onLanguageChanged(() => {
            if (this._tickId)
                this._renderIndicator();
        });
        // Enable also runs on unlock, possibly in the middle of a recording
        this._sync();
    }

    destroy() {
        Main.screenshotUI.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._unsubscribeI18n?.();
        this._unsubscribeI18n = null;
        this._stopTick();
        this._island = null;
        this._settings = null;
    }

    _stopTick() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    _renderIndicator() {
        this._island.setIndicator('recording', {
            icon: 'media-record-symbolic',
            color: RED,
            text: formatDuration(Math.floor((GLib.get_monotonic_time() - this._start) / 1e6)),
            accessibleName: t('recording.stop'),
            onClick: () => Main.screenshotUI.stopScreencast(),
        });
        return GLib.SOURCE_CONTINUE;
    }

    _sync() {
        this._stopTick();
        if (!Main.screenshotUI.screencast_in_progress || !this._settings.get_boolean('show-recording')) {
            this._island.setIndicator('recording', null);
            return;
        }
        this._start = GLib.get_monotonic_time();
        this._renderIndicator();
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._renderIndicator());
    }
}
