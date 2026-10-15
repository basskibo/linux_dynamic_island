import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Shows volume and brightness changes on the island instead of the shell's OSD pop-up
export class OsdSource {
    constructor(island, settings) {
        const osd = Main.osdWindowManager;
        this._originalShow = osd.show;
        osd.show = (monitorIndex, icon, label, level, maxLevel) => {
            if (!settings.get_boolean('show-volume')) {
                this._originalShow.call(osd, monitorIndex, icon, label, level, maxLevel);
                return;
            }
            const hasLevel = typeof level === 'number';
            island.toast(icon, hasLevel ? '' : label ?? '', {level: hasLevel ? level : null, duration: 1500});
        };
    }

    destroy() {
        Main.osdWindowManager.show = this._originalShow;
        this._originalShow = null;
    }
}
