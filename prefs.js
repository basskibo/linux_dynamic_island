import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [
    ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right'],
    ['bottom-center', 'Bottom center'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'],
    ['panel-left', 'Top bar, left (after Activities)'], ['panel-center-left', 'Top bar, left of clock'],
    ['panel-center-right', 'Top bar, right of clock'], ['panel-right', 'Top bar, right (before system menu)'],
    ['panel-notch', 'Top bar, around the clock (like the iPhone notch)'],
];

const SHAPES = [
    ['bars', 'Bars'], ['spectrum', 'Spectrum'], ['segments', 'Segments'],
    ['solid', 'Solid'], ['wave', 'Wave'], ['ribbon', 'Ribbon'],
];

const EXPAND_ON = [['hover', 'Hover'], ['click', 'Click'], ['both', 'Hover or click']];

const FEATURES = [
    ['show-volume', 'Volume and brightness'],
    ['show-battery', 'Charger'],
    ['show-recording', 'Screen recording'],
    ['show-bluetooth', 'Bluetooth devices'],
    ['show-progress', 'Download and copy progress'],
];

export default class DynamicIslandPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Position'});

        const position = new Adw.ComboRow({
            title: 'Location',
            model: Gtk.StringList.new(POSITIONS.map(p => p[1])),
            selected: Math.max(0, POSITIONS.findIndex(p => p[0] === settings.get_string('position'))),
        });
        position.connect('notify::selected', () => settings.set_string('position', POSITIONS[position.selected][0]));

        const margin = new Adw.SpinRow({
            title: 'Distance from edge',
            subtitle: 'Pixels, not used in the top bar',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 300, step_increment: 1, page_increment: 10}),
        });
        settings.bind('margin', margin, 'value', Gio.SettingsBindFlags.DEFAULT);

        const width = new Adw.SpinRow({
            title: 'Width',
            subtitle: 'Minimum width in pixels, 0 fits the content',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 800, step_increment: 10, page_increment: 50}),
        });
        settings.bind('width', width, 'value', Gio.SettingsBindFlags.DEFAULT);

        group.add(position);
        group.add(margin);
        const expandOn = new Adw.ComboRow({
            title: 'Open details on',
            subtitle: 'With click, a second click opens the player',
            model: Gtk.StringList.new(EXPAND_ON.map(p => p[1])),
            selected: Math.max(0, EXPAND_ON.findIndex(p => p[0] === settings.get_string('expand-on'))),
        });
        expandOn.connect('notify::selected', () => settings.set_string('expand-on', EXPAND_ON[expandOn.selected][0]));

        group.add(width);
        group.add(expandOn);
        page.add(group);

        const visualizer = new Adw.PreferencesGroup({title: 'Music visualizer'});
        const shape = new Adw.ComboRow({
            title: 'Shape',
            model: Gtk.StringList.new(SHAPES.map(p => p[1])),
            selected: Math.max(0, SHAPES.findIndex(p => p[0] === settings.get_string('eq-style'))),
        });
        shape.connect('notify::selected', () => settings.set_string('eq-style', SHAPES[shape.selected][0]));
        visualizer.add(shape);

        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string('accent-color'));
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            rgba,
            valign: Gtk.Align.CENTER,
        });
        colorButton.connect('notify::rgba', () => {
            const {red, green, blue} = colorButton.rgba;
            settings.set_string('accent-color', `#${[red, green, blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`);
        });
        settings.connect('changed::accent-color', () => {
            const color = new Gdk.RGBA();
            color.parse(settings.get_string('accent-color'));
            colorButton.rgba = color;
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Back to orange',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        reset.connect('clicked', () => settings.reset('accent-color'));
        const color = new Adw.ActionRow({title: 'Color'});
        color.add_suffix(reset);
        color.add_suffix(colorButton);
        visualizer.add(color);
        page.add(visualizer);

        const features = new Adw.PreferencesGroup({title: 'Show in island'});
        for (const [key, title] of FEATURES) {
            const row = new Adw.SwitchRow({title});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            features.add(row);
        }
        page.add(features);
        window.add(page);
    }
}
