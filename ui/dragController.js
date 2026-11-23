import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { t } from '../i18n.js';

export class DragController {
    constructor(island, settings, grabActor, callbacks) {
        this._island = island;
        this._settings = settings;
        this._grabActor = grabActor;
        this._callbacks = callbacks;
        this._destroyed = false;

        this._dragPending = false;
        this._dragging = false;
        this._dragStartX = 0;
        this._dragStartY = 0;
        this._dragBaseTx = 0;
        this._dragBaseTy = 0;
        this._dragGrab = null;
        this._dragEventId = 0;
        this._dodged = false;
        this._dodgeTimerId = 0;

        this.hintActor = new St.BoxLayout({
            style_class: 'di-positioning-hint',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.hintActor.add_child(new St.Icon({
            style_class: 'di-positioning-icon',
            icon_name: 'view-grid-symbolic',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._posHintLabel = new St.Label({
            style_class: 'di-positioning-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.hintActor.add_child(this._posHintLabel);
    }

    get isPositioning() {
        return !this._destroyed && this._settings.get_boolean('positioning-active');
    }

    get isPinned() {
        return !this._destroyed && this._settings.get_boolean('pin-active');
    }

    get isDragging() {
        return this._dragging;
    }

    get isBusy() {
        return this._dragging || this._dragPending;
    }

    get isDodged() {
        return this._dodged;
    }

    updateLabel() {
        if (this._destroyed)
            return;
        this._posHintLabel.text = t('island.positioning.hint');
    }

    begin(event) {
        if (this._destroyed || !this._grabActor)
            return;
        this.cancelDrag();
        this._dragPending = true;
        this._dragging = false;
        [this._dragStartX, this._dragStartY] = event.get_coords();
        this._dragBaseTx = this._island.translation_x;
        this._dragBaseTy = this._island.translation_y;

        this._dragGrab = global.stage.grab(this._grabActor);
        this._dragEventId = this._grabActor.connect('event', (_actor, ev) => this._onDragEvent(ev));
    }

    cancelDrag() {
        if (this._dragEventId && this._grabActor) {
            this._grabActor.disconnect(this._dragEventId);
            this._dragEventId = 0;
        }
        if (this._dragGrab) {
            this._dragGrab.dismiss();
            this._dragGrab = null;
        }
        this._dragPending = false;
        this._dragging = false;
    }

    resetDodge(snapToHome = false) {
        this._cancelDodgeTimer();
        const wasDodged = this._dodged;
        this._dodged = false;
        if (snapToHome && wasDodged && !this._destroyed) {
            const [hx, hy] = this._homeOffset();
            this._island.set({ translation_x: hx, translation_y: hy });
        }
    }

    onPositioningChanged() {
        if (this._destroyed)
            return;
        this.cancelDrag();
        this._cancelDodgeTimer();
        this._dodged = false;
        if (this.isPositioning) {
            this._callbacks.onEnterPositioning();
            this._island.add_style_class_name('di-positioning');
            this.syncPinPosition(true);
        } else {
            this._island.remove_style_class_name('di-positioning');
        }
        this._callbacks.onRefresh();
    }

    syncPinPosition(animate) {
        if (this._destroyed || this._dragging || this._dodged)
            return;
        const [hx, hy] = this._homeOffset();
        this._animateTranslation(hx, hy, animate);
    }

    destroy() {
        this._destroyed = true;
        this.cancelDrag();
        this._cancelDodgeTimer();
        this._island = null;
        this._settings = null;
        this._grabActor = null;
        this._callbacks = null;
    }

    _homeOffset() {
        if (!this.isPinned)
            return [0, 0];
        return this._clampOffset(
            this._settings.get_int('pin-offset-x'),
            this._settings.get_int('pin-offset-y')
        );
    }

    _cancelDodgeTimer() {
        if (this._dodgeTimerId) {
            GLib.Source.remove(this._dodgeTimerId);
            this._dodgeTimerId = 0;
        }
    }

    _clampOffset(tx, ty) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._island.mapped)
            return [Math.round(tx), Math.round(ty)];
        const [stageX, stageY] = this._island.get_transformed_position();
        const homeX = stageX - this._island.translation_x;
        const homeY = stageY - this._island.translation_y;
        const w = this._island.width > 0 ? this._island.width : this._island.get_preferred_width(-1)[1];
        const h = this._island.height > 0 ? this._island.height : this._island.get_preferred_height(w)[1];
        const minTx = monitor.x - homeX;
        const maxTx = monitor.x + monitor.width - w - homeX;
        const minTy = monitor.y - homeY;
        const maxTy = monitor.y + monitor.height - h - homeY;
        return [
            Math.round(Math.max(minTx, Math.min(maxTx, tx))),
            Math.round(Math.max(minTy, Math.min(maxTy, ty))),
        ];
    }

    _animateTranslation(tx, ty, animate = true) {
        this._island.remove_transition('translation-x');
        this._island.remove_transition('translation-y');
        if (animate && this._island.mapped) {
            this._island.ease({
                translation_x: tx,
                translation_y: ty,
                duration: 420,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            });
        } else {
            this._island.set({ translation_x: tx, translation_y: ty });
        }
    }

    _returnFromDodge() {
        this._cancelDodgeTimer();
        const [hx, hy] = this._homeOffset();
        if (!this._dodged && this._island.translation_x === hx && this._island.translation_y === hy)
            return;
        this._dodged = false;
        this._animateTranslation(hx, hy, true);
    }

    _onDragEvent(ev) {
        try {
            const type = ev.type();
            if (type === Clutter.EventType.ENTER || type === Clutter.EventType.LEAVE)
                return Clutter.EVENT_PROPAGATE;
            if (type === Clutter.EventType.MOTION || type === Clutter.EventType.TOUCH_UPDATE) {
                if (type === Clutter.EventType.MOTION && (ev.get_state() & Clutter.ModifierType.BUTTON1_MASK) === 0) {
                    this._finishDrag(false);
                    return Clutter.EVENT_STOP;
                }
                const [x, y] = ev.get_coords();
                const dx = x - this._dragStartX;
                const dy = y - this._dragStartY;
                const threshold = this.isPositioning ? 2 : 6;
                if (!this._dragging) {
                    if (Math.hypot(dx, dy) < threshold)
                        return Clutter.EVENT_STOP;
                    this._dragging = true;
                    this._cancelDodgeTimer();
                    this._island.remove_transition('translation-x');
                    this._island.remove_transition('translation-y');
                }
                const [tx, ty] = this._clampOffset(this._dragBaseTx + dx, this._dragBaseTy + dy);
                this._island.translation_x = tx;
                this._island.translation_y = ty;
                return Clutter.EVENT_STOP;
            }
            if ((type === Clutter.EventType.BUTTON_RELEASE && ev.get_button() === Clutter.BUTTON_PRIMARY) ||
                type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) {
                this._finishDrag(type === Clutter.EventType.TOUCH_CANCEL);
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.KEY_PRESS && ev.get_key_symbol() === Clutter.KEY_Escape) {
                this.cancelDrag();
                if (!this._destroyed && this.isPositioning) {
                    this._settings.set_boolean('positioning-active', false);
                    this.syncPinPosition(true);
                }
                return Clutter.EVENT_STOP;
            }
        } catch (e) {
            this.cancelDrag();
            console.error(e);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _finishDrag(cancelled = false) {
        const wasDragging = this._dragging && !cancelled;
        this.cancelDrag();
        if (this._destroyed)
            return;
        if (cancelled) {
            this.syncPinPosition(true);
            return;
        }
        if (wasDragging) {
            if (this.isPositioning) {
                this._dodged = false;
                this._settings.set_int('pin-offset-x', Math.round(this._island.translation_x));
                this._settings.set_int('pin-offset-y', Math.round(this._island.translation_y));
                this._settings.set_boolean('pin-active', true);
                this._settings.set_boolean('positioning-active', false);
            } else {
                this._dodged = true;
                if (this._callbacks.isExpanded())
                    this._callbacks.onCollapse();
                this._cancelDodgeTimer();
                const secs = Math.max(1, this._settings.get_int('dodge-duration'));
                this._dodgeTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs, () => {
                    this._dodgeTimerId = 0;
                    if (!this._destroyed && !this._dragging)
                        this._returnFromDodge();
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else if (!this.isPositioning) {
            this._handlePrimaryClick();
        }
        if (this._callbacks.isExpanded() && !this._callbacks.isPointerInside())
            this._callbacks.onCollapse();
    }

    _handlePrimaryClick() {
        // In Temporary Dodge mode, a single click immediately slides the island back to its home position
        if (this._dodged) {
            this._returnFromDodge();
            return;
        }
        this._callbacks.onPrimaryClick();
    }
}
