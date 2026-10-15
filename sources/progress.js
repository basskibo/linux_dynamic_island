import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

// Shows download / file copy progress published through the Unity LauncherEntry API (the one docks use)
export class ProgressSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._progress = new Map();
        this._subscription = Gio.DBus.session.signal_subscribe(null, 'com.canonical.Unity.LauncherEntry', 'Update',
            null, null, Gio.DBusSignalFlags.NONE, (connection, sender, path, iface, signal, params) => {
                const [appUri, props] = params.deepUnpack();
                this._onUpdate(appUri, props);
            });
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._subscription);
        this._progress = null;
        this._island = null;
        this._settings = null;
    }

    _onUpdate(appUri, props) {
        const state = this._progress.get(appUri) ?? {visible: false, value: 0};
        if ('progress-visible' in props)
            state.visible = props['progress-visible'].unpack();
        if ('progress' in props)
            state.value = props['progress'].unpack();
        this._progress.set(appUri, state);

        const key = `progress:${appUri}`;
        if (!state.visible || !this._settings.get_boolean('show-progress')) {
            this._island.setIndicator(key, null);
            return;
        }
        const app = Shell.AppSystem.get_default().lookup_app(appUri.replace('application://', ''));
        this._island.setIndicator(key, {
            icon: app?.get_icon() ?? 'folder-download-symbolic',
            text: `${Math.round(state.value * 100)}%`,
        });
    }
}
