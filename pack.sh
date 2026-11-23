#!/bin/sh
# gnome-extensions pack only picks up extension.js/prefs.js by default, so list the other modules
cd "$(dirname "$0")" && gnome-extensions pack --force --extra-source=i18n.js --extra-source=island.js --extra-source=ui --extra-source=prefs --extra-source=locales --extra-source=sources --extra-source=icons .
