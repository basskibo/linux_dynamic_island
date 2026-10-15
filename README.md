# Dynamic Island for GNOME

iOS-style live island that shows what's playing (Spotify, YouTube in browsers, any MPRIS player).
Hover to expand with controls, click to open the player. Position is configurable in the extension settings.

Supports GNOME Shell 46–48.

## Install on another computer

```bash
gnome-extensions install --force dynamic-island@bjagetic.shell-extension.zip
```

Log out and back in (required on Wayland), then:

```bash
gnome-extensions enable dynamic-island@bjagetic
```

Settings: open the Extensions app → Dynamic Island → ⚙, or run `gnome-extensions prefs dynamic-island@bjagetic`.

## Build the zip after changes

```bash
./pack.sh
```
