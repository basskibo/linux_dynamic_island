import 'gi://GnomeBluetooth?version=3.0';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeBluetooth from 'gi://GnomeBluetooth';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {MprisPlayer} from 'resource:///org/gnome/shell/ui/mpris.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';
const ART_SMALL = 26;
const ART_BIG = 56;
const BAR_W = 170;
const GREEN = '#30d158';
const RED = '#ff453a';
const BLUE = '#0a84ff';
// UPower device states that mean "on AC power": charging, fully charged, pending charge
const PLUGGED = [1, 4, 5];

// Island geometry per state: corner radius, padding [top, right, bottom, left], cover size and radius
const COMPACT = {r: 18, pad: [5, 14, 5, 5], a: ART_SMALL, ar: ART_SMALL / 2};
const EXPANDED = {r: 30, pad: [12, 16, 12, 12], a: ART_BIG, ar: 14};

// Damped spring (response 0.45s, damping 0.78 → ~2% overshoot), t in seconds → progress
const OMEGA = 2 * Math.PI / 0.45;
const ZETA = 0.78;
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);
const spring = t => 1 - Math.exp(-ZETA * OMEGA * t) * (Math.cos(OMEGA_D * t) + ZETA * OMEGA / OMEGA_D * Math.sin(OMEGA_D * t));
const lerp = (a, b, p) => a + (b - a) * p;

const formatDuration = secs => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
const toGicon = icon => typeof icon === 'string' ? new Gio.ThemedIcon({name: icon}) : icon;

const Island = GObject.registerClass(
class Island extends St.BoxLayout {
    _init(settings) {
        super._init({
            style_class: 'di-island',
            reactive: true,
            track_hover: true,
            visible: false,
            clip_to_allocation: true,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        this._settings = settings;
        this._player = null;
        this._hasMusic = false;
        this._expanded = false;
        this._shown = false;
        this._trackKey = null;
        this._indicators = new Map();
        this._toastActive = false;
        this._toastId = 0;
        this._hoverId = 0;
        this._timeline = null;
        this._geom = {...COMPACT};
        this._artBg = '';

        this._art = new St.Bin({style_class: 'di-art', pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        this.add_child(this._art);

        this._text = new St.BoxLayout({style_class: 'di-text', vertical: true, y_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'di-title'});
        this._artist = new St.Label({style_class: 'di-artist', visible: false});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._text.add_child(this._title);
        this._text.add_child(this._artist);
        this.add_child(this._text);

        this._eq = new St.BoxLayout({style_class: 'di-eq', y_align: Clutter.ActorAlign.CENTER});
        for (let i = 0; i < 4; i++)
            this._eq.add_child(new St.Widget({style_class: 'di-bar', height: 3, y_align: Clutter.ActorAlign.CENTER}));
        this.add_child(this._eq);

        this._controls = new St.BoxLayout({visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._controls.add_child(this._button('media-skip-backward-symbolic', () => this._player?.previous()));
        this._playButton = this._button('media-playback-pause-symbolic', () => this._player?.playPause());
        this._controls.add_child(this._playButton);
        this._controls.add_child(this._button('media-skip-forward-symbolic', () => this._player?.next()));
        this.add_child(this._controls);

        this._indicatorBox = new St.BoxLayout({style_class: 'di-indicators', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._indicatorBox);

        this._toastBox = new St.BoxLayout({style_class: 'di-toast', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._toastIcon = new St.Icon({style_class: 'di-toast-icon'});
        this._toastBar = new St.Widget({
            style_class: 'di-level',
            width: BAR_W,
            y_align: Clutter.ActorAlign.CENTER,
            layout_manager: new Clutter.BinLayout(),
        });
        this._toastFill = new St.Widget({style_class: 'di-level-fill', width: 0});
        this._toastBar.add_child(this._toastFill);
        this._toastLabel = new St.Label({style_class: 'di-toast-label', y_align: Clutter.ActorAlign.CENTER});
        this._toastLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._toastBox.add_child(this._toastIcon);
        this._toastBox.add_child(this._toastBar);
        this._toastBox.add_child(this._toastLabel);
        this.add_child(this._toastBox);

        this._applyGeom(this._geom);

        this.connect('notify::hover', () => this._onHover());
        this.connect('notify::width', () => this._reposition());
        this.connect('notify::height', () => this._reposition());
        this.connect('destroy', () => this._onDestroy());
        Main.layoutManager.connectObject('monitors-changed', () => this._reposition(), this);
        settings.connectObject('changed', () => this._reposition(), this);
        this._eqId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => this._tickEq());
    }

    _onDestroy() {
        GLib.source_remove(this._eqId);
        if (this._toastId)
            GLib.source_remove(this._toastId);
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._timeline?.stop();
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
    }

    vfunc_button_release_event(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        this._player?.raise();
        return Clutter.EVENT_STOP;
    }

    _button(iconName, callback) {
        const button = new St.Button({style_class: 'di-btn', child: new St.Icon({icon_name: iconName})});
        button.connect('clicked', callback);
        return button;
    }

    // ---------- Public API used by the extension ----------

    setPlayer(player) {
        this._player = player;
        this._hasMusic = !!player && !!player.trackTitle && player.status !== 'Stopped';
        if (this._hasMusic) {
            this._playButton.child.icon_name = player.status === 'Playing'
                ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            const key = `${player.trackTitle}\n${player.trackArtists.join(', ')}\n${player.trackCoverUrl}`;
            if (key !== this._trackKey) {
                this._trackKey = key;
                this._swapTrack(player);
            }
        }
        this._refresh();
        this._tickEq();
    }

    // Temporary takeover of the island (volume, brightness, charger, Bluetooth)
    toast(icon, text, {level = null, color = null, duration = 2500} = {}) {
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

    // Small persistent indicator (screen recording, download progress); null removes it
    setIndicator(key, opts) {
        let chip = this._indicators.get(key);
        if (!opts) {
            if (chip) {
                chip.destroy();
                this._indicators.delete(key);
                this._refresh();
            }
            return;
        }
        const added = !chip;
        if (added) {
            chip = new St.Button({style_class: 'di-chip', can_focus: false, reactive: !!opts.onClick});
            chip.set_child(new St.BoxLayout({style_class: 'di-chip-box'}));
            chip.child.add_child(new St.Icon({style_class: 'di-chip-icon'}));
            chip.child.add_child(new St.Label({style_class: 'di-chip-label', y_align: Clutter.ActorAlign.CENTER}));
            if (opts.onClick)
                chip.connect('clicked', opts.onClick);
            this._indicatorBox.add_child(chip);
            this._indicators.set(key, chip);
        }
        const [icon, label] = chip.child.get_children();
        icon.gicon = toGicon(opts.icon);
        icon.style = opts.color ? `color: ${opts.color};` : null;
        label.text = opts.text ?? '';
        label.visible = !!opts.text;
        if (added)
            this._refresh();
    }

    // ---------- Layout and animation ----------

    // Shows/hides each part for the current state, springing the island to its new size
    _refresh() {
        const hasIndicators = this._indicators.size > 0;
        this._morph(() => {
            const music = this._hasMusic && !this._toastActive;
            const expanded = music && this._expanded;
            this._art.visible = music;
            this._text.visible = music;
            this._artist.visible = expanded;
            this._controls.visible = expanded;
            this._eq.visible = music && !expanded;
            this._indicatorBox.visible = !this._toastActive && hasIndicators;
            this._toastBox.visible = this._toastActive;
        });
        this._setShown(this._hasMusic || hasIndicators || this._toastActive);
    }

    _setShown(shown) {
        if (shown === this._shown)
            return;
        this._shown = shown;
        if (shown) {
            this.show();
            this.set({opacity: 0, scale_x: 0.5, scale_y: 0.5});
            this.ease({opacity: 255, scale_x: 1, scale_y: 1, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        } else {
            this.ease({
                opacity: 0,
                scale_x: 0.5,
                scale_y: 0.5,
                duration: 220,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => this.hide(),
            });
        }
    }

    _onHover() {
        // Small hover intent delay so passing the mouse over the island doesn't make it jump
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.hover ? 90 : 220, () => {
            this._hoverId = 0;
            this._setExpanded(this.hover);
            return GLib.SOURCE_REMOVE;
        });
    }

    _setExpanded(expanded) {
        if (expanded === this._expanded)
            return;
        this._expanded = expanded;
        this._refresh();
        if (!this._hasMusic || this._toastActive)
            return;
        // Newly revealed content fades in once the island has started growing
        for (const actor of expanded ? [this._artist, this._controls] : [this._eq]) {
            actor.opacity = 0;
            actor.ease({opacity: 255, duration: 250, delay: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Applies a layout change, then springs size, corners, padding and cover from the old state to the new one.
    // Driven per frame and rounded to whole pixels so text and icons stay crisp while moving.
    _morph(change) {
        const [w0, h0] = this.get_size();
        const from = {...this._geom, w: w0, h: h0};
        this._timeline?.stop();
        this._timeline = null;

        this.set_size(-1, -1);
        change();
        const target = this._expanded && this._hasMusic && !this._toastActive ? EXPANDED : COMPACT;
        this._applyGeom(target);
        if (!this._shown || !w0)
            return;

        const [, w1] = this.get_preferred_width(-1);
        const [, h1] = this.get_preferred_height(w1);
        if (w1 === w0 && h1 === h0 && target === from.target)
            return;
        const to = {...target, w: w1, h: h1};
        this._applyGeom(from);

        const timeline = new Clutter.Timeline({actor: this, duration: 650});
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
            this.set_size(-1, -1);
            this._timeline = null;
        });
        this._timeline = timeline;
        timeline.start();
    }

    _applyGeom(g) {
        this._geom = {target: g.target ?? g, r: g.r, pad: g.pad, a: g.a, ar: g.ar};
        const px = v => `${Math.max(0, Math.round(v))}px`;
        this.style = `border-radius: ${px(g.r)}; padding: ${g.pad.map(px).join(' ')};`;
        const a = Math.round(g.a);
        this._art.set_size(a, a);
        this._art.style = `${this._artBg} border-radius: ${px(g.ar)};`;
        if (g.w !== undefined)
            this.set_size(Math.round(g.w), Math.round(g.h));
    }

    _swapTrack(player) {
        const apply = () => this._morph(() => {
            this._title.text = player.trackTitle;
            this._artist.text = player.trackArtists.join(', ');
            this._setArt(player.trackCoverUrl);
        });
        if (!this._shown || !this._text.visible) {
            apply();
            return;
        }

        // Old track slides up and fades, new one slides in from below
        this._text.ease({
            opacity: 0,
            translation_y: -8,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                apply();
                this._text.translation_y = 8;
                this._text.ease({opacity: 255, translation_y: 0, duration: 380, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            },
        });
        this._art.ease({
            scale_x: 0.6,
            scale_y: 0.6,
            opacity: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => this._art.ease({
                scale_x: 1,
                scale_y: 1,
                opacity: 255,
                duration: 500,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            }),
        });
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
            this._artBg = `background-image: url("${dest.get_uri()}");`;
            this._applyGeom(this._geom);
        };
        if (dest.query_exists(null)) {
            apply();
            return;
        }
        Gio.File.new_for_uri(url).copy_async(dest, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (file, res) => {
            try {
                file.copy_finish(res);
            } catch (e) {
                console.warn(`dynamic-island: cover download failed: ${e.message}`);
                return;
            }
            // The island may have been destroyed while the download was running
            if (this._art)
                apply();
        });
    }

    _tickEq() {
        if (!this.visible || !this._eq.visible)
            return GLib.SOURCE_CONTINUE;
        const playing = this._player?.status === 'Playing';
        for (const bar of this._eq) {
            bar.ease({
                height: playing ? 4 + Math.round(Math.random() * 14) : 3,
                duration: 240,
                mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            });
        }
        return GLib.SOURCE_CONTINUE;
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const [vertical, horizontal] = this._settings.get_string('position').split('-');
        const margin = this._settings.get_int('margin');
        let x = monitor.x + Math.floor((monitor.width - this.width) / 2);
        if (horizontal === 'left')
            x = monitor.x + margin;
        else if (horizontal === 'right')
            x = monitor.x + monitor.width - this.width - margin;
        const y = vertical === 'top'
            ? monitor.y + Main.panel.height + margin
            : monitor.y + monitor.height - this.height - margin;
        this.set_position(x, y);
    }
});

export default class DynamicIslandExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._island = new Island(this._settings);
        Main.layoutManager.addTopChrome(this._island);

        this._watchMedia();
        this._watchOsd();
        this._watchBattery();
        this._watchRecording();
        this._watchBluetooth();
        this._watchProgress();
    }

    disable() {
        Gio.DBus.session.signal_unsubscribe(this._nameOwnerSub);
        this._nameOwnerSub = 0;
        for (const {player, handlerIds} of this._players.values())
            handlerIds.forEach(id => player.disconnect(id));
        this._players = null;
        this._current = null;

        Main.osdWindowManager.show = this._originalOsdShow;
        this._originalOsdShow = null;

        this._upowerCancellable.cancel();
        this._upowerCancellable = null;
        this._upower?.disconnectObject(this);
        this._upower = null;

        Main.screenshotUI.disconnectObject(this);
        if (this._recordingTickId)
            GLib.source_remove(this._recordingTickId);
        this._recordingTickId = 0;

        for (const device of this._bluetoothDevices)
            device.disconnectObject(this);
        this._bluetoothDevices = null;
        this._bluetoothStore.disconnectObject(this);
        this._bluetoothStore = null;
        this._bluetoothClient = null;

        Gio.DBus.session.signal_unsubscribe(this._launcherEntrySub);
        this._launcherEntrySub = 0;
        this._progress = null;
        this._settings = null;

        this._island.destroy();
        this._island = null;
    }

    // ---------- Media players (MPRIS) ----------

    _watchMedia() {
        this._players = new Map();
        this._current = null;
        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (connection, res) => {
                const [names] = connection.call_finish(res).deepUnpack();
                names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._addPlayer(n));
            });
        // arg0 namespace match must not end with '.'
        this._nameOwnerSub = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2',
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE, (connection, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
            });
    }

    _addPlayer(busName) {
        // The ListNames reply can arrive after disable()
        if (!this._players || this._players.has(busName))
            return;
        const player = new MprisPlayer(busName);
        const handlerIds = [
            player.connect('changed', () => {
                // A player that starts playing takes over the island
                if (player.status === 'Playing' || !this._current)
                    this._current = player;
                this._island.setPlayer(this._current);
            }),
            player.connect('closed', () => {
                this._players.delete(busName);
                if (this._current === player) {
                    const rest = [...this._players.values()].map(entry => entry.player);
                    this._current = rest.find(p => p.status === 'Playing') ?? rest[0] ?? null;
                }
                this._island.setPlayer(this._current);
            }),
        ];
        this._players.set(busName, {player, handlerIds});
    }

    // ---------- Volume / brightness ----------

    _watchOsd() {
        const osd = Main.osdWindowManager;
        this._originalOsdShow = osd.show;
        osd.show = (monitorIndex, icon, label, level, maxLevel) => {
            if (!this._settings.get_boolean('show-volume')) {
                this._originalOsdShow.call(osd, monitorIndex, icon, label, level, maxLevel);
                return;
            }
            const hasLevel = typeof level === 'number';
            this._island.toast(icon, hasLevel ? '' : label ?? '', {level: hasLevel ? level : null, duration: 1500});
        };
    }

    // ---------- Charger ----------

    _watchBattery() {
        this._upowerCancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null, 'org.freedesktop.UPower',
            '/org/freedesktop/UPower/devices/DisplayDevice', 'org.freedesktop.UPower.Device',
            this._upowerCancellable, (source, res) => {
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
        const percent = Math.round(this._upower.get_cached_property('Percentage')?.unpack() ?? 0);
        const icon = this._upower.get_cached_property('IconName')?.unpack() || 'battery-symbolic';
        const previous = this._lastPowerState;
        this._lastPowerState = state;
        // Desktops report no battery (state 0)
        if (state === previous || !state || !this._settings.get_boolean('show-battery'))
            return;
        const plugged = PLUGGED.includes(state);
        if (state === 4 && previous === 1)
            this._island.toast(icon, `Fully charged · ${percent}%`, {color: GREEN});
        else if (plugged !== PLUGGED.includes(previous))
            this._island.toast(icon, `${plugged ? 'Charging' : 'On battery'} · ${percent}%`, {color: plugged ? GREEN : null, level: percent / 100});
    }

    // ---------- Screen recording ----------

    _watchRecording() {
        this._recordingTickId = 0;
        Main.screenshotUI.connectObject('notify::screencast-in-progress', () => {
            if (this._recordingTickId)
                GLib.source_remove(this._recordingTickId);
            this._recordingTickId = 0;
            if (!Main.screenshotUI.screencast_in_progress || !this._settings.get_boolean('show-recording')) {
                this._island.setIndicator('recording', null);
                return;
            }
            const start = GLib.get_monotonic_time();
            const update = () => {
                this._island.setIndicator('recording', {
                    icon: 'media-record-symbolic',
                    color: RED,
                    text: formatDuration(Math.floor((GLib.get_monotonic_time() - start) / 1e6)),
                    onClick: () => Main.screenshotUI.stopScreencast(),
                });
                return GLib.SOURCE_CONTINUE;
            };
            update();
            this._recordingTickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, update);
        }, this);
    }

    // ---------- Bluetooth ----------

    _watchBluetooth() {
        this._bluetoothClient = new GnomeBluetooth.Client();
        this._bluetoothStore = this._bluetoothClient.get_devices();
        this._bluetoothDevices = [];
        const bindDevices = () => {
            this._bluetoothDevices.forEach(device => device.disconnectObject(this));
            this._bluetoothDevices = [];
            for (let i = 0; i < this._bluetoothStore.get_n_items(); i++) {
                const device = this._bluetoothStore.get_item(i);
                device.connectObject('notify::connected', () => this._onBluetoothChanged(device), this);
                this._bluetoothDevices.push(device);
            }
        };
        this._bluetoothStore.connectObject('items-changed', bindDevices, this);
        bindDevices();
    }

    _onBluetoothChanged(device) {
        if (!this._settings.get_boolean('show-bluetooth'))
            return;
        const battery = device.connected && device.battery_percentage > 0 ? ` · ${Math.round(device.battery_percentage)}%` : '';
        // Device-specific icon (headphones, mouse...) when the theme has one
        const icon = Gio.ThemedIcon.new_from_names([`${device.icon}-symbolic`, 'bluetooth-active-symbolic']);
        this._island.toast(icon, `${device.alias} ${device.connected ? 'connected' : 'disconnected'}${battery}`, {color: BLUE});
    }

    // ---------- Download / copy progress ----------

    _watchProgress() {
        this._progress = new Map();
        // Browsers and Nautilus publish progress through the Unity LauncherEntry API (the same one docks use)
        this._launcherEntrySub = Gio.DBus.session.signal_subscribe(null, 'com.canonical.Unity.LauncherEntry', 'Update',
            null, null, Gio.DBusSignalFlags.NONE, (connection, sender, path, iface, signal, params) => {
                const [appUri, props] = params.deepUnpack();
                const state = this._progress.get(appUri) ?? {visible: false, value: 0};
                if ('progress-visible' in props)
                    state.visible = props['progress-visible'].unpack();
                if ('progress' in props)
                    state.value = props['progress'].unpack();
                this._progress.set(appUri, state);

                const key = `progress:${appUri}`;
                if (!state.visible || !this._settings.get_boolean('show-progress')) {
                    this._island.setIndicator(key, null);
                    return;
                }
                const app = Shell.AppSystem.get_default().lookup_app(appUri.replace('application://', ''));
                this._island.setIndicator(key, {
                    icon: app?.get_icon() ?? 'folder-download-symbolic',
                    text: `${Math.round(state.value * 100)}%`,
                });
            });
    }
}
