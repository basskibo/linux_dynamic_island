import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Shows volume and brightness changes on the island instead of the shell's OSD pop-up.
// The OSD manager is only patched while "show-volume" is on, and any failure falls back
// to the shell's own OSD so a changed show() signature can't take the shell down.
export class OsdSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._originalShow = null;
        this._originalShowAll = null;
        this._settings.connectObject('changed::show-volume', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        if (this._settings.get_boolean('show-volume'))
            this._patch();
        else
            this._unpatch();
    }

    _patch() {
        if (this._originalShow)
            return;
        const osd = Main.osdWindowManager;
        const originalShow = osd.show;
        this._originalShow = originalShow;
        const originalShowAll = osd.showAll;
        this._originalShowAll = originalShowAll;
        osd.showAll = (...args) => {
            try {
                const [icon, label, level] = args;
                if (typeof icon !== 'string' && !(icon instanceof Gio.Icon))
                    throw new Error(`unexpected icon ${icon}`);
                this._island.toast(icon, Number.isFinite(level) ? '' : String(label ?? ''), {
                    level: Number.isFinite(level) ? level : null,
                    duration: 1500,
                });
            } catch (e) {
                console.warn(`Dynamic Island: volume OSD failed, using shell OSD: ${e}`);
                originalShowAll.apply(osd, args);
            }
        };
        osd.show = (...args) => {
            try {
                const [icon, label, levels] = args;
                const entry = Object.values(levels ?? {}).find(value => value != null);
                const level = entry?.level;
                if (typeof icon !== 'string' && !(icon instanceof Gio.Icon))
                    throw new Error(`unexpected icon ${icon}`);
                const hasLevel = Number.isFinite(level);
                this._island.toast(icon, hasLevel ? '' : String(label ?? ''), {level: hasLevel ? level : null, duration: 1500});
            } catch (e) {
                console.warn(`Dynamic Island: OSD integration failed, using the shell OSD: ${e}`);
                originalShow.apply(osd, args);
            }
        };
    }

    _unpatch() {
        if (!this._originalShow)
            return;
        Main.osdWindowManager.show = this._originalShow;
        Main.osdWindowManager.showAll = this._originalShowAll;
        this._originalShow = null;
        this._originalShowAll = null;
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._unpatch();
        this._island = null;
        this._settings = null;
    }
}
