import Gio from 'gi://Gio';

const GREEN = '#30d158';
// UPower device states that mean "on AC power": charging, fully charged, pending charge
const PLUGGED = [1, 4, 5];

// Shows charger plugged / unplugged / fully charged
export class BatterySource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._proxy = null;
        this._cancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device',
            this._cancellable, (source, res) => {
                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`dynamic-island: UPower unavailable: ${e.message}`);
                    return;
                }
                this._lastState = this._proxy.get_cached_property('State')?.unpack();
                this._proxy.connectObject('g-properties-changed', () => this._onChanged(), this);
            });
    }

    destroy() {
        this._cancellable.cancel();
        this._cancellable = null;
        this._proxy?.disconnectObject(this);
        this._proxy = null;
        this._island = null;
        this._settings = null;
    }

    _onChanged() {
        const state = this._proxy.get_cached_property('State')?.unpack();
        const percent = Math.round(this._proxy.get_cached_property('Percentage')?.unpack() ?? 0);
        const icon = this._proxy.get_cached_property('IconName')?.unpack() || 'battery-symbolic';
        const previous = this._lastState;
        this._lastState = state;
        // Desktops report no battery (state 0)
        if (state === previous || !state || !this._settings.get_boolean('show-battery'))
            return;
        const plugged = PLUGGED.includes(state);
        if (state === 4 && previous === 1)
            this._island.toast(icon, `Fully charged · ${percent}%`, {color: GREEN});
        else if (plugged !== PLUGGED.includes(previous))
            this._island.toast(icon, `${plugged ? 'Charging' : 'On battery'} · ${percent}%`, {color: plugged ? GREEN : null, level: percent / 100});
    }
}
