import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import { t } from '../i18n.js';
import { loadIcon } from './layout.js';

export class VolumeControl {
    constructor(grabActor, callbacks) {
        this._grabActor = grabActor;
        this._callbacks = callbacks;
        this._destroyed = false;
        this._volFillIdleId = 0;
        this._volLevel = 0;
        this._volMuted = false;
        this._lastNonZeroVol = 0.5;
        this._volIconName = 'volume-2';
        this._volDragging = false;
        this._volGrab = null;
        this._volEventId = 0;
        this._mixerControl = null;
        this._mixerStream = null;

        this.actor = new St.BoxLayout({
            style_class: 'di-volume-row',
            visible: false,
            reactive: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            text_direction: Clutter.TextDirection.LTR,
        });
        this.actor.connect('scroll-event', (_actor, event) => {
            if (event.get_flags() & Clutter.EventFlags.FLAG_POINTER_EMULATED)
                return Clutter.EVENT_STOP;
            const dir = event.get_scroll_direction();
            let delta = 0;
            if (dir === Clutter.ScrollDirection.UP) {
                delta = 0.04;
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                delta = -0.04;
            } else if (dir === Clutter.ScrollDirection.SMOOTH) {
                const [, dy] = event.get_scroll_delta();
                if (!dy)
                    return Clutter.EVENT_STOP;
                const sign = (event.get_scroll_flags() & Clutter.ScrollFlags.INVERTED) ? 1 : -1;
                delta = Math.max(-0.05, Math.min(0.05, sign * dy * 0.04));
            } else {
                return Clutter.EVENT_PROPAGATE;
            }
            if (Math.abs(delta) >= 0.001)
                this._setVolume(this._volLevel + delta, true);
            return Clutter.EVENT_STOP;
        });

        this._volIcon = new St.Icon({ gicon: loadIcon('volume-2') });
        this._volMuteBtn = new St.Button({
            style_class: 'di-vol-btn',
            reactive: true,
            can_focus: false,
            y_align: Clutter.ActorAlign.CENTER,
            child: this._volIcon,
        });
        this._volMuteBtn.connect('clicked', () => this._toggleMute());

        this._volHitArea = new St.Widget({
            reactive: true,
            track_hover: true,
            x_expand: true,
            height: 22,
            y_align: Clutter.ActorAlign.CENTER,
            text_direction: Clutter.TextDirection.LTR,
            layout_manager: new Clutter.BinLayout(),
        });
        this._volTrack = new St.BoxLayout({
            style_class: 'di-vol-track',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            height: 6,
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
            text_direction: Clutter.TextDirection.LTR,
        });
        this._volFill = new St.Widget({
            style_class: 'di-vol-fill',
            x_expand: false,
            y_expand: true,
            width: 0,
        });
        this._volTrack.add_child(this._volFill);
        this._volHitArea.add_child(this._volTrack);

        this._volTrack.connect('notify::width', () => this.scheduleFillSync());
        this._volHitArea.connect('notify::hover', () => this._updateTrackStyle());
        this._volHitArea.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._startDrag(event);
            return Clutter.EVENT_STOP;
        });

        this._volPercentLabel = new St.Label({
            style_class: 'di-vol-percent',
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.END,
            text: t('island.volume.percent', { percent: 0 }),
        });

        this.actor.add_child(this._volMuteBtn);
        this.actor.add_child(this._volHitArea);
        this.actor.add_child(this._volPercentLabel);
    }

    get isDragging() {
        return this._volDragging;
    }

    init() {
        try {
            this._mixerControl = Volume.getMixerControl();
            this._mixerControl.connectObject(
                'state-changed', () => this._bindDefaultSink(),
                'default-sink-changed', () => this._bindDefaultSink(),
                this
            );
            this._bindDefaultSink();
        } catch (e) {
            console.warn(`dynamic-island: volume control unavailable: ${e.message}`);
        }
    }

    updateLabels() {
        if (this._destroyed)
            return;
        const pct = this._volMuted ? 0 : Math.round(this._volLevel * 100);
        this._volMuteBtn.accessible_name = t(pct === 0 ? 'island.volume.unmute' : 'island.volume.mute');
        this._volHitArea.accessible_name = t('island.volume.slider');
        this._volPercentLabel.text = t('island.volume.percent', { percent: pct });
    }

    scheduleFillSync() {
        if (this._destroyed || this._volFillIdleId)
            return;
        this._volFillIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._volFillIdleId = 0;
            this._applyFill(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this._destroyed = true;
        if (this._volFillIdleId) {
            GLib.Source.remove(this._volFillIdleId);
            this._volFillIdleId = 0;
        }
        this._endDrag();
        this._mixerStream?.disconnectObject(this);
        this._mixerStream = null;
        this._mixerControl?.disconnectObject(this);
        this._mixerControl = null;
        this._grabActor = null;
        this._callbacks = null;
    }

    _bindDefaultSink() {
        if (this._destroyed)
            return;
        this._mixerStream?.disconnectObject(this);
        this._mixerStream = this._mixerControl?.get_default_sink() ?? null;
        if (this._mixerStream) {
            this._mixerStream.connectObject(
                'notify::volume', () => this._syncFromStream(),
                'notify::is-muted', () => this._syncFromStream(),
                this
            );
        }
        this._syncFromStream();
    }

    _syncFromStream() {
        if (this._destroyed || this._volDragging)
            return;
        const max = this._mixerControl?.get_vol_max_norm() || 65536;
        const muted = !this._mixerStream || this._mixerStream.is_muted;
        const rawLevel = this._mixerStream ? Math.max(0, Math.min(1, this._mixerStream.volume / max)) : 0;
        if (rawLevel > 0.005)
            this._lastNonZeroVol = rawLevel;
        this._volLevel = muted ? 0 : rawLevel;
        this._volMuted = muted || this._volLevel === 0;
        this._updateDisplay(true);
    }

    _updateDisplay(animate) {
        if (this._destroyed)
            return;
        const pct = this._volMuted ? 0 : Math.round(this._volLevel * 100);
        this._volPercentLabel.text = t('island.volume.percent', { percent: pct });
        this._volMuteBtn.accessible_name = t(pct === 0 ? 'island.volume.unmute' : 'island.volume.mute');
        const nextIcon = pct === 0 ? 'volume-x' : pct <= 35 ? 'volume-1' : 'volume-2';
        if (nextIcon !== this._volIconName) {
            this._volIconName = nextIcon;
            if (animate && this.actor.visible && this._volIcon.mapped) {
                this._volIcon.remove_all_transitions();
                this._volIcon.ease({
                    opacity: 75,
                    duration: 75,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        if (this._destroyed || this._volIconName !== nextIcon)
                            return;
                        this._volIcon.gicon = loadIcon(nextIcon);
                        this._volIcon.ease({
                            opacity: 255,
                            duration: 105,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    },
                });
            } else {
                this._volIcon.remove_all_transitions();
                this._volIcon.gicon = loadIcon(nextIcon);
                this._volIcon.opacity = 255;
            }
        }
        this._applyFill(animate);
    }

    _applyFill(animate) {
        if (this._destroyed || !this._volTrack.mapped)
            return;
        const trackWidth = this._volTrack.width;
        if (trackWidth <= 0)
            return;
        const targetWidth = Math.round(trackWidth * Math.max(0, Math.min(1, this._volLevel)));
        if (animate && this.actor.visible && !this._volDragging) {
            this._volFill.ease({
                width: targetWidth,
                duration: 170,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._volFill.remove_all_transitions();
            this._volFill.width = targetWidth;
        }
    }

    _updateTrackStyle() {
        if (this._destroyed)
            return;
        const active = this._volHitArea.hover || this._volDragging;
        if (active) {
            this._volTrack.add_style_class_name('di-vol-track-active');
            this._volPercentLabel.add_style_class_name('di-vol-percent-active');
        } else {
            this._volTrack.remove_style_class_name('di-vol-track-active');
            this._volPercentLabel.remove_style_class_name('di-vol-percent-active');
        }
        this._volTrack.ease({
            height: active ? 7 : 6,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _setVolume(level, animate = false) {
        if (this._destroyed)
            return;
        const clamped = Math.max(0, Math.min(1, level));
        if (clamped > 0.005)
            this._lastNonZeroVol = clamped;
        this._volLevel = clamped;
        this._volMuted = clamped === 0;
        this._updateDisplay(animate && !this._volDragging);
        if (!this._mixerStream || !this._mixerControl)
            return;
        const max = this._mixerControl.get_vol_max_norm();
        const volume = Math.round(clamped * max);
        if (volume < 1) {
            this._mixerStream.volume = 0;
            if (!this._mixerStream.is_muted)
                this._mixerStream.change_is_muted(true);
        } else {
            this._mixerStream.volume = volume;
            if (this._mixerStream.is_muted)
                this._mixerStream.change_is_muted(false);
        }
        this._mixerStream.push_volume();
    }

    _toggleMute() {
        if (!this._mixerStream && this._mixerControl)
            this._bindDefaultSink();
        if (!this._mixerStream || !this._mixerControl)
            return;
        const muted = this._mixerStream.is_muted || this._mixerStream.volume === 0;
        const max = this._mixerControl.get_vol_max_norm() || 65536;
        if (muted) {
            if (this._mixerStream.volume === 0) {
                const restore = Math.max(0.05, Math.min(1, this._lastNonZeroVol || 0.35));
                this._mixerStream.volume = Math.round(restore * max);
                this._mixerStream.push_volume();
            }
            this._mixerStream.change_is_muted(false);
        } else {
            this._lastNonZeroVol = Math.max(0.05, Math.min(1, this._mixerStream.volume / max));
            this._mixerStream.change_is_muted(true);
        }
    }

    _setVolumeFromEvent(event) {
        const [stageX] = event.get_coords();
        const [trackX] = this._volTrack.get_transformed_position();
        const [transformedW] = this._volTrack.get_transformed_size();
        const width = transformedW > 0 ? transformedW : this._volTrack.width;
        if (width > 0)
            this._setVolume(Math.max(0, Math.min(1, (stageX - trackX) / width)));
    }

    _startDrag(event) {
        if (this._destroyed || !this._grabActor)
            return;
        this._endDrag();
        this._volDragging = true;
        this._volGrab = global.stage.grab(this._grabActor);
        this._volEventId = this._grabActor.connect('event', (_actor, ev) => this._onDragEvent(ev));
        this._updateTrackStyle();
        this._setVolumeFromEvent(event);
    }

    _onDragEvent(ev) {
        try {
            const type = ev.type();
            if (type === Clutter.EventType.ENTER || type === Clutter.EventType.LEAVE)
                return Clutter.EVENT_PROPAGATE;
            if (type === Clutter.EventType.MOTION || type === Clutter.EventType.TOUCH_UPDATE) {
                if (type === Clutter.EventType.MOTION && (ev.get_state() & Clutter.ModifierType.BUTTON1_MASK) === 0) {
                    this._endDrag();
                    return Clutter.EVENT_STOP;
                }
                this._setVolumeFromEvent(ev);
                return Clutter.EVENT_STOP;
            }
            if ((type === Clutter.EventType.BUTTON_RELEASE && ev.get_button() === Clutter.BUTTON_PRIMARY) ||
                type === Clutter.EventType.TOUCH_END || type === Clutter.EventType.TOUCH_CANCEL) {
                if (type === Clutter.EventType.BUTTON_RELEASE)
                    this._setVolumeFromEvent(ev);
                this._endDrag();
                return Clutter.EVENT_STOP;
            }
            if (type === Clutter.EventType.KEY_PRESS && ev.get_key_symbol() === Clutter.KEY_Escape) {
                this._endDrag();
                return Clutter.EVENT_STOP;
            }
        } catch (e) {
            this._endDrag();
            console.error(e);
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _endDrag() {
        if (this._volEventId && this._grabActor) {
            this._grabActor.disconnect(this._volEventId);
            this._volEventId = 0;
        }
        if (this._volGrab) {
            this._volGrab.dismiss();
            this._volGrab = null;
        }
        if (!this._volDragging)
            return;
        this._volDragging = false;
        if (this._destroyed)
            return;
        this._updateTrackStyle();
        this._syncFromStream();
        this._callbacks.onDragEnd();
    }
}
