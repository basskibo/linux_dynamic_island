import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BAR_W = 170;
const SPACING = 12;

const ART_RADIUS = {
    circle: size => size / 2,
    rounded: size => size / 4,
    square: () => 0,
};

// Resting and expanded layouts from the settings. padding is [top, right, bottom, left].
// A negative width tightens the resting island (less padding and spacing), handy around the clock.
function buildLayouts(settings) {
    const tighten = Math.max(0, -settings.get_int('width'));
    const shape = settings.get_string('art-shape');
    const radius = (size, auto) => (ART_RADIUS[shape] ?? auto)(size);
    const small = settings.get_int('art-size');
    const big = settings.get_int('art-size-expanded');
    const panelPad = Math.max(0, 3 - (small - 26) / 2);
    const compact = {
        radius: small / 2 + 5,
        padding: [5, Math.max(0, 14 - tighten), 5, 5],
        spacing: Math.max(0, SPACING - tighten),
        artSize: small,
        artRadius: radius(small, ART_RADIUS.circle),
    };
    return {
        compact,
        // Slimmer resting island so it fits inside the top bar, a bigger cover eats into the padding first
        panelCompact: {...compact, padding: [panelPad, Math.max(0, 12 - tighten), panelPad, 3]},
        expanded: {radius: 32, topRadius: 0, padding: [10, 42, 20, 42], spacing: 12, artSize: Math.max(104, big), artRadius: 25, expanded: true},
    };
}

const ART_BORDER = {
    subtle: () => '1px solid rgba(255,255,255,0.3)',
    white: () => '2px solid #fff',
    accent: settings => `2px solid ${settings.get_string('accent-color')}`,
};

// Top bar positions: [panel box, index in box, which way the expanded island grows (0 right, 1 left)].
// 'panel-notch' wraps around the clock like the iPhone island around the camera.
const PANEL_SLOTS = {
    'panel-notch': ['_centerBox', 0, null],
    'panel-left': ['_leftBox', -1, 0],
    'panel-center-left': ['_centerBox', 0, 1],
    'panel-center-right': ['_centerBox', -1, 0],
    'panel-right': ['_rightBox', 0, 1],
};

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
class Island extends St.Widget {
    _init(settings) {
        super._init({
            style_class: 'di-island',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
            track_hover: true,
            visible: false,
            clip_to_allocation: true,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
        });
        this._settings = settings;
        this._animationSettings = St.Settings.get();
        this._player = null;
        this._hasMusic = false;
        this._expanded = false;
        this._shown = false;
        this._visibilitySerial = 0;
        this._autoHideId = 0;
        this._autoHidden = false;
        this._activityKey = null;
        this._renderKey = null;
        this._dotBridgeId = 0;
        this._destroying = false;
        this._trackKey = null;
        this._indicators = new Map();
        this._toastActive = false;
        this._toastId = 0;
        this._hoverId = 0;
        this._timeline = null;
        this._layouts = buildLayouts(settings);
        this._layout = this._layouts.compact;
        this._geometry = this._layout;
        this._slot = null;
        this._position = null;
        this._restWidth = 0;
        this._artBackground = '';
        this._artCancellable = new Gio.Cancellable();
        this._levels = new Array(EQ_LEVELS).fill(0);
        this._targets = new Array(EQ_LEVELS).fill(0);
        this._phase = 0;
        this._accent = accentGradient(settings.get_string('accent-color'));

        this._art = new St.Bin({style_class: 'di-art', y_align: Clutter.ActorAlign.CENTER, pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        this.add_child(this._art);

        // Gap the clock shows through in notch mode
        this._notch = new St.Widget({visible: false, x_expand: true});
        this._notch.connect('notify::x', () => this._reposition());

        this._text = new St.BoxLayout({style_class: 'di-text', orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._source = new St.BoxLayout({style_class: 'di-source', visible: false});
        this._sourceIcon = new St.Icon({style_class: 'di-source-icon'});
        this._sourceLabel = new St.Label({style_class: 'di-source-label', y_align: Clutter.ActorAlign.CENTER});
        this._source.add_child(this._sourceIcon);
        this._source.add_child(this._sourceLabel);
        this._dashboardHeading = new St.Label({text: 'NOW PLAYING', style_class: 'di-dashboard-heading', visible: false});
        this._text.add_child(this._dashboardHeading);
        this._text.add_child(this._source);
        this._title = new St.Label({style_class: 'di-title'});
        this._artist = new St.Label({style_class: 'di-artist', visible: false});
        this._title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._artist.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._text.add_child(this._title);
        this._album = new St.Label({style_class: 'di-album', visible: false});
        this._album.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this._text.add_child(this._album);
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
        this._text.add_child(this._controls);

        this._calendar = new St.BoxLayout({
            style_class: 'di-calendar', orientation: Clutter.Orientation.VERTICAL,
            visible: false, y_align: Clutter.ActorAlign.CENTER,
        });
        this._calendarStrip = new St.BoxLayout({style_class: 'di-calendar-strip'});
        this._calendarMonth = new St.Label({style_class: 'di-calendar-month', y_align: Clutter.ActorAlign.CENTER});
        this._calendarStrip.add_child(this._calendarMonth);
        this._calendar.add_child(this._calendarStrip);
        this._calendarWeek = new St.BoxLayout({style_class: 'di-calendar-week'});
        this._calendarDays = [];
        for (let i = 0; i < 5; i++) {
            const column = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'di-calendar-day'});
            const weekday = new St.Label({style_class: 'di-calendar-weekday', x_align: Clutter.ActorAlign.CENTER});
            const date = new St.Label({style_class: 'di-calendar-date', x_align: Clutter.ActorAlign.CENTER});
            column.add_child(weekday);
            column.add_child(date);
            this._calendarWeek.add_child(column);
            this._calendarDays.push({column, weekday, date});
        }
        this._calendarStrip.add_child(this._calendarWeek);
        this._calendarFooter = new St.Label({style_class: 'di-calendar-footer', x_align: Clutter.ActorAlign.CENTER});
        const calendarButton = new St.Button({style_class: 'di-calendar-summary', child: this._calendarFooter});
        calendarButton.connect('clicked', () => Main.panel.statusArea.dateMenu.menu.toggle());
        this._calendar.add_child(calendarButton);
        this.add_child(this._calendar);
        this._updateCalendar();
        this._calendarId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            this._updateCalendar();
            return GLib.SOURCE_CONTINUE;
        });

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

        // A separate header and horizontal body reproduce the attached notch,
        // without changing the compact pill's content or event sources.
        this._body = new St.BoxLayout({style_class: 'di-body'});
        for (const child of this.get_children()) {
            this.remove_child(child);
            this._body.add_child(child);
        }
        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_expand: true,
        });
        this._background = new St.DrawingArea({
            x_expand: true, y_expand: true, visible: false,
        });
        this._background.connect('repaint', area => this._drawDashboardShell(area));
        this.add_child(this._background);
        this.add_child(this._content);
        this._header = new St.BoxLayout({style_class: 'di-header', visible: false});
        const nook = new St.BoxLayout({style_class: 'di-tab di-tab-active'});
        nook.add_child(new St.Icon({icon_name: 'audio-headphones-symbolic', style_class: 'di-tab-icon'}));
        nook.add_child(new St.Label({text: 'Nook', y_align: Clutter.ActorAlign.CENTER}));
        this._header.add_child(nook);
        const trayContent = new St.BoxLayout({style_class: 'di-tab'});
        trayContent.add_child(new St.Icon({icon_name: 'mail-inbox-symbolic', style_class: 'di-tab-icon'}));
        trayContent.add_child(new St.Label({text: 'Tray', y_align: Clutter.ActorAlign.CENTER}));
        const tray = new St.Button({child: trayContent, style_class: 'di-header-button'});
        tray.connect('clicked', () => Main.panel.statusArea.dateMenu.menu.toggle());
        this._header.add_child(tray);
        this._header.add_child(new St.Widget({x_expand: true}));
        const settingsButton = new St.Button({
            style_class: 'di-header-button',
            child: new St.Icon({icon_name: 'emblem-system-symbolic', style_class: 'di-tab-icon'}),
        });
        settingsButton.connect('clicked', () => Gio.Subprocess.new(
            ['gnome-extensions', 'prefs', 'dynamic-island@bjagetic'], Gio.SubprocessFlags.NONE));
        this._header.add_child(settingsButton);
        this._content.add_child(this._header);
        this._content.add_child(this._body);

        this._body.remove_child(this._art);
        this._artTile = new St.Widget({layout_manager: new Clutter.FixedLayout(), y_align: Clutter.ActorAlign.CENTER});
        this._artTile.add_child(this._art);
        this._artBadge = new St.Icon({
            style_class: 'di-art-badge', visible: false,
            width: 30, height: 30,
        });
        this._artTile.add_child(this._artBadge);
        this._body.insert_child_at_index(this._artTile, 0);

        const avatarPath = `/var/lib/AccountsService/icons/${GLib.get_user_name()}`;
        this._avatar = new St.Button({style_class: 'di-avatar', visible: false, y_align: Clutter.ActorAlign.CENTER});
        if (GLib.file_test(avatarPath, GLib.FileTest.EXISTS))
            this._avatar.style = `background-image: url("${Gio.File.new_for_path(avatarPath).get_uri()}");`;
        else
            this._avatar.child = new St.Icon({icon_name: 'camera-web-symbolic', icon_size: 32});
        const camera = GioUnix.DesktopAppInfo.new('org.gnome.Snapshot.desktop');
        this._avatar.reactive = !!camera;
        this._avatar.connect('clicked', () => camera?.launch([], global.create_app_launch_context(0, -1)));
        this._body.insert_child_above(this._avatar, this._calendar);

        this._createCoverDot();
        this._place();
        this._applyGeometry(this._compact());

        this.connect('notify::hover', () => this._onHover());
        this.connect('notify::width', () => this._reposition());
        this.connect('notify::height', () => this._reposition());
        this.connect('destroy', () => this._onDestroy());
        Main.layoutManager.connectObject('monitors-changed', () => this._reposition(), this);
        settings.connectObject(
            'changed::position', () => this._place(),
            'changed::auto-hide-enabled', () => this._onAutoHideSettingsChanged(),
            'changed::auto-hide-delay', () => this._onAutoHideSettingsChanged(),
            'changed::cover-dot-enabled', () => this._onCoverDotSettingsChanged(),
            'changed::cover-dot-size', () => this._onCoverDotSettingsChanged(),
            'changed::dashboard-calendar', () => this._refresh(),
            'changed::dashboard-account', () => this._refresh(),
            'changed::dashboard-header', () => this._refresh(),
            'changed::animations-enabled', () => this._onAnimationSettingsChanged(),
            'changed::animation-speed', () => this._onAnimationSettingsChanged(),
            'changed::eq-style', () => this._setEqStyle(),
            'changed::width', () => this._updateLayouts(),
            'changed::art-size', () => this._updateLayouts(),
            'changed::art-size-expanded', () => this._updateLayouts(),
            'changed::art-shape', () => this._updateLayouts(),
            'changed::art-border', () => this._applyGeometry(this._geometry),
            'changed::art-compact', () => this._refresh(),
            'changed::art-spin', () => this._syncSpin(),
            'changed::text-width', () => this._refresh(),
            'changed::accent-color', () => {
                this._accent = accentGradient(settings.get_string('accent-color'));
                this._eq.queue_repaint();
                this._applyGeometry(this._geometry);
            },
            'changed', () => this._reposition(), this);
        this._animationSettings.connectObject('notify::enable-animations', () => this._onAnimationSettingsChanged(), this);
        this._eqId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 260, () => this._tickEq());
    }

    _onDestroy() {
        this._destroying = true;
        if (this._dotBridgeId)
            GLib.source_remove(this._dotBridgeId);
        this._dotBridgeId = 0;
        this._coverDot?.destroy();
        this._coverDot = null;
        if (this._calendarId)
            GLib.source_remove(this._calendarId);
        this._cancelAutoHide();
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
        this._animationSettings.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.container.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.disconnectObject(this);
        Main.panel.statusArea.dateMenu?.menu.disconnectObject(this);
    }

    // The slot is our parent: destroying it from the destroy handler makes Clutter destroy us twice and abort the shell
    destroy() {
        const slot = this._slot;
        this._slot = null;
        super.destroy();
        slot?.destroy();
    }

    _isNotch() {
        return !!this._slot && this._position === 'panel-notch' && !!Main.panel.statusArea.dateMenu;
    }

    _expandedGeometry() {
        const expanded = this._layouts.expanded;
        // In notch mode the clock sits in the top of the expanded island
        if (!this._isNotch())
            return expanded;
        const padding = [...expanded.padding];
        padding[0] += Main.panel.height;
        // Hangs from the top edge like the macOS notch: square top, round bottom
        return {...expanded, padding, topRadius: 0};
    }

    _compact() {
        return this._slot ? this._layouts.panelCompact : this._layouts.compact;
    }

    _updateLayouts() {
        this._renderKey = null;
        this._layouts = buildLayouts(this._settings);
        this._refresh();
    }

    // Vinyl mode: the cover turns while playing and stops where it is when paused
    _syncSpin() {
        const enabled = this._settings.get_boolean('art-spin');
        const spin = enabled && this._hasMusic && this._player?.status === 'Playing';
        if (spin === !!this._art.get_transition('di-spin'))
            return;
        if (spin) {
            // Plain transition, not ease(): ease() keeps the shell in "busy" mode for as long as it runs
            const angle = this._art.rotation_angle_z % 360;
            const transition = new Clutter.PropertyTransition({
                property_name: 'rotation-angle-z',
                duration: 8000,
                repeat_count: -1,
                progress_mode: Clutter.AnimationMode.LINEAR,
            });
            transition.set_from(angle);
            transition.set_to(angle + 360);
            this._art.add_transition('di-spin', transition);
        } else {
            this._art.remove_transition('di-spin');
            if (!enabled)
                this._art.rotation_angle_z = 0;
        }
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
        if (this._slot && (!this._layout.expanded || !this._shown) && !this._isNotch())
            this._ease(this._slot, {width: this._shown ? this._restWidth : 0, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
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

    _drawDashboardShell(area) {
        const [w, h] = area.get_surface_size();
        const cr = area.get_context();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }
        // Concave top shoulders merge into the bar; the body is inset below
        // them. Draw at the actual allocation so no image sizing can square it.
        const shoulder = Math.min(22, w / 8, h / 4);
        const bottom = Math.min(32, (w - 2 * shoulder) / 4, h / 3);
        const k = 0.5522847498;
        cr.moveTo(0, 0);
        cr.lineTo(w, 0);
        cr.curveTo(w - shoulder * k, 0, w - shoulder, shoulder * (1 - k), w - shoulder, shoulder);
        cr.lineTo(w - shoulder, h - bottom);
        cr.curveTo(w - shoulder, h - bottom * (1 - k), w - shoulder - bottom * (1 - k), h, w - shoulder - bottom, h);
        cr.lineTo(shoulder + bottom, h);
        cr.curveTo(shoulder + bottom * (1 - k), h, shoulder, h - bottom * (1 - k), shoulder, h - bottom);
        cr.lineTo(shoulder, shoulder);
        cr.curveTo(shoulder, shoulder * (1 - k), shoulder * k, 0, 0, 0);
        cr.closePath();
        cr.setSourceRGBA(0, 0, 0, 1);
        cr.fill();
        cr.$dispose();
    }

    _updateCalendar() {
        const now = GLib.DateTime.new_now_local();
        this._calendarMonth.text = now.format('%b');
        const firstDay = now.add_days(-2);
        this._calendarDays.forEach(({column, weekday, date}, index) => {
            const day = firstDay.add_days(index);
            weekday.text = day.format('%a');
            date.text = day.format('%d');
            if (day.format('%F') === now.format('%F'))
                column.add_style_class_name('di-calendar-today');
            else
                column.remove_style_class_name('di-calendar-today');
        });
        // This is a date summary, not an events feed: no calendar access required.
        this._calendarFooter.text = `▦  ${now.format('%A, %B %e')}`;
    }

    _createCoverDot() {
        this._coverDotArt = new St.Bin({style_class: 'di-cover-dot-art', width: 20, height: 20});
        this._coverDotFallback = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: 13});
        this._coverDotArt.child = this._coverDotFallback;
        this._coverDot = new St.Button({
            style_class: 'di-cover-dot', child: this._coverDotArt,
            track_hover: true, can_focus: true, visible: false,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Show Dynamic Island',
        });
        this._coverDot.connect('clicked', () => this._revealFromCoverDot());
        this._coverDot.connect('notify::hover', () => {
            if (this._destroying)
                return;
            if (this._coverDot.hover && this._autoHidden)
                this._revealFromCoverDot();
            else
                this._onHover();
        });
        const clock = Main.panel.statusArea.dateMenu?.container;
        const box = clock?.get_parent() ?? Main.panel._centerBox;
        const index = clock ? box.get_children().indexOf(clock) + 1 : -1;
        box.insert_child_at_index(this._coverDot, index);
        this._updateCoverDot();
    }

    _updateCoverDot() {
        const size = this._settings.get_int('cover-dot-size');
        this._coverDotArt.set_size(size, size);
        this._coverDotArt.style = `${this._artBackground} border-radius: ${size / 2}px;`;
        this._coverDotFallback.icon_size = Math.max(8, size - 7);
    }

    _onCoverDotSettingsChanged() {
        this._updateCoverDot();
        this._syncCoverDot();
    }

    _syncCoverDot() {
        if (this._coverDot && !this._destroying)
            this._coverDot.visible = this._settings.get_boolean('cover-dot-enabled') &&
                this._settings.get_boolean('auto-hide-enabled') &&
                this._autoHidden && this._hasMusic && !this.visible;
    }

    _revealFromCoverDot() {
        if (this._destroying || !this._hasMusic)
            return;
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._hoverId = 0;
        if (this._dotBridgeId)
            GLib.source_remove(this._dotBridgeId);
        // Allow the pointer to cross from the disappearing dot into the panel
        // without immediately collapsing it or starting the hide countdown.
        this._dotBridgeId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._dotBridgeId = 0;
            this._onHover();
            return GLib.SOURCE_REMOVE;
        });
        this._activity();
        this._expanded = true;
        this._refresh();
    }

    _cancelAutoHide() {
        if (this._autoHideId)
            GLib.source_remove(this._autoHideId);
        this._autoHideId = 0;
    }

    _pointerOnIsland() {
        return this.hover || !!this._dotBridgeId || !!this._coverDot?.hover ||
            (this._isNotch() && Main.panel.statusArea.dateMenu.hover);
    }

    _onAutoHideSettingsChanged() {
        this._cancelAutoHide();
        if (!this._settings.get_boolean('auto-hide-enabled'))
            this._autoHidden = false;
        this._refresh();
        this._scheduleAutoHide();
    }

    _scheduleAutoHide() {
        this._cancelAutoHide();
        if (!this._settings.get_boolean('auto-hide-enabled') || this._autoHidden || this._pointerOnIsland())
            return;
        this._autoHideId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, this._settings.get_int('auto-hide-delay'), () => {
            this._autoHideId = 0;
            if (!this._pointerOnIsland()) {
                this._autoHidden = true;
                // Fade the current shape out; shrinking it at the same time
                // rebuilds the entire layout during the closing animation.
                this._refresh();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _activity() {
        this._autoHidden = false;
        this._scheduleAutoHide();
    }

    // source is the app playing: {name, icon}
    setPlayer(player, source) {
        const activityKey = player
            ? JSON.stringify([source?.name, player.trackTitle, player.trackArtists, player.trackCoverUrl, player.status])
            : null;
        if (player !== this._player || activityKey !== this._activityKey) {
            this._activityKey = activityKey;
            this._activity();
        }
        this._player = player;
        this._hasMusic = !!player && !!player.trackTitle && player.status !== 'Stopped';
        if (this._hasMusic) {
            this._coverDot.accessible_name = `Show ${player.trackTitle}`;
            this._playButton.child.gicon = icon(player.status === 'Playing' ? 'pause' : 'play');
            this._sourceIcon.gicon = toGicon(source.icon);
            this._artBadge.gicon = toGicon(source.icon);
            this._sourceLabel.text = source.name;
            this._source.visible = this._expanded && !!source.name;
            const key = `${player.trackTitle}\n${player.trackArtists.join(', ')}\n${player.trackCoverUrl}`;
            if (key !== this._trackKey) {
                this._trackKey = key;
                this._swapTrack(player);
            }
        }
        this._refresh();
        this._syncSpin();
        this._tickEq();
    }

    // Temporary takeover of the island (volume, brightness, charger, Bluetooth)
    toast(icon, text, {level = null, color = null, duration = 2500} = {}) {
        this._activity();
        this._toastIcon.gicon = toGicon(icon);
        this._toastIcon.style = color ? `color: ${color};` : null;
        this._toastLabel.text = text;
        this._toastLabel.visible = !!text;
        this._toastBar.visible = level !== null;
        if (level !== null) {
            this._toastLevel = level;
            this._ease(this._toastFill, {
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
            this._ease(this._toastBox, {opacity: 255, duration: 250, delay: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Small persistent indicator (screen recording, download progress); null removes it
    setIndicator(key, opts) {
        let chip = this._indicators.get(key);
        if (!opts) {
            if (chip) {
                chip.destroy();
                this._indicators.delete(key);
                this._activity();
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
        const indicatorState = JSON.stringify([String(opts.icon), opts.text, opts.color]);
        if (chip._activityState !== indicatorState) {
            chip._activityState = indicatorState;
            this._activity();
        }
        const [icon, label] = chip.child.get_children();
        icon.gicon = toGicon(opts.icon);
        icon.style = opts.color ? `color: ${opts.color};` : null;
        label.text = opts.text ?? '';
        label.visible = !!opts.text;
        this._refresh();
    }

    // Shows/hides each part for the current state, springing the island to its new size
    _refresh() {
        const hasIndicators = this._indicators.size > 0;
        // Media/progress signals often repeat the same state. Do not interrupt
        // an in-flight morph or remeasure the whole dashboard for those signals.
        const renderKey = JSON.stringify([
            this._hasMusic, this._expanded, this._toastActive, this._position,
            this._title.text, this._artist.text, this._album.text,
            this._toastLabel.text, this._toastLabel.visible, this._toastBar.visible,
            [...this._indicators.values()].map(chip => chip._activityState),
            this._settings.get_boolean('art-compact'),
            this._settings.get_int('text-width'), this._settings.get_string('eq-style'),
            this._settings.get_boolean('dashboard-calendar'),
            this._settings.get_boolean('dashboard-account'),
            this._settings.get_boolean('dashboard-header'),
        ]);
        if (renderKey !== this._renderKey) {
            this._renderKey = renderKey;
            this._morph(() => {
                const music = this._hasMusic && !this._toastActive;
                const expanded = music && this._expanded;
                const notch = this._isNotch() && !expanded;
                this._art.visible = music && (expanded || this._settings.get_boolean('art-compact'));
                this._artTile.visible = this._art.visible;
                this._artBadge.visible = expanded;
                this._text.visible = music && !notch;
                this._notch.visible = notch;
                this._artist.visible = expanded;
                this._album.visible = expanded && !!this._album.text;
                this._source.visible = expanded && !!this._sourceLabel.text;
                this._controls.visible = expanded;
                this._dashboardHeading.visible = false;
                this._header.visible = expanded && this._settings.get_boolean('dashboard-header');
                this._background.visible = expanded;
                this._avatar.visible = expanded && this._settings.get_boolean('dashboard-account');
                this._setCachedStyle(this._body, `spacing: ${expanded ? 16 : SPACING}px;`);
                this._calendar.visible = expanded && this._settings.get_boolean('dashboard-calendar');
                if (expanded)
                    this.add_style_class_name('di-dashboard');
                else
                    this.remove_style_class_name('di-dashboard');
                this._eq.visible = music && !expanded;
                this._indicatorBox.visible = !this._toastActive && hasIndicators;
                this._toastBox.visible = this._toastActive;
            });
        }
        this._setShown(!this._autoHidden && (this._hasMusic || hasIndicators || this._toastActive));
        this._fitSlot();
        this._syncCoverDot();
    }

    _animationDuration(milliseconds) {
        if (!this._settings.get_boolean('animations-enabled') || !this._animationSettings.enable_animations)
            return 0;
        return milliseconds > 0
            ? Math.max(1, Math.round(milliseconds * 100 / this._settings.get_int('animation-speed')))
            : 0;
    }

    _ease(actor, options) {
        const {duration = 250, delay = 0, mode, onComplete, ...properties} = options;
        const milliseconds = this._animationDuration(duration);
        if (!milliseconds) {
            for (const property of Object.keys(properties))
                actor.remove_transition(property.replaceAll('_', '-'));
            actor.set(properties);
            onComplete?.();
            return;
        }
        actor.ease({...properties, duration: milliseconds, delay: this._animationDuration(delay), mode, onComplete});
    }

    _onAnimationSettingsChanged() {
        // Settle old transitions before switching speed or disabling animation.
        // Invalidate their completions so a cancelled fade cannot hide the panel.
        ++this._visibilitySerial;
        this.remove_all_transitions();
        this._timeline?.stop();
        this._timeline = null;
        for (const actor of [this._artist, this._controls, this._eq, this._toastBox]) {
            actor.remove_transition('opacity');
            actor.opacity = 255;
        }
        this._slot?.remove_all_transitions();
        this._toastFill.remove_transition('width');
        if (Number.isFinite(this._toastLevel))
            this._toastFill.width = Math.round(BAR_W * Math.max(0, Math.min(this._toastLevel, 1)));
        this.opacity = this._shown ? 255 : 0;
        if (!this._shown) {
            this.hide();
            this._expanded = false;
        }
        this.set_size(-1, -1);
        this._renderKey = null;
        this._refresh();
    }

    _setShown(shown) {
        if (shown === this._shown)
            return;
        this._shown = shown;
        const serial = ++this._visibilitySerial;
        // Preserve the current opacity when reversing a transition. Never restart
        // from zero or let an obsolete hide completion hide a newly shown island.
        for (const property of ['opacity', 'scale-x', 'scale-y'])
            this.remove_transition(property);
        this.set({scale_x: 1, scale_y: 1});
        if (shown) {
            if (!this.visible)
                this.opacity = 0;
            this.show();
            this._ease(this, {opacity: 255, duration: 180, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        } else {
            this._ease(this, {
                opacity: 0,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    if (serial === this._visibilitySerial && !this._shown) {
                        this.hide();
                        this._expanded = false;
                        this._renderKey = null;
                        this._syncCoverDot();
                    }
                },
            });
        }
    }

    _onHover() {
        if (this._destroying)
            return;
        if (this._pointerOnIsland())
            this._cancelAutoHide();
        else
            this._scheduleAutoHide();
        // Small hover intent delay so passing the mouse over the island doesn't make it jump
        if (this._hoverId)
            GLib.source_remove(this._hoverId);
        this._hoverId = 0;
        const dateMenu = Main.panel.statusArea.dateMenu;
        // Open calendar collapses the island so it doesn't sit under the menu
        const hover = this._pointerOnIsland() &&
            (!this._isNotch() || !dateMenu.menu.isOpen);
        // In click mode hovering only closes the details (when the pointer leaves)
        if (hover && this._settings.get_string('expand-on') === 'click')
            return;
        this._hoverId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hover ? 40 : 140, () => {
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
        // Fade alongside the resize, not after a second delayed animation.
        for (const actor of [this._artist, this._controls, this._eq]) {
            const reversing = !!actor.get_transition('opacity');
            actor.remove_transition('opacity');
            if (!actor.visible) {
                actor.opacity = 255;
                continue;
            }
            if (!reversing)
                actor.opacity = 0;
            this._ease(actor, {opacity: 255, duration: 140, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
    }

    // Preserve the resize animation, with cached styles and no delayed second stage.
    // Whole-pixel geometry keeps text and icons sharp while moving.
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

        const duration = this._animationDuration(220);
        if (!duration)
            return;
        this._applyGeometry(from, fromWidth, fromHeight);

        const timeline = new Clutter.Timeline({actor: this, duration});
        timeline.connect('new-frame', () => {
            const progress = Math.min(1, timeline.get_elapsed_time() / duration);
            const p = 1 - Math.pow(1 - progress, 3);
            this._applyGeometry({
                radius: lerp(from.radius, to.radius, p),
                topRadius: lerp(from.topRadius ?? from.radius, to.topRadius ?? to.radius, p),
                padding: from.padding.map((v, i) => lerp(v, to.padding[i], p)),
                spacing: lerp(from.spacing, to.spacing, p),
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

    _setCachedStyle(actor, style) {
        if (actor._diCachedStyle === style)
            return;
        actor._diCachedStyle = style;
        actor.style = style;
    }

    _applyGeometry(geometry, width, height) {
        this._geometry = geometry;
        const px = v => `${Math.max(0, Math.round(v))}px`;
        const top = px(geometry.topRadius ?? geometry.radius);
        const bottom = px(geometry.radius);
        // Width 0 = size to content, below 0 is handled by the layouts; music layouts only, toasts keep their own size
        const minWidth = this._hasMusic && !this._toastActive ? this._settings.get_int('width') : 0;
        this._setCachedStyle(this._text, this._layout.expanded
            ? 'min-width: 160px; max-width: 160px; spacing: 4px;'
            : `max-width: ${this._settings.get_int('text-width')}px;`);
        const shellStyle = this._layout.expanded
            ? 'background-image: none; background-color: transparent; border-radius: 0;'
            : `background-image: none; background-color: #000; border-radius: ${top} ${top} ${bottom} ${bottom};`;
        this._setCachedStyle(this, shellStyle + (minWidth > 0 ? ` min-width: ${minWidth}px;` : ''));
        this._setCachedStyle(this._content, `padding: ${geometry.padding.map(px).join(' ')}; spacing: ${px(geometry.spacing)};`);
        // St.DrawingArea repaints automatically on allocation changes. Forcing
        // another repaint here also uploaded its texture on unchanged frames.
        const artSize = Math.round(geometry.artSize);
        this._art.set_size(artSize, artSize);
        this._artTile.set_size(artSize, artSize);
        this._art.set_position(0, 0);
        // Fixed coordinates avoid BinLayout centering the source icon.
        this._artBadge.set_position(Math.max(0, artSize - 25), Math.max(0, artSize - 25));
        const border = ART_BORDER[this._settings.get_string('art-border')]?.(this._settings);
        this._setCachedStyle(this._art, `${this._artBackground} border-radius: ${px(geometry.artRadius)};` + (border ? ` border: ${border};` : ''));
        if (width !== undefined)
            this.set_size(Math.round(width), Math.round(height));
    }

    _swapTrack(player) {
        // Track notifications can arrive in bursts during startup. Update in place
        // rather than queuing fade-out callbacks with stale player metadata.
        for (const actor of [this._text, this._art]) {
            for (const property of ['opacity', 'translation-y', 'scale-x', 'scale-y'])
                actor.remove_transition(property);
            actor.set({opacity: 255, translation_y: 0, scale_x: 1, scale_y: 1});
        }
        this._title.text = player.trackTitle;
        this._artist.text = player.trackArtists.join(', ');
        this._album.text = player._playerProxy?.Metadata?.['xesam:album']?.deepUnpack() ?? '';
        this._setArt(player.trackCoverUrl);
    }

    _setArt(url) {
        this._artUrl = url;
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
                if (!this._artCancellable.is_cancelled() && this._artUrl === url)
                    this._setArtBackground(dest.get_uri());
            });
    }

    _setArtBackground(uri) {
        this._artBackground = uri ? `background-image: url("${uri}");` : '';
        this._updateCoverDot();
        this._coverDotFallback.visible = !uri;
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
        if (!this._shown || !this.visible || !this._eq.visible || this._timeline)
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
            ? monitor.y + Main.panel.height + (this._layout.expanded ? 0 : margin)
            : monitor.y + monitor.height - this.height - margin;
        this.set_position(x, y);
    }
});
