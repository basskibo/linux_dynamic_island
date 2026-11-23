import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_LANGUAGE = 'en';
const DECODER = new TextDecoder('utf-8');

export const SUPPORTED_LANGUAGES = [
    {code: 'auto', nameKey: 'prefs.language.auto', name: 'System Default (Auto)'},
    {code: 'en', name: 'English'},
    {code: 'tr', name: 'Türkçe'},
];

let _localesDir = null;
let _fallbackCatalog = null;
let _activeCatalog = null;
let _activeLanguage = DEFAULT_LANGUAGE;
let _discovered = false;
let _settings = null;
let _settingsSignalId = 0;
const _catalogCache = new Map();
const _listeners = new Set();

function getLocalesDir() {
    if (!_localesDir)
        _localesDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('locales');
    return _localesDir;
}

function loadCatalog(code) {
    if (!code || code === 'auto')
        return null;
    if (_catalogCache.has(code))
        return _catalogCache.get(code);

    const file = getLocalesDir().get_child(`${code}.json`);
    if (!file.query_exists(null))
        return null;

    try {
        const [, bytes] = file.load_contents(null);
        const parsed = JSON.parse(DECODER.decode(bytes));
        if (parsed && typeof parsed === 'object') {
            _catalogCache.set(code, parsed);
            return parsed;
        }
    } catch (e) {
        console.warn(`dynamic-island: failed to load locale "${code}": ${e.message}`);
    }
    return null;
}

function ensureFallback() {
    if (!_fallbackCatalog)
        _fallbackCatalog = loadCatalog(DEFAULT_LANGUAGE) ?? {};
    return _fallbackCatalog;
}

/**
 * Discovers any additional `locales/*.json` files so contributors can add a
 * language by dropping a JSON file into `locales/` without editing code.
 */
export function discoverLanguages() {
    if (_discovered)
        return SUPPORTED_LANGUAGES;
    _discovered = true;

    const known = new Set(SUPPORTED_LANGUAGES.map(l => l.code));
    const extras = [];

    try {
        const enumerator = getLocalesDir().enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_file_type() !== Gio.FileType.REGULAR)
                continue;
            const filename = info.get_name();
            if (!filename.endsWith('.json'))
                continue;
            const code = filename.slice(0, -5);
            if (!code || code === 'auto' || known.has(code))
                continue;
            const catalog = loadCatalog(code);
            const name = catalog?._meta?.name || code.toUpperCase();
            known.add(code);
            extras.push({code, name});
        }
        enumerator.close(null);
    } catch (e) {
        console.warn(`dynamic-island: failed to scan locales directory: ${e.message}`);
    }

    extras.sort((a, b) => a.code.localeCompare(b.code));
    SUPPORTED_LANGUAGES.push(...extras);
    return SUPPORTED_LANGUAGES;
}

function resolveSystemLanguage() {
    const dir = getLocalesDir();
    const candidates = GLib.get_language_names();

    for (const raw of candidates) {
        if (!raw || raw === 'C' || raw === 'POSIX')
            continue;
        // Strip encoding (".UTF-8") and modifier ("@euro"), normalize separators
        const clean = raw.split('.')[0].split('@')[0].replace(/-/g, '_').toLowerCase();
        if (!clean)
            continue;

        // Exact locale match first (e.g. pt_br.json), then base language (e.g. tr.json)
        if (dir.get_child(`${clean}.json`).query_exists(null))
            return clean;

        const base = clean.split('_')[0];
        if (base && dir.get_child(`${base}.json`).query_exists(null))
            return base;
    }

    return DEFAULT_LANGUAGE;
}

export function setLanguage(preference = 'auto') {
    discoverLanguages();
    ensureFallback();

    const target = !preference || preference === 'auto'
        ? resolveSystemLanguage()
        : preference;

    const catalog = loadCatalog(target);
    _activeLanguage = catalog ? target : DEFAULT_LANGUAGE;
    _activeCatalog = catalog ?? _fallbackCatalog;

    for (const listener of _listeners) {
        try {
            listener(_activeLanguage);
        } catch (e) {
            console.warn(`dynamic-island: i18n listener error: ${e.message}`);
        }
    }

    return _activeLanguage;
}

export function initI18n(settings) {
    destroyI18n();
    _settings = settings;
    setLanguage(settings.get_string('language'));
    _settingsSignalId = settings.connect('changed::language', () => {
        setLanguage(settings.get_string('language'));
    });
}

export function destroyI18n() {
    if (_settings && _settingsSignalId)
        _settings.disconnect(_settingsSignalId);
    _settings = null;
    _settingsSignalId = 0;
    _listeners.clear();
}

export function onLanguageChanged(callback) {
    _listeners.add(callback);
    return () => _listeners.delete(callback);
}

export function getActiveLanguage() {
    return _activeLanguage;
}

export function getLanguageChoices() {
    discoverLanguages();
    return SUPPORTED_LANGUAGES.map(lang => [
        lang.code,
        lang.nameKey ? t(lang.nameKey) : lang.name,
    ]);
}

/**
 * Translates a key using the active locale, falling back to English (`en.json`)
 * and finally the key itself. Replaces `{placeholder}` tokens when `params` is given.
 */
export function t(key, params = null) {
    const fallback = ensureFallback();
    if (!_activeCatalog)
        _activeCatalog = fallback;

    let value = _activeCatalog[key];
    if (typeof value !== 'string')
        value = fallback[key];
    if (typeof value !== 'string')
        return key;

    if (params) {
        for (const [name, replacement] of Object.entries(params))
            value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
}

export const _ = t;
