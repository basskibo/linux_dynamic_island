import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const ART_SMALL = 26;
const ART_BIG = 56;
const BAR_W = 170;

// padding is [top, right, bottom, left]
const COMPACT = {radius: 18, padding: [5, 14, 5, 5], artSize: ART_SMALL, artRadius: ART_SMALL / 2};
const EXPANDED = {radius: 30, padding: [12, 16, 12, 12], artSize: ART_BIG, artRadius: 14, expanded: true};
// Slimmer resting island so it fits inside the top bar
const PANEL_COMPACT = {...COMPACT, padding: [3, 12, 3, 3]};

// Top bar positions: [panel box, index in box, which way the expanded island grows (0 right, 1 left)].
// 'panel-notch' wraps around the clock like the iPhone island around the camera.
const PANEL_SLOTS = {
    'panel-notch': ['_centerBox', 0, null],
    'panel-left': ['_leftBox', -1, 0],
    'panel-center-left': ['_centerBox', 0, 1],
    'panel-center-right': ['_centerBox', -1, 0],
    'panel-right': ['_rightBox', 0, 1],
};

// Damped spring (response 0.45s, damping 0.78 → ~2% overshoot), t in seconds → progress
const OMEGA = 2 * Math.PI / 0.45;
const ZETA = 0.78;
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);
const spring = t => 1 - Math.exp(-ZETA * OMEGA * t) * (Math.cos(OMEGA_D * t) + ZETA * OMEGA / OMEGA_D * Math.sin(OMEGA_D * t));
const lerp = (a, b, p) => a + (b - a) * p;

// Visualizer size per shape; levels animate toward random targets while playing
const EQ_WIDTH = {bars: 21, spectrum: 30, segments: 23, solid: 30, wave: 30, ribbon: 30};
const EQ_HEIGHT = 18;
const EQ_LEVELS = 8;

const ICONS = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('icons');
const icon = name => new Gio.FileIcon({file: ICONS.get_child(`${name}.svg`)});

// Gradient for the accent: the top is shifted toward yellow and lighter, so #ff6a00 gives the original #ffc24a → #ff6a00
function accentGradient(hex) {
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    const h = !d ? 0 : max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const hue = (h * 60 + 15 + 360) % 360, light = Math.min(l + 0.14, 0.9);
    const a = s * Math.min(light, 1 - light);
    const k = n => (n + hue / 30) % 12;
    return [[0, 8, 4].map(n => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))), rgb];
}

function roundedRect(cr, x, y, w, h) {
    const r = Math.min(w, h) / 2;
    cr.newSubPath();
    cr.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
}

const toGicon = icon => typeof icon === 'string' ? new Gio.ThemedIcon({name: icon}) : icon;

export const Island = GObject.registerClass(
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
        this._layout = COMPACT;
        this._geometry = COMPACT;
        this._slot = null;
        this._position = null;
        this._restWidth = 0;
        this._artBackground = '';
        this._artCancellable = new Gio.Cancellable();
        this._levels = new Array(EQ_LEVELS).fill(0);
        this._targets = new Array(EQ_LEVELS).fill(0);
        this._phase = 0;
        this._accent = accentGradient(settings.get_string('accent-color'));

        this._art = new St.Bin({style_class: 'di-art', pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        this.add_child(this._art);

        // Gap the clock shows through in notch mode
        this._notch = new St.Widget({visible: false, x_expand: true});
        this._notch.connect('notify::x', () => this._reposition());

        this._text = new St.BoxLayout({style_class: 'di-text', vertical: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._source = new St.BoxLayout({style_class: 'di-source', visible: false});
        this._sourceIcon = new St.Icon({style_class: 'di-source-icon'});
        this._sourceLabel = new St.Label({style_class: 'di-source-label', y_align: Clutter.ActorAlign.CENTER});
        this._source.add_child(this._sourceIcon);
        this._source.add_child(this._sourceLabel);
        this._text.add_child(this._source);
        this._title = new St.Label({style_class: 'di-title'});
        this._artist = new St.Label({style_class: 'di-artist', visible: false});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._text.add_child(this._title);
        this._text.add_child(this._artist);
        this.add_child(this._text);
        this.add_child(this._notch);

        this._eq = new St.DrawingArea({height: EQ_HEIGHT, y_align: Clutter.ActorAlign.CENTER});
        this._eq.connect('repaint', area => this._drawEq(area));
        this._eq.width = this._eqWidth();
        this.add_child(this._eq);
        this._eqTimeline = new Clutter.Timeline({actor: this._eq, duration: 1000, repeat_count: -1});
        this._eqTimeline.connect('new-frame', () => this._stepEq(this._eqTimeline.get_delta() / 1000));
        this._eqTimeline.start();

        this._controls = new St.BoxLayout({visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._controls.add_child(this._button('previous', () => this._player?.previous()));
        this._playButton = this._button('pause', () => this._player?.playPause());
        this._playButton.add_style_class_name('di-play');
        this._controls.add_child(this._playButton);
        this._controls.add_child(this._button('next', () => this._player?.next()));
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

        this._place();
        this._applyGeometry(this._compact());

        this.connect('notify::hover', () => this._onHover());
        this.connect('notify::width', () => this._reposition());
        this.connect('notify::height', () => this._reposition());
        this.connect('destroy', () => this._onDestroy());
        Main.layoutManager.connectObject('monitors-changed', () => this._reposition(), this);
        settings.connectObject(
            'changed::position', () => this._place(),
            'changed::eq-style', () => this._setEqStyle(),
            'changed::width', () => this._refresh(),
            'changed::accent-color', () => {
                this._accent = accentGradient(settings.get_string('accent-color'));
                this._eq.queue_repaint();
            },
            'changed', () => this._reposition(), this);
        this._eqId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => this._tickEq());
    }

    _onDestroy() {
        GLib.source_remove(this._eqId);
        this._eqTimeline.stop();
        if (this._toastId)
            GLib.source_remove(this._toastId);
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._timeline?.stop();
        this._artCancellable.cancel();
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._slot?.destroy();
        Main.panel.statusArea.dateMenu?.container.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.menu.disconnectObject(this);
    }

    _isNotch() {
        return !!this._slot && this._position === 'panel-notch' && !!Main.panel.statusArea.dateMenu;
    }

    _expandedGeometry() {
        // In notch mode the clock sits in the top of the expanded island
        if (!this._isNotch())
            return EXPANDED;
        const padding = [...EXPANDED.padding];
        padding[0] += Main.panel.height;
        // Hangs from the top edge like the macOS notch: square top, round bottom
        return {...EXPANDED, padding, topRadius: 0};
    }

    _compact() {
        return this._slot ? PANEL_COMPACT : COMPACT;
    }

    // Puts the island in a top bar slot, or floating as top chrome for the screen positions
    _place() {
        const position = this._settings.get_string('position');
        if (position === this._position)
            return;
        this._position = position;
        Main.panel.statusArea.dateMenu?.container.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.menu.disconnectObject(this);
        if (this._slot) {
            this._slot.remove_child(this);
            this._slot.destroy();
            this._slot = null;
        } else if (this.get_parent()) {
            Main.layoutManager.removeChrome(this);
        }

        const target = PANEL_SLOTS[position];
        if (target) {
            // Empty slot reserves room for the resting island; the expanded island overlaps its neighbours
            this._slot = new St.Widget({width: 0});
            this._slot.connect('notify::width', () => this._reposition());
            Main.panel[target[0]].insert_child_at_index(this._slot, target[1]);
            this._slot.add_child(this);
            if (this._isNotch()) {
                const clock = Main.panel.statusArea.dateMenu.container;
                const sync = () => {
                    this._notch.width = clock.width;
                    this._reposition();
                };
                clock.connectObject('notify::width', sync, 'notify::x', sync, this);
                const dateMenu = Main.panel.statusArea.dateMenu;
                dateMenu.connectObject('notify::hover', () => this._onHover(), this);
                dateMenu.menu.connectObject('open-state-changed', () => this._onHover(), this);
                sync();
            }
        } else {
            Main.layoutManager.addTopChrome(this);
        }
        // Reparenting cuts the show animation short, which would leave a shown island invisible
        if (this._shown) {
            this.remove_all_transitions();
            this.set({opacity: 255, scale_x: 1, scale_y: 1});
        }
        this._refresh();
    }

    _fitSlot() {
        // The notch island sits behind the clock, so it takes no room in the top bar
        if (this._slot && !this._layout.expanded && !this._isNotch())
            this._slot.ease({width: this._shown ? this._restWidth : 0, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    vfunc_button_release_event(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        // First click opens the details, the next one opens the player
        if (!this._expanded && this._hasMusic && this._settings.get_string('expand-on') !== 'hover') {
            this._setExpanded(true);
            return Clutter.EVENT_STOP;
        }
        this._player?.raise();
        return Clutter.EVENT_STOP;
    }

    _button(name, callback) {
        const button = new St.Button({style_class: 'di-btn', child: new St.Icon({gicon: icon(name)})});
        button.connect('clicked', callback);
        return button;
    }

    // source is the app playing: {name, icon}
    setPlayer(player, source) {
        this._player = player;
        this._hasMusic = !!player && !!player.trackTitle && player.status !== 'Stopped';
        if (this._hasMusic) {
            this._playButton.child.gicon = icon(player.status === 'Playing' ? 'pause' : 'play');
            this._sourceIcon.gicon = toGicon(source.icon);
            this._sourceLabel.text = source.name;
            this._source.visible = this._expanded && !!source.name;
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

    // Shows/hides each part for the current state, springing the island to its new size
    _refresh() {
        const hasIndicators = this._indicators.size > 0;
        this._morph(() => {
            const music = this._hasMusic && !this._toastActive;
            const expanded = music && this._expanded;
            const notch = this._isNotch() && !expanded;
            this._art.visible = music;
            this._text.visible = music && !notch;
            this._notch.visible = notch;
            this._artist.visible = expanded;
            this._source.visible = expanded && !!this._sourceLabel.text;
            this._controls.visible = expanded;
            this._eq.visible = music && !expanded;
            this._indicatorBox.visible = !this._toastActive && hasIndicators;
            this._toastBox.visible = this._toastActive;
        });
        this._setShown(this._hasMusic || hasIndicators || this._toastActive);
        this._fitSlot();
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
        this._hoverId = 0;
        const dateMenu = Main.panel.statusArea.dateMenu;
        // Open calendar collapses the island so it doesn't sit under the menu
        const hover = this._isNotch()
            ? (this.hover || dateMenu.hover) && !dateMenu.menu.isOpen
            : this.hover;
        // In click mode hovering only closes the details (when the pointer leaves)
        if (hover && this._settings.get_string('expand-on') === 'click')
            return;
        this._hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hover ? 90 : 220, () => {
            this._hoverId = 0;
            this._setExpanded(hover);
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
        for (const actor of expanded ? [this._source, this._artist, this._controls] : [this._eq]) {
            actor.opacity = 0;
            actor.ease({opacity: 255, duration: 250, delay: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Applies a layout change, then springs size, corners, padding and cover to the new state.
    // Animated per frame and rounded to whole pixels so text and icons stay sharp while moving.
    _morph(change) {
        const [fromWidth, fromHeight] = this.get_size();
        const from = this._geometry;
        const fromLayout = this._layout;
        this._timeline?.stop();
        this._timeline = null;

        this.set_size(-1, -1);
        change();
        this._layout = this._expanded && this._hasMusic && !this._toastActive ? this._expandedGeometry() : this._compact();
        const to = this._layout;
        this._applyGeometry(to);
        const [, toWidth] = this.get_preferred_width(-1);
        if (!to.expanded)
            this._restWidth = toWidth;
        if (!this._shown || !fromWidth)
            return;

        const [, toHeight] = this.get_preferred_height(toWidth);
        if (toWidth === fromWidth && toHeight === fromHeight && to === fromLayout)
            return;
        this._applyGeometry(from, fromWidth, fromHeight);

        const timeline = new Clutter.Timeline({actor: this, duration: 650});
        timeline.connect('new-frame', () => {
            const p = spring(timeline.get_elapsed_time() / 1000);
            this._applyGeometry({
                radius: lerp(from.radius, to.radius, p),
                topRadius: lerp(from.topRadius ?? from.radius, to.topRadius ?? to.radius, p),
                padding: from.padding.map((v, i) => lerp(v, to.padding[i], p)),
                artSize: lerp(from.artSize, to.artSize, p),
                artRadius: lerp(from.artRadius, to.artRadius, p),
            }, lerp(fromWidth, toWidth, p), lerp(fromHeight, toHeight, p));
        });
        timeline.connect('stopped', (t, finished) => {
            if (!finished)
                return;
            this._applyGeometry(to);
            this.set_size(-1, -1);
            this._timeline = null;
        });
        this._timeline = timeline;
        timeline.start();
    }

    _applyGeometry(geometry, width, height) {
        this._geometry = geometry;
        const px = v => `${Math.max(0, Math.round(v))}px`;
        const top = px(geometry.topRadius ?? geometry.radius);
        const bottom = px(geometry.radius);
        // 0 width setting = size to content; music layouts only, toasts keep their own size
        const minWidth = this._hasMusic && !this._toastActive ? this._settings.get_int('width') : 0;
        this.style = `border-radius: ${top} ${top} ${bottom} ${bottom}; padding: ${geometry.padding.map(px).join(' ')};` +
            (minWidth ? ` min-width: ${minWidth}px;` : '');
        const artSize = Math.round(geometry.artSize);
        this._art.set_size(artSize, artSize);
        this._art.style = `${this._artBackground} border-radius: ${px(geometry.artRadius)};`;
        if (width !== undefined)
            this.set_size(Math.round(width), Math.round(height));
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
            this._setArtBackground(url.startsWith('file://') ? url : null);
            return;
        }
        // St can't load remote images, so https covers (Spotify) are downloaded to a cache first
        const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-island']);
        GLib.mkdir_with_parents(dir, 0o755);
        const dest = Gio.File.new_for_path(`${dir}/${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1)}`);
        if (dest.query_exists(null)) {
            this._setArtBackground(dest.get_uri());
            return;
        }
        Gio.File.new_for_uri(url).copy_async(dest, Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT,
            this._artCancellable, null, (file, res) => {
                try {
                    file.copy_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`dynamic-island: cover download failed: ${e.message}`);
                    return;
                }
                this._setArtBackground(dest.get_uri());
            });
    }

    _setArtBackground(uri) {
        this._artBackground = uri ? `background-image: url("${uri}");` : '';
        this._applyGeometry(this._geometry);
    }

    _eqWidth() {
        return EQ_WIDTH[this._settings.get_string('eq-style')] ?? EQ_WIDTH.bars;
    }

    _setEqStyle() {
        this._eq.width = this._eqWidth();
        this._refresh();
    }

    _tickEq() {
        const playing = this._player?.status === 'Playing';
        this._targets = this._targets.map(() => playing ? 0.15 + Math.random() * 0.85 : 0);
        return GLib.SOURCE_CONTINUE;
    }

    // Eases levels toward their targets each frame; skips repaints once a paused visualizer has settled
    _stepEq(dt) {
        if (!this._eq.visible)
            return;
        const playing = this._player?.status === 'Playing';
        const ease = 1 - Math.exp(-dt * 10);
        let moving = playing;
        this._levels = this._levels.map((level, i) => {
            const next = level + (this._targets[i] - level) * ease;
            moving ||= Math.abs(next - level) > 0.001;
            return next;
        });
        if (playing)
            this._phase += dt * 5;
        if (moving)
            this._eq.queue_repaint();
    }

    // Level at x (0..1) between the sample points, cosine-smoothed
    _levelAt(x) {
        const t = x * (EQ_LEVELS - 1), i = Math.min(Math.floor(t), EQ_LEVELS - 2);
        const f = (1 - Math.cos((t - i) * Math.PI)) / 2;
        return lerp(this._levels[i], this._levels[i + 1], f);
    }

    _drawEq(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const [top, bottom] = this._accent;
        const gradient = new Cairo.LinearGradient(0, 0, 0, h);
        gradient.addColorStopRGB(0, ...top);
        gradient.addColorStopRGB(1, ...bottom);
        cr.setSource(gradient);
        const levels = this._levels;
        const taper = x => Math.sin(Math.PI * x);

        switch (this._settings.get_string('eq-style')) {
        case 'spectrum':
            // Thin bars from the bottom, bass side a bit taller
            levels.forEach((level, i) => {
                const bh = 2 + level * (h - 2) * (1 - i * 0.06);
                roundedRect(cr, i * 4, h - bh, 2, bh);
            });
            cr.fill();
            break;
        case 'segments':
            // LED meter: 4 columns of up to 5 blocks
            for (let i = 0; i < 4; i++) {
                const lit = Math.max(1, Math.ceil(levels[i * 2] * 5));
                for (let j = 0; j < lit; j++)
                    roundedRect(cr, i * 6.33, h - j * 3.6 - 2.8, 4, 2.8);
            }
            cr.fill();
            break;
        case 'solid':
            cr.moveTo(0, h);
            for (let x = 0; x <= w; x++)
                cr.lineTo(x, h - 1 - this._levelAt(x / w) * (h - 1) * Math.sqrt(taper(x / w)));
            cr.lineTo(w, h);
            cr.fill();
            break;
        case 'wave': {
            const amp = levels.reduce((a, b) => a + b) / EQ_LEVELS * (h / 2 - 1.5);
            cr.setLineWidth(2);
            cr.setLineCap(Cairo.LineCap.ROUND);
            for (let x = 1; x < w; x++)
                cr.lineTo(x, h / 2 + amp * Math.sin(x / w * 3 * Math.PI + this._phase) * taper(x / w));
            cr.stroke();
            break;
        }
        case 'ribbon': {
            // Band mirrored around the middle, rippling as it plays
            const half = x => (0.75 + this._levelAt(x) * (h / 2 - 1)) * taper(x) *
                (0.75 + 0.25 * Math.sin(x * 2 * Math.PI + this._phase));
            for (let x = 0; x <= w; x++)
                cr.lineTo(x, h / 2 - half(x / w));
            for (let x = w; x >= 0; x--)
                cr.lineTo(x, h / 2 + half(x / w));
            cr.fill();
            break;
        }
        default:
            for (let i = 0; i < 4; i++) {
                const bh = 3 + levels[i * 2] * (h - 3);
                roundedRect(cr, i * 6, (h - bh) / 2, 3, bh);
            }
            cr.fill();
        }
        cr.$dispose();
    }

    _reposition() {
        if (this._isNotch()) {
            // Line the gap (or the whole expanded island) up with the clock
            const clock = Main.panel.statusArea.dateMenu.container;
            const anchor = this._notch.visible ? this._notch.x + this._notch.width / 2 : this.width / 2;
            this.set_position(Math.round(clock.x + clock.width / 2 - this._slot.x - anchor),
                Math.max(0, Math.round((Main.panel.height - this.height) / 2)));
            return;
        }
        if (this._slot) {
            const grow = PANEL_SLOTS[this._position][2];
            this.set_position(Math.round((this._slot.width - this.width) * grow),
                Math.max(0, Math.round((Main.panel.height - this.height) / 2)));
            return;
        }
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
