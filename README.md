# Dynamic Island for GNOME 50

A compact music island that expands into a black, top-attached dashboard with playback controls, cover art, and a live date strip.

This is Yassine Mathlouthi's GNOME 50 fork of [Dynamic Island by basskibo / Bojan Jagetic](https://github.com/basskibo/linux_dynamic_island), based on upstream version 3.4.

## Screenshots

### Compact island

![Compact music island with cover art, track title, and visualizer](docs/screenshots/compact-island.png)

### Expanded dashboard

![Expanded black notch dashboard with playback controls, calendar, and account photo](docs/screenshots/expanded-dashboard.png)

### Desktop overview

![Dynamic Island attached beneath the GNOME top bar](docs/screenshots/desktop-overview.png)

## What's new in this fork

- **GNOME Shell 50 support**, including its updated volume/brightness OSD API.
- **Attached notch dashboard:** pure-black background, inward-curved top shoulders, rounded lower corners, and a Nook/Tray header.
- **Music controls:** large rounded cover art, bottom-right player badge, track/album/artist details, and previous/play-pause/next buttons.
- **Live date strip:** a five-day view centered on today, with today's date highlighted. Click the date summary or Tray to open GNOME's calendar/notifications.
- **Account tile:** uses the local account photo when available; clicking opens GNOME Camera if installed. It is not a live camera preview.
- **Configurable auto-hide:** defaults to 10 seconds. Song, playback, or action changes reveal the island again. Hovering pauses the countdown; leaving starts a fresh countdown.
- **Cover-art launcher:** after the island fully hides, a small circular cover appears immediately right of the top-bar clock. Hover or click to reopen the expanded dashboard.
- **Smoother transitions:** shorter hover delays, cached styles, fewer redundant layout rebuilds, and no simultaneous resize during auto-hide.
- **Notifications inside the island:** eligible app banners appear as temporary cards with app icon, title, message, open/close controls, and up to three action buttons. Incoming notifications queue by urgency and use your auto-hide timeout; hovering pauses the countdown. Closing a card keeps it in GNOME’s notification history. Clicking it activates the app’s notification normally.

The original MPRIS media support (Spotify, supported browsers, and other players), configurable positions/visualizers, and battery, Bluetooth, recording, and progress sources remain available.

Charger notifications use UPower's actual power-source status, not whether the battery is currently charging. Full batteries and charge-limit pauses no longer imply a disconnected charger. Power changes settle for 1.5 seconds before a notification to filter brief firmware/UPower glitches.

## Compatibility

- This fork targets **GNOME Shell 50**; it does not advertise compatibility with older Shell versions.
- Developed on **GNOME Shell 50.6 / Wayland**. Other distributions and panel-extension combinations may need additional verification.
- The date strip shows local dates, **not calendar event data**.
- Media integration depends on the application exposing MPRIS. Some browser players may not provide cover art; the clock launcher then uses an audio icon.

> This fork keeps the upstream UUID, `dynamic-island@bjagetic`. Installing it replaces an existing installation with that UUID; the two versions cannot be enabled side by side.

## Build and install

You need GNOME Shell 50, the `gnome-extensions` command, and GLib's schema compiler (`glib-compile-schemas`). No Python environment is needed to build or run the extension.

```bash
git clone https://github.com/yassine-mathlouthi/linux_dynamic_island.git
cd linux_dynamic_island
./pack.sh
gnome-extensions install --force dynamic-island@bjagetic.shell-extension.zip
```

**Log out and back in** so GNOME discovers the newly installed extension. Then enable it:

```bash
gnome-extensions enable dynamic-island@bjagetic
```

Open settings:

```bash
gnome-extensions prefs dynamic-island@bjagetic
```

For the screenshot layout, select **top-center** positioning and **hover** expansion.

### New feature settings

All of these apply live from the extension preferences:

| Section | Setting | Default |
| --- | --- | --- |
| Auto-hide | Enable / disable; countdown from 1–300 seconds | On, 10 seconds |
| Clock-side cover launcher | Enable / disable; circle diameter from 12–28 pixels | On, 20 pixels |
| Expanded dashboard | Show / hide date strip, account / Camera tile, and Nook / Tray header independently | All on |
| Interface animations | Enable / disable; speed from 25–200% (higher is faster) | On, 100% |
| Notifications | Replace normal app banners with island cards | On |
| Other extensions | Keep automatic Caffeine changes silent; show feedback only for manual toggles outside fullscreen | On |

Notification cards use the **Hide after** value even when island auto-hide is disabled. GNOME still decides which banners are eligible: app preferences, Do Not Disturb (with GNOME’s critical-alert exceptions), and fullscreen rules remain in effect. Cards are cleared on lock; lock-screen banners stay under GNOME’s control. Additional actions and full message text remain accessible in notification history. Turn off **App notifications in the island** to restore normal banners.

The cover launcher appears only after auto-hide, so turning auto-hide off also keeps the launcher hidden. Hiding the dashboard header does not prevent opening preferences with the command above. Interface transitions also respect GNOME’s system-wide animation setting; the music visualizer and optional vinyl spin remain separate effects.

### Updating after code changes

```bash
./pack.sh
gnome-extensions install --force dynamic-island@bjagetic.shell-extension.zip
```

On Wayland, log out and back in to load changed JavaScript reliably. Preferences changes apply without a logout.

### Disable or uninstall

```bash
gnome-extensions disable dynamic-island@bjagetic
gnome-extensions uninstall dynamic-island@bjagetic
```

## Caffeine integration

When [Caffeine](https://github.com/eonpatapon/gnome-shell-extension-caffeine) is installed, **Only manual Caffeine feedback** suppresses automatic enabled/disabled messages (for example on leaving fullscreen), while retaining status feedback for manual pointer, key, or touch toggles outside fullscreen. Caffeine's actual keep-awake state, fullscreen/media/app automation, settings, and installed files are not modified. Turning this option off or disabling Dynamic Island restores Caffeine's normal feedback. The integration was checked against Caffeine 61; unsupported versions are left untouched.

## Credits and licensing

Original extension: [basskibo/linux_dynamic_island](https://github.com/basskibo/linux_dynamic_island), by Bojan Jagetic and upstream contributors. GNOME 50 dashboard, auto-hide, cover launcher, and animation changes are maintained in this fork by [Yassine Mathlouthi](https://github.com/yassine-mathlouthi).

The upstream checkout did not include a project-level license when this fork was prepared. This fork does not add or imply a license for upstream code; clarify permissions with the original author before further redistribution or reuse. Third-party assets shown in screenshots belong to their respective owners.
