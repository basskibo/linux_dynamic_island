import Gio from 'gi://Gio';
import GnomeBluetooth from 'gi://GnomeBluetooth';

import {t} from '../i18n.js';

const BLUE = '#0a84ff';

// Shows Bluetooth devices connecting and disconnecting
export class BluetoothSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._client = new GnomeBluetooth.Client();
        this._store = this._client.get_devices();
        this._devices = [];
        this._client.connectObject(
            'notify::default-adapter-powered', () => this._pushStatus(),
            'notify::default-adapter', () => this._pushStatus(),
            this
        );
        this._store.connectObject('items-changed', () => this._bindDevices(), this);
        this._bindDevices();
    }

    destroy() {
        this._devices.forEach(device => device.disconnectObject(this));
        this._devices = null;
        this._store.disconnectObject(this);
        this._store = null;
        this._client.disconnectObject(this);
        this._client = null;
        this._island = null;
        this._settings = null;
    }

    _bindDevices() {
        this._devices.forEach(device => device.disconnectObject(this));
        this._devices = [];
        for (let i = 0; i < this._store.get_n_items(); i++) {
            const device = this._store.get_item(i);
            device.connectObject(
                'notify::connected', () => {
                    this._onConnectedChanged(device);
                    this._pushStatus();
                },
                'notify::battery-percentage', () => this._pushStatus(),
                'notify::alias', () => this._pushStatus(),
                this
            );
            this._devices.push(device);
        }
        this._pushStatus();
    }

    _pushStatus() {
        if (!this._client || !this._store || !this._island)
            return;
        const powered = !!this._client.default_adapter_powered;
        const connected = [];
        for (let i = 0; i < this._store.get_n_items(); i++) {
            const device = this._store.get_item(i);
            if (device.connected) {
                connected.push({
                    alias: device.alias || device.name || '',
                    icon: `${device.icon}-symbolic`,
                    battery: device.battery_percentage > 0 ? Math.round(device.battery_percentage) : null,
                });
            }
        }
        this._island.setBluetoothStatus({powered, connected});
    }

    _onConnectedChanged(device) {
        if (!this._settings.get_boolean('show-bluetooth'))
            return;
        const hasBattery = device.connected && device.battery_percentage > 0;
        const text = device.connected
            ? hasBattery
                ? t('bluetooth.connectedBattery', {name: device.alias, percent: Math.round(device.battery_percentage)})
                : t('bluetooth.connected', {name: device.alias})
            : t('bluetooth.disconnected', {name: device.alias});
        // Device-specific icon (headphones, mouse...) when the theme has one
        const icon = Gio.ThemedIcon.new_from_names([`${device.icon}-symbolic`, 'bluetooth-active-symbolic']);
        this._island.toast(icon, text, {color: BLUE});
    }
}
