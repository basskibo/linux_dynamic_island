import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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
        Main.layoutManager.addTopChrome(this._island);
        this._sources = SOURCES.map(Source => new Source(this._island, this._settings));
    }

    disable() {
        this._sources.forEach(source => source.destroy());
        this._sources = null;
        this._island.destroy();
        this._island = null;
        this._settings = null;
    }
}
