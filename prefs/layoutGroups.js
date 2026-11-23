import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { t } from '../i18n.js';
import { createComboRow } from './widgets.js';

const POSITION_KEYS = [
    'top-center', 'top-left', 'top-right',
    'bottom-center', 'bottom-left', 'bottom-right',
    'panel-left', 'panel-center-left',
    'panel-center-right', 'panel-right',
    'panel-notch',
];

const EXPAND_ON_KEYS = ['hover', 'click', 'both'];

export function buildPositionGroup(settings, pageSignalIds) {
    const group = new Adw.PreferencesGroup({ title: t('prefs.position.title') });

    const positions = POSITION_KEYS.map(key => [key, t(`prefs.position.${key}`)]);
    const position = createComboRow({
        title: t('prefs.position.location'),
        choices: positions,
        selectedKey: settings.get_string('position'),
        onChange: code => settings.set_string('position', code),
    });

    const margin = new Adw.SpinRow({
        title: t('prefs.margin.title'),
        subtitle: t('prefs.margin.subtitle'),
        use_markup: false,
        adjustment: new Gtk.Adjustment({ lower: 0, upper: 300, step_increment: 1, page_increment: 10 }),
    });
    settings.bind('margin', margin, 'value', Gio.SettingsBindFlags.DEFAULT);

    const width = new Adw.SpinRow({
        title: t('prefs.width.title'),
        subtitle: t('prefs.width.subtitle'),
        use_markup: false,
        adjustment: new Gtk.Adjustment({ lower: -10, upper: 800, step_increment: 1, page_increment: 10 }),
    });
    settings.bind('width', width, 'value', Gio.SettingsBindFlags.DEFAULT);

    const textWidth = new Adw.SpinRow({
        title: t('prefs.textWidth.title'),
        subtitle: t('prefs.textWidth.subtitle'),
        use_markup: false,
        adjustment: new Gtk.Adjustment({ lower: 40, upper: 600, step_increment: 10, page_increment: 50 }),
    });
    settings.bind('text-width', textWidth, 'value', Gio.SettingsBindFlags.DEFAULT);

    const expandOptions = EXPAND_ON_KEYS.map(key => [key, t(`prefs.expandOn.${key}`)]);
    const expandOn = createComboRow({
        title: t('prefs.expandOn.title'),
        subtitle: t('prefs.expandOn.subtitle'),
        choices: expandOptions,
        selectedKey: settings.get_string('expand-on'),
        onChange: code => settings.set_string('expand-on', code),
    });

    group.add(position);
    group.add(margin);
    group.add(width);
    group.add(textWidth);
    group.add(expandOn);

    const dodgeDuration = new Adw.SpinRow({
        title: t('prefs.drag.dodgeDuration.title'),
        subtitle: t('prefs.drag.dodgeDuration.subtitle'),
        use_markup: false,
        adjustment: new Gtk.Adjustment({ lower: 1, upper: 60, step_increment: 1, page_increment: 5 }),
    });
    settings.bind('dodge-duration', dodgeDuration, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(dodgeDuration);

    const customPosRow = new Adw.ActionRow({
        title: t('prefs.drag.customPos.title'),
        use_markup: false,
    });
    const setPosBtn = new Gtk.Button({
        valign: Gtk.Align.CENTER,
    });
    setPosBtn.connect('clicked', () => {
        settings.set_boolean('positioning-active', !settings.get_boolean('positioning-active'));
    });
    const resetPosBtn = new Gtk.Button({
        label: t('prefs.drag.customPos.resetButton'),
        valign: Gtk.Align.CENTER,
    });
    resetPosBtn.connect('clicked', () => {
        settings.set_boolean('positioning-active', false);
        settings.reset('pin-active');
        settings.reset('pin-offset-x');
        settings.reset('pin-offset-y');
    });
    customPosRow.add_suffix(setPosBtn);
    customPosRow.add_suffix(resetPosBtn);
    group.add(customPosRow);

    const syncPositioningRow = () => {
        const picking = settings.get_boolean('positioning-active');
        const pinned = settings.get_boolean('pin-active');
        customPosRow.subtitle = t(
            picking ? 'prefs.drag.customPos.subtitlePicking'
                : pinned ? 'prefs.drag.customPos.subtitleActive'
                    : 'prefs.drag.customPos.subtitleDefault'
        );
        setPosBtn.label = t(picking ? 'prefs.drag.customPos.cancelButton' : 'prefs.drag.customPos.setButton');
        if (picking) {
            setPosBtn.remove_css_class('suggested-action');
            setPosBtn.add_css_class('destructive-action');
        } else {
            setPosBtn.remove_css_class('destructive-action');
            setPosBtn.add_css_class('suggested-action');
        }
        resetPosBtn.sensitive = pinned;
    };
    syncPositioningRow();
    pageSignalIds.push(
        settings.connect('changed::positioning-active', syncPositioningRow),
        settings.connect('changed::pin-active', syncPositioningRow)
    );

    return group;
}

export function buildResetGroup(window, settings, scheduleRebuild) {
    const resetGroup = new Adw.PreferencesGroup();
    const resetRow = new Adw.ActionRow({
        title: t('prefs.reset.title'),
        subtitle: t('prefs.reset.subtitle'),
        use_markup: false,
    });
    const resetAllButton = new Gtk.Button({
        label: t('prefs.reset.button'),
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    resetAllButton.connect('clicked', () => {
        const dialog = new Adw.AlertDialog({
            heading: t('prefs.reset.confirmTitle'),
            body: t('prefs.reset.confirmBody'),
        });
        dialog.add_response('cancel', t('prefs.reset.cancel'));
        dialog.add_response('reset', t('prefs.reset.confirm'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');
        dialog.set_close_response('cancel');
        dialog.connect('response', (_dlg, response) => {
            if (response !== 'reset')
                return;
            for (const key of settings.settings_schema.list_keys())
                settings.reset(key);
            scheduleRebuild();
        });
        dialog.present(window);
    });
    resetRow.add_suffix(resetAllButton);
    resetRow.activatable_widget = resetAllButton;
    resetGroup.add(resetRow);
    return resetGroup;
}
