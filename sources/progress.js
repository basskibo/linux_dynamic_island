import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import {t, onLanguageChanged} from '../i18n.js';

// App URIs come from any client on the bus
const MAX_ENTRIES = 16;

// Shows download / file copy progress published through the Unity LauncherEntry API (the one docks use)
export class ProgressSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._progress = new Map();
        this._subscription = Gio.DBus.session.signal_subscribe(null, 'com.canonical.Unity.LauncherEntry', 'Update',
            null, null, Gio.DBusSignalFlags.NONE, (connection, sender, path, iface, signal, params) => {
                const [appUri, props] = params.deepUnpack();
                this._onUpdate(appUri, props, sender);
            });
        // An app that crashes mid-download never sends the update that clears its progress
        this._ownerSubscription = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                const [name, , newOwner] = params.deepUnpack();
                if (!newOwner)
                    this._clear(state => state.sender === name);
            });
        settings.connectObject('changed::show-progress', () => {
            if (!settings.get_boolean('show-progress'))
                this._clear(() => true);
        }, this);
        this._unsubscribeI18n = onLanguageChanged(() => this._refreshAll());
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._subscription);
        Gio.DBus.session.signal_unsubscribe(this._ownerSubscription);
        this._settings.disconnectObject(this);
        this._unsubscribeI18n?.();
        this._unsubscribeI18n = null;
        this._progress = null;
        this._island = null;
        this._settings = null;
    }

    _refreshAll() {
        if (!this._progress || !this._settings.get_boolean('show-progress'))
            return;
        for (const [appUri, state] of this._progress) {
            if (state.visible)
                this._renderIndicator(appUri, state);
        }
    }

    _renderIndicator(appUri, state) {
        const app = Shell.AppSystem.get_default().lookup_app(appUri.replace('application://', ''));
        this._island.setIndicator(`progress:${appUri}`, {
            icon: app?.get_icon() ?? 'folder-download-symbolic',
            text: t('progress.percent', {percent: Math.round(state.value * 100)}),
        });
    }

    _clear(matches) {
        for (const [appUri, state] of this._progress) {
            if (matches(state)) {
                this._progress.delete(appUri);
                this._island.setIndicator(`progress:${appUri}`, null);
            }
        }
    }

    _onUpdate(appUri, props, sender) {
        if (!this._progress.has(appUri) && this._progress.size >= MAX_ENTRIES)
            return;
        const state = this._progress.get(appUri) ?? {visible: false, value: 0};
        state.sender = sender;
        if ('progress-visible' in props)
            state.visible = props['progress-visible'].unpack();
        if ('progress' in props)
            state.value = props['progress'].unpack();
        this._progress.set(appUri, state);

        const key = `progress:${appUri}`;
        if (!state.visible || !this._settings.get_boolean('show-progress')) {
            this._progress.delete(appUri);
            this._island.setIndicator(key, null);
            return;
        }
        this._renderIndicator(appUri, state);
    }
}
