import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { onLanguageChanged } from './i18n.js';
import { DragController } from './ui/dragController.js';
import { HoverController } from './ui/hoverController.js';
import { IdlePanel } from './ui/idlePanel.js';
import { buildLayouts, easeOutExpo, lerp } from './ui/layout.js';
import { MediaView } from './ui/mediaView.js';
import { Positioner } from './ui/positioner.js';
import { ToastIndicators } from './ui/toastIndicators.js';
import { Visualizer } from './ui/visualizer.js';
import { VolumeControl } from './ui/volumeControl.js';

export const Island = GObject.registerClass(
    class Island extends St.BoxLayout {
        _init(settings) {
            super._init({
                style_class: 'di-island',
                reactive: true,
                track_hover: true,
                visible: false,
                clip_to_allocation: true,
                pivot_point: new Graphene.Point({ x: 0.5, y: 0.5 }),
            });
            this.layout_manager.orientation = Clutter.Orientation.VERTICAL;
            this._settings = settings;
            this._destroyed = false;
            this._expanded = false;
            this._shown = false;
            this._timeline = null;
            this._layouts = buildLayouts(settings);
            this._layout = this._layouts.compact;
            this._geometry = this._layout;
            this._restWidth = 0;

            this._grabActor = new Clutter.Actor({ width: 0, height: 0, reactive: true });
            Main.uiGroup.add_child(this._grabActor);

            this._topRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
            this.add_child(this._topRow);

            this._positioner = new Positioner(this, this._topRow, settings, {
                isMorphing: () => !!this._timeline,
                isExpandedLayout: () => !!this._layout.expanded,
                isShown: () => this._shown,
                getRestWidth: () => this._restWidth,
                onHover: () => this._hover.onHover(),
                onBeforeReplace: () => {
                    this._timeline?.stop();
                    this._timeline = null;
                },
                onAfterReplace: () => {
                    this._drag.cancelDrag();
                    this._drag.resetDodge(false);
                    this._refresh();
                    this._drag.syncPinPosition(false);
                },
            });

            this._media = new MediaView(settings, {
                isShown: () => this._shown,
                isExpanded: () => this._expanded,
                onMorph: change => this._morph(change),
            });

            this._visualizer = new Visualizer(settings);

            this._toast = new ToastIndicators({
                onRefresh: () => this._refresh(),
            });

            this._idle = new IdlePanel(settings);

            this._volume = new VolumeControl(this._grabActor, {
                onDragEnd: () => {
                    if (!this._hover.isPointerInside()) {
                        this._hover.cancelHoverTimer();
                        this._setExpanded(false);
                    }
                },
            });

            this._drag = new DragController(this, settings, this._grabActor, {
                onEnterPositioning: () => {
                    this._expanded = false;
                    this._hover.stopOutsideWatch();
                },
                onCollapse: () => this._setExpanded(false),
                onPrimaryClick: () => this._runSingleClickAction(),
                onRefresh: () => this._refresh(),
                isExpanded: () => this._expanded,
                isPointerInside: () => this._hover.isPointerInside(),
            });

            this._hover = new HoverController(this, settings, {
                isNotch: () => this._positioner.isNotch,
                isPinned: () => this._drag.isPinned,
                isExpanded: () => this._expanded,
                isBusy: () => this._volume.isDragging || this._drag.isBusy,
                isPositioning: () => this._drag.isPositioning,
                isDodged: () => this._drag.isDodged,
                onSetExpanded: expanded => this._setExpanded(expanded),
            });

            // Assemble top row in exact visual order (notch sits between track text and visualizer)
            this._topRow.add_child(this._media.artActor);
            this._topRow.add_child(this._media.textActor);
            this._topRow.add_child(this._positioner.notchActor);
            this._topRow.add_child(this._visualizer.actor);
            this._topRow.add_child(this._media.controlsActor);
            this._topRow.add_child(this._toast.indicatorBox);
            this._topRow.add_child(this._toast.toastBox);
            this._topRow.add_child(this._idle.compactActor);
            this._topRow.add_child(this._idle.expandedActor);
            this._topRow.add_child(this._drag.hintActor);

            this.add_child(this._volume.actor);

            this._updateControlLabels();
            this._unsubscribeI18n = onLanguageChanged(() => {
                this._updateControlLabels();
                this._idle.updateLocale();
            });

            this._positioner.place();
            this._applyGeometry(this._compact());
            this._drag.syncPinPosition(false);
            this._volume.init();
            if (this._drag.isPositioning)
                this.add_style_class_name('di-positioning');

            this.connect('notify::hover', () => this._hover.onHover());
            this.connect('notify::width', () => this._positioner.scheduleReposition());
            this.connect('notify::height', () => this._positioner.scheduleReposition());
            this.connect('destroy', () => this._onDestroy());
            global.display.connectObject('in-fullscreen-changed', () => this._refresh(), this);
            settings.connectObject(
                'changed::always-visible', () => this._refresh(),
                'changed::idle-content', () => this._refresh(),
                'changed::idle-icon-path', () => this._idle.syncIcon(),
                'changed::idle-expand-clock', () => this._refresh(),
                'changed::idle-expand-icon', () => this._refresh(),
                'changed::idle-expand-battery', () => this._refresh(),
                'changed::idle-expand-bluetooth', () => this._refresh(),
                'changed::idle-expand-volume', () => this._refresh(),
                'changed::positioning-active', () => this._drag.onPositioningChanged(),
                'changed::pin-active', () => this._drag.syncPinPosition(true),
                'changed::pin-offset-x', () => this._drag.syncPinPosition(true),
                'changed::pin-offset-y', () => this._drag.syncPinPosition(true),
                'changed::position', () => this._positioner.place(),
                'changed::eq-style', () => {
                    this._visualizer.syncStyle();
                    this._refresh();
                },
                'changed::width', () => this._updateLayouts(),
                'changed::art-size', () => this._updateLayouts(),
                'changed::art-size-expanded', () => this._updateLayouts(),
                'changed::art-shape', () => this._updateLayouts(),
                'changed::art-border', () => this._applyGeometry(this._geometry),
                'changed::art-compact', () => this._refresh(),
                'changed::art-spin', () => this._media.syncSpin(),
                'changed::text-width', () => this._refresh(),
                'changed::accent-color', () => {
                    this._visualizer.syncAccent();
                    this._applyGeometry(this._geometry);
                },
                'changed', () => this._positioner.scheduleReposition(),
                this
            );
        }

        _onDestroy() {
            this._destroyed = true;
            this._settings.disconnectObject(this);
            if (this._settings?.get_boolean('positioning-active'))
                this._settings.set_boolean('positioning-active', false);
            this._unsubscribeI18n?.();
            this._unsubscribeI18n = null;
            global.display.disconnectObject(this);
            this._timeline?.stop();
            this._timeline = null;

            this._hover.destroy();
            this._drag.destroy();
            this._volume.destroy();
            this._visualizer.destroy();
            this._toast.destroy();
            this._idle.destroy();
            this._media.destroy();
            this._positioner.destroy();

            if (this._grabActor) {
                this._grabActor.destroy();
                this._grabActor = null;
            }
        }

        // The slot is our parent: destroying it from the destroy handler makes Clutter destroy us twice and abort the shell
        destroy() {
            const slot = this._positioner?.detachSlot();
            super.destroy();
            slot?.destroy();
        }

        // In the top bar the island goes away with the panel, so toasts wouldn't be seen
        get hiddenByFullscreen() {
            return this._positioner.hiddenByFullscreen;
        }

        // source is the app playing: {name, icon}
        setPlayer(player, source) {
            if (this._destroyed)
                return;
            this._media.setPlayer(player, source);
            this._refresh();
            this._media.syncSpin();
            this._visualizer.setPlaying(this._media.playing);
        }

        // Temporary takeover of the island (volume, brightness, charger, Bluetooth)
        toast(icon, text, opts) {
            this._toast.toast(icon, text, opts);
        }

        // Small persistent indicator (screen recording, download progress); null removes it
        setIndicator(key, opts) {
            this._toast.setIndicator(key, opts);
        }

        setBatteryStatus(status) {
            if (this._destroyed)
                return;
            const presenceChanged = this._idle.setBatteryStatus(status);
            if (presenceChanged && this._expanded && this._isIdle())
                this._refresh();
        }

        setBluetoothStatus(status) {
            if (this._destroyed)
                return;
            this._idle.setBluetoothStatus(status);
            if (this._expanded && this._isIdle())
                this._positioner.scheduleReposition();
        }

        vfunc_button_press_event(event) {
            if (this._destroyed || this._volume.isDragging || !this._grabActor || event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            const [x, y] = event.get_coords();
            // Clutter 18 (GNOME 50+) returns null from event.get_source(), so fall back to stage picking
            const source = event.get_source?.()
                ?? global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
            for (let src = source; src && src !== this; src = src.get_parent()) {
                if (src === this._volume.actor || src === this._media.controlsActor || src instanceof St.Button)
                    return Clutter.EVENT_PROPAGATE;
            }
            this._drag.begin(event);
            return Clutter.EVENT_STOP;
        }

        _updateControlLabels() {
            this._media.updateLabels();
            this._volume.updateLabels();
            this._drag.updateLabel();
        }

        _isIdle() {
            return !this._media.hasMusic && !this._toast.toastActive && !this._toast.hasIndicators &&
                this._settings.get_boolean('always-visible');
        }

        _compact() {
            const base = this._positioner.slot ? this._layouts.panelCompact : this._layouts.compact;
            if (this._isIdle()) {
                const pad = base.padding;
                const side = Math.max(6, pad[1]);
                return { ...base, padding: [pad[0], side, pad[2], side] };
            }
            return base;
        }

        _expandedGeometry() {
            const expanded = this._media.hasMusic && !this._toast.toastActive
                ? this._layouts.expanded
                : this._layouts.idleExpanded;
            // In notch mode the clock sits in the top of the expanded island
            if (!this._positioner.isNotch)
                return expanded;
            const padding = [...expanded.padding];
            padding[0] += Main.panel.height;
            // Hangs from the top edge like the macOS notch: square top, round bottom
            return { ...expanded, padding, topRadius: 0 };
        }

        _updateLayouts() {
            this._layouts = buildLayouts(this._settings);
            this._refresh();
        }

        _runSingleClickAction() {
            const canExpand = this._media.hasMusic || this._isIdle();
            // First click opens the details; for music a second click raises the player, for idle it toggles closed
            if (!this._expanded && canExpand && this._settings.get_string('expand-on') !== 'hover') {
                this._setExpanded(true);
                return;
            }
            if (this._expanded && this._isIdle()) {
                this._setExpanded(false);
                return;
            }
            this._media.raisePlayer();
        }

        // Shows/hides each part for the current state, springing the island to its new size
        _refresh() {
            if (this._destroyed)
                return;
            const hasIndicators = this._toast.hasIndicators;
            const toastActive = this._toast.toastActive;
            const hasMusic = this._media.hasMusic;
            const alwaysVisible = this._settings.get_boolean('always-visible');
            const positioning = this._drag.isPositioning;
            const idleMode = this._settings.get_string('idle-content');
            const showIdleClock = this._settings.get_boolean('idle-expand-clock');
            const showIdleIcon = this._settings.get_boolean('idle-expand-icon');
            const showIdleBat = this._settings.get_boolean('idle-expand-battery') && this._idle.hasBattery;
            const showIdleBt = this._settings.get_boolean('idle-expand-bluetooth');
            const showIdleVol = this._settings.get_boolean('idle-expand-volume');
            const showIdleStatus = showIdleBat || showIdleBt;
            const hasIdlePanelContent = showIdleClock || showIdleIcon || showIdleStatus || showIdleVol;

            this._morph(() => {
                const music = hasMusic && !toastActive;
                const idle = !music && !toastActive && !hasIndicators && alwaysVisible;
                const expandedMusic = !positioning && music && this._expanded;
                const expandedIdle = !positioning && idle && this._expanded;
                const expanded = expandedMusic || expandedIdle;
                const showPosHint = positioning && !music && !toastActive && !hasIndicators;
                const notch = this._positioner.isNotch && !expanded && !showPosHint;
                const showIdleBox = idle && !expandedIdle && !notch && !showPosHint;

                this._media.artActor.visible = music && (expandedMusic || this._settings.get_boolean('art-compact'));
                this._media.textActor.visible = music && !notch;
                this._positioner.notchActor.visible = notch;
                this._media.artistActor.visible = expandedMusic;
                this._media.sourceActor.visible = expandedMusic && this._media.hasSourceName;
                this._media.controlsActor.visible = expandedMusic;
                this._volume.actor.visible = expandedMusic || (expandedIdle && showIdleVol);
                this._visualizer.actor.visible = music && !expandedMusic;
                this._toast.indicatorBox.visible = !toastActive && hasIndicators;
                this._toast.toastBox.visible = toastActive;
                this._drag.hintActor.visible = showPosHint;

                const showTopIdle = expandedIdle && (showIdleClock || showIdleIcon || showIdleStatus || !hasIdlePanelContent);
                this._topRow.visible = !expandedIdle || showTopIdle;
                this._idle.applyState({
                    showCompact: showIdleBox,
                    expandedIdle,
                    idleMode,
                    showClock: showIdleClock,
                    showIcon: showIdleIcon,
                    showBat: showIdleBat,
                    showBt: showIdleBt,
                    showStatus: showIdleStatus,
                    showTopIdle,
                    hasPanelContent: hasIdlePanelContent,
                });
            });

            this._idle.syncClock();
            if (this._volume.actor.visible)
                this._volume.scheduleFillSync();
            // Floating island steps aside for fullscreen video (in the top bar it hides with the panel); toasts still
            // show because they replace the shell's OSD. Not trackFullscreen: it would force a hidden island visible.
            const fullscreen = this._positioner.isFloating && Main.layoutManager.primaryMonitor?.inFullscreen;
            this._setShown(positioning || toastActive || (!fullscreen && (hasMusic || hasIndicators || alwaysVisible)));
            this._positioner.fitSlot();
        }

        _setShown(shown) {
            if (shown === this._shown)
                return;
            this._shown = shown;
            this.remove_all_transitions();
            if (shown) {
                // Compute target position before showing so the entrance animation starts in place without jumping
                this._positioner.reposition();
                this.show();
                this.set({ opacity: 0, scale_x: 0.6, scale_y: 0.6 });
                // Keep opacity on a non-overshooting curve: EASE_OUT_BACK overshoots >1.0 and wraps uchar opacity past 255
                this.ease({ opacity: 255, duration: 220, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                this.ease({ scale_x: 1, scale_y: 1, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_BACK });
            } else {
                this.ease({
                    opacity: 0,
                    scale_x: 0.6,
                    scale_y: 0.6,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        if (!this._destroyed && !this._shown) {
                            this.hide();
                            this._drag.resetDodge(true);
                        }
                    },
                });
            }
        }

        _setExpanded(expanded) {
            if (this._destroyed || expanded === this._expanded)
                return;
            this._expanded = expanded;
            if (expanded) {
                this._hover.startOutsideWatch();
            } else {
                this._hover.cancelHoverTimer();
                this._hover.stopOutsideWatch();
            }
            this._refresh();
            if (this._toast.toastActive || this._drag.isPositioning)
                return;
            for (const actor of [
                this._media.sourceActor,
                this._media.artistActor,
                this._media.controlsActor,
                this._visualizer.actor,
                this._idle.compactActor,
                this._idle.expandedActor,
                this._volume.actor,
            ]) {
                actor.remove_all_transitions();
                actor.opacity = 255;
            }
            const fadeTargets = this._media.hasMusic
                ? (expanded ? [this._media.sourceActor, this._media.artistActor, this._media.controlsActor, this._volume.actor] : [this._visualizer.actor])
                : (this._isIdle() ? (expanded ? [this._idle.expandedActor, this._volume.actor] : [this._idle.compactActor]) : []);
            for (const actor of fadeTargets) {
                if (actor.visible) {
                    actor.opacity = 0;
                    actor.ease({ opacity: 255, duration: 200, delay: 60, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                }
            }
        }

        // Applies a layout change, then smoothly animates size, corners, padding and cover to the new state.
        // Animated per frame and rounded to whole pixels so text and icons stay sharp while moving.
        _morph(change) {
            const [fromWidth, fromHeight] = this.get_size();
            const from = this._geometry;
            const fromLayout = this._layout;
            this._timeline?.stop();
            this._timeline = null;

            this.set_size(-1, -1);
            change();
            const canExpand = (this._media.hasMusic || this._isIdle()) && !this._toast.toastActive && !this._drag.isPositioning;
            this._layout = this._expanded && canExpand ? this._expandedGeometry() : this._compact();
            const to = this._layout;
            this._applyGeometry(to);
            if (!this.get_stage())
                return;
            const [, toWidth] = this.get_preferred_width(-1);
            if (!to.expanded)
                this._restWidth = toWidth;
            if (!this._shown || !fromWidth || !this.mapped)
                return;

            const [, toHeight] = this.get_preferred_height(toWidth);
            if (toWidth === fromWidth && toHeight === fromHeight && to === fromLayout)
                return;
            this._applyGeometry(from, fromWidth, fromHeight);

            const duration = 340;
            const timeline = new Clutter.Timeline({ actor: this, duration });
            timeline.connect('new-frame', () => {
                const p = easeOutExpo(timeline.get_elapsed_time() / duration);
                this._applyGeometry({
                    radius: lerp(from.radius, to.radius, p),
                    topRadius: lerp(from.topRadius ?? from.radius, to.topRadius ?? to.radius, p),
                    padding: from.padding.map((v, i) => lerp(v, to.padding[i], p)),
                    spacing: lerp(from.spacing, to.spacing, p),
                    artSize: lerp(from.artSize, to.artSize, p),
                    artRadius: lerp(from.artRadius, to.artRadius, p),
                }, lerp(fromWidth, toWidth, p), lerp(fromHeight, toHeight, p));
            });
            timeline.connect('stopped', (_t, finished) => {
                if (!finished || this._destroyed)
                    return;
                this._applyGeometry(to);
                this.set_size(-1, -1);
                this._timeline = null;
                this._positioner.scheduleReposition();
                if (this._volume.actor.visible)
                    this._volume.scheduleFillSync();
            });
            this._timeline = timeline;
            timeline.start();
        }

        _applyGeometry(geometry, width, height) {
            this._geometry = geometry;
            const px = v => `${Math.max(0, Math.round(v))}px`;
            const top = px(geometry.topRadius ?? geometry.radius);
            const bottom = px(geometry.radius);
            // Width 0 = size to content, below 0 is handled by the layouts; music layouts only, toasts keep their own size
            const minWidth = this._media.hasMusic && !this._toast.toastActive ? this._settings.get_int('width') : 0;
            this._topRow.style = `spacing: ${px(geometry.spacing)};`;
            this.style = `border-radius: ${top} ${top} ${bottom} ${bottom}; padding: ${geometry.padding.map(px).join(' ')};` +
                ` spacing: ${this._volume.actor.visible ? '10px' : '0px'};` + (minWidth > 0 ? ` min-width: ${minWidth}px;` : '');
            this._media.applyGeometry(geometry);
            const artSize = Math.round(geometry.artSize);
            this._positioner.notchActor.height = artSize;
            const idleWidth = Math.max(this._positioner.slot ? 84 : 112, this._settings.get_int('width'));
            this._idle.applyCompactSize(Math.max(20, idleWidth - Math.round(geometry.padding[1] + geometry.padding[3])), artSize);
            if (width !== undefined) {
                const rw = Math.round(width);
                const rh = Math.round(height);
                this.set_size(rw, rh);
                this._positioner.repositionForSize(rw, rh);
            }
        }
    });
