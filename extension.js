import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Island} from './island.js';
import {BatterySource} from './sources/battery.js';
import {BluetoothSource} from './sources/bluetooth.js';
import {MediaSource} from './sources/media.js';
import {OsdSource} from './sources/osd.js';
import {ProgressSource} from './sources/progress.js';
import {RecordingSource} from './sources/recording.js';

const SOURCES = [MediaSource, OsdSource, BatterySource, RecordingSource, BluetoothSource, ProgressSource];

export default class DynamicIslandExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._island = new Island(this._settings);
        this._sources = [];
        try {
            SOURCES.forEach(Source => this._sources.push(new Source(this._island, this._settings)));
        } catch (e) {
            // The shell won't call disable() after a failed enable(), so the OSD patch and island would stay behind
            this.disable();
            throw e;
        }
    }

    disable() {
        this._sources.forEach(source => source.destroy());
        this._sources = null;
        this._island.destroy();
        this._island = null;
        this._settings = null;
    }
}
