import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { PANEL_SLOTS } from './layout.js';

export class Positioner {
    constructor(island, topRow, settings, callbacks) {
        this._island = island;
        this._topRow = topRow;
        this._settings = settings;
        this._callbacks = callbacks;
        this._destroyed = false;
        this._slot = null;
        this._position = null;
        this._repositionIdleId = 0;

        // Gap the clock shows through in notch mode
        this.notchActor = new St.Widget({ visible: false, x_expand: true });
        this.notchActor.connect('notify::x', () => this.scheduleReposition());

        Main.layoutManager.connectObject('monitors-changed', () => this.scheduleReposition(), this);
    }

    get slot() {
        return this._slot;
    }

    get isNotch() {
        return !!this._slot && this._position === 'panel-notch' && !!Main.panel.statusArea.dateMenu;
    }

    // In the top bar the island goes away with the panel, so toasts wouldn't be seen
    get hiddenByFullscreen() {
        return !!this._slot && !!Main.layoutManager.primaryMonitor?.inFullscreen;
    }

    get isFloating() {
        return !this._slot;
    }

    // Puts the island in a top bar slot, or floating as top chrome for the screen positions
    place() {
        if (this._destroyed)
            return;
        const position = this._settings.get_string('position');
        if (position === this._position)
            return;
        this._position = position;
        this._callbacks.onBeforeReplace();
        this._disconnectDateMenu();
        if (this._slot) {
            this._slot.remove_child(this._island);
            this._slot.destroy();
            this._slot = null;
        } else if (this._island.get_parent()) {
            Main.layoutManager.removeChrome(this._island);
        }

        const target = PANEL_SLOTS[position];
        if (target) {
            // Empty slot reserves room for the resting island; the expanded island overlaps its neighbours
            this._slot = new St.Widget({ width: 0 });
            this._slot.connect('notify::width', () => this.scheduleReposition());
            Main.panel[target[0]].insert_child_at_index(this._slot, target[1]);
            this._slot.add_child(this._island);
            if (this.isNotch) {
                const clock = Main.panel.statusArea.dateMenu.container;
                const sync = () => this.scheduleReposition();
                clock.connectObject('notify::width', sync, 'notify::x', sync, this);
                const dateMenu = Main.panel.statusArea.dateMenu;
                dateMenu.connectObject('notify::hover', () => this._callbacks.onHover(), this);
                dateMenu.menu.connectObject('open-state-changed', () => this._callbacks.onHover(), this);
                this.notchActor.width = clock.width;
                this.scheduleReposition();
            }
        } else {
            Main.layoutManager.addTopChrome(this._island);
        }
        // Reparenting cuts the show animation short, which would leave a shown island invisible
        if (this._callbacks.isShown()) {
            this._island.remove_all_transitions();
            this._island.set({ opacity: 255, scale_x: 1, scale_y: 1 });
        } else {
            // Same for the hide animation: without its onComplete the island would stay around, empty and clickable
            this._island.remove_all_transitions();
            this._island.hide();
        }
        this._callbacks.onAfterReplace();
    }

    fitSlot() {
        if (this._destroyed)
            return;
        // The notch island sits behind the clock, so it takes no room in the top bar
        if (this._slot && !this._callbacks.isExpandedLayout() && !this.isNotch) {
            this._slot.ease({
                width: this._callbacks.isShown() ? this._callbacks.getRestWidth() : 0,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    // Defer repositioning past Clutter's allocation cycle to avoid invalidating stage views mid-allocation
    scheduleReposition() {
        if (this._destroyed || this._repositionIdleId)
            return;
        this._repositionIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._repositionIdleId = 0;
            this.reposition();
            return GLib.SOURCE_REMOVE;
        });
    }

    reposition() {
        if (this._destroyed || !this._island.get_stage())
            return;
        const w = this._island.visible && this._island.width > 0
            ? this._island.width
            : this._island.get_preferred_width(-1)[1];
        const h = this._island.visible && this._island.height > 0
            ? this._island.height
            : this._island.get_preferred_height(w)[1];
        this.repositionForSize(w, h);
    }

    repositionForSize(w, h) {
        if (this._destroyed || !this._island.get_stage())
            return;
        if (this.isNotch) {
            // Line the gap (or the whole expanded island) up with the clock
            const clock = Main.panel.statusArea.dateMenu.container;
            if (this.notchActor.width !== clock.width)
                this.notchActor.width = clock.width;
            const anchor = this.notchActor.visible && this._island.visible && !this._callbacks.isMorphing()
                ? this._topRow.x + this.notchActor.x + this.notchActor.width / 2
                : w / 2;
            this._setPosition(Math.round(clock.x + clock.width / 2 - this._slot.x - anchor),
                Math.max(0, Math.round((Main.panel.height - h) / 2)));
            return;
        }
        if (this._slot) {
            const grow = PANEL_SLOTS[this._position][2];
            this._setPosition(Math.round((this._slot.width - w) * grow),
                Math.max(0, Math.round((Main.panel.height - h) / 2)));
            return;
        }
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const [vertical, horizontal] = this._settings.get_string('position').split('-');
        const margin = this._settings.get_int('margin');
        let x = monitor.x + Math.floor((monitor.width - w) / 2);
        if (horizontal === 'left')
            x = monitor.x + margin;
        else if (horizontal === 'right')
            x = monitor.x + monitor.width - w - margin;
        const y = vertical === 'top'
            ? monitor.y + Main.panel.height + margin
            : monitor.y + monitor.height - h - margin;
        this._setPosition(x, y);
    }

    // Detached before super.destroy() so Island can destroy its parent slot safely afterwards
    detachSlot() {
        const slot = this._slot;
        this._slot = null;
        return slot;
    }

    destroy() {
        this._destroyed = true;
        if (this._repositionIdleId) {
            GLib.Source.remove(this._repositionIdleId);
            this._repositionIdleId = 0;
        }
        Main.layoutManager.disconnectObject(this);
        this._disconnectDateMenu();
        this._slot = null;
        this._island = null;
        this._topRow = null;
        this._settings = null;
        this._callbacks = null;
    }

    _disconnectDateMenu() {
        Main.panel.statusArea.dateMenu?.container.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.menu.disconnectObject(this);
    }

    _setPosition(x, y) {
        if (!this._island.fixed_position_set || this._island.x !== x || this._island.y !== y)
            this._island.set_position(x, y);
    }
}
