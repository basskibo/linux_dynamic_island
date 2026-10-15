import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const RED = '#ff453a';

const formatDuration = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

// Shows a red recording indicator with elapsed time; clicking it stops the screencast
export class RecordingSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._tickId = 0;
        Main.screenshotUI.connectObject('notify::screencast-in-progress', () => this._sync(), this);
    }

    destroy() {
        Main.screenshotUI.disconnectObject(this);
        this._stopTick();
        this._island = null;
        this._settings = null;
    }

    _stopTick() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    _sync() {
        this._stopTick();
        if (!Main.screenshotUI.screencast_in_progress || !this._settings.get_boolean('show-recording')) {
            this._island.setIndicator('recording', null);
            return;
        }
        const start = GLib.get_monotonic_time();
        const update = () => {
            this._island.setIndicator('recording', {
                icon: 'media-record-symbolic',
                color: RED,
                text: formatDuration(Math.floor((GLib.get_monotonic_time() - start) / 1e6)),
                onClick: () => Main.screenshotUI.stopScreencast(),
            });
            return GLib.SOURCE_CONTINUE;
        };
        update();
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, update);
    }
}
