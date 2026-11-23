import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { BAR_W, toGicon } from './layout.js';

export class ToastIndicators {
    constructor(callbacks) {
        this._callbacks = callbacks;
        this._destroyed = false;
        this._indicators = new Map();
        this._toastActive = false;
        this._toastId = 0;

        this.indicatorBox = new St.BoxLayout({ style_class: 'di-indicators', visible: false, y_align: Clutter.ActorAlign.CENTER });

        this.toastBox = new St.BoxLayout({ style_class: 'di-toast', visible: false, y_align: Clutter.ActorAlign.CENTER });
        this._toastIcon = new St.Icon({ style_class: 'di-toast-icon' });
        this._toastBar = new St.BoxLayout({
            style_class: 'di-level',
            width: BAR_W,
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
            text_direction: Clutter.TextDirection.LTR,
        });
        this._toastFill = new St.Widget({
            style_class: 'di-level-fill',
            x_expand: false,
            y_expand: true,
            width: 0,
        });
        this._toastBar.add_child(this._toastFill);
        this._toastLabel = new St.Label({ style_class: 'di-toast-label', y_align: Clutter.ActorAlign.CENTER });
        this._toastLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.toastBox.add_child(this._toastIcon);
        this.toastBox.add_child(this._toastBar);
        this.toastBox.add_child(this._toastLabel);
    }

    get toastActive() {
        return this._toastActive;
    }

    get hasIndicators() {
        return this._indicators.size > 0;
    }

    // Temporary takeover of the island (volume, brightness, charger, Bluetooth)
    toast(icon, text, { level = null, color = null, duration = 2500 } = {}) {
        if (this._destroyed)
            return;
        this._toastIcon.gicon = toGicon(icon);
        this._toastIcon.style = color ? `color: ${color};` : null;
        this._toastLabel.text = text;
        this._toastLabel.visible = !!text;
        this._toastBar.visible = level !== null;
        if (level !== null) {
            this._toastFill.ease({
                width: Math.round(BAR_W * Math.max(0, Math.min(level, 1))),
                duration: 120,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        const wasActive = this._toastActive;
        this._toastActive = true;
        if (this._toastId)
            GLib.source_remove(this._toastId);
        this._toastId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            this._toastId = 0;
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;
            this._toastActive = false;
            this._callbacks.onRefresh();
            return GLib.SOURCE_REMOVE;
        });
        this._callbacks.onRefresh();
        if (!wasActive) {
            this.toastBox.opacity = 0;
            this.toastBox.ease({ opacity: 255, duration: 250, delay: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        }
    }

    // Small persistent indicator (screen recording, download progress); null removes it
    setIndicator(key, opts) {
        if (this._destroyed)
            return;
        let chip = this._indicators.get(key);
        if (!opts) {
            if (chip) {
                chip.destroy();
                this._indicators.delete(key);
                this._callbacks.onRefresh();
            }
            return;
        }
        const added = !chip;
        if (added) {
            chip = new St.Button({ style_class: 'di-chip', can_focus: false, reactive: !!opts.onClick });
            chip.set_child(new St.BoxLayout({ style_class: 'di-chip-box' }));
            chip.child.add_child(new St.Icon({ style_class: 'di-chip-icon' }));
            chip.child.add_child(new St.Label({ style_class: 'di-chip-label', y_align: Clutter.ActorAlign.CENTER }));
            if (opts.onClick)
                chip.connect('clicked', opts.onClick);
            this.indicatorBox.add_child(chip);
            this._indicators.set(key, chip);
        }
        const [icon, label] = chip.child.get_children();
        icon.gicon = toGicon(opts.icon);
        icon.style = opts.color ? `color: ${opts.color};` : null;
        label.text = opts.text ?? '';
        label.visible = !!opts.text;
        chip.accessible_name = opts.accessibleName ?? '';
        if (added)
            this._callbacks.onRefresh();
    }

    destroy() {
        this._destroyed = true;
        if (this._toastId) {
            GLib.source_remove(this._toastId);
            this._toastId = 0;
        }
        this._indicators.clear();
        this._callbacks = null;
    }
}
