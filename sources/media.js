import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import {MprisPlayer} from 'resource:///org/gnome/shell/ui/mpris.js';

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

const findApp = name => {
    const id = name && Shell.AppSystem.search(name)[0]?.[0];
    return id ? Shell.AppSystem.get_default().lookup_app(id) : null;
};

// Name and icon of the app playing. Browsers don't report their app (no DesktopEntry), so it's looked up by the
// player's name; YouTube is recognized from the track URL when the player sends one.
function sourceOf(player) {
    const identity = player._mprisProxy?.Identity ?? '';
    const app = player.app ?? findApp(identity);
    const url = player._playerProxy?.Metadata?.['xesam:url']?.deepUnpack() ?? '';
    return {
        name: /youtube\.com|youtu\.be/.test(url) ? 'YouTube' : app?.get_name() ?? identity,
        icon: app?.get_icon() ?? 'audio-x-generic-symbolic',
    };
}

// Tracks MPRIS media players and shows the active one on the island
export class MediaSource {
    constructor(island) {
        this._island = island;
        this._players = new Map();
        this._current = null;

        Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (connection, res) => {
                const [names] = connection.call_finish(res).deepUnpack();
                names.filter(n => n.startsWith(MPRIS_PREFIX)).forEach(n => this._addPlayer(n));
            });
        // arg0 namespace match must not end with '.'
        this._nameOwnerSub = Gio.DBus.session.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2',
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE, (connection, sender, path, iface, signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (newOwner && !oldOwner)
                    this._addPlayer(name);
            });
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._nameOwnerSub);
        for (const {player, handlerIds} of this._players.values())
            handlerIds.forEach(id => player.disconnect(id));
        this._players = null;
        this._current = null;
        this._island = null;
    }

    _update() {
        this._island.setPlayer(this._current, this._current && sourceOf(this._current));
    }

    _addPlayer(busName) {
        // The ListNames reply can arrive after destroy()
        if (!this._players || this._players.has(busName))
            return;
        const player = new MprisPlayer(busName);
        const handlerIds = [
            player.connect('changed', () => {
                // A player that starts playing takes over the island
                if (player.status === 'Playing' || !this._current)
                    this._current = player;
                this._update();
            }),
            player.connect('closed', () => {
                this._players.delete(busName);
                if (this._current === player) {
                    const rest = [...this._players.values()].map(entry => entry.player);
                    this._current = rest.find(p => p.status === 'Playing') ?? rest[0] ?? null;
                }
                this._update();
            }),
        ];
        this._players.set(busName, {player, handlerIds});
    }
}
