import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { getLanguageChoices, t } from '../i18n.js';
import { createComboRow } from './widgets.js';

const IDLE_CONTENT_KEYS = ['empty', 'clock', 'icon'];

export function buildGeneralGroup(window, settings, pageSignalIds) {
    const general = new Adw.PreferencesGroup({ title: t('prefs.general.title') });

    const languages = getLanguageChoices();
    const currentLang = settings.get_string('language');
    const languageRow = createComboRow({
        title: t('prefs.language.title'),
        subtitle: t('prefs.language.subtitle'),
        choices: languages,
        selectedKey: currentLang,
        onChange: code => {
            if (code !== settings.get_string('language'))
                settings.set_string('language', code);
        },
    });
    general.add(languageRow);

    const alwaysVisible = new Adw.SwitchRow({
        title: t('prefs.alwaysVisible.title'),
        subtitle: t('prefs.alwaysVisible.subtitle'),
        use_markup: false,
    });
    settings.bind('always-visible', alwaysVisible, 'active', Gio.SettingsBindFlags.DEFAULT);
    general.add(alwaysVisible);

    const idleContentOptions = IDLE_CONTENT_KEYS.map(key => [key, t(`prefs.idleContent.${key}`)]);
    const idleContentRow = createComboRow({
        title: t('prefs.idleContent.title'),
        subtitle: t('prefs.idleContent.subtitle'),
        choices: idleContentOptions,
        selectedKey: settings.get_string('idle-content'),
        onChange: code => settings.set_string('idle-content', code),
    });
    settings.bind('always-visible', idleContentRow, 'sensitive', Gio.SettingsBindFlags.GET);
    general.add(idleContentRow);

    const idleIconRow = new Adw.ActionRow({
        title: t('prefs.idleIcon.title'),
        use_markup: false,
    });
    const idleIconPreview = new Gtk.Image({
        pixel_size: 20,
        valign: Gtk.Align.CENTER,
    });
    const idleIconReset = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: t('prefs.idleIcon.resetTooltip'),
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    idleIconReset.connect('clicked', () => settings.reset('idle-icon-path'));
    const idleIconChoose = new Gtk.Button({
        label: t('prefs.idleIcon.choose'),
        valign: Gtk.Align.CENTER,
    });
    idleIconChoose.connect('clicked', () => {
        const filter = new Gtk.FileFilter();
        filter.set_name(t('prefs.idleIcon.filterName'));
        filter.add_mime_type('image/svg+xml');
        filter.add_mime_type('image/png');
        filter.add_pattern('*.svg');
        filter.add_pattern('*.png');
        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        const dialog = new Gtk.FileDialog({
            title: t('prefs.idleIcon.dialogTitle'),
            filters,
            default_filter: filter,
        });
        dialog.open(window, null, (dlg, res) => {
            try {
                const file = dlg.open_finish(res);
                const path = file?.get_path();
                if (path)
                    settings.set_string('idle-icon-path', path);
            } catch (e) {
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    console.warn(`dynamic-island: icon picker failed: ${e.message}`);
            }
        });
    });

    const syncIdleIconRow = () => {
        const path = settings.get_string('idle-icon-path');
        const file = path ? Gio.File.new_for_path(path) : null;
        const valid = !!file && file.query_exists(null);
        idleIconRow.subtitle = valid ? GLib.path_get_basename(path) : t('prefs.idleIcon.subtitleDefault');
        idleIconReset.visible = !!path;
        if (valid)
            idleIconPreview.set_from_gicon(new Gio.FileIcon({ file }));
        else
            idleIconPreview.set_from_icon_name('audio-x-generic-symbolic');
        idleIconRow.sensitive = settings.get_boolean('always-visible') && (
            settings.get_string('idle-content') === 'icon' ||
            settings.get_boolean('idle-expand-icon')
        );
    };
    syncIdleIconRow();
    pageSignalIds.push(
        settings.connect('changed::idle-icon-path', syncIdleIconRow),
        settings.connect('changed::always-visible', syncIdleIconRow),
        settings.connect('changed::idle-content', syncIdleIconRow),
        settings.connect('changed::idle-expand-icon', syncIdleIconRow)
    );

    idleIconRow.add_prefix(idleIconPreview);
    idleIconRow.add_suffix(idleIconReset);
    idleIconRow.add_suffix(idleIconChoose);
    general.add(idleIconRow);

    return general;
}

export function buildIdlePanelGroup(settings) {
    const idlePanelGroup = new Adw.PreferencesGroup({
        title: t('prefs.idlePanel.title'),
        description: t('prefs.idlePanel.description'),
    });
    const idlePanelItems = [
        ['idle-expand-clock', t('prefs.idlePanel.clock'), null],
        ['idle-expand-icon', t('prefs.idlePanel.icon'), null],
        ['idle-expand-battery', t('prefs.idlePanel.battery'), t('prefs.idlePanel.batterySubtitle')],
        ['idle-expand-bluetooth', t('prefs.idlePanel.bluetooth'), null],
        ['idle-expand-volume', t('prefs.idlePanel.volume'), null],
    ];
    for (const [key, title, subtitle] of idlePanelItems) {
        const props = subtitle ? { title, subtitle, use_markup: false } : { title, use_markup: false };
        const row = new Adw.SwitchRow(props);
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        idlePanelGroup.add(row);
    }
    settings.bind('always-visible', idlePanelGroup, 'sensitive', Gio.SettingsBindFlags.GET);
    return idlePanelGroup;
}
