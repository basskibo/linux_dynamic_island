#!/bin/sh
# gnome-extensions pack only picks up extension.js/prefs.js by default, so list the other modules
cd "$(dirname "$0")" && gnome-extensions pack --force --extra-source=island.js --extra-source=sources --extra-source=icons .
