# Bug ledger

Shell-side fixes can't load under plain gjs, so those rows were checked by hand in a headless shell
(`gnome-shell --headless --wayland --virtual-monitor`, private D-Bus and config, fake MPRIS players).

| Bug | Guarded by |
| --- | --- |
| Island hides while music plays after another player goes Playing then Stopped | `tests/pick.test.js` |
| App with no title takes the island over as "Unknown title" | `tests/pick.test.js` |
| Cover art path from another app (`/dev/zero`, FIFO) can freeze the session | No automated test, needs a shell. Headless check: both rejected, real PNG accepted |
| Quote in cover art URL breaks out of the CSS `url()` | No automated test, needs a shell. `Gio.File.get_uri()` checked under gjs |
| Progress chip stuck after the app crashes | No automated test, needs a shell. Headless check: chip cleared when the sender left the bus |
