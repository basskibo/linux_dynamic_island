import Gio from 'gi://Gio';
import GnomeBluetooth from 'gi://GnomeBluetooth';

const BLUE = '#0a84ff';

// Shows Bluetooth devices connecting and disconnecting
export class BluetoothSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._client = new GnomeBluetooth.Client();
        this._store = this._client.get_devices();
        this._devices = [];
        this._store.connectObject('items-changed', () => this._bindDevices(), this);
        this._bindDevices();
    }

    destroy() {
        this._devices.forEach(device => device.disconnectObject(this));
        this._devices = null;
        this._store.disconnectObject(this);
        this._store = null;
        this._client = null;
        this._island = null;
        this._settings = null;
    }

    _bindDevices() {
        this._devices.forEach(device => device.disconnectObject(this));
        this._devices = [];
        for (let i = 0; i < this._store.get_n_items(); i++) {
            const device = this._store.get_item(i);
            device.connectObject('notify::connected', () => this._onConnectedChanged(device), this);
            this._devices.push(device);
        }
    }

    _onConnectedChanged(device) {
        if (!this._settings.get_boolean('show-bluetooth'))
            return;
        const battery = device.connected && device.battery_percentage > 0 ? ` · ${Math.round(device.battery_percentage)}%` : '';
        // Device-specific icon (headphones, mouse...) when the theme has one
        const icon = Gio.ThemedIcon.new_from_names([`${device.icon}-symbolic`, 'bluetooth-active-symbolic']);
        this._island.toast(icon, `${device.alias} ${device.connected ? 'connected' : 'disconnected'}${battery}`, {color: BLUE});
    }
}
