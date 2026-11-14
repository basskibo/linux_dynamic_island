import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const GREEN = '#30d158';
const SETTLE_MS = 1500;

// Charging state is not charger presence: charge limits and full batteries can
// stop charging while AC remains connected. UPower.OnBattery tracks the source.
export class BatterySource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._proxy = null;
        this._powerProxy = null;
        this._lastState = null;
        this._lastOnBattery = null;
        this._syncId = 0;
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();

        this._watchProxy('/org/freedesktop/UPower', 'org.freedesktop.UPower', proxy => {
            this._powerProxy = proxy;
            const onBattery = proxy.get_cached_property('OnBattery')?.unpack();
            this._lastOnBattery = typeof onBattery === 'boolean' ? onBattery : null;
        });
        this._watchProxy('/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device', proxy => {
            this._proxy = proxy;
            this._lastState = proxy.get_cached_property('State')?.unpack() ?? null;
        });
    }

    _watchProxy(path, iface, ready) {
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
            'org.freedesktop.UPower', path, iface, this._cancellable, (source, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`dynamic-island: UPower unavailable: ${e.message}`);
                    return;
                }
                if (this._destroyed)
                    return;
                ready(proxy);
                const watchedProperty = iface === 'org.freedesktop.UPower' ? 'OnBattery' : 'State';
                proxy.connectObject('g-properties-changed', (_proxy, changed, invalidated) => {
                    const properties = changed.unpack();
                    if (Object.hasOwn(properties, watchedProperty) || (invalidated ?? []).includes(watchedProperty))
                        this._queueSync();
                }, this);
            });
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
        if (this._syncId)
            GLib.source_remove(this._syncId);
        this._syncId = 0;
        this._proxy?.disconnectObject(this);
        this._powerProxy?.disconnectObject(this);
        this._proxy = null;
        this._powerProxy = null;
        this._island = null;
        this._settings = null;
    }

    _queueSync() {
        if (this._destroyed)
            return;
        if (this._syncId)
            GLib.source_remove(this._syncId);
        // Coalesce firmware/UPower bursts and notify only once the source settles.
        this._syncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._syncId = 0;
            this._onChanged();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onChanged() {
        if (this._destroyed)
            return;
        const onBattery = this._powerProxy?.get_cached_property('OnBattery')?.unpack();
        // Missing/invalidated properties are not evidence of a disconnection.
        if (typeof onBattery !== 'boolean')
            return;
        const state = this._proxy?.get_cached_property('State')?.unpack() ?? null;
        const rawPercent = this._proxy?.get_cached_property('Percentage')?.unpack();
        const percent = Number.isFinite(rawPercent) ? Math.round(Math.max(0, Math.min(100, rawPercent))) : null;
        const suffix = percent === null ? '' : ` · ${percent}%`;
        const icon = this._proxy?.get_cached_property('IconName')?.unpack() || 'battery-symbolic';
        const previousPower = this._lastOnBattery;
        const previousState = this._lastState;
        this._lastOnBattery = onBattery;
        this._lastState = state;

        // Establish the initial baseline silently, including after missing data.
        if (previousPower === null || !this._settings.get_boolean('show-battery'))
            return;
        if (onBattery !== previousPower) {
            this._island.toast(icon, `${onBattery ? 'On battery' : 'Charger connected'}${suffix}`, {
                color: onBattery ? null : GREEN,
                level: percent === null ? null : percent / 100,
            });
        } else if (!onBattery && state === 4 && previousState === 1) {
            this._island.toast(icon, `Fully charged${suffix}`, {color: GREEN});
        }
    }
}
