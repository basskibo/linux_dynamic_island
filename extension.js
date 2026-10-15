import 'gi://GnomeBluetooth?version=3.0';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeBluetooth from 'gi://GnomeBluetooth';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {MprisPlayer} from 'resource:///org/gnome/shell/ui/mpris.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PREFIX = 'org.mpris.MediaPlayer2.';
const ART_SMALL = 26;
const ART_BIG = 56;
const BAR_W = 170;
const SPRING = Clutter.AnimationMode.EASE_OUT_BACK;
const ORANGE = '#ff9f0a';
const GREEN = '#30d158';
const RED = '#ff453a';
const BLUE = '#0a84ff';
// UPower device states that mean "on AC power": charging, fully charged, pending charge
const PLUGGED = [1, 4, 5];
// Volume-control apps open the mic only to draw a level meter
const MIC_SKIP = ['org.gnome.VolumeControl', 'org.PulseAudio.pavucontrol'];
const TIMER_PRESETS = [1, 5, 10, 15, 25, 60];

// Island geometry per state: corner radius, padding [top, right, bottom, left], cover size and radius
const COMPACT = {r: 18, pad: [5, 14, 5, 5], a: ART_SMALL, ar: ART_SMALL / 2};
const EXPANDED = {r: 30, pad: [12, 16, 12, 12], a: ART_BIG, ar: 14};

// Damped spring (iOS-like: response 0.45s, damping 0.78 → ~2% overshoot), t in seconds → progress
const OMEGA = 2 * Math.PI / 0.45;
const ZETA = 0.78;
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);
const spring = t => 1 - Math.exp(-ZETA * OMEGA * t) * (Math.cos(OMEGA_D * t) + ZETA * OMEGA / OMEGA_D * Math.sin(OMEGA_D * t));
const lerp = (a, b, p) => a + (b - a) * p;

const fmt = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
const toGicon = icon => typeof icon === 'string' ? new Gio.ThemedIcon({name: icon}) : icon;

export default class DynamicIsland extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._players = new Map();
        this._current = null;
        this._hasMusic = false;
        this._expanded = false;
        this._shown = false;
        this._trackKey = null;
        this._chipMap = new Map();
        this._toastActive = false;
        this._toastId = 0;
        this._hoverId = 0;
        this._timeline = null;
        this._geom = {...COMPACT};
        this._artBg = '';
        this._timer = null;
        this._recStart = 0;
        this._progress = new Map();
        this._notifiedEvents = new Set();

        this._buildUi();
        this._watchMedia();
        this._watchOsd();
        this._watchBattery();
        this._watchPrivacy();
        this._watchRecording();
        this._watchNotifications();
        this._addTimerToggle();
        this._watchBluetooth();
        this._watchProgress();
        this._calendar = new Calendar.DBusEventSource();

        this._eqId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => this._tickEq());
        this._secId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => this._tickSecond());
        this._calId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => this._checkCalendar());
    }

    disable() {
        GLib.source_remove(this._eqId);
        GLib.source_remove(this._secId);
        GLib.source_remove(this._calId);
        if (this._toastId)
            GLib.source_remove(this._toastId);
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._hoverId = 0;
        this._timeline?.stop();
        this._timeline = null;
        this._eqId = 0;
        this._secId = 0;
        this._calId = 0;
        this._toastId = 0;
        Gio.DBus.session.signal_unsubscribe(this._nameSub);
        Gio.DBus.session.signal_unsubscribe(this._progressSub);
        this._upowerCancel.cancel();
        this._upower?.disconnectObject(this);
        this._upower = null;
        Main.osdWindowManager.show = this._origOsdShow;
        Main.layoutManager.disconnectObject(this);
        Main.screenshotUI.disconnectObject(this);
        Main.messageTray.disconnectObject(this);
        Main.messageTray.getSources().forEach(s => s.disconnectObject(this));
        this._mixer.disconnectObject(this);
        this._camera.disconnectObject(this);
        this._camera = null;
        for (const d of this._btDevices) d.disconnectObject(this);
        this._btStore.disconnectObject(this);
        this._btClient = null;
        this._calendar.destroy();
        this._calendar = null;
        this._timerToggle.destroy();
        this._timerToggle = null;
        this._timerIndicator.destroy();
        this._timerIndicator = null;
        this._settings.disconnectObject(this);
        this._settings = null;
        for (const p of this._players.values())
            p.disconnectAll();
        this._players = null;
        this._current = null;
        this._chipMap = null;
        this._mixer = null;
        this._btStore = null;
        this._btDevices = null;
        // Destroying the island also destroys every child widget and its signal handlers
        this._island.destroy();
        this._island = null;
        this._art = null;
        this._title = null;
        this._artist = null;
        this._text = null;
        this._eq = null;
        this._bars = null;
        this._controls = null;
        this._playBtn = null;
        this._chips = null;
        this._toastIcon = null;
        this._toastLabel = null;
        this._toastFill = null;
        this._toastBar = null;
        this._toastBox = null;
    }

    // ---------- UI ----------

    _buildUi() {
        this._art = new St.Bin({style_class: 'di-art', width: ART_SMALL, height: ART_SMALL, pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        this._title = new St.Label({style_class: 'di-title'});
        this._artist = new St.Label({style_class: 'di-artist', visible: false});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._text = new St.BoxLayout({style_class: 'di-text', vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._text.add_child(this._title);
        this._text.add_child(this._artist);

        this._eq = new St.BoxLayout({style_class: 'di-eq', y_align: Clutter.ActorAlign.CENTER});
        this._bars = [];
        for (let i = 0; i < 4; i++) {
            const bar = new St.Widget({style_class: 'di-bar', height: 3, y_align: Clutter.ActorAlign.CENTER});
            this._eq.add_child(bar);
            this._bars.push(bar);
        }

        this._controls = new St.BoxLayout({visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._playBtn = this._button('media-playback-pause-symbolic', () => this._current?.playPause());
        this._controls.add_child(this._button('media-skip-backward-symbolic', () => this._current?.previous()));
        this._controls.add_child(this._playBtn);
        this._controls.add_child(this._button('media-skip-forward-symbolic', () => this._current?.next()));

        this._chips = new St.BoxLayout({style_class: 'di-chips', visible: false, y_align: Clutter.ActorAlign.CENTER});

        this._toastIcon = new St.Icon({style_class: 'di-toast-icon'});
        this._toastLabel = new St.Label({style_class: 'di-toast-label', y_align: Clutter.ActorAlign.CENTER});
        this._toastLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._toastFill = new St.Widget({style_class: 'di-level-fill', width: 0});
        this._toastBar = new St.Widget({style_class: 'di-level', width: BAR_W, y_align: Clutter.ActorAlign.CENTER, layout_manager: new Clutter.BinLayout()});
        this._toastBar.add_child(this._toastFill);
        this._toastBox = new St.BoxLayout({style_class: 'di-toast', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._toastBox.add_child(this._toastIcon);
        this._toastBox.add_child(this._toastBar);
        this._toastBox.add_child(this._toastLabel);

        this._island = new St.BoxLayout({
            style_class: 'di-island', reactive: true, track_hover: true, visible: false,
            clip_to_allocation: true, pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        for (const a of [this._art, this._text, this._eq, this._controls, this._chips, this._toastBox])
            this._island.add_child(a);
        this._island.connect('notify::hover', () => {
            // Small hover intent delay so passing the mouse over the island doesn't make it jump
            if (this._hoverId)
                GLib.source_remove(this._hoverId);
            this._hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._island.hover ? 90 : 220, () => {
                this._hoverId = 0;
                this._setExpanded(this._island.hover);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._island.connect('button-release-event', (actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._current?.raise();
            return Clutter.EVENT_STOP;
        });
        this._applyGeom(this._geom);
        this._island.connect('notify::width', () => this._reposition());
        this._island.connect('notify::height', () => this._reposition());
        Main.layoutManager.addTopChrome(this._island);
        Main.layoutManager.connectObject('monitors-changed', () => this._reposition(), this);
        this._settings.connectObject('changed', () => this._reposition(), this);
    }

    _button(icon, cb) {
        const b = new St.Button({style_class: 'di-btn', child: new St.Icon({icon_name: icon})});
        b.connect('clicked', cb);
        return b;
    }

    _on(key) {
        return this._settings.get_boolean(key);
    }

    // Shows/hides each part for the current state, springing the island to its new size
    _refresh() {
        if (!this._island)
            return;
        const hasChips = this._chips.get_n_children() > 0;
        this._morph(() => {
            const toast = this._toastActive;
            const music = this._hasMusic && !toast;
            const expanded = music && this._expanded;
            this._art.visible = this._text.visible = music;
            this._artist.visible = expanded;
            this._controls.visible = expanded;
            this._eq.visible = music && !expanded;
            this._chips.visible = !toast && hasChips;
            this._toastBox.visible = toast;
        });
        this._setShown(this._hasMusic || hasChips || this._toastActive);
    }

    _setShown(on) {
        if (on === this._shown)
            return;
        this._shown = on;
        if (on) {
            this._island.show();
            this._island.set({opacity: 0, scale_x: 0.5, scale_y: 0.5});
            this._island.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 500, mode: SPRING});
        } else {
            this._island.ease({
                opacity: 0, scale_x: 0.5, scale_y: 0.5, duration: 220, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => this._island?.hide(),
            });
        }
    }

    _setExpanded(on) {
        if (on === this._expanded)
            return;
        this._expanded = on;
        this._refresh();
        if (!this._hasMusic || this._toastActive)
            return;
        // Newly revealed content fades in once the island has started growing
        for (const actor of on ? [this._artist, this._controls] : [this._eq]) {
            actor.opacity = 0;
            actor.ease({opacity: 255, duration: 250, delay: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Applies a layout change, then springs size, corners, padding and cover from the old state to the new one.
    // Driven per frame and rounded to whole pixels so text and icons stay crisp while moving.
    _morph(change) {
        const island = this._island;
        const [w0, h0] = island.get_size();
        const from = {...this._geom, w: w0, h: h0};
        this._timeline?.stop();
        this._timeline = null;

        island.set_size(-1, -1);
        change();
        const target = this._expanded && this._hasMusic && !this._toastActive ? EXPANDED : COMPACT;
        this._applyGeom(target);
        if (!this._shown || !w0)
            return;

        const [, w1] = island.get_preferred_width(-1);
        const [, h1] = island.get_preferred_height(w1);
        if (w1 === w0 && h1 === h0 && target === from.target)
            return;
        const to = {...target, w: w1, h: h1};
        this._applyGeom(from);

        const timeline = new Clutter.Timeline({actor: island, duration: 650});
        timeline.connect('new-frame', () => {
            const p = spring(timeline.get_elapsed_time() / 1000);
            this._applyGeom({
                target,
                r: lerp(from.r, to.r, p),
                pad: from.pad.map((v, i) => lerp(v, to.pad[i], p)),
                a: lerp(from.a, to.a, p),
                ar: lerp(from.ar, to.ar, p),
                w: lerp(from.w, to.w, p),
                h: lerp(from.h, to.h, p),
            });
        });
        timeline.connect('stopped', (t, finished) => {
            if (!finished)
                return;
            this._applyGeom(target);
            island.set_size(-1, -1);
            this._timeline = null;
        });
        this._timeline = timeline;
        timeline.start();
    }

    _applyGeom(g) {
        this._geom = {target: g.target ?? g, r: g.r, pad: g.pad, a: g.a, ar: g.ar};
        const px = v => `${Math.max(0, Math.round(v))}px`;
        this._island.style = `border-radius: ${px(g.r)}; padding: ${g.pad.map(px).join(' ')};`;
        const a = Math.round(g.a);
        this._art.set_size(a, a);
        this._art.style = `${this._artBg} border-radius: ${px(g.ar)};`;
        if (g.w !== undefined)
            this._island.set_size(Math.round(g.w), Math.round(g.h));
    }

    // Temporary takeover of the island (volume, charger, notifications...)
    _toast(icon, text, {level = null, color = null, duration = 2500} = {}) {
        this._toastIcon.gicon = toGicon(icon);
        this._toastIcon.style = color ? `color: ${color};` : null;
        this._toastLabel.text = text;
        this._toastLabel.visible = !!text;
        this._toastBar.visible = level !== null;
        if (level !== null)
            this._toastFill.ease({width: Math.round(BAR_W * Math.max(0, Math.min(level, 1))), duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});

        const wasActive = this._toastActive;
        this._toastActive = true;
        if (this._toastId)
            GLib.source_remove(this._toastId);
        this._toastId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration, () => {
            this._toastId = 0;
            this._toastActive = false;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
        this._refresh();
        if (!wasActive) {
            this._toastBox.opacity = 0;
            this._toastBox.ease({opacity: 255, duration: 250, delay: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Persistent small indicator (mic, camera, recording, timer, progress); null removes it
    _setChip(key, opts) {
        let chip = this._chipMap.get(key);
        if (!opts) {
            if (chip) {
                chip.destroy();
                this._chipMap.delete(key);
                this._refresh();
            }
            return;
        }
        const added = !chip;
        if (added) {
            chip = new St.Button({style_class: 'di-chip', can_focus: false, reactive: !!opts.onClick});
            const box = new St.BoxLayout({style_class: 'di-chip-box'});
            chip._icon = new St.Icon({style_class: 'di-chip-icon'});
            chip._label = new St.Label({style_class: 'di-chip-label', y_align: Clutter.ActorAlign.CENTER});
            box.add_child(chip._icon);
            box.add_child(chip._label);
            chip.set_child(box);
            if (opts.onClick)
                chip.connect('clicked', opts.onClick);
            this._chips.add_child(chip);
            this._chipMap.set(key, chip);
        }
        chip._icon.gicon = toGicon(opts.icon);
        chip._icon.style = opts.color ? `color: ${opts.color};` : null;
        chip._label.text = opts.text ?? '';
        chip._label.visible = !!opts.text;
        if (added)
            this._refresh();
    }

    _reposition() {
        const m = Main.layoutManager.primaryMonitor;
        if (!m || !this._island)
            return;
        const [vertical, horizontal] = this._settings.get_string('position').split('-');
        const margin = this._settings.get_int('margin');
        const {width, height} = this._island;
        const x = horizontal === 'left' ? m.x + margin
            : horizontal === 'right' ? m.x + m.width - width - margin
            : m.x + Math.floor((m.width - width) / 2);
        const y = vertical === 'top' ? m.y + Main.panel.height + margin : m.y + m.height - height - margin;
        this._island.set_position(x, y);
    }

    // ---------- Media ----------

    _watchMedia() {
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                const [names] = conn.call_finish(res).deepUnpack();
                names.filter(n => n.startsWith(PREFIX)).forEach(n => this._addPlayer(n));
            });
        this._nameSub = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2', Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE, // arg0 namespace must not end with '.'
            (c, s, p, i, sig, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
            });
    }

    _addPlayer(busName) {
        if (!this._players || this._players.has(busName))
            return;
        const p = new MprisPlayer(busName);
        p.connect('changed', () => {
            // A player that starts playing takes over the island
            if (p.status === 'Playing' || !this._current)
                this._current = p;
            this._updateMusic();
        });
        p.connect('closed', () => {
            if (!this._players)
                return;
            this._players.delete(busName);
            if (this._current === p) {
                const rest = [...this._players.values()];
                this._current = rest.find(x => x.status === 'Playing') ?? rest[0] ?? null;
            }
            this._updateMusic();
        });
        this._players.set(busName, p);
    }

    _updateMusic() {
        if (!this._island)
            return;
        const p = this._current;
        this._hasMusic = !!p && !!p.trackTitle && p.status !== 'Stopped';
        if (this._hasMusic) {
            const playing = p.status === 'Playing';
            this._playBtn.child.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            const key = `${p.trackTitle}\n${p.trackArtists.join(', ')}\n${p.trackCoverUrl}`;
            if (key !== this._trackKey) {
                this._trackKey = key;
                this._swapTrack(p);
            }
        }
        this._refresh();
        this._tickEq();
    }

    _swapTrack(p) {
        const apply = () => this._morph(() => {
            this._title.text = p.trackTitle;
            this._artist.text = p.trackArtists.join(', ');
            this._setArt(p.trackCoverUrl);
        });
        if (!this._shown || !this._text.visible)
            return apply();

        // Old track slides up and fades, new one slides in from below
        this._text.ease({
            opacity: 0, translation_y: -8, duration: 160, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                apply();
                this._text.translation_y = 8;
                this._text.ease({opacity: 255, translation_y: 0, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            },
        });
        this._art.ease({
            scale_x: 0.6, scale_y: 0.6, opacity: 0, duration: 160, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => this._art.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 500, mode: SPRING}),
        });
    }

    _tickEq() {
        if (!this._island?.visible || !this._eq.visible)
            return GLib.SOURCE_CONTINUE;
        const playing = this._current?.status === 'Playing';
        for (const bar of this._bars) {
            bar.ease({
                height: playing ? 4 + Math.round(Math.random() * 14) : 3,
                duration: 240, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
        }
        return GLib.SOURCE_CONTINUE;
    }

    _setArt(url) {
        if (!url.startsWith('http')) {
            this._artBg = url.startsWith('file://') ? `background-image: url("${url}");` : '';
            this._applyGeom(this._geom);
            return;
        }
        // St can't load remote images, so download Spotify-style https covers into a cache (via GVfs)
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-island']);
        GLib.mkdir_with_parents(dir, 0o755);
        const dest = Gio.File.new_for_path(`${dir}/${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1)}`);
        const apply = () => {
            if (!this._island)
                return;
            this._artBg = `background-image: url("${dest.get_uri()}");`;
            this._applyGeom(this._geom);
        };
        if (dest.query_exists(null))
            return apply();
        Gio.File.new_for_uri(url).copy_async(dest, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (f, res) => {
            try {
                f.copy_finish(res);
                apply();
            } catch (e) {
                console.warn(`dynamic-island: cover download failed: ${e.message}`);
            }
        });
    }

    // ---------- Volume / brightness ----------

    _watchOsd() {
        const osd = Main.osdWindowManager;
        this._origOsdShow = osd.show;
        osd.show = (monitorIndex, icon, label, level, maxLevel) => {
            if (!this._on('show-volume'))
                return this._origOsdShow.call(osd, monitorIndex, icon, label, level, maxLevel);
            const hasLevel = typeof level === 'number';
            this._toast(icon, hasLevel ? '' : label ?? '', {level: hasLevel ? level : null, duration: 1500});
        };
    }

    // ---------- Charger ----------

    _watchBattery() {
        this._upowerCancel = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device', this._upowerCancel, (o, res) => {
                try {
                    this._upower = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`dynamic-island: UPower unavailable: ${e.message}`);
                    return;
                }
                this._lastPowerState = this._upower.get_cached_property('State')?.unpack();
                this._upower.connectObject('g-properties-changed', () => this._onPowerChanged(), this);
            });
    }

    _onPowerChanged() {
        const state = this._upower.get_cached_property('State')?.unpack();
        const pct = Math.round(this._upower.get_cached_property('Percentage')?.unpack() ?? 0);
        const icon = this._upower.get_cached_property('IconName')?.unpack() || 'battery-symbolic';
        const prev = this._lastPowerState;
        this._lastPowerState = state;
        // Desktops report no battery (state 0)
        if (state === prev || !state || !this._on('show-battery'))
            return;
        if (state === 4 && prev === 1)
            this._toast(icon, `Fully charged · ${pct}%`, {color: GREEN});
        else if (PLUGGED.includes(state) !== PLUGGED.includes(prev))
            this._toast(icon, PLUGGED.includes(state) ? `Charging · ${pct}%` : `On battery · ${pct}%`,
                {color: PLUGGED.includes(state) ? GREEN : null, level: pct / 100});
    }

    // ---------- Mic / camera ----------

    _watchPrivacy() {
        this._mixer = getMixerControl();
        this._mixer.connectObject('stream-added', () => this._syncMic(), 'stream-removed', () => this._syncMic(), this);
        this._camera = new Shell.CameraMonitor();
        this._camera.connectObject('notify::cameras-in-use', () => this._syncCamera(), this);
        this._settings.connectObject('changed::show-privacy', () => {
            this._syncMic();
            this._syncCamera();
        }, this);
        this._syncMic();
        this._syncCamera();
    }

    _syncMic() {
        const inUse = this._on('show-privacy') &&
            this._mixer.get_source_outputs().some(o => !MIC_SKIP.includes(o.get_application_id()));
        this._setChip('mic', inUse ? {icon: 'microphone-sensitivity-high-symbolic', color: ORANGE} : null);
    }

    _syncCamera() {
        const inUse = this._on('show-privacy') && this._camera.cameras_in_use;
        this._setChip('cam', inUse ? {icon: 'camera-web-symbolic', color: GREEN} : null);
    }

    // ---------- Screen recording ----------

    _watchRecording() {
        Main.screenshotUI.connectObject('notify::screencast-in-progress', () => {
            this._recStart = Main.screenshotUI.screencast_in_progress && this._on('show-recording')
                ? GLib.get_monotonic_time() : 0;
            if (!this._recStart)
                this._setChip('rec', null);
            this._tickSecond();
        }, this);
    }

    // ---------- Timer / stopwatch ----------

    _addTimerToggle() {
        this._timerToggle = new QuickMenuToggle({title: 'Timer', iconName: 'alarm-symbolic', toggleMode: false});
        this._timerToggle.menu.setHeader('alarm-symbolic', 'Timer');
        for (const min of TIMER_PRESETS)
            this._timerToggle.menu.addAction(`${min} min`, () => this._startTimer(min));
        this._timerToggle.menu.addAction('Stopwatch', () => this._startTimer(null));
        this._timerToggle.connect('clicked', () => {
            if (this._timer)
                this._stopTimer();
            else
                this._timerToggle.menu.open();
        });
        this._settings.bind('show-timer', this._timerToggle, 'visible', Gio.SettingsBindFlags.GET);
        this._timerIndicator = new SystemIndicator();
        this._timerIndicator.quickSettingsItems.push(this._timerToggle);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._timerIndicator);
    }

    _startTimer(minutes) {
        const now = GLib.get_monotonic_time();
        this._timer = {start: now, end: minutes ? now + minutes * 60e6 : null};
        this._timerToggle.checked = true;
        this._timerToggle.subtitle = minutes ? `${minutes} min` : 'Stopwatch';
        this._tickSecond();
    }

    _stopTimer() {
        this._timer = null;
        this._timerToggle.checked = false;
        this._timerToggle.subtitle = null;
        this._setChip('timer', null);
    }

    _tickSecond() {
        if (!this._island)
            return GLib.SOURCE_REMOVE;
        const now = GLib.get_monotonic_time();
        if (this._recStart) {
            this._setChip('rec', {
                icon: 'media-record-symbolic', color: RED, text: fmt(Math.floor((now - this._recStart) / 1e6)),
                onClick: () => Main.screenshotUI.stopScreencast(),
            });
        }
        if (this._timer?.end) {
            const left = Math.ceil((this._timer.end - now) / 1e6);
            if (left <= 0) {
                this._stopTimer();
                global.display.get_sound_player().play_from_theme('alarm-clock-elapsed', 'Timer done', null);
                // Shows up as an island toast through the notification hook, and stays in the history
                Main.notify('Timer', 'Time is up');
            } else {
                this._setChip('timer', {icon: 'alarm-symbolic', color: ORANGE, text: fmt(left), onClick: () => this._stopTimer()});
            }
        } else if (this._timer) {
            this._setChip('timer', {
                icon: 'preferences-system-time-symbolic', color: ORANGE,
                text: fmt(Math.floor((now - this._timer.start) / 1e6)), onClick: () => this._stopTimer(),
            });
        }
        return GLib.SOURCE_CONTINUE;
    }

    // ---------- Notifications ----------

    _watchNotifications() {
        const watch = source => source.connectObject('notification-request-banner', (s, n) => this._onNotification(s, n), this);
        Main.messageTray.getSources().forEach(watch);
        Main.messageTray.connectObject('source-added', (tray, source) => watch(source), this);
    }

    _onNotification(source, n) {
        // policy.showBanners is false in Do Not Disturb and for apps with banners turned off
        if (!this._on('show-notifications') || !source.policy.showBanners)
            return;
        const text = [n.title, n.body].filter(Boolean).join(' · ').replace(/\s+/g, ' ');
        this._toast(n.gicon ?? source.icon ?? 'preferences-system-notifications-symbolic', text, {duration: 4000});
    }

    // ---------- Bluetooth ----------

    _watchBluetooth() {
        this._btClient = new GnomeBluetooth.Client();
        this._btStore = this._btClient.get_devices();
        this._btDevices = [];
        const bind = () => {
            this._btDevices.forEach(d => d.disconnectObject(this));
            this._btDevices = [];
            for (let i = 0; i < this._btStore.get_n_items(); i++) {
                const d = this._btStore.get_item(i);
                d.connectObject('notify::connected', () => this._onBluetooth(d), this);
                this._btDevices.push(d);
            }
        };
        this._btStore.connectObject('items-changed', bind, this);
        bind();
    }

    _onBluetooth(device) {
        if (!this._on('show-bluetooth'))
            return;
        const battery = device.connected && device.battery_percentage > 0 ? ` · ${Math.round(device.battery_percentage)}%` : '';
        // Device-specific icon (headphones, mouse...) when the theme has one
        const icon = Gio.ThemedIcon.new_from_names([`${device.icon}-symbolic`, 'bluetooth-active-symbolic']);
        this._toast(icon, `${device.alias} ${device.connected ? 'connected' : 'disconnected'}${battery}`,
            {color: BLUE});
    }

    // ---------- Download / copy progress ----------

    _watchProgress() {
        // Browsers and Nautilus publish progress through the Unity LauncherEntry API (used by docks)
        this._progressSub = Gio.DBus.session.signal_subscribe(null, 'com.canonical.Unity.LauncherEntry', 'Update',
            null, null, Gio.DBusSignalFlags.NONE, (c, sender, path, iface, sig, params) => {
                const [uri, props] = params.deepUnpack();
                const state = this._progress.get(uri) ?? {visible: false, progress: 0};
                if ('progress-visible' in props)
                    state.visible = props['progress-visible'].unpack();
                if ('progress' in props)
                    state.progress = props['progress'].unpack();
                this._progress.set(uri, state);
                // shortcut: a chip stays if the app quits mid-download without clearing it; add a NameOwnerChanged check if that shows up
                if (!state.visible || !this._on('show-progress')) {
                    this._setChip(`progress:${uri}`, null);
                    return;
                }
                const app = Shell.AppSystem.get_default().lookup_app(uri.replace('application://', ''));
                this._setChip(`progress:${uri}`, {
                    icon: app?.get_icon() ?? 'folder-download-symbolic',
                    text: `${Math.round(state.progress * 100)}%`,
                });
            });
    }

    // ---------- Calendar ----------

    _checkCalendar() {
        if (!this._calendar)
            return GLib.SOURCE_REMOVE;
        if (!this._on('show-calendar'))
            return GLib.SOURCE_CONTINUE;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        // Same range all day, so the calendar server only reloads when the date changes
        this._calendar.requestRange(today, new Date(today.getTime() + 2 * 86400e3));
        for (const e of this._calendar.getEvents(now, new Date(now.getTime() + 5 * 60e3))) {
            const mins = Math.ceil((e.date - now) / 60e3);
            if (mins <= 0 || e.end - e.date >= 86400e3 || this._notifiedEvents.has(e.id))
                continue;
            this._notifiedEvents.add(e.id);
            this._toast('x-office-calendar-symbolic', `${e.summary} · in ${mins} min`, {color: RED, duration: 8000});
        }
        return GLib.SOURCE_CONTINUE;
    }
}
