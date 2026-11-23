import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Shows volume and brightness changes on the island instead of the shell's OSD pop-up.
// The OSD manager is only patched while "show-volume" is on, and any failure falls back
// to the shell's own OSD so a changed show() signature can't take the shell down.
export class OsdSource {
    constructor(island, settings) {
        this._island = island;
        this._settings = settings;
        this._restore = null;
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
        if (this._restore)
            return;
        const osd = Main.osdWindowManager;
        // Each reader returns [icon, label, level]. GNOME 49 replaced show(monitorIndex, icon, label, level) with
        // show(icon, label, levels per monitor) and showAll; showOne goes through show.
        const readers = osd.showAll ? {
            show: (icon, label, levels) => [icon, label, Object.values(levels)[0]?.level],
            showAll: (icon, label, level) => [icon, label, level],
        } : {
            show: (monitorIndex, icon, label, level) => [icon, label, level],
        };
        this._restore = Object.entries(readers).map(([name, read]) => {
            const wasOwn = Object.hasOwn(osd, name);
            const original = osd[name];
            osd[name] = (...args) => {
                try {
                    if (this._island.hiddenByFullscreen) {
                        original.apply(osd, args);
                        return;
                    }
                    const [icon, label, level] = read(...args);
                    if (typeof icon !== 'string' && !(icon instanceof Gio.Icon))
                        throw new Error(`unexpected icon ${icon}`);
                    const hasLevel = Number.isFinite(level);
                    this._island.toast(icon, hasLevel ? '' : String(label ?? ''), {level: hasLevel ? level : null, duration: 1500});
                } catch (e) {
                    console.warn(`Dynamic Island: OSD integration failed, using the shell OSD: ${e}`);
                    original.apply(osd, args);
                }
            };
            // Without an own property the method lives on the class again, as if never patched
            return () => {
                if (wasOwn)
                    osd[name] = original;
                else
                    delete osd[name];
            };
        });
    }

    _unpatch() {
        this._restore?.forEach(restore => restore());
        this._restore = null;
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._unpatch();
        this._island = null;
        this._settings = null;
    }
}
