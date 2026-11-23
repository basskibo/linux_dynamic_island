# Dynamic Island for GNOME — User & Developer Guide

<img src="icon.png" width="72" alt="">

A complete guide to using, configuring, building, and contributing to **Dynamic Island for GNOME**.

Supports **GNOME Shell 46–50** (X11 and Wayland).

---

## 1. Installation & First Run

### Install from a `.zip` package

```bash
gnome-extensions install --force dynamic-island@bjagetic.shell-extension.zip
```

Log out and back in (required on Wayland so GNOME Shell loads the new files), then enable the extension:

```bash
gnome-extensions enable dynamic-island@bjagetic
```

### Open Preferences

- Open the **Extensions** app → **Dynamic Island** → **⚙**, or
- Run from a terminal:

```bash
gnome-extensions prefs dynamic-island@bjagetic
```

---

## 2. Everyday Usage & Interactions

### Media Playback
- Automatically detects active **MPRIS** players (Spotify, Rhythmbox, VLC, Chrome/Brave/Firefox tabs, YouTube, etc.).
- **Resting state:** Shows compact cover art, track title, and the live music visualizer.
- **Expanded state:** Hover (or click, depending on **Open details on**) to expand the two-tier media card with source app badge, artist name, previous / play-pause / next buttons, and the volume bar.
- **Open the player:** Click the island once (in **Hover** mode) or a second time (in **Click** mode) to bring the active media player window to the front.

### Apple-Inspired Volume Control
Available at the bottom of both the expanded media card and the expanded idle panel:
- **Mute / Unmute:** Click the speaker icon on the left to mute (`volume-x`, `0%`); click again to unmute and restore your previous volume level.
- **Adjust volume:** Click anywhere along the pill slider, drag smoothly across it, or scroll with the mouse wheel / touchpad (`0–100%`).
- **Two-way sync:** Reflects system PipeWire / PulseAudio volume and mute changes in real time with a fixed-width percentage label so the island never jitters.

### Idle Modes & Expanded Idle Panel
When **Always visible** is enabled and no media, toast, or indicator is active:
- **Compact idle pill:** Shows either an **Empty black pill**, a live **`HH:MM` clock**, or a **Minimal icon** (default or custom SVG/PNG).
- **Expanded idle panel:** Hover or click the idle pill to reveal any combination of:
  - Large lock-screen style clock with localized full date
  - Enlarged minimal or custom SVG/PNG icon
  - Live battery percentage and charging indicator *(auto-hidden on desktops without a battery)*
  - Live Bluetooth adapter state, connected device name, and device battery percentage
  - Quick volume slider

### Live System Toasts & Persistent Indicators
- **Volume & Brightness HUD:** Replaces GNOME's default OSD pop-up when **Take over system OSD (Volume & brightness)** is enabled.
- **Charger:** Shows plugged in, unplugged, and fully charged toasts via UPower.
- **Bluetooth:** Shows device connected / disconnected toasts (with battery percentage when reported).
- **Screen Recording:** Displays a red recording timer chip while GNOME's built-in screencast is active; click the chip to stop recording.
- **Download & Copy Progress:** Displays live percentage chips for apps publishing progress through the Unity `LauncherEntry` D-Bus API (e.g., Files / Nautilus, browsers).

### Temporary Dodge & Custom Permanent Position
- **Temporary Dodge:** Press and drag the island anywhere on screen when it covers something you need to click. It stays quietly out of the way for **Dodge return delay** seconds and then glides back home—or click it once to return immediately.
- **Custom Permanent Position:**
  1. Open **Preferences → Position → Custom permanent position** and click **Set Position on Screen**.
  2. The island highlights with a blue outline (`Drag to place`). Drag it to your preferred spot and release to save.
  3. Press **Esc** or click **Cancel** to abort without saving.
  4. Click **Reset Position** anytime to return to the standard preset location.
- **Fullscreen behavior:** Floating positions step aside during fullscreen video/apps (while volume/brightness toasts still appear so keyboard feedback is never lost). Top-bar positions hide naturally with the panel.

---

## 3. Preferences Reference

| Section | Setting | Description |
|---|---|---|
| **General** | **Language** | `System Default (Auto)`, `English`, `Türkçe`, or any custom JSON file added to `locales/`. Switches instantly without restarting GNOME Shell. |
| | **Always visible** | Keeps the island visible as a compact pill even when idle. |
| | **Idle content** | Content inside the resting idle pill: `Empty black pill`, `Clock (HH:MM)`, or `Minimal icon`. |
| | **Custom idle icon** | Pick any local `.svg` or `.png` file (up to 10 MB) or reset to the default icon. |
| **Expanded idle panel** | **Clock and date** / **Minimal / custom icon** / **Battery status** / **Bluetooth summary** / **Quick volume slider** | Toggle individual widgets shown when expanding the idle pill. |
| **Position** | **Location** | 6 floating positions (`top-*`, `bottom-*`) and 5 top-bar positions (`panel-left`, `panel-center-left`, `panel-center-right`, `panel-right`, `panel-notch`). |
| | **Distance from edge** | Screen edge margin in pixels (`0–300`, floating modes only). |
| | **Width** | Minimum width (`-10` to `800`). `0` fits content; negative values tighten resting padding/spacing. |
| | **Max text width** | Maximum title width in pixels (`40–600`) before ellipsizing. |
| | **Open details on** | `Hover`, `Click`, or `Hover or click`. |
| | **Dodge return delay** | Seconds (`1–60`) before a temporarily dragged island returns home. |
| | **Custom permanent position** | Interactively anchor or reset a custom `(x, y)` offset on screen. |
| **Cover art** | **Size** / **Expanded size** | Resting (`16–40 px`) and expanded (`32–120 px`) cover art dimensions. |
| | **Shape** | `Auto` (circle resting, rounded expanded), `Circle`, `Rounded square`, or `Square`. |
| | **Frame** | `None`, `Subtle`, `White`, or `Visualizer color`. |
| | **Show when resting** | Hide resting cover art for a slimmer pill. |
| | **Spin like a vinyl** | Smoothly rotates the cover art while music is playing. |
| **Music visualizer** | **Shape** | `Bars`, `Spectrum`, `Segments`, `Solid`, `Wave`, or `Ribbon`. |
| | **Color** | Custom hex accent color with one-click reset back to `#ff6a00`. |
| **Show in island** | **Take over system OSD**, **Charger**, **Screen recording**, **Bluetooth devices**, **Download and copy progress** | Independently enable or disable each live event source. |
| **Reset** | **Reset to defaults** | Restores all GSettings keys to schema defaults after confirmation. |

---

## 4. Architecture & Project Structure

The codebase separates Shell UI components (`ui/`), GTK4/Adwaita preferences (`prefs/`), system event sources (`sources/`), and translations (`locales/`) with a strict one-way dependency flow:

```text
.
├── extension.js            # Extension lifecycle (enable/disable) wiring Island & sources
├── island.js               # Main St.BoxLayout orchestrator, morph engine, GSettings routing
├── i18n.js                 # JSON locale loader, system detection, live language listeners
├── prefs.js                # ExtensionPreferences entry point & live-rebuild lifecycle
├── stylesheet.css          # GNOME Shell St CSS styling for all island states
├── pack.sh                 # Builds dynamic-island@bjagetic.shell-extension.zip
├── metadata.json           # Extension UUID, version, and supported GNOME Shell versions
├── icons/                  # Custom thin-stroke SVG icons (play, pause, next, prev, volume-*)
├── locales/                # Standalone JSON translation catalogs (en.json, tr.json, ...)
├── schemas/                # GSettings XML schema & compiled gschemas.compiled
├── sources/                # System data providers pushing state into Island
│   ├── media.js            # MPRIS D-Bus watcher & app/YouTube source resolution
│   ├── pick.js             # Active player priority ranking
│   ├── osd.js              # Reversible Main.osdWindowManager patch (GNOME 46–50)
│   ├── battery.js          # UPower DisplayDevice proxy (toasts + live idle battery status)
│   ├── bluetooth.js        # GnomeBluetooth.Client watcher (toasts + live idle summary)
│   ├── recording.js        # GNOME ScreenshotUI screencast timer & stop button
│   └── progress.js         # Unity LauncherEntry D-Bus download/copy progress
├── ui/                     # Modular GNOME Shell UI controllers owned by island.js
│   ├── layout.js           # Layout geometry presets, constants, icon & date helpers
│   ├── positioner.js       # Panel slot, notch clock alignment, deferred _scheduleReposition
│   ├── mediaView.js        # Cover art async cache, vinyl spin, track info & playback buttons
│   ├── visualizer.js       # 6-style Cairo visualizer with mapped-aware Clutter.Timeline
│   ├── toastIndicators.js  # Temporary toast HUD & persistent indicator chips
│   ├── idlePanel.js        # Compact idle pill, 3-column expanded idle panel & clock timer
│   ├── volumeControl.js    # Apple-style slider, scroll, mute toggle, PipeWire/PA sync
│   ├── dragController.js   # Clutter.Grab drag engine, temporary dodge & permanent pin mode
│   └── hoverController.js  # Hover-intent delay & Wayland-safe outside click/pointer watcher
└── prefs/                  # Modular GTK4/Adwaita Preferences UI (isolated from Shell imports)
    ├── widgets.js          # Non-ellipsized wrapping Adw.ComboRow factory
    ├── generalGroups.js    # General settings, custom icon FileDialog & idle panel toggles
    ├── layoutGroups.js     # Position, dimensions, drag/dodge settings & reset confirmation
    └── appearanceGroups.js # Cover art, visualizer style/color & feature toggles
```

> **Note for contributors:** `prefs.js` and `prefs/*.js` run in a separate GTK4/Adwaita process and must never import `island.js` or `ui/*.js`. Similarly, modules under `ui/` communicate back to `island.js` exclusively through injected callbacks to avoid circular dependencies and ensure deterministic teardown in `_onDestroy()`.

---

## 5. Development, Packaging & Testing

### Syntax & Schema Checks

```bash
for f in extension.js i18n.js island.js prefs.js ui/*.js prefs/*.js sources/*.js; do
    node --check "$f"
done
glib-compile-schemas --strict schemas/
```

### Build the Extension Package

```bash
./pack.sh
```

`pack.sh` passes `--extra-source` for `i18n.js`, `island.js`, `ui`, `prefs`, `locales`, `sources`, and `icons`, producing `dynamic-island@bjagetic.shell-extension.zip`.

### Isolated Headless GNOME Shell Test

To test changes safely without touching your live desktop session or settings:

```bash
TMP=$(mktemp -d)
EXT="$TMP/data/gnome-shell/extensions/dynamic-island@bjagetic"
mkdir -p "$EXT" "$TMP/config" "$TMP/cache"
unzip -q dynamic-island@bjagetic.shell-extension.zip -d "$EXT"
glib-compile-schemas "$EXT/schemas"

dbus-run-session -- env \
    XDG_DATA_HOME="$TMP/data" \
    XDG_CONFIG_HOME="$TMP/config" \
    XDG_CACHE_HOME="$TMP/cache" \
    GSETTINGS_BACKEND=memory \
    MUTTER_DEBUG_DUMMY_MODE_SPECS="1920x1080" \
    gnome-shell --headless --virtual-monitor 1920x1080
```

Enable/disable inside the same `dbus-run-session` with `gnome-extensions enable dynamic-island@bjagetic` and inspect logs for zero `JS ERROR`, `St-CRITICAL`, and `needs an allocation` messages.

### Adding a New Translation

1. Copy `locales/en.json` to `locales/<code>.json` (e.g. `locales/de.json`, `locales/fr.json`, or `locales/pt_br.json`).
2. Update `_meta.code` and `_meta.name` with the locale code and native display name.
3. Translate every string value while keeping `{placeholder}` tokens (`{percent}`, `{name}`, `{count}`, `{weekday}`, `{day}`, `{month}`) unchanged. Any missing key falls back to `locales/en.json`.
4. Run `./pack.sh` — `i18n.js` automatically discovers new files in `locales/` without code changes.

---

## 6. Troubleshooting

- **Changes don't appear after installing a new `.zip`:** On Wayland, GNOME Shell caches loaded ES modules for the session. Log out and back in after running `gnome-extensions install --force ...`.
- **Island doesn't show for a music player:** Verify the player exposes MPRIS (`org.mpris.MediaPlayer2.*`) on the session D-Bus and sends a non-empty track title.
- **Want the default GNOME/Ubuntu volume pop-up back:** Turn off **Preferences → Show in island → Take over system OSD (Volume & brightness)**.
- **Island is stuck off-screen or in an unexpected position:** Open **Preferences → Position → Custom permanent position → Reset Position**, or reset all settings from the terminal:

```bash
dconf reset -f /org/gnome/shell/extensions/dynamic-island/
```
