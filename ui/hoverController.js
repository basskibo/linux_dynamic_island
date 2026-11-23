import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class HoverController {
    constructor(island, settings, callbacks) {
        this._island = island;
        this._settings = settings;
        this._callbacks = callbacks;
        this._destroyed = false;
        this._hoverId = 0;
        this._outsideCaptureId = 0;
        this._outsidePollId = 0;
        this._outsideSince = 0;
    }

    isPointInside(x, y) {
        if (this._destroyed || !this._island.mapped || !this._island.visible)
            return false;
        const [ax, ay] = this._island.get_transformed_position();
        const [aw, ah] = this._island.get_transformed_size();
        if (aw > 0 && ah > 0 && x >= ax && x <= ax + aw && y >= ay && y <= ay + ah)
            return true;
        if (this._callbacks.isNotch() && !this._callbacks.isPinned()) {
            const dateMenu = Main.panel.statusArea.dateMenu;
            if (dateMenu?.mapped && !dateMenu.menu.isOpen) {
                const [dx, dy] = dateMenu.get_transformed_position();
                const [dw, dh] = dateMenu.get_transformed_size();
                if (dw > 0 && dh > 0 && x >= dx && x <= dx + dw && y >= dy && y <= dy + dh)
                    return true;
            }
        }
        return false;
    }

    isPointerInside() {
        const [px, py] = global.get_pointer();
        return this.isPointInside(px, py);
    }

    cancelHoverTimer() {
        if (this._hoverId) {
            GLib.source_remove(this._hoverId);
            this._hoverId = 0;
        }
    }

    onHover() {
        // Small hover intent delay so passing the mouse over the island doesn't make it jump
        this.cancelHoverTimer();
        if (this._destroyed || this._callbacks.isBusy() || this._callbacks.isPositioning())
            return;
        if (this._callbacks.isDodged()) {
            if (this._callbacks.isExpanded())
                this._callbacks.onSetExpanded(false);
            return;
        }
        const dateMenu = Main.panel.statusArea.dateMenu;
        // Open calendar collapses the island so it doesn't sit under the menu
        const useNotchHover = this._callbacks.isNotch() && !this._callbacks.isPinned();
        const hover = useNotchHover
            ? (this._island.hover || dateMenu.hover) && !dateMenu.menu.isOpen
            : this._island.hover;
        // In click mode hovering only closes the details (when the pointer leaves)
        if (hover && this._settings.get_string('expand-on') === 'click')
            return;
        this._hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hover ? 90 : 150, () => {
            this._hoverId = 0;
            if (this._destroyed || this._callbacks.isBusy() || this._callbacks.isPositioning())
                return GLib.SOURCE_REMOVE;
            if (hover && !this.isPointerInside())
                return GLib.SOURCE_REMOVE;
            if (!hover && this.isPointerInside())
                return GLib.SOURCE_REMOVE;
            this._callbacks.onSetExpanded(hover);
            return GLib.SOURCE_REMOVE;
        });
    }

    startOutsideWatch() {
        if (this._destroyed)
            return;
        this._outsideSince = 0;
        if (!this._outsidePollId) {
            this._outsidePollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                if (this._destroyed || !this._callbacks.isExpanded()) {
                    this._outsidePollId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (this._callbacks.isBusy()) {
                    this._outsideSince = 0;
                    return GLib.SOURCE_CONTINUE;
                }
                if (this._callbacks.isNotch() && !this._callbacks.isPinned() && Main.panel.statusArea.dateMenu?.menu.isOpen) {
                    this._outsidePollId = 0;
                    this._callbacks.onSetExpanded(false);
                    return GLib.SOURCE_REMOVE;
                }
                const [px, py, mods] = global.get_pointer();
                if (this.isPointInside(px, py)) {
                    this._outsideSince = 0;
                    return GLib.SOURCE_CONTINUE;
                }
                const anyButton = (mods & (
                    Clutter.ModifierType.BUTTON1_MASK |
                    Clutter.ModifierType.BUTTON2_MASK |
                    Clutter.ModifierType.BUTTON3_MASK
                )) !== 0;
                const now = GLib.get_monotonic_time();
                if (!this._outsideSince)
                    this._outsideSince = now;
                if (anyButton || now - this._outsideSince >= 150_000) {
                    this._outsidePollId = 0;
                    this._callbacks.onSetExpanded(false);
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
        if (!this._outsideCaptureId) {
            this._outsideCaptureId = global.stage.connect('captured-event', (_stage, ev) => {
                if (this._destroyed || !this._callbacks.isExpanded() || this._callbacks.isBusy())
                    return Clutter.EVENT_PROPAGATE;
                if (ev.type() === Clutter.EventType.BUTTON_PRESS) {
                    const [x, y] = ev.get_coords();
                    if (!this.isPointInside(x, y))
                        this._callbacks.onSetExpanded(false);
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    stopOutsideWatch() {
        this._outsideSince = 0;
        if (this._outsidePollId) {
            GLib.source_remove(this._outsidePollId);
            this._outsidePollId = 0;
        }
        if (this._outsideCaptureId) {
            global.stage.disconnect(this._outsideCaptureId);
            this._outsideCaptureId = 0;
        }
    }

    destroy() {
        this._destroyed = true;
        this.cancelHoverTimer();
        this.stopOutsideWatch();
        this._island = null;
        this._settings = null;
        this._callbacks = null;
    }
}
