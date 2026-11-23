import Gio from 'gi://Gio';

import { t } from '../i18n.js';

export const BAR_W = 170;
export const ART_MAX_BYTES = 10 * 1024 * 1024;
export const SPACING = 12;

export const ART_RADIUS = {
    circle: size => size / 2,
    rounded: size => size / 4,
    square: () => 0,
};

// Resting and expanded layouts from the settings. padding is [top, right, bottom, left].
// A negative width tightens the resting island (less padding and spacing), handy around the clock.
export function buildLayouts(settings) {
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
        panelCompact: { ...compact, padding: [panelPad, Math.max(0, 12 - tighten), panelPad, 3] },
        expanded: { radius: 28, padding: [12, 16, 12, 14], spacing: SPACING, artSize: big, artRadius: radius(big, ART_RADIUS.rounded), expanded: true },
        idleExpanded: { radius: 26, padding: [14, 22, 14, 22], spacing: SPACING, artSize: small, artRadius: radius(small, ART_RADIUS.circle), expanded: true },
    };
}

export const ART_BORDER = {
    subtle: () => '1px solid rgba(255,255,255,0.3)',
    white: () => '2px solid #fff',
    accent: settings => `2px solid ${settings.get_string('accent-color')}`,
};

// Top bar positions: [panel box, index in box, which way the expanded island grows (0 right, 1 left)].
// 'panel-notch' wraps around the clock like the iPhone island around the camera.
export const PANEL_SLOTS = {
    'panel-notch': ['_centerBox', 0, null],
    'panel-left': ['_leftBox', -1, 0],
    'panel-center-left': ['_centerBox', 0, 1],
    'panel-center-right': ['_centerBox', -1, 0],
    'panel-right': ['_rightBox', 0, 1],
};

export const easeOutExpo = t => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const lerp = (a, b, p) => a + (b - a) * p;

// Resolve icons/ relative to the extension root (one level above ui/)
const ICONS = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('icons');
export const loadIcon = name => new Gio.FileIcon({ file: ICONS.get_child(`${name}.svg`) });

export const toGicon = icon => typeof icon === 'string' ? new Gio.ThemedIcon({ name: icon }) : icon;

export function formatLocalizedDate(dt) {
    const weekdays = t('date.weekdays').split(',');
    const months = t('date.months').split(',');
    const weekday = weekdays[dt.get_day_of_week() % 7] ?? '';
    const month = months[dt.get_month() - 1] ?? '';
    return t('date.format', { weekday, day: dt.get_day_of_month(), month });
}
