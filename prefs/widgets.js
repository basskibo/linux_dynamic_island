import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

export function createChoiceRow(settings, key, title, choices) {
    return createComboRow({
        title,
        choices,
        selectedKey: settings.get_string(key),
        onChange: code => settings.set_string(key, code),
    });
}

// ComboRow with wrapping, non-ellipsized labels in both the row and dropdown list so full translations show
export function createComboRow({ title, subtitle = null, choices, selectedKey, onChange }) {
    const valueFactory = new Gtk.SignalListItemFactory();
    valueFactory.connect('setup', (_f, item) => {
        item.child = new Gtk.Label({
            xalign: 1,
            justify: Gtk.Justification.RIGHT,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.NONE,
            max_width_chars: 32,
        });
    });
    valueFactory.connect('bind', (_f, item) => {
        item.child.label = item.item.string;
    });

    const props = {
        title,
        use_markup: false,
        model: Gtk.StringList.new(choices.map(p => p[1])),
        selected: Math.max(0, choices.findIndex(p => p[0] === selectedKey)),
        factory: valueFactory,
    };
    if (subtitle)
        props.subtitle = subtitle;

    const row = new Adw.ComboRow(props);

    const listFactory = new Gtk.SignalListItemFactory();
    listFactory.connect('setup', (_f, item) => {
        const box = new Gtk.Box({ spacing: 8 });
        const label = new Gtk.Label({
            xalign: 0,
            hexpand: true,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            ellipsize: Pango.EllipsizeMode.NONE,
            max_width_chars: 42,
        });
        const check = new Gtk.Image({ icon_name: 'object-select-symbolic' });
        box.append(label);
        box.append(check);
        item.child = box;
    });
    listFactory.connect('bind', (_f, item) => {
        const label = item.child.get_first_child();
        const check = label.get_next_sibling();
        label.label = item.item.string;
        const syncCheck = () => {
            check.opacity = row.selected === item.position ? 1 : 0;
        };
        syncCheck();
        item._selectedId = row.connect('notify::selected', syncCheck);
    });
    listFactory.connect('unbind', (_f, item) => {
        if (item._selectedId) {
            row.disconnect(item._selectedId);
            item._selectedId = 0;
        }
    });
    row.list_factory = listFactory;

    row.connect('notify::selected', () => {
        const code = choices[row.selected]?.[0];
        if (code !== undefined)
            onChange(code);
    });
    return row;
}
