# Dynamic Island for GNOME

<img src="icon.png" width="96" alt="">

<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/39bb63b9-f8fb-444c-bd9d-0f3f877631af" />
<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/10144d60-060b-4ad1-964d-82738655068a" />
<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/9b18daea-04c7-4418-a638-b9b4c3043667" />

<img width="500" height="269" alt="image" src="https://github.com/user-attachments/assets/8ea98f0d-ac8b-4940-aafc-eaeee3c50711" />


iOS-style live island that shows what's playing (Spotify, YouTube in browsers, any MPRIS player).
Hover to expand with controls, click to open the player. Position is configurable in the extension settings: floating at a screen edge, or inside the top bar
(after Activities, left/right of the clock, before the system menu, or wrapped around the clock like the
iPhone notch). The music visualizer shape (bars, spectrum, segments, solid, wave, ribbon) and color are configurable too.

Supports GNOME Shell 46–50.

## What's New & Features

- **Always-Visible & Idle Modes:** Keep the island visible even when nothing is playing with 3 compact idle styles (**Empty black pill**, **Live clock `HH:MM`**, or **Minimal icon** with support for uploading a custom **SVG/PNG** icon).
- **Interactive Expanded Idle Panel:** Hover or click the idle pill to smoothly expand a customizable control panel with individually toggleable modules:
  - Large lock-screen style clock with localized full date.
  - Enlarged minimal or custom SVG/PNG icon.
  - Live battery status and charging indicator (automatically hidden on desktops).
  - Live Bluetooth connection and device battery summary.
  - Quick system volume control.
- **Apple-Inspired Minimalist Volume Control:** Available in both the two-tier expanded media card and the expanded idle panel:
  - Left dynamic thin-stroke speaker icon (`volume-x` at 0%, `volume-1` for 1–35%, `volume-2` for 36–100%) with click-to-mute/unmute that restores the previous volume level.
  - Center 6–7 px rounded pill slider supporting click, drag, and mouse-wheel scroll (`0–100%`) with bidirectional real-time PipeWire/PulseAudio sync.
  - Right tabular volume percentage (`72%`) that stays fixed-width with zero island resize jitter.
- **System OSD Takeover Toggle:** Enable or disable **Take over system OSD (Volume & brightness)** live in Preferences to switch between showing keyboard volume/brightness HUDs inside Dynamic Island or GNOME's default system OSD.
- **Temporary Dodge & Custom Permanent Position:**
  - Drag the island aside anytime when you need to click behind it; it stays quietly out of the way for a configurable duration (`dodge-duration`) before sliding back (or click once to return immediately).
  - Use **Set Position on Screen** / **Reset Position** in Preferences to anchor a permanent custom home spot on screen (temporary dodge still returns to your saved spot).
- **Preferences & Multi-Language Support:** Modular JSON localization (`locales/en.json`, `locales/tr.json`) with automatic system detection and instant switching, full non-ellipsized dropdown labels, and a **Reset to defaults** option.
- **GNOME 50 & Wayland Stability:** Smooth morph and entrance animations without opacity flicker, allocation-safe repositioning, pointer-grab-safe dragging on Clutter 18, and reliable auto-collapse when moving the cursor over Wayland application windows.

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
glib-compile-schemas --strict schemas/
./pack.sh
```

## Languages & Translations

Dynamic Island supports automatic system language detection as well as instant language switching from the extension preferences (**General → Language**).

Currently included languages:

- **English** (`locales/en.json`)
- **Turkish / Türkçe** (`locales/tr.json`)

Translations live as standalone JSON files inside the `locales/` directory. To add a new language:

1. Copy `locales/en.json` to `locales/<code>.json` using the lowercase ISO 639-1 language code (e.g. `locales/de.json`, `locales/fr.json`, or regional `locales/pt_br.json`).
2. Update `_meta.code` and `_meta.name` with the language code and its native name (e.g. `"Deutsch"`, `"Français"`).
3. Translate all string values while keeping `{placeholder}` tokens such as `{percent}` and `{name}` intact. Missing keys automatically fall back to `locales/en.json`.
4. Rebuild the package with `./pack.sh` — any new `.json` file in `locales/` is automatically discovered by `i18n.js` and shown in the Language selector.

## Contributors

- **[@basskibo](https://github.com/basskibo)** — Original Dynamic Island for GNOME extension, core MPRIS/OSD architecture, visualizers, and animations.
- **Enes ([@droithim](https://github.com/droithim))** — Always-visible & idle modes, interactive expanded idle panel, Apple-inspired minimalist volume control, OSD takeover toggle, temporary dodge & custom permanent positioning, modular multi-language i18n (including Turkish), and GNOME 50 / Wayland stability fixes.

