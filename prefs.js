import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const POSITIONS = [
    ['top-center', 'Top center'], ['top-left', 'Top left'], ['top-right', 'Top right'],
    ['bottom-center', 'Bottom center'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right'],
    ['panel-left', 'Top bar, left (after Activities)'], ['panel-center-left', 'Top bar, left of clock'],
    ['panel-center-right', 'Top bar, right of clock'], ['panel-right', 'Top bar, right (before system menu)'],
];

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

        group.add(position);
        group.add(margin);
        page.add(group);

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
