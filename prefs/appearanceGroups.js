import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { t } from '../i18n.js';
import { createChoiceRow, createComboRow } from './widgets.js';

const SHAPE_KEYS = ['bars', 'spectrum', 'segments', 'solid', 'wave', 'ribbon'];
const ART_SHAPE_KEYS = ['auto', 'circle', 'rounded', 'square'];
const ART_BORDER_KEYS = ['none', 'subtle', 'white', 'accent'];
const FEATURE_KEYS = ['show-volume', 'show-battery', 'show-recording', 'show-bluetooth', 'show-progress'];

export function buildCoverGroup(settings) {
    const cover = new Adw.PreferencesGroup({ title: t('prefs.cover.title') });

    const artSize = new Adw.SpinRow({
        title: t('prefs.cover.size.title'),
        subtitle: t('prefs.cover.size.subtitle'),
        use_markup: false,
        adjustment: new Gtk.Adjustment({ lower: 16, upper: 40, step_increment: 1, page_increment: 4 }),
    });
    settings.bind('art-size', artSize, 'value', Gio.SettingsBindFlags.DEFAULT);
    cover.add(artSize);

    const artSizeExpanded = new Adw.SpinRow({
        title: t('prefs.cover.sizeExpanded.title'),
        subtitle: t('prefs.cover.sizeExpanded.subtitle'),
        use_markup: false,
        adjustment: new Gtk.Adjustment({ lower: 32, upper: 120, step_increment: 2, page_increment: 8 }),
    });
    settings.bind('art-size-expanded', artSizeExpanded, 'value', Gio.SettingsBindFlags.DEFAULT);
    cover.add(artSizeExpanded);

    cover.add(createChoiceRow(
        settings,
        'art-shape',
        t('prefs.cover.shape.title'),
        ART_SHAPE_KEYS.map(key => [key, t(`prefs.cover.shape.${key}`)])
    ));
    cover.add(createChoiceRow(
        settings,
        'art-border',
        t('prefs.cover.border.title'),
        ART_BORDER_KEYS.map(key => [key, t(`prefs.cover.border.${key}`)])
    ));

    const artCompact = new Adw.SwitchRow({
        title: t('prefs.cover.compact.title'),
        subtitle: t('prefs.cover.compact.subtitle'),
        use_markup: false,
    });
    settings.bind('art-compact', artCompact, 'active', Gio.SettingsBindFlags.DEFAULT);
    cover.add(artCompact);

    const artSpin = new Adw.SwitchRow({
        title: t('prefs.cover.spin.title'),
        subtitle: t('prefs.cover.spin.subtitle'),
        use_markup: false,
    });
    settings.bind('art-spin', artSpin, 'active', Gio.SettingsBindFlags.DEFAULT);
    cover.add(artSpin);

    return cover;
}

export function buildVisualizerGroup(settings, pageSignalIds) {
    const visualizer = new Adw.PreferencesGroup({ title: t('prefs.visualizer.title') });

    const shapes = SHAPE_KEYS.map(key => [key, t(`prefs.visualizer.shape.${key}`)]);
    const shape = createComboRow({
        title: t('prefs.visualizer.shape.title'),
        choices: shapes,
        selectedKey: settings.get_string('eq-style'),
        onChange: code => settings.set_string('eq-style', code),
    });
    visualizer.add(shape);

    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string('accent-color'));
    const colorButton = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({ with_alpha: false }),
        rgba,
        valign: Gtk.Align.CENTER,
    });
    colorButton.connect('notify::rgba', () => {
        const { red, green, blue } = colorButton.rgba;
        settings.set_string('accent-color', `#${[red, green, blue].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`);
    });
    pageSignalIds.push(settings.connect('changed::accent-color', () => {
        const color = new Gdk.RGBA();
        color.parse(settings.get_string('accent-color'));
        colorButton.rgba = color;
    }));
    const reset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: t('prefs.visualizer.color.resetTooltip'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    reset.connect('clicked', () => settings.reset('accent-color'));
    const color = new Adw.ActionRow({ title: t('prefs.visualizer.color.title'), use_markup: false });
    color.add_suffix(reset);
    color.add_suffix(colorButton);
    visualizer.add(color);

    return visualizer;
}

export function buildFeaturesGroup(settings) {
    const features = new Adw.PreferencesGroup({ title: t('prefs.features.title') });
    for (const key of FEATURE_KEYS) {
        const props = { title: t(`prefs.features.${key}`), use_markup: false };
        if (key === 'show-volume')
            props.subtitle = t('prefs.features.show-volumeSubtitle');
        const row = new Adw.SwitchRow(props);
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        features.add(row);
    }
    return features;
}
